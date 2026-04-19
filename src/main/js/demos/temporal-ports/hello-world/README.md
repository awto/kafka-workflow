# Temporal Port: hello-world

Original Temporal sample: [temporalio/samples-typescript/tree/main/hello-world](https://github.com/temporalio/samples-typescript/tree/main/hello-world)

This port keeps only the durable workflow shape:

- emit one external request;
- await its reply with `ref(...)`;
- finish with a durable result.

Run with:

```sh
npm test --workspace demos/temporal-ports/hello-world
```
