import * as CC from "@effectful/cc";
import * as S from "@effectful/serialization";

import {
  CancellationScope,
  currentCancellationScope,
  addCanceler,
  cancelScope,
  getCancellationScope,
  installCancelablePromise,
  setCancellationScope,
  setPromiseBranchScopeBinder,
  setPromiseHandlerRepair,
  setPromiseResultFactory,
  withCancellationScope
} from "./cancel";

declare const exports: Record<string, unknown>;

const WorkflowPromise: any = installCancelablePromise(require("promise"));
(globalThis as any).Promise = WorkflowPromise;
(S as any).regOpaqueObject?.(
  WorkflowPromise,
  "@effectful/kafka-workflow-rt/Promise"
);
(S as any).regOpaqueObject?.(
  WorkflowPromise.prototype,
  "@effectful/kafka-workflow-rt/Promise#"
);

function registerWorkflowPromiseInternals(): void {
  function noop() {}

  const probe = new WorkflowPromise(() => {});
  probe.then(noop, noop);
  const handler = (probe as any)._A?.constructor;
  if (typeof handler === "function") {
    S.regConstructor(handler, {
      name: "@effectful/kafka-workflow-rt/PromiseHandler"
    });
  }
}

registerWorkflowPromiseInternals();

type RestorableAsyncFrame = {
  awaiting?: unknown;
  promise?: any;
  onReturn?: ((value: unknown) => void) | null;
  onError?: ((reason: unknown) => void) | null;
};

function scheduleWorkflowPromiseTask(task: () => void): void {
  if (
    typeof process !== "undefined" &&
    process &&
    typeof process.nextTick === "function"
  ) {
    process.nextTick(task);
    return;
  }
  if (typeof queueMicrotask === "function") {
    queueMicrotask(task);
    return;
  }
  setTimeout(task, 0);
}

class ThenableBridge {
  done = false;

  constructor(public promise: any) {}
}
S.regConstructor(ThenableBridge);

function resolveThenableBridge(
  this: ThenableBridge,
  resolved: unknown
): unknown {
  if (this.done) return undefined;
  this.done = true;
  return resolveRestoredWorkflowPromise(this.promise, resolved);
}
S.regOpaqueObject(
  resolveThenableBridge,
  "@effectful/kafka-workflow-rt/resolveThenableBridge"
);

function rejectThenableBridge(
  this: ThenableBridge,
  reason: unknown
): unknown {
  if (this.done) return undefined;
  this.done = true;
  return rejectRestoredWorkflowPromise(this.promise, reason);
}
S.regOpaqueObject(
  rejectThenableBridge,
  "@effectful/kafka-workflow-rt/rejectThenableBridge"
);

function resolveRestoredWorkflowPromise(promise: any, value: unknown): any {
  if (!promise || promise._y !== 0) return promise;
  if (value === promise) {
    return rejectRestoredWorkflowPromise(
      promise,
      new TypeError("A promise cannot be resolved with itself.")
    );
  }
  if (value && (typeof value === "object" || typeof value === "function")) {
    let then;
    try {
      then = (value as any).then;
    } catch (error) {
      return rejectRestoredWorkflowPromise(promise, error);
    }
    if (then === promise.then && value instanceof WorkflowPromise) {
      promise._y = 3;
      promise._z = value;
      finalizeRestoredWorkflowPromise(promise);
      return promise;
    }
    if (typeof then === "function") {
      const bridge = new ThenableBridge(promise);
      try {
        then.call(
          value,
          resolveThenableBridge.bind(bridge),
          rejectThenableBridge.bind(bridge)
        );
      } catch (error) {
        if (!bridge.done) rejectRestoredWorkflowPromise(promise, error);
      }
      return promise;
    }
  }
  promise._y = 1;
  promise._z = value;
  finalizeRestoredWorkflowPromise(promise);
  return promise;
}

function rejectRestoredWorkflowPromise(promise: any, error: unknown): any {
  if (!promise || promise._y !== 0) return promise;
  promise._y = 2;
  promise._z = error;
  if (WorkflowPromise && typeof WorkflowPromise._C === "function") {
    WorkflowPromise._C(promise, error);
  }
  finalizeRestoredWorkflowPromise(promise);
  return promise;
}

