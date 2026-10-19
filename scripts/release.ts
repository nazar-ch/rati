#!/usr/bin/env run-node.sh
// scripts/release.ts — bumps, tags and publishes the `rati` package to npmjs, from a clean `main`
// in sync with origin; docs/current/RELEASING.md is the maintainer's guide, the one-time Keychain
// setup included.
//
//   scripts/release.ts [bump] [--yes] [--otp <code>] [--dry-run]
//
//   [bump]   patch (default) | minor | major | prepatch | preminor | premajor
//            | prerelease, or an explicit version like 0.5.0
//
// `--dry-run` bumps package.json, prints the plan, runs `yarn npm publish --dry-run`, and restores
// package.json: no commit, tag, publish or push.
//
// `release` takes its commands, its reads and its terminal as a `ReleaseHost`, so
// ./release.contract.unit.test.ts drives every refusal and the dry run's plan in-process; the
// `import.meta.main` block hands it the real one.

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { $, live, which } from '@jnana-app/kit/lib/zx';

const PACKAGE = 'rati';
const KEYCHAIN_SERVICE = 'npm_token_rati';
const RELEASE_BRANCH = 'main';
// yarn's default registry is its read-only mirror, so publishing points at npmjs.
const PUBLISH_REGISTRY = 'https://registry.npmjs.org';
const PACKAGE_JSON = `packages/${PACKAGE}/package.json`;

/** What a captured command left behind. */
export interface Captured {
    exitCode: number;
    stdout: string;
    stderr: string;
}

/** Environment variables a command runs with on top of the script's own. */
export type ExtraEnv = Readonly<Record<string, string>>;

/** Everything `release` reaches outside its own memory, each command run from the repo root. */
export interface ReleaseHost {
    /** Runs a command to completion with its output captured; resolves even on a non-zero exit. */
    capture(command: readonly string[], env?: ExtraEnv): Promise<Captured>;
    /** Runs a command with the terminal attached and resolves its exit code. */
    attached(command: readonly string[], env?: ExtraEnv): Promise<number>;
    hasCommand(name: string): Promise<boolean>;
    /** The `version` field of the package's package.json, read from disk at the call. */
    readVersion(): Promise<string>;
    /** Whether the package's `dist/` directory exists. */
    hasDist(): Promise<boolean>;
    /** Prints the question and resolves `true` on a single `y` or `Y` keypress, `false` otherwise. */
    confirm(question: string): Promise<boolean>;
    out(line: string): void;
    err(line: string): void;
    /** The login name the Keychain entry is stored under. */
    user: string;
}

/** A refusal: the message printed after `✗`, and the exit code it ends the run with. */
class Refusal extends Error {
    readonly exitCode: number;

    constructor(message: string, exitCode = 1) {
        super(message);
        this.exitCode = exitCode;
    }
}

interface Options {
    bump: string;
    assumeYes: boolean;
    otp: string;
    dryRun: boolean;
}

function parseOptions(argv: readonly string[]): Options {
    const [first = '', ...flags] = argv;
    // Only a NON-FLAG first argument is the bump, so `release.ts --dry-run` keeps its flag.
    const bumpGiven = first !== '' && !first.startsWith('-');
    const bump = bumpGiven ? first : 'patch';
    const rest = bumpGiven ? flags : [...argv];
    const options: Options = { bump, assumeYes: false, otp: '', dryRun: false };
    for (let arg = rest.shift(); arg !== undefined; arg = rest.shift()) {
        switch (arg) {
            case '-y':
            case '--yes':
                options.assumeYes = true;
                break;
            case '--otp': {
                const code = rest.shift();
                if (code === undefined) throw new Refusal('--otp needs a code.');
                options.otp = code;
                break;
            }
            case '--dry-run':
                options.dryRun = true;
                break;
            default:
                throw new Refusal(`Unknown option: ${arg}`);
        }
    }
    return options;
}

/** A prerelease publishes under its own identifier, `next` where it has none, and a stable version
 *  under `latest`, so `npm install rati` stays on the last stable release. */
function distTagOf(version: string): string {
    if (!version.includes('-')) return 'latest';
    return /^\d+\.\d+\.\d+-([A-Za-z][A-Za-z0-9]*)/.exec(version)?.[1] ?? 'next';
}

/** The username `yarn npm whoami` prints: its first line past the last `: `, because yarn
 *  prefixes every line with `➤ YN0000: ` and appends a timing line. */
function publisherOf(whoami: string): string {
    const first = whoami.split('\n', 1)[0] ?? '';
    const separator = first.lastIndexOf(': ');
    return separator < 0 ? first : first.slice(separator + 2);
}

/** Runs the release `argv` asks for against `host`, and resolves the exit code. */
export async function release(argv: readonly string[], host: ReleaseHost): Promise<number> {
    try {
        await run(parseOptions(argv), host);
        return 0;
    } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        host.err(`✗ ${error.message}`);
        return error.exitCode;
    }
}

