# Temporal Port: execute-update

Original Temporal sample: [temporalio/samples-typescript/tree/main/message-passing/execute-update](https://github.com/temporalio/samples-typescript/tree/main/message-passing/execute-update)

Temporal models `fetchAndAdd` and `done` as workflow updates with validators.

This port keeps the same counter behavior with a single workflow loop:

- `fetchAndAdd` mutates state and emits the previous value as a reply;
- negative arguments are rejected in normal workflow code;
- `done` completes the workflow with the final count.

Run with:

```sh
npm test --workspace demos/temporal-ports/execute-update
```
