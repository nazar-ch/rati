// scripts/steps.ts — the starts ci.ts makes: a gate step with the terminal attached, and each
// workspace's build as its package.json `build` script composes it, one operation of
// @jnana-app/commands per command of the script.

import { readFileSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

import type { Started } from '@jnana-app/commands/command';
import type { Tsc } from '@jnana-app/commands/tsc';
import type { Vp } from '@jnana-app/commands/vp';

/** Copies the step's output to this process's own and answers its exit status; a SIGINT here
 *  reaches the step, which leads a process group of its own, and then ends this process. */
export async function attached(step: Started): Promise<number> {
    step.stdout?.pipe(process.stdout, { end: false });
    step.stderr?.pipe(process.stderr, { end: false });
    const interrupt = (): void => {
        step.kill({ signal: 'SIGINT' });
        // why-void: `exited` never rejects (it answers how the program ended), so nothing escapes.
        void step.exited.then(() => process.exit(130));
    };
    process.once('SIGINT', interrupt);
    const { status } = await step.exited;
    process.off('SIGINT', interrupt);
    return status;
}

/** The absolute path of the `tsc` bin of the `typescript` package rati declares. */
export function declaredCompiler(): string {
    // `typescript`'s `exports` leaves out `bin/tsc`, so the bin is read off its manifest.
    const manifestPath = createRequire(import.meta.url).resolve('typescript/package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { bin?: { tsc?: unknown } };
    const bin = manifest.bin?.tsc;
    if (typeof bin !== 'string') throw new Error(`${manifestPath} declares no \`tsc\` bin`);
    return path.join(path.dirname(manifestPath), bin);
}

/** The wrappers a workspace build starts through, and the compiler `tsc` runs. */
export interface BuildPrograms {
    readonly vp: Vp;
    readonly tsc: Tsc;
    readonly compiler: string;
}

/** A workspace ci.ts builds, by its package name. */
export type Workspace = 'rati' | 'demo' | 'ssr-demo';

const WORKSPACE_DIRS: Record<Workspace, string> = {
    rati: 'packages/rati',
    demo: 'examples/demo',
    'ssr-demo': 'examples/ssr',
};

/** Builds `workspace` of the checkout at `root`, its output streamed, and answers the status of
 *  the first step that failed, `0` where none did. */
export async function buildWorkspace(
    workspace: Workspace,
    { vp, tsc, compiler }: BuildPrograms,
    root: string,
): Promise<number> {
    const cwd = path.join(root, WORKSPACE_DIRS[workspace]);
    const bundle = (): number => vp.build({ cwd, streamed: true }).status;
    switch (workspace) {
        case 'rati': {
            const bundled = bundle();
            if (bundled !== 0) return bundled;
            const project = 'tsconfig.build.json';
            const declared = tsc.emitProject({ compiler, project, cwd, streamed: true }).status;
            if (declared !== 0) return declared;
            const client = path.join('vite', 'client.d.ts');
            await copyFile(path.join(cwd, 'src', client), path.join(cwd, 'dist', client));
            return 0;
        }
        case 'demo': {
            const project = 'src/tsconfig.json';
            const checked = tsc.checkProject({ compiler, project, cwd, streamed: true }).status;
            return checked !== 0 ? checked : bundle();
        }
        case 'ssr-demo':
            return bundle();
    }
}
