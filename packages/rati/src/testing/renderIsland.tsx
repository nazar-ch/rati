import { createElement, type ComponentProps, type ComponentType, type ReactNode } from 'react';

import { mountTree, type MountedTree } from './dom.js';

import { island, type IslandComponent, type IslandConfig } from '../island/island.js';
import { useScopeControls, type ScopeControls } from '../mandala/controls.js';
import type { Scope, ScopeInputs, ScopeProps } from '../scope/scope.js';

/*
    long:2
    renderIsland — mount an island, drive it to resolution, and read which slot shows, through
    `react-dom/client`, never `@testing-library/react`. Given a CONFIG, each slot is wrapped in a
    private marker, so `slot()`, `text()` and `controls()` read the screen without leaking
    testids; a built island can only mount and query.

    The mount is an ASYNC act, under which React skips StrictMode's double-invoke: a test pinning
    StrictMode's discard-the-first-run renders synchronously (mandala/island.test.tsx).
*/

const SLOT_ATTR = 'data-rati-testing-slot';
type SlotName = 'loading' | 'content' | 'error';

/**
 * Inputs as a call-site tuple: required when the scope declares required inputs, optional
 * otherwise. Closes the hole where `rerender()` on an input-ful scope would type-check and
 * silently re-render with `{}` — wiping every input.
 */
type InputsArg<S extends Scope<any>> =
    {} extends ScopeInputs<S> ? [props?: ScopeInputs<S>] : [props: ScopeInputs<S>];

/** The handle {@link renderIsland} returns. */
export interface IslandHandle<S extends Scope<any>> {
    /** The DOM node the island is mounted into (appended to `document.body`). */
    readonly container: HTMLElement;
    /**
     * Which slot is visible — `content` / `loading` / `error` — read by visibility, since
     * mid-transition React keeps hidden stale content mounted. Throws when no slot marker is
     * in the DOM: an unmounted island, or one that threw past its slots. Config mode only.
     */
    slot(): SlotName;
    /** The visible slot's trimmed `textContent` (what it says), or `null`. Config mode only. */
    text(): string | null;
    /** Re-render with new inputs — the param-change path (a new run, old sources detached).
     *  Required when the scope has required inputs. Async like the mount: resolves as far
     *  as the new inputs allow before returning. */
    rerender(...args: InputsArg<S>): Promise<void>;
    /**
     * The nearest island's controls for this scope, as captured at the last render — call it
     * after the drive whose effect you want. Config mode only, after the first render.
     */
    controls(): ScopeControls<S>;
    /** Unmount the island and remove its container. */
    unmount(): void;
}

/**
 * Options for {@link renderIsland}. `props` (the island's inputs) is required when the
 * scope declares required inputs — mirroring what JSX would demand of the built island —
 * and absent-able only for an input-less scope.
 */
export type RenderIslandOptions<S extends Scope<any>> = {
    /** Wrap the island in app-level providers (a store context, a theme, …). */
    wrapper?: ComponentType<{ children: ReactNode }>;
} & ({} extends ScopeInputs<S>
    ? {
          /** The island's inputs (its `input()` head). Omittable: the scope has none. */
          props?: ScopeInputs<S>;
      }
    : {
          /** The island's inputs (its `input()` head). */
          props: ScopeInputs<S>;
      });

function visibleNode(container: HTMLElement, slot: SlotName): Element | null {
    // EVERY marker for the slot: a boundary showing its fallback keeps the previous children
    // hidden beside it, so one slot name appears dead and live — under `keepStale`, `content`
    // beside `content`.
    for (const node of container.querySelectorAll(`[${SLOT_ATTR}="${slot}"]`)) {
        // React hides a suspended boundary's CHILDREN (ancestors of this marker), not the
        // marker itself — walk up to the container looking for a display:none ancestor.
        let hidden = false;
        for (let el: Element | null = node; el && el !== container; el = el.parentElement) {
            if (el instanceof HTMLElement && el.style.display === 'none') {
                hidden = true;
                break;
            }
        }
        if (!hidden) return node;
    }
    return null;
}

