import * as S from "@effectful/serialization";

export type CancelTarget = {
  cancel: () => unknown;
};

export type Canceler = (() => unknown) | CancelTarget;

type PromiseResult<T = unknown> = {
  then: (
    resolve: (value: T) => unknown,
    reject?: (reason: unknown) => unknown
  ) => unknown;
  resolve: (value: T) => unknown;
  reject: (reason: unknown) => unknown;
};

const kInstalled = Symbol.for("@effectful/kafka-workflow-rt/cancel/installed");
const kScope = Symbol.for("@effectful/kafka-workflow-rt/cancel/scope");
const kSerializableHandler = Symbol.for(
  "@effectful/kafka-workflow-rt/cancel/serializable-handler"
);
const wrappedHandlerNames = new WeakMap<Function, string>();
let wrappedHandlerCount = 0;

export class CancellationScope {
  cancelers = new Set<Canceler>();
  children = new Set<CancellationScope>();
}

let activeScope: CancellationScope | undefined;
let createPromiseResult: (<T>() => PromiseResult<T>) | undefined;
let bindPromiseBranchScope:
  | ((value: unknown, scope: CancellationScope) => unknown)
  | undefined;
let repairPromiseHandler:
  | ((handler: unknown) => void)
  | undefined;

type NormalizedEntry = {
  promise: any;
  scope: CancellationScope;
  parentScope?: CancellationScope;
};

function createChildScope(
  parent: CancellationScope | undefined
): CancellationScope {
  const scope = new CancellationScope();
  if (parent) parent.children.add(scope);
  return scope;
}

function useTargetDirectly(target: unknown): boolean {
  if (!target || (typeof target !== "object" && typeof target !== "function")) {
    return false;
  }
  const value = target as any;
  if (
    Array.isArray(value.listeners) &&
    typeof value.settled === "number" &&
    typeof value.resolve === "function" &&
    typeof value.reject === "function"
  ) {
    return true;
  }
  return typeof value._y === "number";
}

export function setPromiseResultFactory(
  factory: (<T>() => PromiseResult<T>) | undefined
): void {
  createPromiseResult = factory;
}

export function setPromiseBranchScopeBinder(
  binder: ((value: unknown, scope: CancellationScope) => unknown) | undefined
): void {
  bindPromiseBranchScope = binder;
}

export function setPromiseHandlerRepair(
  repair: ((handler: unknown) => void) | undefined
): void {
  repairPromiseHandler = repair;
}

export function currentCancellationScope(): CancellationScope | undefined {
  return activeScope;
}

export function withCancellationScope<T>(
  scope: CancellationScope | undefined,
  body: () => T
): T {
  const prev = activeScope;
  activeScope = scope;
  try {
    return body();
  } finally {
    activeScope = prev;
  }
}

export function addCanceler(canceler: Canceler): void {
  const scope = activeScope;
  if (!scope) throw new Error("No active cancellation scope");
  scope.cancelers.add(canceler);
}

export function removeCanceler(canceler: Canceler): void {
  const scope = activeScope;
  if (!scope) throw new Error("No active cancellation scope");
  scope.cancelers.delete(canceler);
}

export function linkCancellationScope(
  parent: CancellationScope | undefined,
  child: CancellationScope
): () => void {
  if (!parent) return () => {};
  parent.children.add(child);
  return () => {
    parent.children.delete(child);
  };
}

export function getCancellationScope(
  target: unknown
): CancellationScope | undefined {
  if (
    !target ||
    (typeof target !== "object" && typeof target !== "function")
  ) {
    return undefined;
  }
  return (target as any)[kScope] as CancellationScope | undefined;
}

export function setCancellationScope(
  target: unknown,
  scope: CancellationScope | undefined
): void {
  if (
    !target ||
    (typeof target !== "object" && typeof target !== "function")
  ) {
    return;
  }
  Object.defineProperty(target as any, kScope, {
    value: scope,
    configurable: true
  });
}

