# Temporal Port: activities-cancellation-heartbeating

Original Temporal sample:
[temporalio/samples-typescript/tree/main/activities-cancellation-heartbeating](https://github.com/temporalio/samples-typescript/tree/main/activities-cancellation-heartbeating)

This port focuses on the cancellation path from the original sample:

- a long-running activity reports progress through a durable `ref`;
- a workflow-level cancel message wins a `Promise.race`;
- the losing activity branch receives `CancelToken`, emits cancellation and cleanup outputs, and only then the workflow returns.

Comparison point: no explicit `CancellationScope` API is needed in the demo code. The cancellation behavior is attached to normal `Promise.race` control flow.

Run:

```sh
npm test --workspace demos/temporal-ports/activities-cancellation-heartbeating
```