function finalizeRestoredWorkflowPromise(promise: any): void {
  if (promise._x === 1) {
    scheduleRestoredWorkflowHandler(promise, promise._A);
    promise._A = null;
    return;
  }
  if (promise._x === 2) {
    for (const deferred of promise._A) {
      scheduleRestoredWorkflowHandler(promise, deferred);
    }
    promise._A = null;
  }
}

function scheduleRestoredWorkflowHandler(promise: any, deferred: any): void {
  scheduleWorkflowPromiseTask(() => {
    const cb = promise._y === 1 ? deferred.onFulfilled : deferred.onRejected;
    if (cb === null) {
      if (promise._y === 1) {
        resolveRestoredWorkflowPromise(deferred.promise, promise._z);
      } else {
        rejectRestoredWorkflowPromise(deferred.promise, promise._z);
      }
      return;
    }
    try {
      repairAwaitCallback(cb);
      resolveRestoredWorkflowPromise(deferred.promise, cb(promise._z));
    } catch (error) {
      rejectRestoredWorkflowPromise(deferred.promise, error);
    }
  });
}

function reviveRestoredWorkflowPromise(promise: unknown): void {
  let current = promise as any;
  while (current && current._y === 3) {
    current = current._z;
  }
  if (!current || (current._y !== 1 && current._y !== 2) || current._A == null) {
    return;
  }
  finalizeRestoredWorkflowPromise(current);
}

function reviveRestoredWorkflowPromises(
  value: unknown,
  visited = new Set<unknown>()
): void {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return;
  }
  if (visited.has(value)) return;
  visited.add(value);

  const promise = value as any;
  if (
    typeof promise._x === "number" &&
    typeof promise._y === "number" &&
    ("_A" in promise || "_z" in promise)
  ) {
    reviveRestoredWorkflowPromise(promise);
  }

  if (value instanceof Map) {
    for (const [key, entry] of value) {
      reviveRestoredWorkflowPromises(key, visited);
      reviveRestoredWorkflowPromises(entry, visited);
    }
    return;
  }

  if (value instanceof Set) {
    for (const entry of value) {
      reviveRestoredWorkflowPromises(entry, visited);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      reviveRestoredWorkflowPromises(entry, visited);
    }
    return;
  }

  for (const key of Object.keys(value as object)) {
    reviveRestoredWorkflowPromises((value as any)[key], visited);
  }
}

export { WorkflowPromise as Promise };
export {
  CancellationScope,
  currentCancellationScope,
  addCanceler,
  removeCanceler,
  withCancellationScope,
  cancelScope
} from "./cancel";

/** Host/runtime topic defaults. Workflow modules should prefer `manifest.outputTopics`. */
export const config = {
  outputTopics: new Set<string>(["workflow-result", "workflow-error"]),
  resultTopic: "workflow-result",
  errorTopic: "workflow-error"
};

const INTERNAL_OUTPUT_TOPICS = new Set<string>(["workflow-resume"]);

/** Host-provided thread metadata. Normal workflow code rarely needs this. */
export let threadId = "none";
export let stepId = "none";

export type OutputRecord = { key: string; value: string; topic: string };
export type StepResult = { state: string; outputs: OutputRecord[] };
export type JavaFuture = {
  complete(value: unknown): void;
  completeExceptionally(error: unknown): void;
};

const workflowPrompt = CC.newPrompt<unknown>("workflow");
const WAITING = Symbol("efwf$waiting");

export class CancelToken extends Error {
  constructor(message = "cancel") {
    super(message);
    this.name = "CancelToken";
  }
}
S.regConstructor(CancelToken);
S.regConstructor(CancellationScope);

/** Advanced: low-level continuation token used by `suspend(...)`. Prefer `ref(...)`. */
export class Suspension {
  static count = 0;
  cont?: CC.SubCont<any, any>;
  constructor(public id: string = `${stepId}:${++Suspension.count}`) {}
}
S.regConstructor(Suspension);

type RefWaiter<T = unknown> = {
  ref: Ref<T>;
  scope?: CancellationScope;
  active: boolean;
  cancel: () => unknown;
  settle: (state: 1 | 2, value: T | undefined, error: unknown) => unknown;
};

function detachRefWaiter<T>(waiter: RefWaiter<T>): void {
  if (!waiter.active) return;
  waiter.active = false;
  waiter.ref.listeners = waiter.ref.listeners.filter((item) => item !== waiter);
  if (waiter.scope) waiter.scope.cancelers.delete(waiter);
  if (waiter.ref.settled === 0 && waiter.ref.listeners.length === 0) {
    pendingRefs.delete(waiter.ref.id);
  }
}

