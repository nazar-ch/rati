// The React act environment, declared runner-level — the contract rati/testing documents.
// The suites drive React's `act` directly at the test top level (`act(() => src.setReady(v))`
// and friends); rati/testing's own helpers scope the flag around their internal `act` calls
// only (src/testing/actEnvironment.ts) and deliberately never set it permanently.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
