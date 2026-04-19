# Temporal Port: nexus-cancellation

Original Temporal sample:
[temporalio/samples-typescript/tree/main/nexus-cancellation](https://github.com/temporalio/samples-typescript/tree/main/nexus-cancellation)

This port keeps the service workflow as a plain function and focuses the caller on cancellation:

- the caller starts a durable external operation through a `ref`;
- a cancel message races the operation result;
- when the cancel message wins, the operation branch receives `CancelToken` and emits a cancel-operation output before the caller returns.

Comparison point: the cancellation story is normal direct workflow code and `Promise.race`, not a separate Nexus cancellation surface.

Run:

```sh
npm test --workspace demos/temporal-ports/nexus-cancellation
```