function runInWaiterScope<T>(
  waiter: Pick<RefWaiter<unknown>, "scope">,
  body: () => T
): T {
  return waiter.scope ? withCancellationScope(waiter.scope, body) : body();
}

function repairAwaitCallback(callback: unknown): void {
  const helpers = loadDebuggerAsyncHelpers();
  const frame = helpers?.getBoundSelf?.(callback) as RestorableAsyncFrame | undefined;
  if (!frame || typeof frame !== "object" || !("awaiting" in frame)) return;
  const promise = frame.promise;
  if (!promise || typeof promise.then !== "function") return;
  const bridge = new ThenableBridge(promise);
  frame.onReturn = resolveThenableBridge.bind(bridge);
  frame.onError = rejectThenableBridge.bind(bridge);
}

function trackPendingAsyncCallback(callback: unknown): void {
  const helpers = loadDebuggerAsyncHelpers();
  const frame = helpers?.getBoundSelf?.(callback) as RestorableAsyncFrame | undefined;
  const promise = frame?.promise;
  if (promise && typeof promise.then === "function") {
    pendingAsyncPromises.add(promise);
  }
}

function isAsyncAwaitCallback(callback: unknown): boolean {
  return !!loadDebuggerAsyncHelpers()?.getBoundSelf?.(callback);
}

class CallbackRefListener<T = unknown> implements RefWaiter<T> {
  active = true;

  constructor(
    public ref: Ref<T>,
    public resolve: (value: T) => unknown,
    public reject: (reason: unknown) => unknown,
    public scope?: CancellationScope
  ) {
    trackPendingAsyncCallback(resolve);
    trackPendingAsyncCallback(reject);
  }

  cancel(): unknown {
    if (!this.active) return undefined;
    detachRefWaiter(this);
    return runInWaiterScope(this, () => {
      repairAwaitCallback(this.reject);
      return this.reject(new CancelToken());
    });
  }

  settle(state: 1 | 2, value: T | undefined, error: unknown): unknown {
    if (!this.active) return undefined;
    detachRefWaiter(this);
    return runInWaiterScope(this, () => {
      if (state === 1) {
        repairAwaitCallback(this.resolve);
        return this.resolve(value as T);
      }
      repairAwaitCallback(this.reject);
      return this.reject(error);
    });
  }
}
S.regConstructor(CallbackRefListener);

class SubContRefListener<T = unknown> implements RefWaiter<T> {
  active = true;

  constructor(
    public ref: Ref<T>,
    public cont: CC.SubCont<any, any>,
    public scope?: CancellationScope
  ) {}

  cancel(): unknown {
    return this.settle(2, undefined, new CancelToken());
  }

  settle(state: 1 | 2, value: T | undefined, error: unknown): unknown {
    if (!this.active) return undefined;
    detachRefWaiter(this);
    return runInWaiterScope(this, () =>
      CC.pushSubCont(this.cont, () => {
        if (state === 2) throw error;
        return value as T;
      })
    );
  }
}
S.regConstructor(SubContRefListener);

/** Awaitable durable external wait handle returned by `ref(...)` and `refId(...)`. */
export class Ref<T = unknown> {
  static count = 0;
  listeners: RefWaiter<T>[] = [];
  settled = 0;
  value?: T;
  error?: unknown;

  constructor(
    public id: string = `${stepId}:ref:${++Ref.count}`,
    public key: string = `${threadId}|${JSON.stringify({ ref: id })}`
  ) {}

  then(
    resolve: (value: T) => unknown,
    reject?: (reason: unknown) => unknown
  ): void {
    const continuationScope =
      isAsyncAwaitCallback(resolve) || isAsyncAwaitCallback(reject)
        ? currentCancellationScope()
        : undefined;
    const scope =
      continuationScope ?? getCancellationScope(this) ?? currentCancellationScope();
    this.addListener(
      new CallbackRefListener<T>(
        this,
        resolve,
        reject ?? ((reason: unknown) => {
          throw reason;
        }),
        scope
      )
    );
  }

  addListener(listener: RefWaiter<T>): unknown {
    if (this.settled === 1) {
      return listener.settle(1, this.value as T, undefined);
    }
    if (this.settled === 2) {
      return listener.settle(2, undefined, this.error);
    }

    if (listener.scope) {
      withCancellationScope(listener.scope, () => addCanceler(listener));
    }
    this.listeners.push(listener);
    return undefined;
  }

