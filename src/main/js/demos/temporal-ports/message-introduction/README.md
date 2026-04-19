# Temporal Port: message-passing/introduction

Original Temporal sample: [temporalio/samples-typescript/tree/main/message-passing/introduction](https://github.com/temporalio/samples-typescript/tree/main/message-passing/introduction)

Temporal models this sample with separate query, signal, update, and async update handlers, plus an explicit mutex for ordered async updates.

This port keeps the same behavior in a single workflow loop:

- queries and updates are ordinary workflow messages with reply ids;
- the async language lookup is just a normal output plus awaited reply;
- update ordering is automatic because the workflow loop is already serialized.

Run with:

```sh
npm test --workspace demos/temporal-ports/message-introduction
```
