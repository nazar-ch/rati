import { describe, expect, test } from 'vite-plus/test';

import { type Captured, type ExtraEnv, release, type ReleaseHost } from './release.ts';

const PACKAGE_JSON = 'packages/rati/package.json';

interface Call {
    command: string;
    env: ExtraEnv;
}

interface Scenario {
    /** Exit code and stdout per command, keyed by the command joined with spaces. */
    commands?: Record<string, Partial<Captured>>;
    missing?: string[];
    version?: string;
    /** The version `yarn version <bump>` writes, per bump. */
    bumps?: Record<string, string>;
    dist?: boolean;
    confirms?: boolean;
}

const HEALTHY: Record<string, Partial<Captured>> = {
    'git rev-parse --abbrev-ref HEAD': { stdout: 'main\n' },
    'git rev-parse --abbrev-ref @{u}': { stdout: 'origin/main\n' },
    'git rev-parse @': { stdout: 'abc\n' },
    'git rev-parse origin/main': { stdout: 'abc\n' },
    'security find-generic-password -a maintainer -s npm_token_rati -w': { stdout: 'npm_secret\n' },
    'yarn npm whoami --publish': { stdout: '➤ YN0000: nazar\n➤ YN0000: Done in 0s 120ms\n' },
};

/** A host over a scripted repo: package.json's version is the one piece of disk state, written by
 *  `yarn version` and put back by `git checkout`. */
function scriptedHost(scenario: Scenario = {}) {
    const original = scenario.version ?? '0.7.1';
    const disk = { version: original };
    const calls: Call[] = [];
    const out: string[] = [];
    const err: string[] = [];
    const commands = { ...HEALTHY, ...scenario.commands };
    const bumps: Record<string, string> = { patch: '0.7.2', minor: '0.8.0', ...scenario.bumps };

    const exec = (command: readonly string[], env: ExtraEnv = {}): Captured => {
        const line = command.join(' ');
        calls.push({ command: line, env });
        const bumped = bumps[/^yarn workspace rati version (\S+)$/.exec(line)?.[1] ?? ''];
        if (bumped !== undefined) disk.version = bumped;
        if (line === `git checkout -- ${PACKAGE_JSON}`) disk.version = original;
        return { exitCode: 0, stdout: '', stderr: '', ...commands[line] };
    };

    const host: ReleaseHost = {
        capture: async (command, env) => exec(command, env),
        attached: async (command, env) => exec(command, env).exitCode,
        hasCommand: async (name) => !(scenario.missing ?? []).includes(name),
        readVersion: async () => disk.version,
        hasDist: async () => scenario.dist ?? true,
        confirm: async (question) => {
            out.push(question);
            return scenario.confirms ?? false;
        },
        out: (line) => out.push(line),
        err: (line) => err.push(line),
        user: 'maintainer',
    };
    const ran = (prefix: string): boolean =>
        calls.some(({ command }) => command.startsWith(prefix));
    const transcript = (): string =>
        [
            ...calls.map(({ command }) => `$ ${command}`),
            ...out,
            ...err.map((line) => `stderr: ${line}`),
        ].join('\n');
    return { host, disk, calls, out, err, ran, transcript };
}

/** What no refused or dry run may reach: a commit, a tag, a real publish or a push. */
function assertNothingShipped(run: ReturnType<typeof scriptedHost>): void {
    const shipped = run.calls.filter(
        ({ command }) =>
            command.startsWith('git commit') ||
            command.startsWith('git tag') ||
            command.startsWith('git push') ||
            (command.startsWith('yarn workspace rati npm publish') &&
                !command.endsWith('--dry-run')),
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

    test('refuses --otp with no code after it', async () => {
        const run = scriptedHost();
        expect(await release(['--otp'], run.host), run.transcript()).toBe(1);
        expect(run.calls, run.transcript()).toEqual([]);
    });
});

describe('refusals', () => {
    test.each<[string, Scenario, string]>([
        ['yarn is missing', { missing: ['yarn'] }, 'yarn not found'],
        ['the Keychain tool is missing', { missing: ['security'] }, "'security' tool not found"],
        [
            'the branch is not main',
            { commands: { 'git rev-parse --abbrev-ref HEAD': { stdout: 'feature\n' } } },
            "On branch 'feature', expected 'main'.",
        ],
        [
            'the tree is dirty',
            { commands: { 'git status --porcelain': { stdout: ' M a.ts\n' } } },
            'dirty',
        ],
        [
            'main is out of sync with its upstream',
            { commands: { 'git rev-parse origin/main': { stdout: 'def\n' } } },
            'not in sync with origin/main',
        ],
        [
            'the Keychain holds no token',
            {
                commands: {
                    'security find-generic-password -a maintainer -s npm_token_rati -w': {
                        exitCode: 44,
                    },
                },
            },
            'No token in Keychain',
        ],
        [
            'the token fails to authenticate',
            {
                commands: {
                    'yarn npm whoami --publish': { exitCode: 1, stdout: '➤ YN0041: Invalid auth' },
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

    test("a failing test run ends the release with the tests' exit code, before the version bump", async () => {
        const run = scriptedHost({ commands: { 'yarn workspace rati test': { exitCode: 3 } } });
        expect(await release([], run.host), run.transcript()).toBe(3);
        expect(run.ran('yarn workspace rati build'), run.transcript()).toBe(false);
        expect(run.ran('yarn workspace rati version'), run.transcript()).toBe(false);
    });

    test('anything but y at the prompt aborts and puts package.json back', async () => {
        const run = scriptedHost({ confirms: false });
        expect(await release(['minor'], run.host), run.transcript()).toBe(1);
        expect(run.err.join('\n'), run.transcript()).toContain('Aborted.');
        expect(run.disk.version, run.transcript()).toBe('0.7.1');
        assertNothingShipped(run);
    });

    test('a failed publish names the undo and pushes nothing', async () => {
        const run = scriptedHost({
            commands: { 'yarn workspace rati npm publish --tag latest': { exitCode: 1 } },
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
        expect(run.disk.version, run.transcript()).toBe('0.7.1');
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
            .map(({ command }) => command)
            .filter((command) => /^git (commit|tag|push)|npm publish/.test(command));
        expect(shipped, run.transcript()).toEqual([
            `git commit -q -m release: rati v0.7.2 -- ${PACKAGE_JSON}`,
            'git tag -a v0.7.2 -m release: rati v0.7.2',
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
            .map(({ command }) => command);
        expect(carrying, run.transcript()).toEqual([
            'yarn npm whoami --publish',
            'yarn workspace rati npm publish --tag latest',
        ]);
    });
});
