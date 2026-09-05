/*
    rati/testing/data — the hand-drive kit for the `rati/data` primitives.

    A separate entry from `rati/testing` for the same reason `rati/data` is separate
    from `rati`: it imports MobX. Keeping it out of the main testing barrel means a
    MobX-free app still gets `deferred`/`flush`/`controllableSource`/`renderIsland`
    without installing the optional peer.

    Test-environment only, like everything under `rati/testing`.
*/

export {
    controllableProducer,
    type ControllableProducer,
    type ProducerCall,
} from './controllableProducer.js';
export { controllableQuery, type ControllableQuery } from './controllableQuery.js';
