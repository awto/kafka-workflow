# Temporal Port: timer-examples

Original Temporal sample: [temporalio/samples-typescript/tree/main/timer-examples](https://github.com/temporalio/samples-typescript/tree/main/timer-examples)

This port keeps both parts of the sample:

- `processOrder` races a long-running activity against a reminder timer;
- `countdown` keeps an updatable timer entirely in workflow code.

The useful comparison point is that the same scheduler primitive already used by the other demos is enough for both flows.

Run with:

```sh
npm test --workspace demos/temporal-ports/timer-examples
```
