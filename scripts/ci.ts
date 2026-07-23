// scripts/ci.ts — the whole verification gate in one command (`yarn ci`, or
// `node scripts/ci.ts` directly — Node 26 runs TS as-is). Every stage runs even when an
// earlier one fails; the summary names the failures and the exit code is theirs. Today
// this is the manual "CI" — run it before handing work over, or as the nightly-style
// deep pass; when a hosted CI lane is worth wiring, a job runs this file unchanged.
//
//   node scripts/ci.ts                        # every stage
//   node scripts/ci.ts lint test              # a subset, by name
//   FUZZ_RUNS=2000 node scripts/ci.ts fuzz    # deepen the randomized stage
//   FUZZ_SEED=7 node scripts/ci.ts fuzz       # pin the seed (reproduce a failure)
//
// The `test` stage is the day-to-day suite at its deliberately tiny fuzz budget (seconds);
// the `fuzz` stage re-runs only the randomized suites at a raised budget (default 500 —
// the mandala-fuzz effort's deep-run bar). The distinction is MF-04's finding: an unpinned
// default-budget green is weak evidence for the fuzz invariants — the deep budget is what
// makes a green mean something (docs/planned/mandala-fuzz/README.md §Findings).

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { $ } from 'zx';
import type { ProcessPromise } from 'zx';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// `vp` lives in the workspace bin — a bare shell (cron, a future CI job) won't have it.
process.env.PATH = `${path.join(root, 'node_modules', '.bin')}:${process.env.PATH}`;

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

const fuzzRuns = process.env.FUZZ_RUNS ?? '500';

type Stage = { name: string; what: string; run: () => Promise<number> };

const stages: Stage[] = [
    { name: 'fmt', what: 'oxfmt, check only', run: () => exitOf(sh`vp fmt --check`) },
    { name: 'lint', what: 'oxlint, repo-wide', run: () => exitOf(sh`vp lint`) },
    {
        name: 'typecheck',
        what: 'tsc (native TS7) over every workspace, src and test trees',
        run: () =>
            runAll([
                'rati#typecheck',
                'rati#typecheck:test',
                'demo#typecheck',
                'ssr-demo#typecheck',
            ]),
    },
    {
        name: 'test',
        what: 'the full Vitest suite (+ type tests), default fuzz budget',
        run: () => runAll(['rati#test']),
    },
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
        `unknown stage(s): ${unknown.join(', ')} (want: ${stages.map((stage) => stage.name).join(' | ')})`,
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
