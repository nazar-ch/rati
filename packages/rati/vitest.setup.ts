// The React act environment, declared runner-level — the contract rati/testing documents: the
// suites drive `act` at the test top level, and rati/testing's helpers scope the flag around their
// own calls only (src/testing/actEnvironment.ts).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
