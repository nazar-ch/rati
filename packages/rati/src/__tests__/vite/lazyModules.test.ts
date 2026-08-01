// @vitest-environment node
import { describe, test, expect } from 'vite-plus/test';

import { findLazyCalls, recordModuleIds } from '../../vite/lazyModules';

/*
    The transform's two halves, driven directly: which call sites carry a recordable
    import, and where the id lands in the source. Its work against a real build is in
    the example (a lazy route's URL emits its chunk's modulepreload); this is the
    syntax it has to survive on the way there.
*/

function record(code: string, filename = 'routes.tsx'): string {
    const calls = findLazyCalls(code, filename, 'rati');
    return recordModuleIds(
        code,
        calls.map((call) => ({ at: call.at, moduleId: call.specifier.replace('./', 'src/') })),
    );
}

describe('findLazyCalls', () => {
    test('records the specifier of a rati lazy route', () => {
        const code = `import { lazy } from 'rati';\nconst S = lazy(() => import('./Settings'));`;

        expect(record(code)).toBe(
            `import { lazy } from 'rati';\nconst S = lazy(() => import('./Settings'), "src/Settings");`,
        );
    });

    test('reads the import through an aliased import and an async factory', () => {
        const code =
            `import { lazy as pageLazy } from 'rati';\n` +
            `const S = pageLazy(async () => (await import('./Settings')).default);`;

        // The id goes after the factory, wherever that ends — here past `.default`.
        expect(record(code)).toContain(`(await import('./Settings')).default, "src/Settings")`);
    });

    test('leaves lazy from anywhere else alone', () => {
        // Same name, different function: React's lazy takes no id, and a local one
        // means whatever the app decided.
        const code =
            `import { lazy } from 'react';\n` +
            `import { route } from 'rati';\n` +
            `const S = lazy(() => import('./Settings'));`;

        expect(findLazyCalls(code, 'routes.tsx', 'rati')).toEqual([]);
    });

    test('skips an import it cannot name at build time', () => {
        // No literal, so there is no chunk to point at — the call still works, it just
        // gets no preload.
        const code = `import { lazy } from 'rati';\nconst S = lazy(() => import(pagePath));`;

        expect(findLazyCalls(code, 'routes.tsx', 'rati')).toEqual([]);
    });

    test('does not record over an id that is already there', () => {
        const code = `import { lazy } from 'rati';\nconst S = lazy(() => import('./S'), "src/S.tsx");`;

        expect(findLazyCalls(code, 'routes.tsx', 'rati')).toEqual([]);
    });

    test('parses the TSX a route table is actually written in', () => {
        // The reason the parser gets the filename: `satisfies`, a type-only import and
        // JSX all reach this transform unstripped.
        const code =
            `import { lazy, route } from 'rati';\n` +
            `import type { GenericRouteType } from 'rati';\n` +
            `const S = lazy(() => import('./Settings'));\n` +
            `const icon = <span className="i" />;\n` +
            `export const routes = [route('/s', 's', S, { icon })] as const satisfies GenericRouteType[];`;

        expect(record(code)).toContain(`import('./Settings'), "src/Settings")`);
    });

    test('records every route in the table, each at its own call', () => {
        const code =
            `import { lazy } from 'rati';\n` +
            `const A = lazy(() => import('./A'));\n` +
            `const B = lazy(() => import('./B'));`;

        // Right-to-left insertion: B's offset must survive A's edit.
        expect(record(code)).toBe(
            `import { lazy } from 'rati';\n` +
                `const A = lazy(() => import('./A'), "src/A");\n` +
                `const B = lazy(() => import('./B'), "src/B");`,
        );
    });
});
