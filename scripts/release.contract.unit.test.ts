import { describe, expect, test } from 'vite-plus/test';

import { Git } from '@jnana-app/commands/git';
import {
    type Scripted,
    type ScriptedAnswer,
    type ScriptedCall,
    scripted,
} from '@jnana-app/commands/scripted';
import { Security } from '@jnana-app/commands/security';
import { Tsc } from '@jnana-app/commands/tsc';
import { Vp } from '@jnana-app/commands/vp';
import { Yarn } from '@jnana-app/commands/yarn';

import { release, type ReleaseHost } from './release.ts';

const ROOT = '/repo';
const PACKAGE_JSON = 'packages/rati/package.json';
const UPSTREAM = 'refs/remotes/origin/main';

/** One start any wrapper made, in the order the release made it. */
interface Call {
    /** The program, its argv, and ` <<< <stdin>` where the start was handed input. */
    line: string;
    env: Readonly<Record<string, string>>;
}

type Answers = Record<string, Omit<ScriptedAnswer, 'args'>>;

interface Scenario {
    /** Answers per start, keyed by the argv after the program joined with spaces. */
    git?: Answers;
    yarn?: Answers;
    vp?: Answers;
    security?: Answers;
    missing?: string[];
    built?: number;
    version?: string;
    /** The version `yarn version <bump>` writes, per bump. */
    bumps?: Record<string, string>;
    dist?: boolean;
    confirms?: boolean;
}

const KEYCHAIN_READ = 'find-generic-password -a maintainer -s npm_token_rati -w';

const HEALTHY: { git: Answers; yarn: Answers; vp: Answers; security: Answers } = {
    git: {
        'rev-parse --path-format=absolute --show-toplevel --git-common-dir HEAD --symbolic-full-name HEAD':
            { stdout: `${ROOT}\n${ROOT}/.git\nabc\nrefs/heads/main\n` },
        'status --porcelain=v1 -z --untracked-files=normal': {},
        'fetch --quiet origin main': {},
        'rev-parse --symbolic-full-name @{upstream}': { stdout: `${UPSTREAM}\n` },
        'cat-file --batch-check': { stdout: 'abc commit 220\nabc commit 220\n' },
        [`restore -- ${PACKAGE_JSON}`]: {},
        [`commit --quiet --file=- -- ${PACKAGE_JSON}`]: {},
        'push --follow-tags origin main': {},
    },
    yarn: {
        'npm whoami --publish': { stdout: '➤ YN0000: nazar\n➤ YN0000: Done in 0s 120ms\n' },
    },
    vp: { 'test --run': {} },
    security: { [KEYCHAIN_READ]: { stdout: 'npm_secret\n' } },
};

/** The wrapper's answers: the healthy ones under the scenario's, and every bump, tag and publish
 *  the cases reach answering `0`. */
function answersOf(healthy: Answers, scenario: Answers | undefined): ScriptedAnswer[] {
    return Object.entries({ ...healthy, ...scenario }).map(([args, answer]) => ({
        ...answer,
        args: args.split(' '),
    }));
}

/** `wrapper`, each operation appending the starts it made to `log` in the order it made them. */
function logging<W extends Scripted>(wrapper: W, log: Call[]): W {
    return new Proxy(wrapper, {
        get(target, key) {
            const member: unknown = Reflect.get(target, key, target);
            if (typeof member !== 'function') return member;
            return (...args: unknown[]): unknown => {
                const before = target.calls.length;
                const answer: unknown = Reflect.apply(member, target, args);
                for (const call of target.calls.slice(before)) log.push(callOf(call));
                return answer;
            };
        },
    });
}

function callOf(call: ScriptedCall): Call {
    const input = call.operation === 'start' ? undefined : call.spec.input;
    const line = [call.program, ...(call.spec.args ?? [])].join(' ');
    return {
        line: typeof input === 'string' ? `${line} <<< ${input}` : line,
        env: call.spec.env ?? {},
    };
}