function readSlot(container: HTMLElement): SlotName {
    if (visibleNode(container, 'error')) return 'error';
    if (visibleNode(container, 'content')) return 'content';
    if (visibleNode(container, 'loading')) return 'loading';
    // Markers present but all hidden is a mid-transition instant — the fallback is about to
    // show; loading is the honest read. NO marker at all means the island isn't rendering
    // its slots anymore — don't silently report 'loading' for a dead island.
    if (container.querySelector(`[${SLOT_ATTR}]`)) return 'loading';
    throw new Error(
        'renderIsland: no slot marker is in the DOM — the island unmounted or threw past ' +
            'its slots (a scope error with no `error` slot rethrows to the nearest ' +
            'ErrorBoundary; pass one via `wrapper` and assert on the container instead).',
    );
}

/**
 * Mounts an island, or a `{ scope, component, … }` config, and returns a driving handle. The
 * mount resolves the scope as far as it can, so an undriven `deferred` or
 * `controllableSource` reads `loading` — drive it, then `await flush()`.
 */
export async function renderIsland<S extends Scope<any>>(
    target: IslandConfig<S> | IslandComponent<S>,
    // A rest tuple so `options` itself is only omittable when the scope is input-less.
    ...rest: {} extends ScopeInputs<S>
        ? [options?: RenderIslandOptions<S>]
        : [options: RenderIslandOptions<S>]
): Promise<IslandHandle<S>> {
    const options = (rest[0] ?? {}) as {
        props?: ScopeInputs<S>;
        wrapper?: ComponentType<{ children: ReactNode }>;
    };
    const isConfig = typeof target !== 'function';
    const captured: { current: ScopeControls<S> | null } = { current: null };

    let Island: IslandComponent<S>;
    if (isConfig) {
        const config = target;
        // A probe rendered in every slot, capturing the controls so the handle can expose
        // them without the test wiring its own reader. Under the controls channel, which the
        // mandala provides around the whole inner tree (loading slot included).
        function Probe() {
            captured.current = useScopeControls(config.scope);
            return null;
        }
        const OrigComponent = config.component;
        const OrigLoading = config.loading;
        const OrigError = config.error;
        Island = island({
            ...config,
            component: function ContentSlot(props: ScopeProps<S>) {
                return createElement(
                    'div',
                    { [SLOT_ATTR]: 'content' },
                    createElement(Probe, null),
                    createElement(OrigComponent, props),
                );
            },
            loading: function LoadingSlot(props: { inputs: ScopeInputs<S> }) {
                return createElement(
                    'div',
                    { [SLOT_ATTR]: 'loading' },
                    createElement(Probe, null),
                    OrigLoading ? createElement(OrigLoading, props) : null,
                );
            },
            // Only wrap an error slot the config actually declares — with none, the island
            // rethrows to the nearest ErrorBoundary (pass one via `wrapper` to catch it).
            ...(OrigError && {
                error: function ErrorSlot(props: ComponentProps<typeof OrigError>) {
                    return createElement(
                        'div',
                        { [SLOT_ATTR]: 'error' },
                        createElement(Probe, null),
                        createElement(OrigError, props),
                    );
                },
            }),
        } as IslandConfig<S>);
    } else {
        Island = target;
    }

    const { wrapper: Wrapper } = options;
    const element = (props: ScopeInputs<S> | undefined) => {
        const node = createElement(Island, (props ?? {}) as ScopeInputs<S>);
        return Wrapper ? createElement(Wrapper, null, node) : node;
    };

    const mount: MountedTree = await mountTree(element(options.props));
    const { container } = mount;

    const requireConfig = (what: string) => {
        if (!isConfig) {
            throw new Error(
                `renderIsland: ${what} needs config mode — pass { scope, component, … } ` +
                    `instead of a built island() component.`,
            );
        }
    };

    return {
        container,
        slot() {
            requireConfig('slot()');
            return readSlot(container);
        },
        text() {
            requireConfig('text()');
            const node =
                visibleNode(container, 'error') ??
                visibleNode(container, 'content') ??
                visibleNode(container, 'loading');
            return node?.textContent?.trim() ?? null;
        },
        // The cast bridges the conditional tuple (unresolvable while S is generic).
        rerender: ((props?: ScopeInputs<S>) =>
            mount.rerender(element(props))) as IslandHandle<S>['rerender'],
        controls() {
            requireConfig('controls()');
            if (!captured.current) {
                throw new Error('renderIsland: controls() read before the first render');
            }
            return captured.current;
        },
        unmount: mount.unmount,
    };
}
