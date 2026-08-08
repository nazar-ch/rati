// scripts/ci.ts — the release ritual: the two checks the kit's standard battery does NOT run
// (`yarn ci`, or `node scripts/ci.ts` directly — Node 26 runs TS as-is). Every stage runs even when
// an earlier one fails; the summary names the failures and the exit code is theirs.
//
//   node scripts/ci.ts                        # both stages
//   node scripts/ci.ts build                  # one, by name
//   FUZZ_RUNS=2000 node scripts/ci.ts fuzz    # deepen the randomized stage
//   FUZZ_SEED=7 node scripts/ci.ts fuzz       # pin the seed (reproduce a failure)
//
// THIS IS NOT THE PRE-PUSH GATE, and until jnana-kit:KC-13 it was. `.claude/kit.json`'s `verify`
// now names the kit's standard battery, which runs fmt, lint, typecheck, the Markdown and doc-link
// gates, the control-byte scan, the `@jnana-app/kit` conformance checks and the full Vitest suite —
// every stage this file used to carry except the two below. The `GATE_STAGES` list that used to sit
// at the bottom of this file, and the identical list in `.claude/kit.json`, went with them: two
// hand-written lists that "move together" is the coupling the battery exists to delete, and the run
// stamp they existed to guard is written by the battery's own wrapper now.
//
// So what is left is the deliberate residue — the two things a gate should not pay for on every
// push, run before a release or when you touch the mandala engine or the packaging:
//
//   - `fuzz` re-runs only the randomized suites at a raised budget (default 500 — the mandala-fuzz
//     effort's deep-run bar). The battery's `test` step runs the same suites at their deliberately
//     tiny default budget, which is seconds; the distinction is MF-04's finding, that an unpinned
//     default-budget green is weak evidence for the fuzz invariants and the deep budget is what
//     makes a green mean something (docs/archive/efforts/mandala-fuzz/README.md §Findings — the
//     effort archived, and this pointer had been left at its planned/ path).
//   - `build` produces the library bundle + d.ts and both example apps. Nothing type-checks the
//     emit, and a bundle that fails to build is a release-time fact, not a per-push one.

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { $ } from 'zx';
import type { ProcessPromise } from 'zx';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// `vp` lives in the workspace bin — a bare shell (cron, a future CI job) won't have it. Bracket
// access throughout: `process.env` is an index signature, and this file is in a tsc program now.
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
