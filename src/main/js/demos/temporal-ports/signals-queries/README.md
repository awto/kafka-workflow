# Temporal Port: signals-queries

Original Temporal sample: [temporalio/samples-typescript/tree/main/signals-queries](https://github.com/temporalio/samples-typescript/tree/main/signals-queries)

This port keeps the same teaching point:

- workflow state lives inside the workflow;
- external callers mutate it by sending signals;
- query-like reads are modeled by emitting the current state on demand.

Run with:

```sh
npm test --workspace demos/temporal-ports/signals-queries
```