  resolve(value: T): unknown {
    return this.settle(1, value, undefined);
  }

  reject(reason: unknown): unknown {
    return this.settle(2, undefined, reason);
  }

  private settle(state: 1 | 2, value: T | undefined, error: unknown): unknown {
    if (this.settled !== 0) return undefined;
    this.settled = state;
    this.value = value;
    this.error = error;
    pendingRefs.delete(this.id);

    const listeners = this.listeners.slice();
    this.listeners.length = 0;
    let resumed: unknown = undefined;
    for (const listener of listeners) {
      const next = listener.settle(state, value, error);
      if (next !== undefined) {
        resumed = rememberResume(next);
      }
    }
    return resumed;
  }
}
S.regConstructor(Ref);

setPromiseResultFactory(<T>() => {
  const id = `${stepId}:promise:${++Ref.count}`;
  return new Ref<T>(id, `${threadId}|${JSON.stringify({ promise: id })}`);
});

type DebuggerAsyncHelpers = {
  getSuspendedFrameByPromise?: (promise: unknown) => { awaiting?: unknown } | undefined;
  getBoundSelf?: (value: unknown) => unknown;
};

let debuggerAsyncHelpers: DebuggerAsyncHelpers | null | undefined;

function loadDebuggerAsyncHelpers(): DebuggerAsyncHelpers | null {
  if (debuggerAsyncHelpers !== undefined) return debuggerAsyncHelpers ?? null;
  try {
    debuggerAsyncHelpers = require("@effectful/debugger/async");
  } catch (_error) {
    debuggerAsyncHelpers = null;
  }
  return debuggerAsyncHelpers ?? null;
}

function moveListenerToScope(
  listener: RefWaiter<any>,
  scope: CancellationScope
): void {
  if (listener.scope === scope) return;
  listener.scope?.cancelers.delete(listener);
  listener.scope = scope;
  scope.cancelers.add(listener);
}

function isFrameListener(
  helpers: DebuggerAsyncHelpers,
  frame: unknown,
  listener: RefWaiter<any>
): boolean {
  const getBoundSelf = helpers.getBoundSelf;
  if (typeof getBoundSelf !== "function") return false;
  const callbackListener = listener as CallbackRefListener<any>;
  return (
    getBoundSelf(callbackListener.resolve) === frame ||
    getBoundSelf(callbackListener.reject) === frame
  );
}

function bindAwaitChainToScope(
  value: unknown,
  scope: CancellationScope,
  helpers: DebuggerAsyncHelpers,
  visited = new Set<unknown>()
): void {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return;
  }
  if (visited.has(value)) return;
  visited.add(value);
  setCancellationScope(value, scope);

  const frame = helpers.getSuspendedFrameByPromise?.(value);
  if (!frame) return;

  const awaiting = frame.awaiting;
  if (awaiting instanceof Ref) {
    for (const listener of awaiting.listeners) {
      if (listener.active && isFrameListener(helpers, frame, listener)) {
        moveListenerToScope(listener, scope);
      }
    }
    return;
  }

  bindAwaitChainToScope(awaiting, scope, helpers, visited);
}

setPromiseBranchScopeBinder((value, scope) => {
  const helpers = loadDebuggerAsyncHelpers();
  if (helpers?.getSuspendedFrameByPromise) {
    bindAwaitChainToScope(value, scope, helpers);
  } else {
    setCancellationScope(value, scope);
  }
  return value;
});

setPromiseHandlerRepair((handler) => {
  repairAwaitCallback(handler);
});

let suspended = new Map<string, Suspension>();
let pendingRefs = new Map<string, Ref<any>>();
let pendingAsyncPromises = new Set<any>();
let rootScope = new CancellationScope();
const toOutput: OutputRecord[] = [];
let latestResume: unknown = undefined;
let mainResult: unknown = undefined;

function rememberResume(value: unknown): unknown {
  if (value !== undefined) latestResume = value;
  return value;
}

/** Advanced: suspend the current computation, returning a resumable token. Prefer `ref(...)`. */
export function suspend(id?: string): any {
  return CC.withSubCont(workflowPrompt, (cont) => {
    const susp = new Suspension(id ?? `${stepId}:${++Suspension.count}`);
    susp.cont = cont;
    suspended.set(susp.id, susp);
    return CC.abort(workflowPrompt, susp);
  });
}

