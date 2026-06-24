/*
    rati/mobx — the MobX-coupled surface, kept out of the MobX-free core.

      - `observableSource`: adapt a MobX observable derivation to a rati `Source`.
      - the legacy data layer (`ActiveData` / `remoteData`): mutable MobX drafts and
        the debounced remote loader, pending extraction to their own package.

    `mobx` is an *optional* peer dependency of rati, needed only by this entry — an
    app that never imports `rati/mobx` keeps MobX out of its bundle, and rati core
    never references it.
*/
export { observableSource } from './observableSource';

export { ActiveData, ActiveApiData } from '../data/ActiveData';
export { type ActiveDataInstanceType } from '../data/ActiveDataInstanceType';
export { remoteData } from '../data/remoteData';
export { remoteDataKey, responseKey } from '../data/apiUtils';
