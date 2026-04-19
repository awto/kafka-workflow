import * as CC from "@effectful/cc";
import { CancellationScope } from "./cancel";
declare const WorkflowPromise: any;
export { WorkflowPromise as Promise };
export { CancellationScope, currentCancellationScope, addCanceler, removeCanceler, withCancellationScope, cancelScope } from "./cancel";
/** Host/runtime topic defaults. Workflow modules should prefer `manifest.outputTopics`. */
export declare const config: {
    outputTopics: Set<string>;
    resultTopic: string;
    errorTopic: string;
};
/** Host-provided thread metadata. Normal workflow code rarely needs this. */
export declare let threadId: string;
export declare let stepId: string;
export type OutputRecord = {
    key: string;
    value: string;
    topic: string;
};
export type StepResult = {
    state: string;
    outputs: OutputRecord[];
};
export type JavaFuture = {
    complete(value: unknown): void;
    completeExceptionally(error: unknown): void;
};
export declare class CancelToken extends Error {
    constructor(message?: string);
}
/** Advanced: low-level continuation token used by `suspend(...)`. Prefer `ref(...)`. */
export declare class Suspension {
    id: string;
    static count: number;
    cont?: CC.SubCont<any, any>;
    constructor(id?: string);
}
type RefWaiter<T = unknown> = {
    ref: Ref<T>;
    scope?: CancellationScope;
    active: boolean;
    cancel: () => unknown;
    settle: (state: 1 | 2, value: T | undefined, error: unknown) => unknown;
};
/** Awaitable durable external wait handle returned by `ref(...)` and `refId(...)`. */
export declare class Ref<T = unknown> {
    id: string;
    key: string;
    static count: number;
    listeners: RefWaiter<T>[];
    settled: number;
    value?: T;
    error?: unknown;
    constructor(id?: string, key?: string);
    then(resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown): void;
    addListener(listener: RefWaiter<T>): unknown;
    resolve(value: T): unknown;
    reject(reason: unknown): unknown;
    private settle;
}
/** Advanced: suspend the current computation, returning a resumable token. Prefer `ref(...)`. */
export declare function suspend(id?: string): any;
/** Queue a raw string output record. Prefer `outputJSON(...)` for JSON protocols. */
export declare function output(value: string, topic: string, key?: string): void;
/** Queue an output record with JSON stringified payload. */
export declare function outputJSON(value: unknown, topic: string, key?: string): void;
/** Start a workflow thread if it does not already exist. */
export declare function ensureThread(value: unknown, key?: string): void;
/** High-level durable external wait handle. */
export declare function ref<T>(name?: string): Ref<T>;
/** Durable external wait handle with a caller-provided stable id. */
export declare function refId<T>(id: string, key?: string): Ref<T>;
/**
 * Advanced: block the current workflow continuation on a promise-like value.
 * Prefer native `await`; this helper is mainly for low-level runtime code.
 */
export declare function wait<T>(value: PromiseLike<T> | T): T;
/**
 * Host-facing step function. It drives a single event and resolves after the
 * promise queue has had a chance to run workflow continuations triggered by
 * this step.
 */
export declare function step(eventString: string, stateString: string, tid: string, sid: string): PromiseLike<StepResult>;
export declare function drainOutputs(): OutputRecord[];
/** Install the GraalJS/VM host globals for a bundled workflow module. */
export declare function installWorkflowHost(workflow: unknown): void;
