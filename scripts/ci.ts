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
//
// A run that covers the pre-push gate also leaves jnana-kit's run stamp — see the last
// section of this file.

import { existsSync } from 'node:fs';
import os from 'node:os';
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

// Where the kit checkout is. Two consumers below want it for opposite reasons, so it is resolved
// once: the `doc-links` stage RUNS a gate out of it and fails when it is not there, while
// `stampGate` merely reports to it and stays silent when it is not.
const kitHome = process.env.JNANA_KIT_HOME || path.join(os.homedir(), 'Sites', 'jnana-kit');

type Stage = { name: string; what: string; run: () => Promise<number> };

const stages: Stage[] = [
    { name: 'fmt', what: 'oxfmt, check only', run: () => exitOf(sh`vp fmt --check`) },
    { name: 'lint', what: 'oxlint, repo-wide', run: () => exitOf(sh`vp lint`) },
    {
        name: 'doc-links',
        what: "the kit's doc-link and doc-style gate, over every tracked .md",
        // The checker lives in the kit checkout, not here (jnana-kit:DS-28 graduated its doc-style
        // half to a hard gate). A missing checkout FAILS this stage rather than skipping it: a
        // consumer runs on an exported kit path by contract, and a gate that quietly measured
        // nothing would read exactly like one that passed.
        run: async (): Promise<number> => {
            const runNode = path.join(kitHome, 'tools', 'run-node.sh');
            const checker = path.join(kitHome, 'tools', 'check-doc-links.ts');
            if (!existsSync(runNode) || !existsSync(checker)) {
                console.error(
                    `ci: no kit checkout at ${kitHome} — this gate lives there. Export ` +
                        `JNANA_KIT_HOME (.claude/kit.json names the seam) and re-run.`,
                );
                return 1;
            }
            return exitOf(sh`sh ${runNode} ${checker} --gate`);
        },
    },
    {
        name: 'control-char-scan',
        what: "the kit's raw-C0-byte gate, over the whole text corpus",
        // Also wired as a staged task in `vite.config.ts`, which only ever sees what is being
        // committed; this is the corpus half. Worth both: a NUL makes ripgrep skip a file
        // SILENTLY, so one that predates the gate never surfaces from a commit-scoped check.
        // This repo had four, in `hydrationDiagnostics.ts`, which also made git treat that file
        // as binary — found by the first whole-corpus run.
        //
        // A missing kit checkout FAILS rather than skips, for the same reason `doc-links` above
        // does: a gate that quietly measured nothing reads exactly like one that passed.
        run: async (): Promise<number> => {
            const scan = path.join(kitHome, 'tools', 'ci-control-char-scan.sh');
            if (!existsSync(scan)) {
                console.error(
                    `ci: no kit checkout at ${kitHome} — this gate lives there. Export ` +
                        `JNANA_KIT_HOME (.claude/kit.json names the seam) and re-run.`,
                );
                return 1;
            }
            return exitOf(sh`bash ${scan} --all`);
        },
    },
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

// --- the jnana-kit run stamp -----------------------------------------------------------
//
// jnana-kit's Stop hook nudges a session that pushes a branch without running its gate, and
// it knows a gate ran because the gate SAID so: `verify-stamp.ts`, called as the gate's last
// step with the verdict. Until that seam existed the hook could only see gates that ARE the
// kit's shared runner over `verify:*` scripts; ours is `yarn ci`, so a rati session could
// skip the gate and push in silence — which is literally the session that produced the
// finding (jnana-kit:FND-03, closed for rati by jnana-kit:FND-32).
//
// ONLY A RUN THAT COVERS THE PRE-PUSH GATE STAMPS. `yarn ci fmt` is a spot-check, not the
// gate, and a green stamp from one would silence the hook for a session that never ran the
// other three — a false green, which is worse than the silence being fixed. So this list is
// the stage set `.claude/kit.json` `verify` names, and drift between the two can only cost a
// stamp (silence), never buy a wrong one.
const GATE_STAGES = ['fmt', 'lint', 'doc-links', 'control-char-scan', 'typecheck', 'test'];

// Fire-and-forget by the seam's own contract: its exit status is not this gate's, and it
// exits 0 for every reason it could not stamp. A machine with no kit checkout is simply not
// a case the reminder serves, so it does not stamp and says nothing about it.
const stampGate = async (ok: boolean): Promise<void> => {
    if (!GATE_STAGES.every((name) => selected.some((stage) => stage.name === name))) return;
    const runNode = path.join(kitHome, 'tools', 'run-node.sh');
    const seam = path.join(kitHome, 'tools', 'verify-stamp.ts');
    if (!existsSync(runNode) || !existsSync(seam)) return;
    await sh`sh ${runNode} ${seam} ${ok ? 'ok' : 'failed'}`;
};

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
// Before the exit below, so a red gate stamps its red: "ran red, pushed anyway" is a state
// the kit's hook can name, and only if this runs on both paths.
await stampGate(failures === 0);
if (failures) {
    console.log(`${failures} stage(s) failed.`);
    process.exit(1);
}
console.log('all stages passed.');
