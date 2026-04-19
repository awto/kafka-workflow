# Temporal Port: timer-progress

Original Temporal sample:
[temporalio/samples-typescript/tree/main/timer-progress](https://github.com/temporalio/samples-typescript/tree/main/timer-progress)

This port keeps the same teaching point:

- workflow progress changes after each durable timer tick;
- callers can ask for the current progress while the workflow is still running;
- the workflow completes after reaching the configured number of progress steps.

Comparison point: Temporal registers a query handler for `getProgress`. This
port treats the query as a normal workflow message with a reply id, so progress
state, timer handling, and query handling stay in one direct workflow loop.

Run:

```sh
npm test --workspace demos/temporal-ports/timer-progress
```
