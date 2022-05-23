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

export type Options<Result> = {
    isImmediate?: boolean;
    debounceMaxWaitMs?: number;
    debounceWaitMs?: number | 'INPUT';
    spinnerTimeoutMs?: number;
    raceGuard?: boolean;
};

export interface DebouncedFunction<Args extends any[], F extends (...args: Args) => any> {
    (this: ThisParameterType<F>, ...args: Args & Parameters<F>): Promise<ReturnType<F>>;
    cancel: (reason?: any) => void;
    state: PublicState<F>;
}

interface DebouncedPromise<FunctionReturn> {
    resolve: (result: FunctionReturn) => void;
    reject: (reason?: any) => void;
}

export function debounce<Args extends any[], F extends (...args: Args) => Promise<any>>(
    func: F,
    options: Options<ReturnType<F>> = {}
): DebouncedFunction<Args, F> {
    let invokeTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let spinnerTimeoutId: ReturnType<typeof setTimeout> | undefined;

    const isImmediate = options.isImmediate ?? false;
    const maxWait = options.debounceMaxWaitMs;
    const waitMilliseconds = options.debounceWaitMs === 'INPUT' ? 350 : options.debounceWaitMs ?? 100;
    const spinnerTimeout = options.spinnerTimeoutMs ?? 200;
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

    const debouncedFunction = function (this: ThisParameterType<F>, ...args: Parameters<F>) {
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

            if (spinnerTimeoutId !== undefined) {
                clearTimeout(spinnerTimeoutId);
            }

            const invokeTime = nextInvokeTimeout();
            invokeTimeoutId = setTimeout(invokeFunction, invokeTime);

            // Spinner should appear in spinnerTimeoutMs after laster interaction, but
            // not earlier then the api call is invoked
            spinnerTimeoutId = setTimeout(
                state.showSpinner,
                spinnerTimeout < invokeTime ? invokeTime : spinnerTimeout
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

                if (options.raceGuard) {
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

    debouncedFunction.cancel = function (reason?: any) {
        if (invokeTimeoutId !== undefined) {
            clearTimeout(invokeTimeoutId);
        }
        if (spinnerTimeoutId !== undefined) {
            clearTimeout(spinnerTimeoutId);
        }
        state.setBusy(false);

        state.promises.forEach(({ reject }) => reject(reason));
        state.clearPromises();
    };

    debouncedFunction.state = new PublicState<F>(state);

    return debouncedFunction;
}

class InternalState<F extends (...args: any[]) => any> {
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

    @observable public promises: DebouncedPromise<ReturnType<F>>[] = [];

    @action pushPromise(promise: DebouncedPromise<ReturnType<F>>) {
        this.promises.push(promise);
    }

    @action clearPromises() {
        this.promises = [];
    }

    @observable isBusy: boolean = false;
    @observable isSpinner: boolean = false;

    @action setBusy(value: boolean) {
        this.isBusy = value;
        if (!value) this.isSpinner = false;
    }

    @action.bound showSpinner() {
        if (this.isBusy) {
            this.isSpinner = true;
        }
    }
}

class PublicState<F extends (...args: any[]) => any> {
    constructor(private internalState: InternalState<F>) {}

    get isReady() {
        return this.internalState.promises.length === 0 && !this.isBusy;
    }

    get isBusy() {
        return this.internalState.isBusy;
    }

    get isVisiblyBusy() {
        return this.internalState.isBusy && this.internalState.isSpinner;
    }
}
