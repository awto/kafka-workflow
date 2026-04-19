# Temporal Port: mutex

Original Temporal sample: [temporalio/samples-typescript/tree/main/mutex](https://github.com/temporalio/samples-typescript/tree/main/mutex)

This port keeps the same core idea:

- a workflow thread owns the mutex state;
- clients request and release the lock by sending events;
- the workflow serializes access and grants the next waiter.
- a `oneAtATimeWorkflow` contender starts/requests the lock workflow, waits
  for the grant, runs one protected activity, and releases the lock.
- lock grants can auto-release through the shared scheduler if the holder does
  not send its release signal before the timeout.

The lock manager and contender are both ordinary workflows in the same bundle.
The contender talks to the lock manager through `workflow-resume` records, so
the comparison stays close to the Temporal sample without introducing a special
client-side mutex API.

Run with:

```sh
npm test --workspace demos/temporal-ports/mutex
```

Run the Docker Compose integration test with:

```sh
npm run test:integration --workspace demos/temporal-ports/mutex
```

Run the chaos integration test with:

```sh
npm run test:integration:chaos --workspace demos/temporal-ports/mutex
```

The chaos test kills both `engine` and `scheduler`, waits for Kafka Streams to
recover after each restart, and verifies both serialized contenders and
scheduler timeout handoff still complete. Set `CHAOS_SERIAL_SERVICES` to a
comma-separated service sequence to override the default `engine,scheduler,engine`
serial-contender kill sequence.
