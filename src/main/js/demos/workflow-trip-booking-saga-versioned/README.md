# workflow-trip-booking-saga-versioned

Versioning demo for `kafka-workflow`.

This demo shows one possible upgrade protocol. The runtime does not require
this envelope, upgrade manager, or delayed-release design; applications can
craft whatever versioning workflow matches their domain.

- `1.0.x` books hotel, flight, and car.
- `1.1.x` can adopt a `1.0.x` handoff and falls back to a taxi when the car is unavailable.
- `2.0.x` starts fresh and books hotel, flight, and taxi directly.
- Minor upgrades are dispatched explicitly by `versioning-upgrade-manager`, which is just another workflow in the bundle.
- Delayed release is also a real workflow local to this demo package.
- Major versions start as separate workflow families and are not reused by upgrades.
- Patch-only changes do not trigger upgrades.

The point of the demo is that versioning policy does not require a runtime
extension. The core only provides durable continuations and outputs; envelopes,
handoff rules, adoption, and delayed cleanup are all normal workflow code that
can be changed or replaced.

Run the bundle tests with:

```sh
npm test --workspace demos/workflow-trip-booking-saga-versioned
```

Run the Docker Compose integration test with:

```sh
npm run test:integration --workspace demos/workflow-trip-booking-saga-versioned
```

That Compose run covers:

- `1.0 -> 1.1` minor upgrade with handoff and taxi fallback
- `1.1.x` patch-only start without upgrade
- fresh `2.0` start with direct taxi booking
- delayed release firing when adoption never happens

Run the chaos integration test with:

```sh
npm run test:integration:chaos --workspace demos/workflow-trip-booking-saga-versioned
```