/** A host over scripted wrappers: package.json's version is the one piece of disk state, written by
 *  `yarn version` and put back by `git restore`. */
function scriptedHost(scenario: Scenario = {}) {
    const original = scenario.version ?? '0.7.1';
    const bumps: Record<string, string> = { patch: '0.7.2', minor: '0.8.0', ...scenario.bumps };
    const calls: Call[] = [];
    const out: string[] = [];
    const err: string[] = [];
    // Every bump, tag and publish answers `0` unless the scenario keys one.
    const fallback = Array.from({ length: 8 }, (): ScriptedAnswer => ({}));
    const git = new (scripted(Git))().answer(...answersOf(HEALTHY.git, scenario.git), ...fallback);
    const yarn = new (scripted(Yarn))().answer(
        ...answersOf(HEALTHY.yarn, scenario.yarn),
        ...fallback,
    );
    const vp = new (scripted(Vp))().answer(...answersOf(HEALTHY.vp, scenario.vp));
    const security = new (scripted(Security))().answer(
        ...answersOf(HEALTHY.security, scenario.security),
    );
    // `build` is the host's, so the release itself starts no compile.
    const tsc = new (scripted(Tsc))();

    const diskVersion = (): string => {
        let version = original;
        for (const { line } of calls) {
            const bumped = /^yarn workspace rati version (\S+)$/.exec(line)?.[1];
            if (bumped !== undefined) version = bumps[bumped] ?? version;
            if (line === `git restore -- ${PACKAGE_JSON}`) version = original;
        }
        return version;
    };

    const host: ReleaseHost = {
        programs: {
            git: logging(git, calls),
            yarn: logging(yarn, calls),
            vp: logging(vp, calls),
            security: logging(security, calls),
            tsc: logging(tsc, calls),
            compiler: '/repo/node_modules/typescript/bin/tsc',
        },
        root: ROOT,
        hasCommand: (name) => !(scenario.missing ?? []).includes(name),
        attached: async (step) => (await step.exited).status,
        build: async () => {
            calls.push({ line: 'build rati', env: {} });
            return scenario.built ?? 0;
        },
        readVersion: async () => diskVersion(),
        hasDist: async () => scenario.dist ?? true,
        confirm: async (question) => {
            out.push(question);
            return scenario.confirms ?? false;
        },
        out: (line) => out.push(line),
        err: (line) => err.push(line),
        user: 'maintainer',
    };
    const ran = (prefix: string): boolean => calls.some(({ line }) => line.startsWith(prefix));
    const transcript = (): string =>
        [
            ...calls.map(({ line }) => `$ ${line}`),
            ...out,
            ...err.map((line) => `stderr: ${line}`),
        ].join('\n');
    return { host, diskVersion, calls, out, err, ran, transcript };
}

/** What no refused or dry run may reach: a commit, a tag, a real publish or a push. */
function assertNothingShipped(run: ReturnType<typeof scriptedHost>): void {
    const shipped = run.calls.filter(
        ({ line }) =>
            line.startsWith('git commit') ||
            line.startsWith('git tag') ||
            line.startsWith('git push') ||
            (line.startsWith('yarn workspace rati npm publish') && !line.endsWith('--dry-run')),
    );
    expect(shipped, run.transcript()).toEqual([]);
}

