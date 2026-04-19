# workflow-trip-booking-saga

Primary workflow example for [kafka-workflow](https://github.com/awto/kafka-workflow).

- Uses [`@effectful/kafka-workflow-rt`](../../packages/rt).
- Bundles through the shared debugger-instrumented demo bootstrap in [`../_build`](../_build).
- Builds to [`src/main/resources/static/built/trip-booking-saga/index.js`](../../../resources/static/built/trip-booking-saga/index.js).
- Includes a Docker Compose integration test in [`integration/`](./integration) that starts Kafka, builds the workflow and Java host, runs the engine and scheduler, and verifies both a successful booking flow and a real scheduler-driven timeout flow.
- Includes a chaos integration test in [`integration/`](./integration) that randomly kills `engine` or `scheduler`, waits for Kafka Streams to recover, and verifies the workflow still completes.

The workflow itself is intentionally direct: reservations run in parallel with
`Promise.all`, the timeout is a normal `Promise.race`, cancellations are
delivered as `CancelToken`, and compensation is just a small array of functions.

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
