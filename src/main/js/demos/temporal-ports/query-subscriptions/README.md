# Temporal Port: query-subscriptions

Original Temporal sample: [temporalio/samples-typescript/tree/main/query-subscriptions](https://github.com/temporalio/samples-typescript/tree/main/query-subscriptions)

This is a particularly good comparison sample because the Temporal version uses Redis streams and SDK interceptors to build subscribable queries, while their own README notes that the simpler approach is to publish updates directly from workflow code.

This port keeps only that simpler workflow-level behavior:

- keep versioned workflow state;
- emit each update as a normal workflow output;
- finish with the final counter value.

Run with:

```sh
npm test --workspace demos/temporal-ports/query-subscriptions
```
