"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ref = exports.Suspension = exports.CancelToken = exports.stepId = exports.threadId = exports.config = exports.cancelScope = exports.withCancellationScope = exports.removeCanceler = exports.addCanceler = exports.currentCancellationScope = exports.CancellationScope = exports.Promise = void 0;
exports.suspend = suspend;
exports.output = output;
exports.outputJSON = outputJSON;
exports.ensureThread = ensureThread;
exports.ref = ref;
exports.refId = refId;
exports.wait = wait;
exports.step = step;
exports.drainOutputs = drainOutputs;
exports.installWorkflowHost = installWorkflowHost;
const CC = __importStar(require("@effectful/cc"));
const S = __importStar(require("@effectful/serialization"));
const cancel_1 = require("./cancel");
const WorkflowPromise = (0, cancel_1.installCancelablePromise)(require("promise"));
exports.Promise = WorkflowPromise;
globalThis.Promise = WorkflowPromise;
S.regOpaqueObject?.(WorkflowPromise, "@effectful/kafka-workflow-rt/Promise");
S.regOpaqueObject?.(WorkflowPromise.prototype, "@effectful/kafka-workflow-rt/Promise#");
function registerWorkflowPromiseInternals() {
    function noop() { }
    const probe = new WorkflowPromise(() => { });
    probe.then(noop, noop);
    const handler = probe._A?.constructor;
    if (typeof handler === "function") {
        S.regConstructor(handler, {
            name: "@effectful/kafka-workflow-rt/PromiseHandler"
        });
    }
}
registerWorkflowPromiseInternals();
function scheduleWorkflowPromiseTask(task) {
    if (typeof process !== "undefined" &&
        process &&
        typeof process.nextTick === "function") {
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
    constructor(promise) {
        this.promise = promise;
        this.done = false;
    }
}
S.regConstructor(ThenableBridge);
function resolveThenableBridge(resolved) {
    if (this.done)
        return undefined;
    this.done = true;
    return resolveRestoredWorkflowPromise(this.promise, resolved);
}
S.regOpaqueObject(resolveThenableBridge, "@effectful/kafka-workflow-rt/resolveThenableBridge");
function rejectThenableBridge(reason) {
    if (this.done)
        return undefined;
    this.done = true;
    return rejectRestoredWorkflowPromise(this.promise, reason);
}
S.regOpaqueObject(rejectThenableBridge, "@effectful/kafka-workflow-rt/rejectThenableBridge");
function resolveRestoredWorkflowPromise(promise, value) {
    if (!promise || promise._y !== 0)
        return promise;
    if (value === promise) {
        return rejectRestoredWorkflowPromise(promise, new TypeError("A promise cannot be resolved with itself."));
    }
    if (value && (typeof value === "object" || typeof value === "function")) {
        let then;
        try {
            then = value.then;
        }
        catch (error) {
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
                then.call(value, resolveThenableBridge.bind(bridge), rejectThenableBridge.bind(bridge));
            }
            catch (error) {
                if (!bridge.done)
                    rejectRestoredWorkflowPromise(promise, error);
            }
            return promise;
        }
    }
    promise._y = 1;
    promise._z = value;
    finalizeRestoredWorkflowPromise(promise);
    return promise;
}
function rejectRestoredWorkflowPromise(promise, error) {
    if (!promise || promise._y !== 0)
        return promise;
    promise._y = 2;
    promise._z = error;
    if (WorkflowPromise && typeof WorkflowPromise._C === "function") {
        WorkflowPromise._C(promise, error);
    }
    finalizeRestoredWorkflowPromise(promise);
    return promise;
}
function finalizeRestoredWorkflowPromise(promise) {
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
function scheduleRestoredWorkflowHandler(promise, deferred) {
    scheduleWorkflowPromiseTask(() => {
        const cb = promise._y === 1 ? deferred.onFulfilled : deferred.onRejected;
        if (cb === null) {
            if (promise._y === 1) {
                resolveRestoredWorkflowPromise(deferred.promise, promise._z);
            }
            else {
                rejectRestoredWorkflowPromise(deferred.promise, promise._z);
            }
            return;
        }
        try {
            repairAwaitCallback(cb);
            resolveRestoredWorkflowPromise(deferred.promise, cb(promise._z));
        }
        catch (error) {
            rejectRestoredWorkflowPromise(deferred.promise, error);
        }
    });
}
function reviveRestoredWorkflowPromise(promise) {
    let current = promise;
    while (current && current._y === 3) {
        current = current._z;
    }
    if (!current || (current._y !== 1 && current._y !== 2) || current._A == null) {
        return;
    }
    finalizeRestoredWorkflowPromise(current);
}
function reviveRestoredWorkflowPromises(value, visited = new Set()) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) {
        return;
    }
    if (visited.has(value))
        return;
    visited.add(value);
    const promise = value;
    if (typeof promise._x === "number" &&
        typeof promise._y === "number" &&
        ("_A" in promise || "_z" in promise)) {
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
    for (const key of Object.keys(value)) {
        reviveRestoredWorkflowPromises(value[key], visited);
    }
}
var cancel_2 = require("./cancel");
Object.defineProperty(exports, "CancellationScope", { enumerable: true, get: function () { return cancel_2.CancellationScope; } });
Object.defineProperty(exports, "currentCancellationScope", { enumerable: true, get: function () { return cancel_2.currentCancellationScope; } });
Object.defineProperty(exports, "addCanceler", { enumerable: true, get: function () { return cancel_2.addCanceler; } });
Object.defineProperty(exports, "removeCanceler", { enumerable: true, get: function () { return cancel_2.removeCanceler; } });
Object.defineProperty(exports, "withCancellationScope", { enumerable: true, get: function () { return cancel_2.withCancellationScope; } });
Object.defineProperty(exports, "cancelScope", { enumerable: true, get: function () { return cancel_2.cancelScope; } });
/** Host/runtime topic defaults. Workflow modules should prefer `manifest.outputTopics`. */
exports.config = {
    outputTopics: new Set(["workflow-result", "workflow-error"]),
    resultTopic: "workflow-result",
    errorTopic: "workflow-error"
};
const INTERNAL_OUTPUT_TOPICS = new Set(["workflow-resume"]);
/** Host-provided thread metadata. Normal workflow code rarely needs this. */
exports.threadId = "none";
exports.stepId = "none";
const workflowPrompt = CC.newPrompt("workflow");
const WAITING = Symbol("efwf$waiting");
class CancelToken extends Error {
    constructor(message = "cancel") {
        super(message);
        this.name = "CancelToken";
    }
}
exports.CancelToken = CancelToken;
S.regConstructor(CancelToken);
S.regConstructor(cancel_1.CancellationScope);
/** Advanced: low-level continuation token used by `suspend(...)`. Prefer `ref(...)`. */
class Suspension {
    constructor(id = `${exports.stepId}:${++Suspension.count}`) {
        this.id = id;
    }
}
exports.Suspension = Suspension;
Suspension.count = 0;
S.regConstructor(Suspension);
function detachRefWaiter(waiter) {
    if (!waiter.active)
        return;
    waiter.active = false;
    waiter.ref.listeners = waiter.ref.listeners.filter((item) => item !== waiter);
    if (waiter.scope)
        waiter.scope.cancelers.delete(waiter);
    if (waiter.ref.settled === 0 && waiter.ref.listeners.length === 0) {
        pendingRefs.delete(waiter.ref.id);
    }
}
function runInWaiterScope(waiter, body) {
    return waiter.scope ? (0, cancel_1.withCancellationScope)(waiter.scope, body) : body();
}
function repairAwaitCallback(callback) {
    const helpers = loadDebuggerAsyncHelpers();
    const frame = helpers?.getBoundSelf?.(callback);
    if (!frame || typeof frame !== "object" || !("awaiting" in frame))
        return;
    const promise = frame.promise;
    if (!promise || typeof promise.then !== "function")
        return;
    const bridge = new ThenableBridge(promise);
    frame.onReturn = resolveThenableBridge.bind(bridge);
    frame.onError = rejectThenableBridge.bind(bridge);
}
function trackPendingAsyncCallback(callback) {
    const helpers = loadDebuggerAsyncHelpers();
    const frame = helpers?.getBoundSelf?.(callback);
    const promise = frame?.promise;
    if (promise && typeof promise.then === "function") {
        pendingAsyncPromises.add(promise);
    }
}
function isAsyncAwaitCallback(callback) {
    return !!loadDebuggerAsyncHelpers()?.getBoundSelf?.(callback);
}
class CallbackRefListener {
    constructor(ref, resolve, reject, scope) {
        this.ref = ref;
        this.resolve = resolve;
        this.reject = reject;
        this.scope = scope;
        this.active = true;
        trackPendingAsyncCallback(resolve);
        trackPendingAsyncCallback(reject);
    }
    cancel() {
        if (!this.active)
            return undefined;
        detachRefWaiter(this);
        return runInWaiterScope(this, () => {
            repairAwaitCallback(this.reject);
            return this.reject(new CancelToken());
        });
    }
    settle(state, value, error) {
        if (!this.active)
            return undefined;
        detachRefWaiter(this);
        return runInWaiterScope(this, () => {
            if (state === 1) {
                repairAwaitCallback(this.resolve);
                return this.resolve(value);
            }
            repairAwaitCallback(this.reject);
            return this.reject(error);
        });
    }
}
S.regConstructor(CallbackRefListener);
class SubContRefListener {
    constructor(ref, cont, scope) {
        this.ref = ref;
        this.cont = cont;
        this.scope = scope;
        this.active = true;
    }
    cancel() {
        return this.settle(2, undefined, new CancelToken());
    }
    settle(state, value, error) {
        if (!this.active)
            return undefined;
        detachRefWaiter(this);
        return runInWaiterScope(this, () => CC.pushSubCont(this.cont, () => {
            if (state === 2)
                throw error;
            return value;
        }));
    }
}
S.regConstructor(SubContRefListener);
/** Awaitable durable external wait handle returned by `ref(...)` and `refId(...)`. */
class Ref {
    constructor(id = `${exports.stepId}:ref:${++Ref.count}`, key = `${exports.threadId}|${JSON.stringify({ ref: id })}`) {
        this.id = id;
        this.key = key;
        this.listeners = [];
        this.settled = 0;
    }
    then(resolve, reject) {
        const continuationScope = isAsyncAwaitCallback(resolve) || isAsyncAwaitCallback(reject)
            ? (0, cancel_1.currentCancellationScope)()
            : undefined;
        const scope = continuationScope ?? (0, cancel_1.getCancellationScope)(this) ?? (0, cancel_1.currentCancellationScope)();
        this.addListener(new CallbackRefListener(this, resolve, reject ?? ((reason) => {
            throw reason;
        }), scope));
    }
    addListener(listener) {
        if (this.settled === 1) {
            return listener.settle(1, this.value, undefined);
        }
        if (this.settled === 2) {
            return listener.settle(2, undefined, this.error);
        }
        if (listener.scope) {
            (0, cancel_1.withCancellationScope)(listener.scope, () => (0, cancel_1.addCanceler)(listener));
        }
        this.listeners.push(listener);
        return undefined;
    }
    resolve(value) {
        return this.settle(1, value, undefined);
    }
    reject(reason) {
        return this.settle(2, undefined, reason);
    }
    settle(state, value, error) {
        if (this.settled !== 0)
            return undefined;
        this.settled = state;
        this.value = value;
        this.error = error;
        pendingRefs.delete(this.id);
        const listeners = this.listeners.slice();
        this.listeners.length = 0;
        let resumed = undefined;
        for (const listener of listeners) {
            const next = listener.settle(state, value, error);
            if (next !== undefined) {
                resumed = rememberResume(next);
            }
        }
        return resumed;
    }
}
exports.Ref = Ref;
Ref.count = 0;
S.regConstructor(Ref);
(0, cancel_1.setPromiseResultFactory)(() => {
    const id = `${exports.stepId}:promise:${++Ref.count}`;
    return new Ref(id, `${exports.threadId}|${JSON.stringify({ promise: id })}`);
});
let debuggerAsyncHelpers;
function loadDebuggerAsyncHelpers() {
    if (debuggerAsyncHelpers !== undefined)
        return debuggerAsyncHelpers ?? null;
    try {
        debuggerAsyncHelpers = require("@effectful/debugger/async");
    }
    catch (_error) {
        debuggerAsyncHelpers = null;
    }
    return debuggerAsyncHelpers ?? null;
}
function moveListenerToScope(listener, scope) {
    if (listener.scope === scope)
        return;
    listener.scope?.cancelers.delete(listener);
    listener.scope = scope;
    scope.cancelers.add(listener);
}
function isFrameListener(helpers, frame, listener) {
    const getBoundSelf = helpers.getBoundSelf;
    if (typeof getBoundSelf !== "function")
        return false;
    const callbackListener = listener;
    return (getBoundSelf(callbackListener.resolve) === frame ||
        getBoundSelf(callbackListener.reject) === frame);
}
function bindAwaitChainToScope(value, scope, helpers, visited = new Set()) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) {
        return;
    }
    if (visited.has(value))
        return;
    visited.add(value);
    (0, cancel_1.setCancellationScope)(value, scope);
    const frame = helpers.getSuspendedFrameByPromise?.(value);
    if (!frame)
        return;
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
(0, cancel_1.setPromiseBranchScopeBinder)((value, scope) => {
    const helpers = loadDebuggerAsyncHelpers();
    if (helpers?.getSuspendedFrameByPromise) {
        bindAwaitChainToScope(value, scope, helpers);
    }
    else {
        (0, cancel_1.setCancellationScope)(value, scope);
    }
    return value;
});
(0, cancel_1.setPromiseHandlerRepair)((handler) => {
    repairAwaitCallback(handler);
});
let suspended = new Map();
let pendingRefs = new Map();
let pendingAsyncPromises = new Set();
let rootScope = new cancel_1.CancellationScope();
const toOutput = [];
let latestResume = undefined;
let mainResult = undefined;
function rememberResume(value) {
    if (value !== undefined)
        latestResume = value;
    return value;
}
/** Advanced: suspend the current computation, returning a resumable token. Prefer `ref(...)`. */
function suspend(id) {
    return CC.withSubCont(workflowPrompt, (cont) => {
        const susp = new Suspension(id ?? `${exports.stepId}:${++Suspension.count}`);
        susp.cont = cont;
        suspended.set(susp.id, susp);
        return CC.abort(workflowPrompt, susp);
    });
}
/** Queue a raw string output record. Prefer `outputJSON(...)` for JSON protocols. */
function output(value, topic, key = exports.threadId) {
    toOutput.push({ key, value, topic });
}
/** Queue an output record with JSON stringified payload. */
function outputJSON(value, topic, key = exports.threadId) {
    return output(JSON.stringify(value), topic, key);
}
/** Start a workflow thread if it does not already exist. */
function ensureThread(value, key = exports.threadId) {
    return output(`init:${JSON.stringify(value)}`, "workflow-resume", key);
}
/** High-level durable external wait handle. */
function ref(name = "ref") {
    const id = `${exports.stepId}:${name}:${++Ref.count}`;
    const handle = new Ref(id, `${exports.threadId}|${JSON.stringify({ ref: id })}`);
    pendingRefs.set(handle.id, handle);
    return handle;
}
/** Durable external wait handle with a caller-provided stable id. */
function refId(id, key = `${exports.threadId}|${JSON.stringify({ ref: id })}`) {
    const handle = new Ref(id, key);
    pendingRefs.set(handle.id, handle);
    return handle;
}
function isPromiseLike(value) {
    return !!value && typeof value.then === "function";
}
function isSettledWorkflowPromise(value) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) {
        return { settled: false, rejected: false, value: undefined };
    }
    const promise = value;
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
function wait(value) {
    if (!isPromiseLike(value))
        return value;
    if (value instanceof Ref) {
        return CC.withSubCont(workflowPrompt, (cont) => {
            value.addListener(new SubContRefListener(value, cont, (0, cancel_1.currentCancellationScope)()));
            return CC.abort(workflowPrompt, WAITING);
        });
    }
    const settled = isSettledWorkflowPromise(value);
    if (settled.settled) {
        if (settled.rejected)
            throw settled.value;
        return settled.value;
    }
    return CC.withSubCont(workflowPrompt, (cont) => {
        WorkflowPromise.resolve(value).then((resolved) => {
            CC.pushSubCont(cont, () => resolved);
        }, (error) => {
            CC.pushSubCont(cont, () => {
                throw error;
            });
        });
        return CC.abort(workflowPrompt, WAITING);
    });
}
/** Internal: resume a saved low-level suspension */
function resumeSuspension(refId, payload, isError) {
    const susp = suspended.get(refId);
    if (!susp || !susp.cont)
        return { handled: false, result: undefined };
    suspended.delete(refId);
    const result = rememberResume(CC.pushSubCont(susp.cont, () => {
        if (isError)
            throw payload;
        return payload;
    }));
    return { handled: true, result };
}
function settleRef(refId, payload, isError) {
    const handle = pendingRefs.get(refId);
    if (!handle)
        return { handled: false, result: undefined };
    const result = isError ? handle.reject(payload) : handle.resolve(payload);
    return { handled: true, result };
}
function hasPendingWork() {
    return suspended.size > 0 || pendingRefs.size > 0 || hasPendingAsyncWork();
}
function resetState() {
    suspended = new Map();
    pendingRefs = new Map();
    pendingAsyncPromises = new Set();
    rootScope = new cancel_1.CancellationScope();
    mainResult = undefined;
}
function prunePendingAsyncPromises() {
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
function trackMainResult(value) {
    mainResult = value;
    return value;
}
function unwrapMainResult() {
    if (!isPromiseLike(mainResult))
        return undefined;
    const settled = isSettledWorkflowPromise(mainResult);
    if (!settled.settled) {
        return { pending: true, result: mainResult, error: undefined };
    }
    if (settled.rejected) {
        return { pending: false, result: undefined, error: settled.value };
    }
    return { pending: false, result: settled.value, error: undefined };
}
function hasPendingAsyncWork() {
    if (pendingAsyncPromises.size > 0)
        return true;
    return unwrapMainResult()?.pending === true;
}
/** Load state from a persisted JSON string (host-provided) */
function loadState(stateString) {
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
        rootScope = state.rootScope || new cancel_1.CancellationScope();
        mainResult = state.mainResult;
        return parsed;
    }
    resetState();
    return parsed;
}
/** Persist current state for the host runner */
function saveState() {
    prunePendingAsyncPromises();
    if (!hasPendingWork())
        return "";
    const stateData = S.write({
        suspended,
        pendingRefs,
        pendingAsyncPromises,
        rootScope,
        mainResult
    }, { verbose: true, warnIgnored: true });
    stateData.running = true;
    return JSON.stringify(stateData);
}
function unwrapStepResult(result, error) {
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
function refreshStepResult(result, error) {
    if (latestResume !== undefined) {
        result = latestResume;
    }
    const unwrapped = unwrapMainResult() ?? unwrapStepResult(result, error);
    return {
        result: unwrapped.result,
        error: unwrapped.error
    };
}
async function drainStepAsyncWork(result, error, rounds = 64) {
    for (let round = 0; round < rounds; round++) {
        await drainMicrotasks();
        ({ result, error } = refreshStepResult(result, error));
        if (!hasPendingAsyncWork())
            break;
    }
    return { result, error };
}
function drainMicrotasks(turns = 256) {
    let promise = WorkflowPromise.resolve();
    for (let index = 0; index < turns; index++) {
        promise = promise.then(() => undefined);
    }
    return promise;
}
function finalizeStep(result, error) {
    prunePendingAsyncPromises();
    const pending = hasPendingWork();
    if (error !== undefined && !pending && exports.config.errorTopic) {
        outputJSON(String(error), exports.config.errorTopic);
    }
    else if (error === undefined &&
        !pending &&
        result !== undefined &&
        result !== WAITING &&
        !(result instanceof Suspension)) {
        outputJSON(result, exports.config.resultTopic);
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
function step(eventString, stateString, tid, sid) {
    exports.threadId = tid;
    exports.stepId = sid;
    Suspension.count = 0;
    Ref.count = 0;
    toOutput.length = 0;
    latestResume = undefined;
    const stJSON = loadState(stateString);
    const eventJSON = JSON.parse(eventString);
    let result = undefined;
    let error = undefined;
    (0, cancel_1.withCancellationScope)(rootScope, () => {
        try {
            result = CC.pushPrompt(workflowPrompt, () => {
                if (stJSON && stJSON.running) {
                    if (eventJSON.ref) {
                        const refId = String(eventJSON.ref);
                        const payload = "error" in eventJSON ? eventJSON.error : eventJSON.value;
                        const isError = "error" in eventJSON;
                        const settled = settleRef(refId, payload, isError);
                        if (settled.handled)
                            return settled.result;
                        const suspendedResult = resumeSuspension(refId, payload, isError);
                        if (suspendedResult.handled)
                            return suspendedResult.result;
                    }
                    return stJSON;
                }
                let main = globalThis.efwf$module;
                if (main && typeof main !== "function")
                    main = main.default || main.main;
                if (!main)
                    throw new TypeError("No workflow code");
                const value = main(eventJSON, stJSON);
                if (isPromiseLike(value))
                    trackMainResult(value);
                return value;
            });
        }
        catch (err) {
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
function drainOutputs() {
    const res = [...toOutput];
    toOutput.length = 0;
    return res;
}
function lookupJavaType(name) {
    const JavaApi = globalThis.Java;
    return JavaApi && typeof JavaApi.type === "function"
        ? JavaApi.type(name)
        : null;
}
function wrapHostError(error) {
    const ExceptionClass = lookupJavaType("java.lang.Exception");
    return ExceptionClass ? new ExceptionClass(String(error)) : error;
}
function completeHostStepResult(future, result) {
    if (!future)
        return result;
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
function completeHostFutureStep(result) {
    completeHostStepResult(this.future, result);
    return undefined;
}
function failHostFutureStep(error) {
    this.future.completeExceptionally(wrapHostError(error));
    return undefined;
}
function hostOutputTopics(dest) {
    for (const topic of exports.config.outputTopics) {
        if (!INTERNAL_OUTPUT_TOPICS.has(topic))
            dest.add(topic);
    }
    const workflow = globalThis.efwf$module;
    const manifestTopics = workflow?.manifest?.outputTopics;
    if (manifestTopics) {
        for (const topic of manifestTopics) {
            if (!INTERNAL_OUTPUT_TOPICS.has(topic))
                dest.add(topic);
        }
    }
}
S.regOpaqueObject(hostOutputTopics, "@effectful/kafka-workflow-rt/hostOutputTopics");
function hostStep(eventString, stateString, tid, sid, future) {
    const currentStep = step(eventString, stateString, tid, sid);
    if (!future)
        return currentStep;
    const state = { future };
    return currentStep.then(completeHostFutureStep.bind(state), failHostFutureStep.bind(state));
}
S.regOpaqueObject(hostStep, "@effectful/kafka-workflow-rt/hostStep");
/** Install the GraalJS/VM host globals for a bundled workflow module. */
function installWorkflowHost(workflow) {
    globalThis.efwf$module = workflow;
    globalThis.efwf$outputTopics = hostOutputTopics;
    globalThis.efwf$step = hostStep;
}
S.regOpaqueObject?.(exports, "@effectful/kafka-workflow-rt");
