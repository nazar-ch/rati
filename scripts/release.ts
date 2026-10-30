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
// `release` takes the wrappers of @jnana-app/commands it starts through, its reads and its terminal
// as a `ReleaseHost`, so ./release.contract.unit.test.ts drives every refusal, the dry run's plan
// and the shipped sequence over `scripted` wrappers; the `import.meta.main` block builds the
// wrappers and hands the real host.
//
// The Keychain read and the d.ts emit of the build start a command no operation of the package
// composes, so a real release refuses at the Keychain read, before the bump (kit◊CK-14).

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import type { Started } from '@jnana-app/commands/command';
import { Git } from '@jnana-app/commands/git';
import { Vp } from '@jnana-app/commands/vp';
import { type NpmAuth, Yarn } from '@jnana-app/commands/yarn';
import { isExecutableFile } from '@jnana-app/kit/lib/absent';

import { attached, buildWorkspace } from './steps.ts';

const PACKAGE = 'rati';
const KEYCHAIN_SERVICE = 'npm_token_rati';
const RELEASE_BRANCH = 'main';
const REMOTE = 'origin';
// yarn's default registry is its read-only mirror, so publishing points at npmjs.
const PUBLISH_REGISTRY = 'https://registry.npmjs.org';
const PACKAGE_JSON = `packages/${PACKAGE}/package.json`;

/** The wrappers `release` starts every command through. */
export interface ReleasePrograms {
    readonly git: Git;
    readonly yarn: Yarn;
    readonly vp: Vp;
}

