# Temporal Port: state

Original Temporal sample: [temporalio/samples-typescript/tree/main/state](https://github.com/temporalio/samples-typescript/tree/main/state)

Temporal uses a signal plus a query handler over a `Map<string, number>`.

This port keeps the same workflow idea with a plain direct loop:

- `setValue` mutates workflow state;
- `getValue` returns the current value through a normal workflow output;
- `cancel` stops the workflow and returns the final snapshot.

Run with:

```sh
npm test --workspace demos/temporal-ports/state
```
