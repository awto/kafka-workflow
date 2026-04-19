# Temporal Port: safe-message-handlers

Original Temporal sample: [temporalio/samples-typescript/tree/main/message-passing/safe-message-handlers](https://github.com/temporalio/samples-typescript/tree/main/message-passing/safe-message-handlers)

This port keeps the same core entity-workflow story:

- start a cluster;
- allocate and delete jobs;
- query cluster status;
- shut the cluster down cleanly.

The Temporal sample uses update handlers plus an async mutex to avoid interleaving around awaited RPC calls. This port keeps the same cluster-management behavior, but as a single direct-style message loop. The workflow simply waits for one command at a time, so the serialization is explicit in the workflow code.

Run with:

```sh
npm test --workspace demos/temporal-ports/safe-message-handlers
```