/** Everything `release` reaches outside its own memory, each command run from `root`. */
export interface ReleaseHost {
    readonly programs: ReleasePrograms;
    /** The checkout the release runs in. */
    readonly root: string;
    /** Whether `name` resolves to an executable file on `PATH`. */
    hasCommand(name: string): boolean;
    /** The password the Keychain holds for `account` under `service`, `''` where it holds none. */
    keychainSecret(entry: { readonly account: string; readonly service: string }): string;
    /** Waits for a started step with the terminal attached and resolves its exit status. */
    attached(step: Started): Promise<number>;
    /** Builds the package as its `build` script does and resolves the first failing status. */
    build(): Promise<number>;
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
                // `Yarn.workspacePublish` throws on any other code, which would land after the tag.
                if (!/^\d+$/.test(code)) throw new Refusal('--otp takes a code of digits.');
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

/** Refuses unless HEAD is `main`, the tree is clean, and HEAD is its fetched upstream's commit. */
function checkCheckout(host: ReleaseHost): void {
    const { git } = host.programs;
    const cwd = host.root;
    // `locate` prints the root, the common dir, HEAD's commit and HEAD's full name, one per line.
    const headName = git.locate({ cwd }).stdout.split('\n')[3] ?? '';
    const branch = headName.replace(/^refs\/heads\//, '');
    if (branch !== RELEASE_BRANCH) {
        throw new Refusal(`On branch '${branch}', expected '${RELEASE_BRANCH}'.`);
    }
    if (git.status({ cwd, untracked: true }).stdout !== '') {
        throw new Refusal('Working tree is dirty. Commit or stash first.');
    }
    const fetched = git.fetch({ cwd, remote: REMOTE, refs: [RELEASE_BRANCH] });
    if (!fetched.ok) {
        throw new Refusal(
            `git fetch ${REMOTE} ${RELEASE_BRANCH} failed:\n${fetched.stderr}`,
            fetched.status,
        );
    }
    const upstream = git.upstreamName({ cwd });
    if (!upstream.ok) return;
    const tracked = upstream.stdout.trim();
    // `cat-file --batch-check` prints `<object> <type> <size>` for each revision it resolves.
    const [head, tip] = git
        .resolveBatch({ cwd, revs: ['HEAD', tracked] })
        .stdout.split('\n')
        .map((line) => line.split(' ')[0]);
    if (head === undefined || head !== tip) {
        throw new Refusal(
            `Local '${RELEASE_BRANCH}' is not in sync with ${tracked.replace(/^refs\/remotes\//, '')}. Pull/push first.`,
        );
    }
}

async function run(options: Options, host: ReleaseHost): Promise<void> {
    const { yarn, vp } = host.programs;
    const cwd = host.root;
    const info = (line: string): void => host.out(`→ ${line}`);

    if (!host.hasCommand('yarn')) throw new Refusal('yarn not found');
    if (!host.hasCommand('security')) {
        throw new Refusal("macOS 'security' tool not found (Keychain unavailable)");
    }
    checkCheckout(host);

    info(`Reading npm token from Keychain (service: ${KEYCHAIN_SERVICE})…`);
    const token = host.keychainSecret({ account: host.user, service: KEYCHAIN_SERVICE }).trim();
    if (token === '') {
        throw new Refusal(
            'No token in Keychain. Run the one-time setup in docs/current/RELEASING.md.',
        );
    }
    // The yarn npm verbs alone carry the token, through yarn's environment and never its argv.
    const auth: NpmAuth = { token, publishRegistry: PUBLISH_REGISTRY };

    // The exit code decides, never the output: `yarn npm whoami` prints its error to stdout.
    const whoami = yarn.npmWhoami({ cwd, auth });
    if (!whoami.ok) {
        throw new Refusal(
            'Token failed to authenticate (expired?). Rotate it — see docs/current/RELEASING.md.',
        );
    }
    const publisher = whoami.user;
    info(`Authenticated as: ${publisher}`);

    // Before the bump, so a failing test or build leaves package.json alone.
    info('Running tests…');
    const packageDir = path.join(cwd, 'packages', PACKAGE);
    const tested = await host.attached(vp.testFiles({ cwd: packageDir, paths: [], exclude: [] }));
    if (tested !== 0) throw new Refusal('Tests failed.', tested);
    info('Building…');
    const built = await host.build();
    if (built !== 0) throw new Refusal('Build failed.', built);
    if (!(await host.hasDist())) throw new Refusal('Build produced no dist/.');

    const current = await host.readVersion();
    const publish = (tag: string, extra: Publishing): number =>
        yarn.workspacePublish({ cwd, workspace: PACKAGE, tag, auth, ...extra }).status;

    // Only `yarn version` knows how a keyword resolves, so the bump is written to package.json and
    // read back; every exit before the version commit puts package.json back.
    const state = { committed: false };
    try {
        const bumped = yarn.workspaceVersion({ cwd, workspace: PACKAGE, bump: options.bump });
        if (!bumped.ok) {
            throw new Refusal(
                `yarn version ${options.bump} failed:\n${bumped.stderr || bumped.stdout}`,
            );
        }
        const version = await host.readVersion();
        const distTag = distTagOf(version);
        if (options.dryRun) {
            info(`DRY RUN — would publish ${PACKAGE}@${version} (dist-tag: ${distTag})`);
            publish(distTag, { dryRun: true });
        } else {
            await ship({ ...options, current, version, distTag, publisher }, host, publish, state);
        }
    } finally {
        if (!state.committed) host.programs.git.restore({ cwd, paths: [PACKAGE_JSON] });
    }
    if (options.dryRun) info('Dry run complete — no commit, tag, publish, or push performed.');
}

/** What a publish takes beyond its dist-tag. */
interface Publishing {
    readonly dryRun?: boolean;
    readonly otp?: string;
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
    publish: (tag: string, extra: Publishing) => number,
    state: { committed: boolean },
): Promise<void> {
    const { bump, assumeYes, otp, current, version, distTag, publisher } = shipment;
    const { git } = host.programs;
    const cwd = host.root;
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
    const commit = git.commit({ cwd, message: subject, paths: [PACKAGE_JSON] });
    if (!commit.ok) throw new Refusal(`git commit failed:\n${commit.stderr}`);
    state.committed = true;
    // Annotated: `git push --follow-tags` ignores a lightweight tag.
    const tag = git.tagAnnotated({ cwd, name: `v${version}`, message: subject });
    if (!tag.ok) {
        throw new Refusal(
            `git tag failed:\n${tag.stderr}\n   The version commit exists locally. Undo with:  git reset --hard HEAD~1`,
        );
    }

    info(`Publishing ${PACKAGE}@${version} (dist-tag: ${distTag})…`);
    const published = publish(distTag, otp === '' ? {} : { otp });
    if (published !== 0) {
        throw new Refusal(
            `Publish failed. The version commit/tag exist locally but were NOT pushed.\n` +
                `   Undo with:  git tag -d v${version} && git reset --hard HEAD~1`,
        );
    }

    info('Pushing commit + tag…');
    const pushed = git.push({
        cwd,
        remote: REMOTE,
        refspecs: [RELEASE_BRANCH],
        followTags: true,
    });
    if (!pushed.ok) {
        throw new Refusal(
            `Push failed after ${PACKAGE}@${version} was published:\n${pushed.stderr}\n` +
                `   Retry with:  git push --follow-tags ${REMOTE} ${RELEASE_BRANCH}`,
            pushed.status,
        );
    }

    host.out('');
    host.out(`✓ Published ${PACKAGE}@${version}  (dist-tag: ${distTag})`);
    host.out(`  https://www.npmjs.com/package/${PACKAGE}/v/${version}`);
}

/** Whether `name` resolves to an executable file in a directory of `searchPath`. */
function onPath(name: string, searchPath: string): boolean {
    return searchPath
        .split(path.delimiter)
        .some((dir) => dir !== '' && isExecutableFile(path.join(dir, name)));
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

function processHost(root: string, programs: ReleasePrograms): ReleaseHost {
    const packageDir = path.join(root, 'packages', PACKAGE);
    return {
        programs,
        root,
        hasCommand: (name) => onPath(name, process.env['PATH'] ?? ''),
        keychainSecret: ({ account, service }) => {
            throw new Refusal(
                'No @jnana-app/commands operation reads the Keychain ' +
                    `(\`security find-generic-password -a ${account} -s ${service} -w\`), ` +
                    'so the release cannot read its npm token. Nothing was bumped, committed or published.',
            );
        },
        attached,
        build: () => buildWorkspace('rati', programs.vp, root),
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
    // `vp` lives in the workspace bin, which a bare shell's PATH lacks.
    process.env['PATH'] = `${path.join(root, 'node_modules', '.bin')}:${process.env['PATH']}`;
    const programs = { git: new Git(), yarn: new Yarn(), vp: new Vp() };
    process.exitCode = await release(process.argv.slice(2), processHost(root, programs));
}
