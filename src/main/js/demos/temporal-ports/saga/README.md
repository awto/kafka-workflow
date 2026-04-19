# Temporal Port: saga

Original Temporal sample: [temporalio/samples-typescript/tree/main/saga](https://github.com/temporalio/samples-typescript/tree/main/saga)

This is one of the strongest comparison samples because Temporal needs an explicit activity/compensation pattern, while here the same saga is just direct workflow code plus a small compensation stack.

This port keeps the same behavior:

- create account first, fail fast if that step fails;
- add address, add client, add bank account sequentially;
- if any later step fails, run compensations in reverse order;
- swallow compensation errors and rethrow the original failure.

Run with:

```sh
npm test --workspace demos/temporal-ports/saga
```