describe('arguments', () => {
    test('with no bump given, the bump is patch', async () => {
        const run = scriptedHost();
        expect(await release(['--dry-run'], run.host), run.transcript()).toBe(0);
        expect(run.ran('yarn workspace rati version patch'), run.transcript()).toBe(true);
    });

    test('a first argument that is no flag is the bump', async () => {
        const run = scriptedHost();
        expect(await release(['minor', '--dry-run'], run.host), run.transcript()).toBe(0);
        expect(run.out.join('\n'), run.transcript()).toContain('rati@0.8.0');
    });

    test.each([
        { argv: ['--frobnicate'] },
        { argv: ['minor', 'major'] },
        { argv: ['--dry-run', 'minor'] },
    ])(
        'refuses $argv with an unknown-option error before running any command',
        async ({ argv }) => {
            const run = scriptedHost();
            expect(await release(argv, run.host), run.transcript()).toBe(1);
            expect(run.err.join('\n'), run.transcript()).toContain('Unknown option:');
            expect(run.calls, run.transcript()).toEqual([]);
        },
    );

    test.each([{ argv: ['--otp'] }, { argv: ['--otp', 'l23456'] }])(
        'refuses $argv, an --otp with no code of digits after it, before running any command',
        async ({ argv }) => {
            const run = scriptedHost();
            expect(await release(argv, run.host), run.transcript()).toBe(1);
            expect(run.calls, run.transcript()).toEqual([]);
        },
    );
});

describe('refusals', () => {
    test.each<[string, Scenario, string]>([
        ['yarn is missing', { missing: ['yarn'] }, 'yarn not found'],
        ['the Keychain tool is missing', { missing: ['security'] }, "'security' tool not found"],
        [
            'the branch is not main',
            {
                git: {
                    'rev-parse --path-format=absolute --show-toplevel --git-common-dir HEAD --symbolic-full-name HEAD':
                        { stdout: `${ROOT}\n${ROOT}/.git\nabc\nrefs/heads/feature\n` },
                },
            },
            "On branch 'feature', expected 'main'.",
        ],
        [
            'the tree is dirty',
            {
                git: {
                    'status --porcelain=v1 -z --untracked-files=normal': { stdout: ' M a.ts\0' },
                },
            },
            'dirty',
        ],
        [
            'main is out of sync with its upstream',
            { git: { 'cat-file --batch-check': { stdout: 'abc commit 220\ndef commit 220\n' } } },
            'not in sync with origin/main',
        ],
        [
            'the Keychain holds no token',
            { security: { [KEYCHAIN_READ]: { status: 44 } } },
            'No token in Keychain',
        ],
        [
            'the token fails to authenticate',
            {
                yarn: {
                    'npm whoami --publish': { status: 1, stdout: '➤ YN0041: Invalid auth' },
                },
            },
            'Token failed to authenticate',
        ],
        ['the build leaves no dist/', { dist: false }, 'Build produced no dist/.'],
    ])('refuses when %s, before the version bump', async (_case, scenario, message) => {
        const run = scriptedHost(scenario);
        expect(await release([], run.host), run.transcript()).toBe(1);
        expect(run.err.join('\n'), run.transcript()).toContain(message);
        expect(run.ran('yarn workspace rati version'), run.transcript()).toBe(false);
        assertNothingShipped(run);
    });

    test('the sync check reads HEAD against the upstream git names, after the fetch', async () => {
        const run = scriptedHost();
        await release(['--dry-run'], run.host);
        const lines = run.calls.map(({ line }) => line);
        expect(lines.indexOf('git fetch --quiet origin main'), run.transcript()).toBeLessThan(
            lines.indexOf(`git cat-file --batch-check <<< HEAD\n${UPSTREAM}\n`),
        );
    });

    test('the Keychain read asks for the npm token under the login name', async () => {
        const run = scriptedHost();
        await release(['--dry-run'], run.host);
        expect(run.ran(`security ${KEYCHAIN_READ}`), run.transcript()).toBe(true);
    });

    test("a failing test run ends the release with the tests' exit code, before the version bump", async () => {
        const run = scriptedHost({ vp: { 'test --run': { status: 3 } } });
        expect(await release([], run.host), run.transcript()).toBe(3);
        expect(run.ran('build rati'), run.transcript()).toBe(false);
        expect(run.ran('yarn workspace rati version'), run.transcript()).toBe(false);
    });

    test("a failing build ends the release with the build's exit code, before the version bump", async () => {
        const run = scriptedHost({ built: 127 });
        expect(await release([], run.host), run.transcript()).toBe(127);
        expect(run.err.join('\n'), run.transcript()).toContain('Build failed.');
        expect(run.ran('yarn workspace rati version'), run.transcript()).toBe(false);
    });

    test('anything but y at the prompt aborts and puts package.json back', async () => {
        const run = scriptedHost({ confirms: false });
        expect(await release(['minor'], run.host), run.transcript()).toBe(1);
        expect(run.err.join('\n'), run.transcript()).toContain('Aborted.');
        expect(run.diskVersion(), run.transcript()).toBe('0.7.1');
        assertNothingShipped(run);
    });

    test('a failed publish names the undo and pushes nothing', async () => {
        const run = scriptedHost({
            yarn: { 'workspace rati npm publish --tag latest': { status: 1 } },
        });
        expect(await release(['--yes'], run.host), run.transcript()).toBe(1);
        expect(run.err.join('\n'), run.transcript()).toContain(
            'git tag -d v0.7.2 && git reset --hard HEAD~1',
        );
        expect(run.ran('git push'), run.transcript()).toBe(false);
    });
});

