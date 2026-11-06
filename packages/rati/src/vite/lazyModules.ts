import { parseSync } from 'vite';

/*
    The specifier-recording transform: `lazy(() => import('./Settings'))` gains
    `"src/Settings.tsx"`, the root-relative path the client manifest keys the chunk by, as its
    second argument, so `prepareRoute` can name the chunk. The import itself is untouched.
*/

interface Node {
    type: string;
    start: number;
    end: number;
    [key: string]: unknown;
}

export interface LazyCall {
    /** The import specifier, as written. */
    specifier: string;
    /** Where the id goes: after the factory argument. */
    at: number;
}

/**
 * The `lazy()` call sites in `code` that import a literal specifier, or `[]` when the
 * module doesn't import rati's `lazy` at all. `filename` picks the dialect: routes are
 * `.tsx`, and the parser reads the extension rather than guessing at the syntax.
 */
export function findLazyCalls(code: string, filename: string, source: string): LazyCall[] {
    const ast = parseSync(filename, code).program as unknown as { body: Node[] };

    // Only the local names bound to RATI'S `lazy`. A module that imports React's
    // (or defines its own) must be left alone: same name, different function.
    const locals = new Set<string>();
    for (const node of ast.body) {
        if (node.type !== 'ImportDeclaration') continue;
        if ((node['source'] as Node & { value?: unknown }).value !== source) continue;
        for (const spec of node['specifiers'] as Node[]) {
            const imported = spec['imported'] as (Node & { name?: string }) | undefined;
            const local = spec['local'] as Node & { name: string };
            if (spec.type === 'ImportSpecifier' && imported?.name === 'lazy')
                locals.add(local.name);
        }
    }
    if (locals.size === 0) return [];

    const calls: LazyCall[] = [];
    walk(ast as unknown as Node, (node) => {
        if (node.type !== 'CallExpression') return;
        const callee = node['callee'] as Node & { name?: string };
        if (callee.type !== 'Identifier' || !locals.has(callee.name ?? '')) return;
        const factory = (node['arguments'] as Node[])[0];
        // Already recorded (or an app passing its own id): don't add a second.
        if (!factory || (node['arguments'] as Node[]).length > 1) return;

        // The import can sit anywhere in the factory — `() => import('./x')`, but also
        // `async () => (await import('./x')).default`.
        let specifier: string | undefined;
        walk(factory, (inner) => {
            if (inner.type !== 'ImportExpression') return;
            const importSource = inner['source'] as Node & { value?: unknown };
            // A computed specifier (`import(path)`) has no chunk to name at build time.
            if (importSource.type === 'Literal' && typeof importSource.value === 'string') {
                specifier = importSource.value;
            }
        });
        if (specifier !== undefined) calls.push({ specifier, at: factory.end });
    });
    return calls;
}

/** Append each id as `lazy()`'s second argument, back to front so offsets hold. */
export function recordModuleIds(code: string, ids: { at: number; moduleId: string }[]): string {
    let result = code;
    for (const { at, moduleId } of [...ids].sort((a, b) => b.at - a.at)) {
        result = result.slice(0, at) + `, ${JSON.stringify(moduleId)}` + result.slice(at);
    }
    return result;
}

function walk(node: unknown, visit: (node: Node) => void): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        for (const child of node) walk(child, visit);
        return;
    }
    const record = node as Record<string, unknown>;
    if (typeof record['type'] === 'string') visit(record as unknown as Node);
    for (const key in record) {
        if (key === 'type' || key === 'start' || key === 'end') continue;
        walk(record[key], visit);
    }
}
