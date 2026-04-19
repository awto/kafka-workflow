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
exports.CancellationScope = void 0;
exports.setPromiseResultFactory = setPromiseResultFactory;
exports.setPromiseBranchScopeBinder = setPromiseBranchScopeBinder;
exports.setPromiseHandlerRepair = setPromiseHandlerRepair;
exports.currentCancellationScope = currentCancellationScope;
exports.withCancellationScope = withCancellationScope;
exports.addCanceler = addCanceler;
exports.removeCanceler = removeCanceler;
exports.linkCancellationScope = linkCancellationScope;
exports.getCancellationScope = getCancellationScope;
exports.setCancellationScope = setCancellationScope;
exports.cancelScope = cancelScope;
exports.installCancelablePromise = installCancelablePromise;
const S = __importStar(require("@effectful/serialization"));
const kInstalled = Symbol.for("@effectful/kafka-workflow-rt/cancel/installed");
const kScope = Symbol.for("@effectful/kafka-workflow-rt/cancel/scope");
const kSerializableHandler = Symbol.for("@effectful/kafka-workflow-rt/cancel/serializable-handler");
const wrappedHandlerNames = new WeakMap();
let wrappedHandlerCount = 0;
class CancellationScope {
    constructor() {
        this.cancelers = new Set();
        this.children = new Set();
    }
}
exports.CancellationScope = CancellationScope;
let activeScope;
let createPromiseResult;
let bindPromiseBranchScope;
let repairPromiseHandler;
function createChildScope(parent) {
    const scope = new CancellationScope();
    if (parent)
        parent.children.add(scope);
    return scope;
}
function useTargetDirectly(target) {
    if (!target || (typeof target !== "object" && typeof target !== "function")) {
        return false;
    }
    const value = target;
    if (Array.isArray(value.listeners) &&
        typeof value.settled === "number" &&
        typeof value.resolve === "function" &&
        typeof value.reject === "function") {
        return true;
    }
    return typeof value._y === "number";
}
function setPromiseResultFactory(factory) {
    createPromiseResult = factory;
}
function setPromiseBranchScopeBinder(binder) {
    bindPromiseBranchScope = binder;
}
function setPromiseHandlerRepair(repair) {
    repairPromiseHandler = repair;
}
function currentCancellationScope() {
    return activeScope;
}
function withCancellationScope(scope, body) {
    const prev = activeScope;
    activeScope = scope;
    try {
        return body();
    }
    finally {
        activeScope = prev;
    }
}
function addCanceler(canceler) {
    const scope = activeScope;
    if (!scope)
        throw new Error("No active cancellation scope");
    scope.cancelers.add(canceler);
}
function removeCanceler(canceler) {
    const scope = activeScope;
    if (!scope)
        throw new Error("No active cancellation scope");
    scope.cancelers.delete(canceler);
}
function linkCancellationScope(parent, child) {
    if (!parent)
        return () => { };
    parent.children.add(child);
    return () => {
        parent.children.delete(child);
    };
}
function getCancellationScope(target) {
    if (!target ||
        (typeof target !== "object" && typeof target !== "function")) {
        return undefined;
    }
    return target[kScope];
}
function setCancellationScope(target, scope) {
    if (!target ||
        (typeof target !== "object" && typeof target !== "function")) {
        return;
    }
    Object.defineProperty(target, kScope, {
        value: scope,
        configurable: true
    });
}
function settledLike(PromiseImpl, value) {
    if (value && typeof value.then === "function") {
        return useTargetDirectly(value) ? value : PromiseImpl.resolve(value);
    }
    return PromiseImpl.resolve();
}
function cancelScope(scope, PromiseImpl) {
    const BasePromise = PromiseImpl ?? globalThis.Promise ?? require("promise");
    if (!scope)
        return BasePromise.resolve();
    const childScopes = Array.from(scope.children);
    const cancelers = Array.from(scope.cancelers);
    scope.children.clear();
    scope.cancelers.clear();
    const tasks = childScopes.map((child) => cancelScope(child, BasePromise));
    for (const canceler of cancelers) {
        try {
            tasks.push(settledLike(BasePromise, runCanceler(canceler)));
        }
        catch (_e) {
            // ignore cancellation errors so the main failure wins
        }
    }
    if (tasks.length === 0)
        return BasePromise.resolve();
    const result = newPromiseResult();
    rawAllSettled(BasePromise, tasks).then(bindSerializableHandler(runResolveUndefinedResult, { result }), bindSerializableHandler(runRejectResult, { result }));
    return result;
}
function runCanceler(canceler) {
    if (typeof canceler === "function")
        return canceler();
    return canceler.cancel();
}
function rawAll(PromiseImpl, promises) {
    const values = Array.from(promises);
    const result = newPromiseResult();
    if (values.length === 0) {
        result.resolve([]);
        return result;
    }
    const state = new RawAllState(result, values.length);
    for (let index = 0; index < values.length; index++) {
        const promise = useTargetDirectly(values[index])
            ? values[index]
            : PromiseImpl.resolve(values[index]);
        promise.then(bindSerializableHandler(runRawAllEntryHandler, new RawAllEntryHandler(state, index, true)), bindSerializableHandler(runRawAllEntryHandler, new RawAllEntryHandler(state, index, false)));
    }
    return result;
}
function rawAllSettled(PromiseImpl, promises) {
    const values = Array.from(promises);
    const result = newPromiseResult();
    if (values.length === 0) {
        result.resolve([]);
        return result;
    }
    const state = new RawAllSettledState(result, values.length);
    for (let index = 0; index < values.length; index++) {
        const promise = useTargetDirectly(values[index])
            ? values[index]
            : PromiseImpl.resolve(values[index]);
        promise.then(bindSerializableHandler(runRawAllSettledEntryHandler, new RawAllSettledEntryHandler(state, index, true)), bindSerializableHandler(runRawAllSettledEntryHandler, new RawAllSettledEntryHandler(state, index, false)));
    }
    return result;
}
function returnUndefined() {
    return undefined;
}
S.regOpaqueObject(returnUndefined, "@effectful/kafka-workflow-rt/cancel/returnUndefined");
function allSettled(PromiseImpl, promises) {
    return rawAllSettled(PromiseImpl, promises);
}
function invokeWrappedHandler(...args) {
    return withCancellationScope(this.scope, () => {
        repairPromiseHandler?.(this.handler);
        return this.handler(...args);
    });
}
S.regOpaqueObject(invokeWrappedHandler, "@effectful/kafka-workflow-rt/cancel/invokeWrappedHandler");
function markSerializableHandler(handler) {
    Object.defineProperty(handler, kSerializableHandler, {
        value: true,
        configurable: true
    });
    return handler;
}
function bindSerializableHandler(handler, self) {
    return markSerializableHandler(handler.bind(self));
}
function registerWrappedHandler(handler) {
    let name = wrappedHandlerNames.get(handler);
    if (!name) {
        name = `@effectful/kafka-workflow-rt/cancel/handler/${++wrappedHandlerCount}`;
        wrappedHandlerNames.set(handler, name);
        S.regOpaqueObject(handler, name, {
            props: false,
            propsSnapshot: false
        });
    }
    return handler;
}
function wrapHandler(scope, handler) {
    if (typeof handler !== "function" || !scope)
        return handler;
    if (handler[kSerializableHandler])
        return handler;
    return invokeWrappedHandler.bind({
        scope,
        handler: registerWrappedHandler(handler)
    });
}
function normalizeEntries(PromiseImpl, iterable) {
    const parentScope = activeScope;
    return Array.from(iterable, (value) => {
        const scope = new CancellationScope();
        if (parentScope) {
            parentScope.children.add(scope);
        }
        const nestedScope = getCancellationScope(value);
        const target = bindPromiseBranchScope?.(value, scope) ?? value;
        if (nestedScope &&
            nestedScope !== scope &&
            nestedScope !== parentScope) {
            scope.children.add(nestedScope);
        }
        const promise = withCancellationScope(scope, () => useTargetDirectly(target) ? target : PromiseImpl.resolve(target));
        setCancellationScope(promise, scope);
        return { promise, scope, parentScope };
    });
}
function detachEntry(entry) {
    entry.parentScope?.children.delete(entry.scope);
}
function detachEntries(entries, keep = -1) {
    for (let i = 0; i < entries.length; i++) {
        if (i === keep)
            continue;
        detachEntry(entries[i]);
    }
}
function waitForEntries(PromiseImpl, entries) {
    if (entries.length === 0)
        return PromiseImpl.resolve();
    const result = newPromiseResult();
    rawAllSettled(PromiseImpl, entries.map((entry) => entry.promise)).then(bindSerializableHandler(runResolveUndefinedResult, { result }), bindSerializableHandler(runRejectResult, { result }));
    return result;
}
function createAggregateError(errors) {
    if (typeof AggregateError === "function") {
        return new AggregateError(errors, "All promises were rejected");
    }
    const err = new Error("All promises were rejected");
    err.errors = errors;
    return err;
}
function newPromiseResult() {
    if (!createPromiseResult) {
        throw new Error("Promise result factory is not installed");
    }
    return createPromiseResult();
}
class RawAllState {
    constructor(result, size) {
        this.result = result;
        this.settled = false;
        this.pending = size;
        this.values = new Array(size);
    }
}
S.regConstructor(RawAllState);
class RawAllEntryHandler {
    constructor(state, index, ok) {
        this.state = state;
        this.index = index;
        this.ok = ok;
    }
}
S.regConstructor(RawAllEntryHandler);
function runRawAllEntryHandler(value) {
    const state = this.state;
    if (state.settled)
        return undefined;
    if (!this.ok) {
        state.settled = true;
        return state.result.reject(value);
    }
    state.values[this.index] = value;
    state.pending--;
    if (state.pending === 0) {
        state.settled = true;
        return state.result.resolve(state.values);
    }
    return undefined;
}
S.regOpaqueObject(runRawAllEntryHandler, "@effectful/kafka-workflow-rt/cancel/runRawAllEntryHandler");
class RawAllSettledState {
    constructor(result, size) {
        this.result = result;
        this.pending = size;
        this.values = new Array(size);
    }
}
S.regConstructor(RawAllSettledState);
class RawAllSettledEntryHandler {
    constructor(state, index, ok) {
        this.state = state;
        this.index = index;
        this.ok = ok;
    }
}
S.regConstructor(RawAllSettledEntryHandler);
function runRawAllSettledEntryHandler(value) {
    const state = this.state;
    state.values[this.index] = this.ok
        ? { status: "fulfilled", value }
        : { status: "rejected", reason: value };
    state.pending--;
    if (state.pending === 0) {
        return state.result.resolve(state.values);
    }
    return undefined;
}
S.regOpaqueObject(runRawAllSettledEntryHandler, "@effectful/kafka-workflow-rt/cancel/runRawAllSettledEntryHandler");
class RaceState {
    constructor(entries, result) {
        this.entries = entries;
        this.result = result;
        this.settled = false;
    }
}
S.regConstructor(RaceState);
class RaceEntryHandler {
    constructor(state, index, ok) {
        this.state = state;
        this.index = index;
        this.ok = ok;
    }
}
S.regConstructor(RaceEntryHandler);
class FinalizeAfterCancel {
    constructor(resultState, siblings, value, resolveValue) {
        this.resultState = resultState;
        this.siblings = siblings;
        this.value = value;
        this.resolveValue = resolveValue;
    }
}
S.regConstructor(FinalizeAfterCancel);
function runAfterCancel() {
    const PromiseImpl = globalThis.Promise ?? require("promise");
    return waitForEntries(PromiseImpl, this.siblings).then(bindSerializableHandler(runAfterWait, this), bindSerializableHandler(runRejectResult, this.resultState));
}
S.regOpaqueObject(runAfterCancel, "@effectful/kafka-workflow-rt/cancel/runAfterCancel");
function runAfterWait() {
    this.siblings.forEach((entry) => detachEntry(entry));
    return this.resolveValue
        ? this.resultState.result.resolve(this.value)
        : this.resultState.result.reject(this.value);
}
S.regOpaqueObject(runAfterWait, "@effectful/kafka-workflow-rt/cancel/runAfterWait");
function runRejectResult(error) {
    return this.result.reject(error);
}
S.regOpaqueObject(runRejectResult, "@effectful/kafka-workflow-rt/cancel/runRejectResult");
function runResolveUndefinedResult() {
    return this.result.resolve(undefined);
}
S.regOpaqueObject(runResolveUndefinedResult, "@effectful/kafka-workflow-rt/cancel/runResolveUndefinedResult");
function runRaceEntryHandler(value) {
    const state = this.state;
    if (state.settled)
        return undefined;
    state.settled = true;
    const winner = state.entries[this.index];
    const siblings = state.entries.filter((_, index) => index !== this.index);
    detachEntry(winner);
    const PromiseImpl = globalThis.Promise ?? require("promise");
    const finalize = new FinalizeAfterCancel(state, siblings, value, this.ok);
    return rawAll(PromiseImpl, siblings.map((entry) => cancelScope(entry.scope, PromiseImpl))).then(bindSerializableHandler(runAfterCancel, finalize), bindSerializableHandler(runRejectResult, state));
}
S.regOpaqueObject(runRaceEntryHandler, "@effectful/kafka-workflow-rt/cancel/runRaceEntryHandler");
class AllState {
    constructor(entries, result) {
        this.entries = entries;
        this.result = result;
        this.settled = false;
        this.pending = entries.length;
        this.values = new Array(entries.length);
    }
}
S.regConstructor(AllState);
class AllEntryHandler {
    constructor(state, index, ok) {
        this.state = state;
        this.index = index;
        this.ok = ok;
    }
}
S.regConstructor(AllEntryHandler);
function runAllEntryHandler(value) {
    const state = this.state;
    const entry = state.entries[this.index];
    if (this.ok) {
        if (state.settled)
            return undefined;
        state.values[this.index] = value;
        detachEntry(entry);
        state.pending--;
        if (state.pending === 0) {
            state.settled = true;
            return state.result.resolve(state.values);
        }
        return undefined;
    }
    if (state.settled)
        return undefined;
    state.settled = true;
    detachEntry(entry);
    const siblings = state.entries.filter((_, index) => index !== this.index);
    const PromiseImpl = globalThis.Promise ?? require("promise");
    const finalize = new FinalizeAfterCancel(state, siblings, value, false);
    return rawAll(PromiseImpl, siblings.map((next) => cancelScope(next.scope, PromiseImpl))).then(bindSerializableHandler(runAfterCancel, finalize), bindSerializableHandler(runRejectResult, state));
}
S.regOpaqueObject(runAllEntryHandler, "@effectful/kafka-workflow-rt/cancel/runAllEntryHandler");
class AnyState {
    constructor(entries, result) {
        this.entries = entries;
        this.result = result;
        this.settled = false;
        this.rejected = 0;
        this.errors = new Array(entries.length);
    }
}
S.regConstructor(AnyState);
class AnyEntryHandler {
    constructor(state, index, ok) {
        this.state = state;
        this.index = index;
        this.ok = ok;
    }
}
S.regConstructor(AnyEntryHandler);
function runAnyEntryHandler(value) {
    const state = this.state;
    const entry = state.entries[this.index];
    if (this.ok) {
        if (state.settled)
            return undefined;
        state.settled = true;
        detachEntry(entry);
        const siblings = state.entries.filter((_, index) => index !== this.index);
        const PromiseImpl = globalThis.Promise ?? require("promise");
        const finalize = new FinalizeAfterCancel(state, siblings, value, true);
        return rawAll(PromiseImpl, siblings.map((next) => cancelScope(next.scope, PromiseImpl))).then(bindSerializableHandler(runAfterCancel, finalize), bindSerializableHandler(runRejectResult, state));
    }
    if (state.settled)
        return undefined;
    state.errors[this.index] = value;
    detachEntry(entry);
    state.rejected++;
    if (state.rejected === state.entries.length) {
        state.settled = true;
        return state.result.reject(createAggregateError(state.errors));
    }
    return undefined;
}
S.regOpaqueObject(runAnyEntryHandler, "@effectful/kafka-workflow-rt/cancel/runAnyEntryHandler");
class AllSettledState {
    constructor(entries, result) {
        this.entries = entries;
        this.result = result;
        this.pending = entries.length;
        this.results = new Array(entries.length);
    }
}
S.regConstructor(AllSettledState);
class AllSettledEntryHandler {
    constructor(state, index, ok) {
        this.state = state;
        this.index = index;
        this.ok = ok;
    }
}
S.regConstructor(AllSettledEntryHandler);
function runAllSettledEntryHandler(value) {
    const state = this.state;
    state.results[this.index] = this.ok
        ? { status: "fulfilled", value }
        : { status: "rejected", reason: value };
    detachEntry(state.entries[this.index]);
    state.pending--;
    if (state.pending === 0) {
        return state.result.resolve(state.results);
    }
    return undefined;
}
S.regOpaqueObject(runAllSettledEntryHandler, "@effectful/kafka-workflow-rt/cancel/runAllSettledEntryHandler");
function wrapRace(PromiseImpl, iterable) {
    const parentScope = activeScope;
    const resultScope = createChildScope(parentScope);
    const entries = withCancellationScope(resultScope, () => normalizeEntries(PromiseImpl, iterable));
    const result = newPromiseResult();
    if (entries.length !== 0) {
        const state = new RaceState(entries, result);
        for (let index = 0; index < entries.length; index++) {
            const entry = entries[index];
            entry.promise.then(bindSerializableHandler(runRaceEntryHandler, new RaceEntryHandler(state, index, true)), bindSerializableHandler(runRaceEntryHandler, new RaceEntryHandler(state, index, false)));
        }
    }
    setCancellationScope(result, resultScope);
    return result;
}
function wrapAll(PromiseImpl, iterable) {
    const parentScope = activeScope;
    const resultScope = createChildScope(parentScope);
    const entries = withCancellationScope(resultScope, () => normalizeEntries(PromiseImpl, iterable));
    const result = newPromiseResult();
    if (entries.length === 0) {
        result.resolve([]);
    }
    else {
        const state = new AllState(entries, result);
        for (let index = 0; index < entries.length; index++) {
            const entry = entries[index];
            entry.promise.then(bindSerializableHandler(runAllEntryHandler, new AllEntryHandler(state, index, true)), bindSerializableHandler(runAllEntryHandler, new AllEntryHandler(state, index, false)));
        }
    }
    setCancellationScope(result, resultScope);
    return result;
}
function wrapAny(PromiseImpl, iterable) {
    const parentScope = activeScope;
    const resultScope = createChildScope(parentScope);
    const entries = withCancellationScope(resultScope, () => normalizeEntries(PromiseImpl, iterable));
    const result = newPromiseResult();
    if (entries.length === 0) {
        result.reject(createAggregateError([]));
    }
    else {
        const state = new AnyState(entries, result);
        for (let index = 0; index < entries.length; index++) {
            const entry = entries[index];
            entry.promise.then(bindSerializableHandler(runAnyEntryHandler, new AnyEntryHandler(state, index, true)), bindSerializableHandler(runAnyEntryHandler, new AnyEntryHandler(state, index, false)));
        }
    }
    setCancellationScope(result, resultScope);
    return result;
}
function wrapAllSettled(PromiseImpl, iterable) {
    const parentScope = activeScope;
    const resultScope = createChildScope(parentScope);
    const entries = withCancellationScope(resultScope, () => normalizeEntries(PromiseImpl, iterable));
    const result = newPromiseResult();
    if (entries.length === 0) {
        result.resolve([]);
    }
    else {
        const state = new AllSettledState(entries, result);
        for (let index = 0; index < entries.length; index++) {
            const entry = entries[index];
            entry.promise.then(bindSerializableHandler(runAllSettledEntryHandler, new AllSettledEntryHandler(state, index, true)), bindSerializableHandler(runAllSettledEntryHandler, new AllSettledEntryHandler(state, index, false)));
        }
    }
    setCancellationScope(result, resultScope);
    return result;
}
function installCancelablePromise(PromiseImpl) {
    const BasePromise = PromiseImpl ?? require("promise");
    if (BasePromise[kInstalled])
        return BasePromise;
    Object.defineProperty(BasePromise, kInstalled, { value: true });
    const originalThen = BasePromise.prototype.then;
    BasePromise.prototype.then = function patchedThen(onFulfilled, onRejected) {
        const scope = getCancellationScope(this) ?? activeScope;
        const next = originalThen.call(this, wrapHandler(scope, onFulfilled), wrapHandler(scope, onRejected));
        setCancellationScope(next, scope);
        return next;
    };
    BasePromise.race = function patchedRace(iterable) {
        return wrapRace(BasePromise, iterable);
    };
    BasePromise.all = function patchedAll(iterable) {
        return wrapAll(BasePromise, iterable);
    };
    BasePromise.any = function patchedAny(iterable) {
        return wrapAny(BasePromise, iterable);
    };
    BasePromise.allSettled = function patchedAllSettled(iterable) {
        return wrapAllSettled(BasePromise, iterable);
    };
    return BasePromise;
}
