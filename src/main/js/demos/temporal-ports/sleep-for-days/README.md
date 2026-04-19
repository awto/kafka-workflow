# Temporal Port: sleep-for-days

Original Temporal sample:
[temporalio/samples-typescript/tree/main/sleep-for-days](https://github.com/temporalio/samples-typescript/tree/main/sleep-for-days)

This port keeps the long-sleep workflow shape but expresses it with ordinary workflow refs:

- send an email activity and wait for its reply;
- race a durable sleep against a completion signal;
- cancel the sleep timer when completion wins;
- cancel the completion waiter when the timer wins and the loop starts another email.

Comparison point: the loop uses direct `async` control flow and `Promise.race`; there is no workflow-specific condition API in the demo code.

Run:

```sh
npm test --workspace demos/temporal-ports/sleep-for-days
```