function settledLike(PromiseImpl: any, value: unknown): any {
  if (value && typeof (value as any).then === "function") {
    return useTargetDirectly(value) ? value : PromiseImpl.resolve(value);
  }
  return PromiseImpl.resolve();
}

export function cancelScope(
  scope: CancellationScope | undefined,
  PromiseImpl?: any
): any {
  const BasePromise = PromiseImpl ?? (globalThis as any).Promise ?? require("promise");
  if (!scope) return BasePromise.resolve();

  const childScopes = Array.from(scope.children);
  const cancelers = Array.from(scope.cancelers);
  scope.children.clear();
  scope.cancelers.clear();

  const tasks = childScopes.map((child) => cancelScope(child, BasePromise));
  for (const canceler of cancelers) {
    try {
      tasks.push(settledLike(BasePromise, runCanceler(canceler)));
    } catch (_e) {
      // ignore cancellation errors so the main failure wins
    }
  }
  if (tasks.length === 0) return BasePromise.resolve();

  const result = newPromiseResult<void>();
  rawAllSettled(BasePromise, tasks).then(
    bindSerializableHandler(runResolveUndefinedResult, { result }),
    bindSerializableHandler(runRejectResult, { result })
  );
  return result;
}

function runCanceler(canceler: Canceler): unknown {
  if (typeof canceler === "function") return canceler();
  return canceler.cancel();
}

function rawAll(PromiseImpl: any, promises: Iterable<unknown>): any {
  const values = Array.from(promises);
  const result = newPromiseResult<unknown[]>();
  if (values.length === 0) {
    result.resolve([]);
    return result;
  }

  const state = new RawAllState(result, values.length);
  for (let index = 0; index < values.length; index++) {
    const promise = useTargetDirectly(values[index])
      ? values[index]
      : PromiseImpl.resolve(values[index]);
    promise.then(
      bindSerializableHandler(
        runRawAllEntryHandler,
        new RawAllEntryHandler(state, index, true)
      ),
      bindSerializableHandler(
        runRawAllEntryHandler,
        new RawAllEntryHandler(state, index, false)
      )
    );
  }
  return result;
}

function rawAllSettled(PromiseImpl: any, promises: Iterable<unknown>): any {
  const values = Array.from(promises);
  const result = newPromiseResult<unknown[]>();
  if (values.length === 0) {
    result.resolve([]);
    return result;
  }

  const state = new RawAllSettledState(result, values.length);
  for (let index = 0; index < values.length; index++) {
    const promise = useTargetDirectly(values[index])
      ? values[index]
      : PromiseImpl.resolve(values[index]);
    promise.then(
      bindSerializableHandler(
        runRawAllSettledEntryHandler,
        new RawAllSettledEntryHandler(state, index, true)
      ),
      bindSerializableHandler(
        runRawAllSettledEntryHandler,
        new RawAllSettledEntryHandler(state, index, false)
      )
    );
  }
  return result;
}

function returnUndefined(): undefined {
  return undefined;
}
S.regOpaqueObject(
  returnUndefined,
  "@effectful/kafka-workflow-rt/cancel/returnUndefined"
);

function allSettled(PromiseImpl: any, promises: any[]): any {
  return rawAllSettled(PromiseImpl, promises);
}

function invokeWrappedHandler(this: {
  scope: CancellationScope;
  handler: (...args: unknown[]) => unknown;
}, ...args: unknown[]) {
  return withCancellationScope(this.scope, () => {
    repairPromiseHandler?.(this.handler);
    return this.handler(...args);
  });
}
S.regOpaqueObject(
  invokeWrappedHandler,
  "@effectful/kafka-workflow-rt/cancel/invokeWrappedHandler"
);

function markSerializableHandler<T extends Function>(handler: T): T {
  Object.defineProperty(handler, kSerializableHandler, {
    value: true,
    configurable: true
  });
  return handler;
}