/** Queue a raw string output record. Prefer `outputJSON(...)` for JSON protocols. */
export function output(value: string, topic: string, key = threadId) {
  toOutput.push({ key, value, topic });
}

/** Queue an output record with JSON stringified payload. */
export function outputJSON(value: unknown, topic: string, key = threadId) {
  return output(JSON.stringify(value), topic, key);
}

/** Start a workflow thread if it does not already exist. */
export function ensureThread(value: unknown, key = threadId) {
  return output(`init:${JSON.stringify(value)}`, "workflow-resume", key);
}

/** High-level durable external wait handle. */
export function ref<T>(name = "ref"): Ref<T> {
  const id = `${stepId}:${name}:${++Ref.count}`;
  const handle = new Ref<T>(id, `${threadId}|${JSON.stringify({ ref: id })}`);
  pendingRefs.set(handle.id, handle);
  return handle;
}

/** Durable external wait handle with a caller-provided stable id. */
export function refId<T>(
  id: string,
  key = `${threadId}|${JSON.stringify({ ref: id })}`
): Ref<T> {
  const handle = new Ref<T>(id, key);
  pendingRefs.set(handle.id, handle);
  return handle;
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return !!value && typeof (value as any).then === "function";
}

function isSettledWorkflowPromise<T>(
  value: unknown
): { settled: boolean; rejected: boolean; value: T | unknown } {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return { settled: false, rejected: false, value: undefined };
  }
  const promise = value as any;
  if (typeof promise._y !== "number") {
    return { settled: false, rejected: false, value: undefined };
  }
  if (promise._y === 1) {
    return { settled: true, rejected: false, value: promise._z };
  }
  if (promise._y === 2) {
    return { settled: true, rejected: true, value: promise._z };
  }
  return { settled: false, rejected: false, value: undefined };
}

/**
 * Advanced: block the current workflow continuation on a promise-like value.
 * Prefer native `await`; this helper is mainly for low-level runtime code.
 */
export function wait<T>(value: PromiseLike<T> | T): T {
  if (!isPromiseLike<T>(value)) return value as T;

  if (value instanceof Ref) {
    return CC.withSubCont(workflowPrompt, (cont) => {
      value.addListener(
        new SubContRefListener<T>(
          value,
          cont,
          currentCancellationScope()
        )
      );
      return CC.abort(workflowPrompt, WAITING as any);
    });
  }

  const settled = isSettledWorkflowPromise<T>(value);
  if (settled.settled) {
    if (settled.rejected) throw settled.value;
    return settled.value as T;
  }

  return CC.withSubCont(workflowPrompt, (cont) => {
    WorkflowPromise.resolve(value).then(
      (resolved: T) => {
        CC.pushSubCont(cont, () => resolved);
      },
      (error: unknown) => {
        CC.pushSubCont(cont, () => {
          throw error;
        });
      }
    );
    return CC.abort(workflowPrompt, WAITING as any);
  });
}

type ResumeResult = { handled: boolean; result: unknown };

/** Internal: resume a saved low-level suspension */
function resumeSuspension(refId: string, payload: any, isError: boolean): ResumeResult {
  const susp = suspended.get(refId);
  if (!susp || !susp.cont) return { handled: false, result: undefined };
  suspended.delete(refId);
  const result = rememberResume(CC.pushSubCont(susp.cont, () => {
    if (isError) throw payload;
    return payload;
  }));
  return { handled: true, result };
}

function settleRef(refId: string, payload: any, isError: boolean): ResumeResult {
  const handle = pendingRefs.get(refId);
  if (!handle) return { handled: false, result: undefined };
  const result = isError ? handle.reject(payload) : handle.resolve(payload);
  return { handled: true, result };
}

function hasPendingWork(): boolean {
  return suspended.size > 0 || pendingRefs.size > 0 || hasPendingAsyncWork();
}

function resetState(): void {
  suspended = new Map();
  pendingRefs = new Map();
  pendingAsyncPromises = new Set();
  rootScope = new CancellationScope();
  mainResult = undefined;
}

function prunePendingAsyncPromises(): void {
  for (const promise of [...pendingAsyncPromises]) {
    let current = promise;
    while (current && current._y === 3) {
      current = current._z;
    }
    if (!current || (current._y !== 0 && current._A == null)) {
      pendingAsyncPromises.delete(promise);
    }
  }
}

