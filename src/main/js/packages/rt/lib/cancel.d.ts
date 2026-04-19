export type CancelTarget = {
    cancel: () => unknown;
};
export type Canceler = (() => unknown) | CancelTarget;
type PromiseResult<T = unknown> = {
    then: (resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown) => unknown;
    resolve: (value: T) => unknown;
    reject: (reason: unknown) => unknown;
};
export declare class CancellationScope {
    cancelers: Set<Canceler>;
    children: Set<CancellationScope>;
}
export declare function setPromiseResultFactory(factory: (<T>() => PromiseResult<T>) | undefined): void;
export declare function setPromiseBranchScopeBinder(binder: ((value: unknown, scope: CancellationScope) => unknown) | undefined): void;
export declare function setPromiseHandlerRepair(repair: ((handler: unknown) => void) | undefined): void;
export declare function currentCancellationScope(): CancellationScope | undefined;
export declare function withCancellationScope<T>(scope: CancellationScope | undefined, body: () => T): T;
export declare function addCanceler(canceler: Canceler): void;
export declare function removeCanceler(canceler: Canceler): void;
export declare function linkCancellationScope(parent: CancellationScope | undefined, child: CancellationScope): () => void;
export declare function getCancellationScope(target: unknown): CancellationScope | undefined;
export declare function setCancellationScope(target: unknown, scope: CancellationScope | undefined): void;
export declare function cancelScope(scope: CancellationScope | undefined, PromiseImpl?: any): any;
export declare function installCancelablePromise(PromiseImpl?: any): any;
export {};
