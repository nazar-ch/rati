// scripts/steps.ts — the starts ci.ts and release.ts share: a gate step with the terminal attached,
// and each workspace's build as its package.json `build` script composes it, one operation of
// @jnana-app/commands per command of the script.
//
// A command no operation composes runs through `noOperation`, which starts nothing and fails the
// build, so a build never reads as green past a step it skipped (kit◊CK-14).

import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import type { Started } from '@jnana-app/commands/command';
import type { Vp } from '@jnana-app/commands/vp';

/** The status `noOperation` answers: a shell's "command not found". */
const NO_OPERATION = 127;

/** Prints that no operation starts `argv` in `cwd`, starts nothing, and answers {@link NO_OPERATION}. */
function noOperation(argv: readonly string[], cwd: string): number {
    console.error(
        `✗ no @jnana-app/commands operation starts \`${argv.join(' ')}\` in ${cwd}, so it did not run`,
    );
    return NO_OPERATION;
}

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

/** A workspace ci.ts builds, by its package name. */
export type Workspace = 'rati' | 'demo' | 'ssr-demo';

const WORKSPACE_DIRS: Record<Workspace, string> = {
    rati: 'packages/rati',
    demo: 'examples/demo',
    'ssr-demo': 'examples/ssr',
};

/** Builds `workspace` of the checkout at `root`, its output streamed, and answers the status of
 *  the first step that failed, `0` where none did. */
export async function buildWorkspace(workspace: Workspace, vp: Vp, root: string): Promise<number> {
    const cwd = path.join(root, WORKSPACE_DIRS[workspace]);
    const bundle = (): number => vp.build({ cwd, streamed: true }).status;
    switch (workspace) {
        case 'rati': {
            const bundled = bundle();
            if (bundled !== 0) return bundled;
            const declared = noOperation(['tsc', '-p', 'tsconfig.build.json'], cwd);
            if (declared !== 0) return declared;
            const client = path.join('vite', 'client.d.ts');
            await copyFile(path.join(cwd, 'src', client), path.join(cwd, 'dist', client));
            return 0;
        }
        case 'demo': {
            const checked = noOperation(['tsc', '--noEmit', '-p', 'src/tsconfig.json'], cwd);
            return checked !== 0 ? checked : bundle();
        }
        case 'ssr-demo':
            return bundle();
    }
}
