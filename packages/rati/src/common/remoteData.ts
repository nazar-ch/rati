import { action, makeObservable, observable } from 'mobx';

/*

Based on https://github.com/chodorowicz/ts-debounce

MIT License

Copyright (c) 2017 Jakub Chodorowicz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

export type RemoteDataOptions = {
    isImmediate?: boolean;
    debounceMaxWaitMs?: number;
    debounceWaitMs?: number | 'INPUT';
    indicatePendingAfterTimeoutMs?: number;
    raceGuard?: boolean;
};

export interface RemoteDataFunction<F extends (...args: any) => any> {
    (...args: Parameters<F>): Promise<Awaited<ReturnType<F>>>;
    cancel: (reason?: any) => void;
    state: PublicState<F>;
}

interface RemoteDataPromise<FunctionReturn> {
    resolve: (result: FunctionReturn) => void;
    reject: (reason?: any) => void;
}

export function remoteData<F extends (...args: any) => Promise<any>>(
    func: F,
    {
        isImmediate = false,
        debounceMaxWaitMs: maxWait,
        indicatePendingAfterTimeoutMs = 200,
        debounceWaitMs,
        raceGuard,
    }: RemoteDataOptions = {}
): RemoteDataFunction<F> {
    let invokeTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let indicatePendingTimeoutId: ReturnType<typeof setTimeout> | undefined;

    const waitMilliseconds = debounceWaitMs === 'INPUT' ? 350 : debounceWaitMs ?? 100;

    let lastInvokeTime = Date.now();

    const state = new InternalState<F>();

    function nextInvokeTimeout() {
        if (maxWait !== undefined) {
            const timeSinceLastInvocation = Date.now() - lastInvokeTime;

            if (timeSinceLastInvocation + waitMilliseconds >= maxWait) {
                return maxWait - timeSinceLastInvocation;
            }
        }

        return waitMilliseconds;
    }

    function isCurrentRequest(requestId: number) {
        return requestId === state.requestId;
    }

    const apiFunction = function (this: ThisParameterType<F>, ...args: Parameters<F>) {
        const context = this;
        const localRequestId = (state.requestId += 1);

        return new Promise<ReturnType<F>>((resolve, reject) => {
            state.setBusy(true);

            const invokeFunction = function () {
                invokeTimeoutId = undefined;
                lastInvokeTime = Date.now();
                if (!isImmediate) {
                    const result = func.apply(context, args);

                    state.promises.forEach(({ resolve }) => resolve(result as ReturnType<F>));
                    state.clearPromises();
                }
            };

            const shouldCallNow = isImmediate && invokeTimeoutId === undefined;

            if (invokeTimeoutId !== undefined) {
                clearTimeout(invokeTimeoutId);
            }

            if (indicatePendingTimeoutId !== undefined) {
                clearTimeout(indicatePendingTimeoutId);
            }

            const invokeTime = nextInvokeTimeout();
            invokeTimeoutId = setTimeout(invokeFunction, invokeTime);

            // Visible pending state should start in indicatePendingAfterTimeoutMs
            // after latest debounced call, but not before the api call is invoked
            indicatePendingTimeoutId = setTimeout(
                state.indicatePending,
                indicatePendingAfterTimeoutMs < invokeTime
                    ? invokeTime
                    : indicatePendingAfterTimeoutMs
            );

            if (shouldCallNow) {
                const result = func.apply(context, args);
                return resolve(result);
            }
            state.pushPromise({ resolve, reject });
        })
            .then((result) => {
                if (isCurrentRequest(localRequestId) && state.promises.length === 0) {
                    state.setBusy(false);
                }

                if (raceGuard) {
                    return state.raceGuardedResult(result, localRequestId);
                } else {
                    return result;
                }
            })
            .catch((error) => {
                if (isCurrentRequest(localRequestId) && state.promises.length === 0) {
                    state.setBusy(false);
                }
                throw error;
            });
    };

    apiFunction.cancel = function (reason?: any) {
        if (invokeTimeoutId !== undefined) {
            clearTimeout(invokeTimeoutId);
        }
        if (indicatePendingTimeoutId !== undefined) {
            clearTimeout(indicatePendingTimeoutId);
        }
        state.setBusy(false);

        state.promises.forEach(({ reject }) => reject(reason));
        state.clearPromises();
    };

    apiFunction.state = new PublicState<F>(state);

    return apiFunction;
}

class InternalState<F extends (...args: any) => any> {
    constructor() {
        makeObservable(this);
    }

    requestId: number = 0;

    latestResult: { requestId: number; result: ReturnType<F> } | null = null;

    @action raceGuardedResult(currentResult: ReturnType<F>, requestId: number) {
        if (!this.latestResult || requestId >= this.latestResult.requestId) {
            this.latestResult = {
                result: currentResult,
                requestId,
            };
            return currentResult;
        } else {
            return this.latestResult.result;
        }
    }

    @observable public saved: boolean = false;

    @observable public promises: RemoteDataPromise<ReturnType<F>>[] = [];

    @action pushPromise(promise: RemoteDataPromise<ReturnType<F>>) {
        this.promises.push(promise);
    }

    @action clearPromises() {
        this.promises = [];
    }

    @observable isPending: boolean = false;
    @observable shouldIndicatePending: boolean = false;

    @action setBusy(value: boolean) {
        this.isPending = value;
        if (!value) this.shouldIndicatePending = false;
    }

    @action.bound indicatePending() {
        if (this.isPending) {
            this.shouldIndicatePending = true;
        }
    }
}

class PublicState<F extends (...args: any) => any> {
    constructor(private internalState: InternalState<F>) {}

    get isReady() {
        return this.internalState.promises.length === 0 && !this.isPending;
    }

    get isPending() {
        return this.internalState.isPending;
    }

    get shouldIndicatePending() {
        return this.internalState.isPending && this.internalState.shouldIndicatePending;
    }

    get buttonProps() {
        return {
            disabled: this.shouldIndicatePending,
            blocked: this.isPending,
        };
    }
}