async function run(options: Options, host: ReleaseHost): Promise<void> {
    const info = (line: string): void => host.out(`→ ${line}`);
    const output = async (command: readonly string[]): Promise<string> =>
        (await host.capture(command)).stdout.trim();
    const pkg = (...args: string[]): string[] => ['yarn', 'workspace', PACKAGE, ...args];

    if (!(await host.hasCommand('yarn'))) throw new Refusal('yarn not found');
    if (!(await host.hasCommand('security'))) {
        throw new Refusal("macOS 'security' tool not found (Keychain unavailable)");
    }

    const branch = await output(['git', 'rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch !== RELEASE_BRANCH) {
        throw new Refusal(`On branch '${branch}', expected '${RELEASE_BRANCH}'.`);
    }
    if ((await output(['git', 'status', '--porcelain'])) !== '') {
        throw new Refusal('Working tree is dirty. Commit or stash first.');
    }
    const fetched = await host.attached(['git', 'fetch', '--quiet', 'origin', RELEASE_BRANCH]);
    if (fetched !== 0) throw new Refusal(`git fetch origin ${RELEASE_BRANCH} failed.`, fetched);
    const upstream = await host.capture(['git', 'rev-parse', '--abbrev-ref', '@{u}']);
    if (upstream.exitCode === 0) {
        const tracked = upstream.stdout.trim();
        if (
            (await output(['git', 'rev-parse', '@'])) !==
            (await output(['git', 'rev-parse', tracked]))
        ) {
            throw new Refusal(
                `Local '${RELEASE_BRANCH}' is not in sync with ${tracked}. Pull/push first.`,
            );
        }
    }

    info(`Reading npm token from Keychain (service: ${KEYCHAIN_SERVICE})…`);
    const keychain = await host.capture([
        'security',
        'find-generic-password',
        '-a',
        host.user,
        '-s',
        KEYCHAIN_SERVICE,
        '-w',
    ]);
    const token = keychain.exitCode === 0 ? keychain.stdout.trim() : '';
    if (token === '') {
        throw new Refusal(
            'No token in Keychain. Run the one-time setup in docs/current/RELEASING.md.',
        );
    }
    // yarn reads these as its npmAuthToken and npmPublishRegistry, so the token stays off disk and
    // reaches only the yarn npm commands.
    const npmEnv: ExtraEnv = {
        YARN_NPM_AUTH_TOKEN: token,
        YARN_NPM_PUBLISH_REGISTRY: PUBLISH_REGISTRY,
    };

    // The exit code decides, never the output: `yarn npm whoami` prints its error to stdout.
    const whoami = await host.capture(['yarn', 'npm', 'whoami', '--publish'], npmEnv);
    if (whoami.exitCode !== 0) {
        throw new Refusal(
            'Token failed to authenticate (expired?). Rotate it — see docs/current/RELEASING.md.',
        );
    }
    const publisher = publisherOf(whoami.stdout);
    info(`Authenticated as: ${publisher}`);

    // Before the bump, so a failing test or build leaves package.json alone.
    info('Running tests…');
    const tested = await host.attached(pkg('test'));
    if (tested !== 0) throw new Refusal('Tests failed.', tested);
    info('Building…');
    const built = await host.attached(pkg('build'));
    if (built !== 0) throw new Refusal('Build failed.', built);
    if (!(await host.hasDist())) throw new Refusal('Build produced no dist/.');

    const current = await host.readVersion();
    const publish = (...args: string[]): Promise<number> =>
        host.attached(pkg('npm', 'publish', '--tag', ...args), npmEnv);

    // Only `yarn version` knows how a keyword resolves, so the bump is written to package.json and
    // read back; every exit before the version commit puts package.json back.
    const state = { committed: false };
    try {
        const bumped = await host.capture(pkg('version', options.bump));
        if (bumped.exitCode !== 0) {
            throw new Refusal(
                `yarn version ${options.bump} failed:\n${bumped.stderr || bumped.stdout}`,
            );
        }
        const version = await host.readVersion();
        const distTag = distTagOf(version);
        if (options.dryRun) {
            info(`DRY RUN — would publish ${PACKAGE}@${version} (dist-tag: ${distTag})`);
            await publish(distTag, '--dry-run');
        } else {
            await ship({ ...options, current, version, distTag, publisher }, host, publish, state);
        }
    } finally {
        if (!state.committed) await host.capture(['git', 'checkout', '--', PACKAGE_JSON]);
    }
    if (options.dryRun) info('Dry run complete — no commit, tag, publish, or push performed.');
}

interface Shipment extends Options {
    current: string;
    version: string;
    distTag: string;
    publisher: string;
}

/** Confirms, commits and tags the bump, publishes and pushes; sets `state.committed` once the
 *  version commit exists, so the caller stops restoring package.json. */
async function ship(
    shipment: Shipment,
    host: ReleaseHost,
    publish: (...args: string[]) => Promise<number>,
    state: { committed: boolean },
): Promise<void> {
    const { bump, assumeYes, otp, current, version, distTag, publisher } = shipment;
    const info = (line: string): void => host.out(`→ ${line}`);

    info(
        `${PACKAGE} ${current} → ${version} (bump: ${bump} · dist-tag: ${distTag} · publisher: ${publisher})`,
    );
    if (!assumeYes && !(await host.confirm(`Publish and push v${version}? [y/N] `))) {
        throw new Refusal('Aborted.');
    }

    const subject = `release: ${PACKAGE} v${version}`;
    info(`Committing and tagging v${version}…`);
    // `yarn version` writes package.json alone, never a commit or a tag.
    const commit = await host.capture(['git', 'commit', '-q', '-m', subject, '--', PACKAGE_JSON]);
    if (commit.exitCode !== 0) throw new Refusal(`git commit failed:\n${commit.stderr}`);
    state.committed = true;
    // Annotated: `git push --follow-tags` ignores a lightweight tag.
    const tag = await host.capture(['git', 'tag', '-a', `v${version}`, '-m', subject]);
    if (tag.exitCode !== 0) {
        throw new Refusal(
            `git tag failed:\n${tag.stderr}\n   The version commit exists locally. Undo with:  git reset --hard HEAD~1`,
        );
    }

    info(`Publishing ${PACKAGE}@${version} (dist-tag: ${distTag})…`);
    const published = await publish(distTag, ...(otp === '' ? [] : ['--otp', otp]));
    if (published !== 0) {
        throw new Refusal(
            `Publish failed. The version commit/tag exist locally but were NOT pushed.\n` +
                `   Undo with:  git tag -d v${version} && git reset --hard HEAD~1`,
        );
    }

    info('Pushing commit + tag…');
    const pushed = await host.attached(['git', 'push', '--follow-tags', 'origin', RELEASE_BRANCH]);
    if (pushed !== 0) {
        throw new Refusal(
            `Push failed after ${PACKAGE}@${version} was published. Retry with:  git push --follow-tags origin ${RELEASE_BRANCH}`,
            pushed,
        );
    }

    host.out('');
    host.out(`✓ Published ${PACKAGE}@${version}  (dist-tag: ${distTag})`);
    host.out(`  https://www.npmjs.com/package/${PACKAGE}/v/${version}`);
}

/** One keypress from the terminal, raw where stdin is one, so Ctrl-C reads as a refusal. */
async function keypress(): Promise<string> {
    const stdin = process.stdin;
    const raw = stdin.isTTY;
    if (raw) stdin.setRawMode(true);
    const key = await new Promise<string>((resolve) => {
        const done = (text: string): void => {
            stdin.off('data', onData);
            stdin.off('end', onEnd);
            resolve(text);
        };
        const onData = (chunk: Buffer): void => done(chunk.toString('utf8').slice(0, 1));
        const onEnd = (): void => done('');
        stdin.on('data', onData);
        stdin.once('end', onEnd);
        stdin.resume();
    });
    if (raw) stdin.setRawMode(false);
    stdin.pause();
    return key;
}

function processHost(root: string): ReleaseHost {
    const env = (extra: ExtraEnv = {}): NodeJS.ProcessEnv => ({ ...process.env, ...extra });
    const packageDir = path.join(root, 'packages', PACKAGE);
    return {
        capture: async (command, extra) => {
            const result = await $({ cwd: root, nothrow: true, env: env(extra) })`${command}`;
            return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
        },
        attached: async (command, extra) =>
            (await live({ cwd: root, nothrow: true, env: env(extra) })`${command}`).exitCode ?? 1,
        hasCommand: async (name) => (await which(name, { nothrow: true })) !== null,
        readVersion: async () => {
            const manifest: unknown = JSON.parse(
                await readFile(path.join(root, PACKAGE_JSON), 'utf8'),
            );
            const version = (manifest as { version?: unknown }).version;
            if (typeof version !== 'string') throw new Error(`${PACKAGE_JSON} carries no version`);
            return version;
        },
        hasDist: async () =>
            (await stat(path.join(packageDir, 'dist')).catch(() => null))?.isDirectory() ?? false,
        confirm: async (question) => {
            process.stdout.write(question);
            const key = await keypress();
            process.stdout.write('\n');
            return key === 'y' || key === 'Y';
        },
        out: (line) => console.log(line),
        err: (line) => console.error(line),
        user: process.env['USER'] ?? '',
    };
}

if (import.meta.main) {
    const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    process.exitCode = await release(process.argv.slice(2), processHost(root));
}
