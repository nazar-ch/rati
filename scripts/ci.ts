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
//     than a per-push one.

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { $ } from 'zx';
import type { ProcessPromise } from 'zx';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// `vp` lives in the workspace bin, which a bare shell's PATH lacks.
process.env['PATH'] = `${path.join(root, 'node_modules', '.bin')}:${process.env['PATH']}`;

// Live output (a gate you watch), aggregated exits (a gate that always finishes).
const sh = $({ stdio: 'inherit', nothrow: true, cwd: root });

const exitOf = async (command: ProcessPromise): Promise<number> => (await command).exitCode ?? 1;

// Sequential on purpose throughout: interleaved compiler/test output is unreadable, and
// the point of this script is a readable transcript of what failed.
const runAll = async (selectors: string[]): Promise<number> => {
    for (const selector of selectors) {
        const code = await exitOf(sh`vp run ${selector}`);
        if (code !== 0) return code;
    }
    return 0;
};

const fuzzRuns = process.env['FUZZ_RUNS'] ?? '500';

type Stage = { name: string; what: string; run: () => Promise<number> };

const stages: Stage[] = [
    {
        name: 'fuzz',
        what: `the randomized suites at FUZZ_RUNS=${fuzzRuns}`,
        run: () =>
            exitOf(
                sh({
                    cwd: path.join(root, 'packages', 'rati'),
                    env: { ...process.env, FUZZ_RUNS: fuzzRuns },
                })`vp test run fuzz/`,
            ),
    },
    {
        name: 'build',
        what: 'the library bundle + d.ts, then both example apps',
        run: () => runAll(['rati#build', 'demo#build', 'ssr-demo#build']),
    },
];

const requested = process.argv.slice(2);
const byName = new Map(stages.map((stage) => [stage.name, stage]));
const unknown = requested.filter((name) => !byName.has(name));
if (unknown.length) {
    console.error(
        `unknown stage(s): ${unknown.join(', ')} (want: ${stages.map((stage) => stage.name).join(' | ')}).\n` +
            `The pre-push gate moved to the kit's standard battery — .claude/kit.json's \`verify\` ` +
            `names it, and it carries every stage this file used to.`,
    );
    process.exit(2);
}
const selected = requested.length ? requested.map((name) => byName.get(name)!) : stages;

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
    process.exit(1);
}
console.log('all stages passed.');
