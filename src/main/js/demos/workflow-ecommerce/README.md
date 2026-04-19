# workflow-ecommerce

Ecommerce workflow example for [kafka-workflow](https://github.com/awto/kafka-workflow).

- Uses [`@effectful/kafka-workflow-rt`](../../packages/rt).
- Bundles through the shared debugger-instrumented demo bootstrap in [`../_build`](../_build).
- Builds to [`src/main/resources/static/built/ecommerce/index.js`](../../../resources/static/built/ecommerce/index.js).
- Includes a Docker Compose integration test in [`integration/`](./integration) that starts Kafka, builds the workflow and Java host, runs the engine and scheduler, and verifies both a completed checkout flow and a scheduler-driven abandonment flow.
- Includes a chaos integration test in [`integration/`](./integration) that randomly kills `engine` or `scheduler`, waits for Kafka Streams to recover, and verifies the workflow still completes.

The cart workflow uses only durable refs, normal messages, scheduler outputs,
and cancellation-aware promise races. There is no workflow-specific query,
signal, or timer API hidden behind the example.

Run the integration test with:

```sh
npm run test:integration
```

Run the chaos integration test with:

```sh
npm run test:integration:chaos
```

Notes:

- Docker Desktop or another running Docker daemon is required.
