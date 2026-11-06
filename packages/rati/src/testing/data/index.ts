/*
    rati/testing/data — the hand-drive kit for the `rati/data` primitives, its own entry because
    it imports MobX; test-environment only.
*/

export {
    controllableProducer,
    type ControllableProducer,
    type ProducerCall,
} from './controllableProducer.js';
export { controllableQuery, type ControllableQuery } from './controllableQuery.js';
