# Temporal Port: continue-as-new

Original Temporal sample: [temporalio/samples-typescript/tree/main/continue-as-new](https://github.com/temporalio/samples-typescript/tree/main/continue-as-new)

This port keeps the same teaching point:

- a workflow runs for many iterations;
- each iteration durably waits on a timer;
- the workflow eventually completes after a bounded number of loops.

In Temporal this requires a dedicated `continueAsNew(...)` primitive to cut history.
In this runtime the same durable looping example stays a normal loop with persisted state.

Run with:

```sh
npm test --workspace demos/temporal-ports/continue-as-new
```