function bindSerializableHandler<T extends object>(
  handler: (this: T, value: unknown) => unknown,
  self: T
): (value: unknown) => unknown {
  return markSerializableHandler(handler.bind(self));
}

function registerWrappedHandler<T extends Function>(handler: T): T {
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

function wrapHandler(scope: CancellationScope | undefined, handler: any): any {
  if (typeof handler !== "function" || !scope) return handler;
  if ((handler as any)[kSerializableHandler]) return handler;
  return invokeWrappedHandler.bind({
    scope,
    handler: registerWrappedHandler(handler)
  });
}

function normalizeEntries(
  PromiseImpl: any,
  iterable: Iterable<unknown>
): NormalizedEntry[] {
  const parentScope = activeScope;
  return Array.from(iterable, (value) => {
    const scope = new CancellationScope();
    if (parentScope) {
      parentScope.children.add(scope);
    }
    const nestedScope = getCancellationScope(value);
    const target = bindPromiseBranchScope?.(value, scope) ?? value;
    if (
      nestedScope &&
      nestedScope !== scope &&
      nestedScope !== parentScope
    ) {
      scope.children.add(nestedScope);
    }
    const promise = withCancellationScope(scope, () =>
      useTargetDirectly(target) ? target : PromiseImpl.resolve(target)
    );
    setCancellationScope(promise, scope);
    return { promise, scope, parentScope };
  });
}

function detachEntry(entry: NormalizedEntry): void {
  entry.parentScope?.children.delete(entry.scope);
}

function detachEntries(entries: NormalizedEntry[], keep = -1): void {
  for (let i = 0; i < entries.length; i++) {
    if (i === keep) continue;
    detachEntry(entries[i]);
  }
}

function waitForEntries(PromiseImpl: any, entries: Array<{ promise: any }>): any {
  if (entries.length === 0) return PromiseImpl.resolve();
  const result = newPromiseResult<void>();
  rawAllSettled(
    PromiseImpl,
    entries.map((entry) => entry.promise)
  ).then(
    bindSerializableHandler(runResolveUndefinedResult, { result }),
    bindSerializableHandler(runRejectResult, { result })
  );
  return result;
}

function createAggregateError(errors: unknown[]): Error {
  if (typeof AggregateError === "function") {
    return new AggregateError(errors, "All promises were rejected");
  }
  const err = new Error("All promises were rejected");
  (err as any).errors = errors;
  return err;
}

function newPromiseResult<T>(): PromiseResult<T> {
  if (!createPromiseResult) {
    throw new Error("Promise result factory is not installed");
  }
  return createPromiseResult<T>();
}

class RawAllState {
  settled = false;
  pending: number;
  values: unknown[];

  constructor(
    public result: PromiseResult<unknown[]>,
    size: number
  ) {
    this.pending = size;
    this.values = new Array(size);
  }
}
S.regConstructor(RawAllState);

class RawAllEntryHandler {
  constructor(
    public state: RawAllState,
    public index: number,
    public ok: boolean
  ) {}
}
S.regConstructor(RawAllEntryHandler);

function runRawAllEntryHandler(this: RawAllEntryHandler, value: unknown): unknown {
  const state = this.state;
  if (state.settled) return undefined;
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
S.regOpaqueObject(
  runRawAllEntryHandler,
  "@effectful/kafka-workflow-rt/cancel/runRawAllEntryHandler"
);

class RawAllSettledState {
  pending: number;
  values: unknown[];

  constructor(
    public result: PromiseResult<unknown[]>,
    size: number
  ) {
    this.pending = size;
    this.values = new Array(size);
  }
}
S.regConstructor(RawAllSettledState);

class RawAllSettledEntryHandler {
  constructor(
    public state: RawAllSettledState,
    public index: number,
    public ok: boolean
  ) {}
}
S.regConstructor(RawAllSettledEntryHandler);

function runRawAllSettledEntryHandler(
  this: RawAllSettledEntryHandler,
  value: unknown
): unknown {
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
S.regOpaqueObject(
  runRawAllSettledEntryHandler,
  "@effectful/kafka-workflow-rt/cancel/runRawAllSettledEntryHandler"
);

class RaceState {
  settled = false;

  constructor(
    public entries: NormalizedEntry[],
    public result: ReturnType<typeof newPromiseResult>
  ) {}
}
S.regConstructor(RaceState);

class RaceEntryHandler {
  constructor(
    public state: RaceState,
    public index: number,
    public ok: boolean
  ) {}
}
S.regConstructor(RaceEntryHandler);

class FinalizeAfterCancel {
  constructor(
    public resultState: { result: ReturnType<typeof newPromiseResult> },
    public siblings: NormalizedEntry[],
    public value: unknown,
    public resolveValue: boolean
  ) {}
}
S.regConstructor(FinalizeAfterCancel);

function runAfterCancel(this: FinalizeAfterCancel): unknown {
  const PromiseImpl = (globalThis as any).Promise ?? require("promise");
  return waitForEntries(PromiseImpl, this.siblings).then(
    bindSerializableHandler(runAfterWait, this),
    bindSerializableHandler(runRejectResult, this.resultState)
  );
}
S.regOpaqueObject(
  runAfterCancel,
  "@effectful/kafka-workflow-rt/cancel/runAfterCancel"
);

function runAfterWait(this: FinalizeAfterCancel): unknown {
  this.siblings.forEach((entry) => detachEntry(entry));
  return this.resolveValue
    ? this.resultState.result.resolve(this.value)
    : this.resultState.result.reject(this.value);
}
S.regOpaqueObject(
  runAfterWait,
  "@effectful/kafka-workflow-rt/cancel/runAfterWait"
);

function runRejectResult(
  this: { result: PromiseResult<any> },
  error: unknown
): unknown {
  return this.result.reject(error);
}
S.regOpaqueObject(
  runRejectResult,
  "@effectful/kafka-workflow-rt/cancel/runRejectResult"
);

function runResolveUndefinedResult(
  this: { result: PromiseResult<void> }
): unknown {
  return this.result.resolve(undefined);
}
S.regOpaqueObject(
  runResolveUndefinedResult,
  "@effectful/kafka-workflow-rt/cancel/runResolveUndefinedResult"
);

function runRaceEntryHandler(this: RaceEntryHandler, value: unknown): unknown {
  const state = this.state;
  if (state.settled) return undefined;
  state.settled = true;

  const winner = state.entries[this.index];
  const siblings = state.entries.filter((_, index) => index !== this.index);
  detachEntry(winner);

  const PromiseImpl = (globalThis as any).Promise ?? require("promise");
  const finalize = new FinalizeAfterCancel(state, siblings, value, this.ok);
  return rawAll(
    PromiseImpl,
    siblings.map((entry) => cancelScope(entry.scope, PromiseImpl))
  ).then(
    bindSerializableHandler(runAfterCancel, finalize),
    bindSerializableHandler(runRejectResult, state)
  );
}
S.regOpaqueObject(
  runRaceEntryHandler,
  "@effectful/kafka-workflow-rt/cancel/runRaceEntryHandler"
);

class AllState {
  settled = false;
  pending: number;
  values: unknown[];

  constructor(
    public entries: NormalizedEntry[],
    public result: ReturnType<typeof newPromiseResult>
  ) {
    this.pending = entries.length;
    this.values = new Array(entries.length);
  }
}
S.regConstructor(AllState);

class AllEntryHandler {
  constructor(
    public state: AllState,
    public index: number,
    public ok: boolean
  ) {}
}
S.regConstructor(AllEntryHandler);

function runAllEntryHandler(this: AllEntryHandler, value: unknown): unknown {
  const state = this.state;
  const entry = state.entries[this.index];
  if (this.ok) {
    if (state.settled) return undefined;
    state.values[this.index] = value;
    detachEntry(entry);
    state.pending--;
    if (state.pending === 0) {
      state.settled = true;
      return state.result.resolve(state.values);
    }
    return undefined;
  }

  if (state.settled) return undefined;
  state.settled = true;
  detachEntry(entry);
  const siblings = state.entries.filter((_, index) => index !== this.index);
  const PromiseImpl = (globalThis as any).Promise ?? require("promise");
  const finalize = new FinalizeAfterCancel(state, siblings, value, false);
  return rawAll(
    PromiseImpl,
    siblings.map((next) => cancelScope(next.scope, PromiseImpl))
  ).then(
    bindSerializableHandler(runAfterCancel, finalize),
    bindSerializableHandler(runRejectResult, state)
  );
}
S.regOpaqueObject(
  runAllEntryHandler,
  "@effectful/kafka-workflow-rt/cancel/runAllEntryHandler"
);

class AnyState {
  settled = false;
  rejected = 0;
  errors: unknown[];

  constructor(
    public entries: NormalizedEntry[],
    public result: ReturnType<typeof newPromiseResult>
  ) {
    this.errors = new Array(entries.length);
  }
}
S.regConstructor(AnyState);

class AnyEntryHandler {
  constructor(
    public state: AnyState,
    public index: number,
    public ok: boolean
  ) {}
}
S.regConstructor(AnyEntryHandler);

function runAnyEntryHandler(this: AnyEntryHandler, value: unknown): unknown {
  const state = this.state;
  const entry = state.entries[this.index];
  if (this.ok) {
    if (state.settled) return undefined;
    state.settled = true;
    detachEntry(entry);
    const siblings = state.entries.filter((_, index) => index !== this.index);
    const PromiseImpl = (globalThis as any).Promise ?? require("promise");
    const finalize = new FinalizeAfterCancel(state, siblings, value, true);
    return rawAll(
      PromiseImpl,
      siblings.map((next) => cancelScope(next.scope, PromiseImpl))
    ).then(
      bindSerializableHandler(runAfterCancel, finalize),
      bindSerializableHandler(runRejectResult, state)
    );
  }

  if (state.settled) return undefined;
  state.errors[this.index] = value;
  detachEntry(entry);
  state.rejected++;
  if (state.rejected === state.entries.length) {
    state.settled = true;
    return state.result.reject(createAggregateError(state.errors));
  }
  return undefined;
}
S.regOpaqueObject(
  runAnyEntryHandler,
  "@effectful/kafka-workflow-rt/cancel/runAnyEntryHandler"
);

class AllSettledState {
  pending: number;
  results: unknown[];

  constructor(
    public entries: NormalizedEntry[],
    public result: ReturnType<typeof newPromiseResult>
  ) {
    this.pending = entries.length;
    this.results = new Array(entries.length);
  }
}
S.regConstructor(AllSettledState);

class AllSettledEntryHandler {
  constructor(
    public state: AllSettledState,
    public index: number,
    public ok: boolean
  ) {}
}
S.regConstructor(AllSettledEntryHandler);

function runAllSettledEntryHandler(
  this: AllSettledEntryHandler,
  value: unknown
): unknown {
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
S.regOpaqueObject(
  runAllSettledEntryHandler,
  "@effectful/kafka-workflow-rt/cancel/runAllSettledEntryHandler"
);

function wrapRace(PromiseImpl: any, iterable: Iterable<unknown>): any {
  const parentScope = activeScope;
  const resultScope = createChildScope(parentScope);
  const entries = withCancellationScope(resultScope, () =>
    normalizeEntries(PromiseImpl, iterable)
  );
  const result = newPromiseResult();
  if (entries.length !== 0) {
    const state = new RaceState(entries, result);
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      entry.promise.then(
        bindSerializableHandler(
          runRaceEntryHandler,
          new RaceEntryHandler(state, index, true)
        ),
        bindSerializableHandler(
          runRaceEntryHandler,
          new RaceEntryHandler(state, index, false)
        )
      );
    }
  }
  setCancellationScope(result, resultScope);
  return result;
}

function wrapAll(PromiseImpl: any, iterable: Iterable<unknown>): any {
  const parentScope = activeScope;
  const resultScope = createChildScope(parentScope);
  const entries = withCancellationScope(resultScope, () =>
    normalizeEntries(PromiseImpl, iterable)
  );
  const result = newPromiseResult();
  if (entries.length === 0) {
    result.resolve([]);
  } else {
    const state = new AllState(entries, result);
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      entry.promise.then(
        bindSerializableHandler(
          runAllEntryHandler,
          new AllEntryHandler(state, index, true)
        ),
        bindSerializableHandler(
          runAllEntryHandler,
          new AllEntryHandler(state, index, false)
        )
      );
    }
  }
  setCancellationScope(result, resultScope);
  return result;
}

function wrapAny(PromiseImpl: any, iterable: Iterable<unknown>): any {
  const parentScope = activeScope;
  const resultScope = createChildScope(parentScope);
  const entries = withCancellationScope(resultScope, () =>
    normalizeEntries(PromiseImpl, iterable)
  );
  const result = newPromiseResult();
  if (entries.length === 0) {
    result.reject(createAggregateError([]));
  } else {
    const state = new AnyState(entries, result);
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      entry.promise.then(
        bindSerializableHandler(
          runAnyEntryHandler,
          new AnyEntryHandler(state, index, true)
        ),
        bindSerializableHandler(
          runAnyEntryHandler,
          new AnyEntryHandler(state, index, false)
        )
      );
    }
  }
  setCancellationScope(result, resultScope);
  return result;
}

function wrapAllSettled(PromiseImpl: any, iterable: Iterable<unknown>): any {
  const parentScope = activeScope;
  const resultScope = createChildScope(parentScope);
  const entries = withCancellationScope(resultScope, () =>
    normalizeEntries(PromiseImpl, iterable)
  );
  const result = newPromiseResult();
  if (entries.length === 0) {
    result.resolve([]);
  } else {
    const state = new AllSettledState(entries, result);
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      entry.promise.then(
        bindSerializableHandler(
          runAllSettledEntryHandler,
          new AllSettledEntryHandler(state, index, true)
        ),
        bindSerializableHandler(
          runAllSettledEntryHandler,
          new AllSettledEntryHandler(state, index, false)
        )
      );
    }
  }
  setCancellationScope(result, resultScope);
  return result;
}

