/*
    rati/mobx — the MobX-coupled surface, kept out of the MobX-free core.

      - `observableSource`: adapt a MobX observable derivation to a rati `Source`.

    `mobx` is an *optional* peer dependency of rati, needed only by this entry (and
    by `rati/data`, which builds on it) — an app that never imports either entry
    keeps MobX out of its bundle, and rati core never references it.
*/
export { observableSource } from './observableSource';