describe('the dry run', () => {
    test('prints the plan, runs the publish dry, and puts package.json back', async () => {
        const run = scriptedHost();
        expect(await release(['--dry-run'], run.host), run.transcript()).toBe(0);
        const printed = run.out.join('\n');
        expect(printed, run.transcript()).toContain(
            'DRY RUN — would publish rati@0.7.2 (dist-tag: latest)',
        );
        expect(printed, run.transcript()).toContain('Dry run complete');
        expect(
            run.ran('yarn workspace rati npm publish --tag latest --dry-run'),
            run.transcript(),
        ).toBe(true);
        expect(run.diskVersion(), run.transcript()).toBe('0.7.1');
        assertNothingShipped(run);
    });

    test.each([
        ['0.8.0-alpha.1', 'alpha'],
        ['0.8.0-rc.2', 'rc'],
        ['0.8.0-0', 'next'],
    ])('a prerelease %s plans the dist-tag %s', async (version, distTag) => {
        const run = scriptedHost({ bumps: { prerelease: version } });
        expect(await release(['prerelease', '--dry-run'], run.host), run.transcript()).toBe(0);
        expect(run.out.join('\n'), run.transcript()).toContain(
            `rati@${version} (dist-tag: ${distTag})`,
        );
    });
});

describe('a confirmed release', () => {
    test('commits and tags the bump, publishes, then pushes the commit with its tag', async () => {
        const run = scriptedHost({ confirms: true });
        expect(await release(['--otp', '123456'], run.host), run.transcript()).toBe(0);
        const shipped = run.calls
            .map(({ line }) => line)
            .filter((line) => /^git (commit|tag|push)|npm publish/.test(line));
        expect(shipped, run.transcript()).toEqual([
            `git commit --quiet --file=- -- ${PACKAGE_JSON} <<< release: rati v0.7.2`,
            'git tag --annotate --file=- v0.7.2 <<< release: rati v0.7.2',
            'yarn workspace rati npm publish --tag latest --otp 123456',
            'git push --follow-tags origin main',
        ]);
        expect(run.out.join('\n'), run.transcript()).toContain('Authenticated as: nazar');
        expect(run.out.join('\n'), run.transcript()).toContain('✓ Published rati@0.7.2');
    });

    test('the npm token reaches the yarn npm commands and no other', async () => {
        const run = scriptedHost();
        await release(['--yes'], run.host);
        const carrying = run.calls
            .filter(({ env }) => env['YARN_NPM_AUTH_TOKEN'] === 'npm_secret')
            .map(({ line }) => line);
        expect(carrying, run.transcript()).toEqual([
            'yarn npm whoami --publish',
            'yarn workspace rati npm publish --tag latest',
        ]);
    });
});