function trackMainResult(value: unknown): unknown {
  mainResult = value;
  return value;
}

function unwrapMainResult():
  | { pending: boolean; result: unknown; error: unknown }
  | undefined {
  if (!isPromiseLike(mainResult)) return undefined;
  const settled = isSettledWorkflowPromise(mainResult);
  if (!settled.settled) {
    return { pending: true, result: mainResult, error: undefined };
  }
  if (settled.rejected) {
    return { pending: false, result: undefined, error: settled.value };
  }
  return { pending: false, result: settled.value, error: undefined };
}

function hasPendingAsyncWork(): boolean {
  if (pendingAsyncPromises.size > 0) return true;
  return unwrapMainResult()?.pending === true;
}

/** Load state from a persisted JSON string (host-provided) */
function loadState(stateString: string | null) {
  if (!stateString) {
    resetState();
    return null;
  }
  const parsed = JSON.parse(stateString);
  if (parsed && parsed.running) {
    const state = S.read(parsed);
    reviveRestoredWorkflowPromises(state);
    suspended = state.suspended || new Map();
    pendingRefs = state.pendingRefs || new Map();
    pendingAsyncPromises = state.pendingAsyncPromises || new Set();
    rootScope = state.rootScope || new CancellationScope();
    mainResult = state.mainResult;
    return parsed;
  }
  resetState();
  return parsed;
}

/** Persist current state for the host runner */
function saveState() {
  prunePendingAsyncPromises();
  if (!hasPendingWork()) return "";
  const stateData: any = S.write(
      {
        suspended,
        pendingRefs,
        pendingAsyncPromises,
        rootScope,
        mainResult
      },
      { verbose: true, warnIgnored: true }
  );
  stateData.running = true;
  return JSON.stringify(stateData);
}

function unwrapStepResult(
  result: unknown,
  error: unknown
): { pending: boolean; result: unknown; error: unknown } {
  if (error !== undefined || !isPromiseLike(result)) {
    return { pending: false, result, error };
  }
  const settled = isSettledWorkflowPromise(result);
  if (!settled.settled) {
    return { pending: true, result, error };
  }
  if (settled.rejected) {
    return { pending: false, result: undefined, error: settled.value };
  }
  return { pending: false, result: settled.value, error };
}

function refreshStepResult(
  result: unknown,
  error: unknown
): { result: unknown; error: unknown } {
  if (latestResume !== undefined) {
    result = latestResume;
  }
  const unwrapped = unwrapMainResult() ?? unwrapStepResult(result, error);
  return {
    result: unwrapped.result,
    error: unwrapped.error
  };
}

async function drainStepAsyncWork(
  result: unknown,
  error: unknown,
  rounds = 64
): Promise<{ result: unknown; error: unknown }> {
  for (let round = 0; round < rounds; round++) {
    await drainMicrotasks();
    ({ result, error } = refreshStepResult(result, error));
    if (!hasPendingAsyncWork()) break;
  }
  return { result, error };
}

function drainMicrotasks(turns = 256): PromiseLike<void> {
  let promise = WorkflowPromise.resolve();
  for (let index = 0; index < turns; index++) {
    promise = promise.then(() => undefined);
  }
  return promise;
}

function finalizeStep(result: unknown, error: unknown): StepResult {
  prunePendingAsyncPromises();
  const pending = hasPendingWork();
  if (error !== undefined && !pending && config.errorTopic) {
    outputJSON(String(error), config.errorTopic);
  } else if (
    error === undefined &&
    !pending &&
    result !== undefined &&
    result !== WAITING &&
    !(result instanceof Suspension)
  ) {
    outputJSON(result, config.resultTopic);
  }

  return {
    state: saveState(),
    outputs: [...toOutput]
  };
}

/**
 * Host-facing step function. It drives a single event and resolves after the
 * promise queue has had a chance to run workflow continuations triggered by
 * this step.
 */