export function installCancelablePromise(PromiseImpl?: any): any {
  const BasePromise: any = PromiseImpl ?? require("promise");
  if (BasePromise[kInstalled]) return BasePromise;

  Object.defineProperty(BasePromise, kInstalled, { value: true });

  const originalThen = BasePromise.prototype.then;
  BasePromise.prototype.then = function patchedThen(
    this: any,
    onFulfilled?: ((value: any) => any) | null,
    onRejected?: ((reason: any) => any) | null
  ) {
    const scope = getCancellationScope(this) ?? activeScope;
    const next = originalThen.call(
      this,
      wrapHandler(scope, onFulfilled),
      wrapHandler(scope, onRejected)
    );
    setCancellationScope(next, scope);
    return next;
  };

  BasePromise.race = function patchedRace(iterable: Iterable<unknown>) {
    return wrapRace(BasePromise, iterable);
  };
  BasePromise.all = function patchedAll(iterable: Iterable<unknown>) {
    return wrapAll(BasePromise, iterable);
  };
  BasePromise.any = function patchedAny(iterable: Iterable<unknown>) {
    return wrapAny(BasePromise, iterable);
  };
  BasePromise.allSettled = function patchedAllSettled(
    iterable: Iterable<unknown>
  ) {
    return wrapAllSettled(BasePromise, iterable);
  };

  return BasePromise;
}
