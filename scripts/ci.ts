// scripts/ci.ts — the release ritual: the two checks the kit's standard battery does NOT run
// (`yarn ci`, or `node scripts/ci.ts` directly). Every stage runs even when an earlier one fails;
// the summary names the failures and the exit code is theirs.
//
//   node scripts/ci.ts                        # both stages
//   node scripts/ci.ts build                  # one, by name
//   FUZZ_RUNS=<n> node scripts/ci.ts fuzz     # deepen the randomized stage
//   FUZZ_SEED=<n> node scripts/ci.ts fuzz     # pin the seed (reproduce a failure)
//
// THIS IS NOT THE PRE-PUSH GATE — that is bare `verify.ts`, the kit's standard battery. These are
// the two checks no push pays for, run before a release or after a change to the mandala engine or
// the packaging:
//
//   - `fuzz` re-runs only the randomized suites at a raised budget: the battery's `test` step runs
//     them at a tiny default budget, which is weak evidence for the fuzz invariants.
//   - `build` produces the library bundle + d.ts and both example apps, a release-time fact rather
//     than a per-push one; ./steps.ts composes each workspace's build.
//
// Every start goes through a wrapper of @jnana-app/commands, built in the `import.meta.main` block
// and handed to `ci`.

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Vp } from '@jnana-app/commands/vp';

import { attached, buildWorkspace, type Workspace } from './steps.ts';

/** The wrappers `ci` starts its stages through. */
export interface CiPrograms {
    readonly vp: Vp;
}

type Stage = { name: string; what: string; run: () => Promise<number> };

function stagesOf(programs: CiPrograms, root: string, fuzzRuns: string): Stage[] {
    // Sequential on purpose throughout: interleaved compiler/test output is unreadable, and
    // the point of this script is a readable transcript of what failed.
    const buildAll = async (workspaces: readonly Workspace[]): Promise<number> => {
        for (const workspace of workspaces) {
            const code = await buildWorkspace(workspace, programs.vp, root);
            if (code !== 0) return code;
        }
        return 0;
    };
    return [
        {
            name: 'fuzz',
            what: `the randomized suites at FUZZ_RUNS=${fuzzRuns}`,
            run: () =>
                attached(
                    // `JNANA_FUZZ` is the switch that builds the kit definer's `fuzz` projects.
                    programs.vp.testFuzz({
                        cwd: root,
                        env: { JNANA_FUZZ: '1', FUZZ_RUNS: fuzzRuns },
                        paths: [],
                    }),
                ),
        },
        {
            name: 'build',
            what: 'the library bundle + d.ts, then both example apps',
            run: () => buildAll(['rati', 'demo', 'ssr-demo']),
        },
    ];
}

/** Runs the stages `argv` names, every stage where it names none, and answers the exit code. */
export async function ci(
    argv: readonly string[],
    programs: CiPrograms,
    root: string,
    fuzzRuns: string,
): Promise<number> {
    const stages = stagesOf(programs, root, fuzzRuns);
    const byName = new Map(stages.map((stage) => [stage.name, stage]));
    const unknown = argv.filter((name) => !byName.has(name));
    if (unknown.length) {
        console.error(
            `unknown stage(s): ${unknown.join(', ')} (want: ${stages.map((stage) => stage.name).join(' | ')}).\n` +
                `The pre-push gate is bare \`verify.ts\`, the kit's standard battery.`,
        );
        return 2;
    }
    const selected = argv.length
        ? argv.map((name) => byName.get(name)).filter((stage) => stage !== undefined)
        : stages;

    const results: { stage: Stage; code: number; seconds: number }[] = [];
    for (const stage of selected) {
        console.log(`\n== ci: ${stage.name} — ${stage.what}`);
        const started = Date.now();
        const code = await stage.run();
        results.push({ stage, code, seconds: Math.round((Date.now() - started) / 1000) });
    }

    console.log('\n==== ci summary ====');
    for (const { stage, code, seconds } of results) {
        console.log(`  ${code === 0 ? 'PASS' : `FAIL rc=${code}`}  ${stage.name}  (${seconds}s)`);
    }
    const failures = results.filter(({ code }) => code !== 0).length;
    if (failures) {
        console.log(`${failures} stage(s) failed.`);
        return 1;
    }
    console.log('all stages passed.');
    return 0;
}

if (import.meta.main) {
    const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    // `vp` lives in the workspace bin, which a bare shell's PATH lacks.
    process.env['PATH'] = `${path.join(root, 'node_modules', '.bin')}:${process.env['PATH']}`;
    process.exitCode = await ci(
        process.argv.slice(2),
        { vp: new Vp() },
        root,
        process.env['FUZZ_RUNS'] ?? '500',
    );
}
