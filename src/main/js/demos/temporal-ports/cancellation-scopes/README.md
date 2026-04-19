# Temporal Port: cancellation-scopes

Original Temporal sample:
[temporalio/samples-typescript/blob/main/activities-cancellation-heartbeating/src/cancellation-scopes.ts](https://github.com/temporalio/samples-typescript/blob/main/activities-cancellation-heartbeating/src/cancellation-scopes.ts)

This port covers the exported cancellation-scope snippets from that file using
plain workflow code:

- cancel a timer through a raced branch;
- cancel a timer through an explicit cancellation scope;
- cancel an in-flight activity and run cleanup from the cancellation path;
- use one timeout signal branch to cancel a group of activities;
- run an activity in a non-cancellable continuation;
- observe cancellation and then wait for the shielded activity to finish;
- resume from a callback-style external event;
- race shared root-scope requests without cancelling the losing request;
- start a shielded activity and return its durable ref.

Comparison point: the cancellation semantics are carried by direct `async`
control flow and the runtime's cancellation-aware promise combinators, not by a
large workflow-facing scope API.

Run:

```sh
npm test --workspace demos/temporal-ports/cancellation-scopes
```
