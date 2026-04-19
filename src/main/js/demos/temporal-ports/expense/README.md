# Temporal Port: expense

Original Temporal sample: [temporalio/samples-typescript/tree/main/expense](https://github.com/temporalio/samples-typescript/tree/main/expense)

This port keeps the same teaching point:

- create an expense request;
- wait for an approval or rejection signal;
- or time out and finish durably.

Run with:

```sh
npm test --workspace demos/temporal-ports/expense
```