export function step(
  eventString: string,
  stateString: string,
  tid: string,
  sid: string
): PromiseLike<StepResult> {
  threadId = tid;
  stepId = sid;
  Suspension.count = 0;
  Ref.count = 0;
  toOutput.length = 0;
  latestResume = undefined;

  const stJSON = loadState(stateString);
  const eventJSON = JSON.parse(eventString);

  let result: unknown = undefined;
  let error: unknown = undefined;

  withCancellationScope(rootScope, () => {
    try {
      result = CC.pushPrompt(workflowPrompt, () => {
        if (stJSON && stJSON.running) {
          if (eventJSON.ref) {
            const refId = String(eventJSON.ref);
            const payload = "error" in eventJSON ? eventJSON.error : eventJSON.value;
            const isError = "error" in eventJSON;
            const settled = settleRef(refId, payload, isError);
            if (settled.handled) return settled.result;
            const suspendedResult = resumeSuspension(refId, payload, isError);
            if (suspendedResult.handled) return suspendedResult.result;
          }
          return stJSON;
        }

        let main = (globalThis as any).efwf$module;
        if (main && typeof main !== "function") main = main.default || main.main;
        if (!main) throw new TypeError("No workflow code");
        const value = main(eventJSON, stJSON);
        if (isPromiseLike(value)) trackMainResult(value);
        return value;
      });
    } catch (err) {
      error = err;
    }
  });

  return drainMicrotasks()
    .then(() => {
      ({ result, error } = refreshStepResult(result, error));
      return undefined;
    })
    .then(() => {
      return drainStepAsyncWork(result, error).then((next) => {
        result = next.result;
        error = next.error;
      });
    })
    .then(() => {
      return finalizeStep(result, error);
    });
}

// convenience export for host integration
export function drainOutputs() {
  const res = [...toOutput];
  toOutput.length = 0;
  return res;
}

function lookupJavaType(name: string): any {
  const JavaApi = (globalThis as any).Java;
  return JavaApi && typeof JavaApi.type === "function"
    ? JavaApi.type(name)
    : null;
}

function wrapHostError(error: unknown): unknown {
  const ExceptionClass = lookupJavaType("java.lang.Exception");
  return ExceptionClass ? new ExceptionClass(String(error)) : error;
}

function completeHostStepResult(
  future: JavaFuture | undefined,
  result: StepResult
): StepResult | undefined {
  if (!future) return result;
  const ArrayListClass = lookupJavaType("java.util.ArrayList");
  const ListClass = lookupJavaType("java.util.List");
  if (!ArrayListClass || !ListClass) {
    future.complete(result);
    return undefined;
  }
  const output = new ArrayListClass();
  output.add(ListClass.of(result.state));
  for (const { key, value, topic } of result.outputs) {
    output.add(ListClass.of(key, value, topic));
  }
  future.complete(output);
  return undefined;
}

function completeHostFutureStep(
  this: { future: JavaFuture },
  result: StepResult
): undefined {
  completeHostStepResult(this.future, result);
  return undefined;
}

function failHostFutureStep(
  this: { future: JavaFuture },
  error: unknown
): undefined {
  this.future.completeExceptionally(wrapHostError(error));
  return undefined;
}

function hostOutputTopics(dest: { add(value: string): unknown }): void {
  for (const topic of config.outputTopics) {
    if (!INTERNAL_OUTPUT_TOPICS.has(topic)) dest.add(topic);
  }
  const workflow = (globalThis as any).efwf$module;
  const manifestTopics = workflow?.manifest?.outputTopics;
  if (manifestTopics) {
    for (const topic of manifestTopics) {
      if (!INTERNAL_OUTPUT_TOPICS.has(topic)) dest.add(topic);
    }
  }
}
S.regOpaqueObject(hostOutputTopics, "@effectful/kafka-workflow-rt/hostOutputTopics");

function hostStep(
  eventString: string,
  stateString: string,
  tid: string,
  sid: string,
  future?: JavaFuture
) {
  const currentStep = step(eventString, stateString, tid, sid);
  if (!future) return currentStep;
  const state = { future };
  return currentStep.then(
    completeHostFutureStep.bind(state),
    failHostFutureStep.bind(state)
  );
}
S.regOpaqueObject(hostStep, "@effectful/kafka-workflow-rt/hostStep");

/** Install the GraalJS/VM host globals for a bundled workflow module. */
export function installWorkflowHost(workflow: unknown): void {
  (globalThis as any).efwf$module = workflow;
  (globalThis as any).efwf$outputTopics = hostOutputTopics;
  (globalThis as any).efwf$step = hostStep;
}

(S as any).regOpaqueObject?.(exports, "@effectful/kafka-workflow-rt");
