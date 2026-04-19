# Demos

The active workflow examples in this repository live under this directory.

All runnable demos use the same small runtime API:

- `ref(...)` and `refId(...)` create durable external wait points.
- `output(...)` and `outputJSON(...)` emit Kafka records.
- `Promise.race`, `Promise.all`, `Promise.any`, and `Promise.allSettled` keep persisted async control flow and cancellation semantics.
- `manifest.outputTopics` declares the external topics a bundle writes to.
- `ensureThread(...)` starts another workflow thread when a demo needs child workflows.

The shared build support lives in [`_build`](./_build): one debugger-instrumented bootstrap, one webpack config factory, and shared TypeScript config bases. Individual demos mostly declare only their workflow code, bundle name, and tests.

The shared test and integration support lives in [`_test`](./_test) and [`_integration`](./_integration). Demo tests use one VM workflow harness, while integration scripts stay as tiny per-demo wrappers around the common Docker Compose runner.

Versioning is demonstrated as workflow code rather than a runtime feature. The
versioned demos use one possible protocol: normal envelopes, refs, handoff
messages, and an upgrade-manager workflow. Projects can keep that protocol,
simplify it, or replace it with their own compatibility and rollout rules.

Main demos:

- [`workflow-minimal`](./workflow-minimal): smallest runnable workflow with one `ref`, one `outputJSON`, one external reply, and one result. Run `npm test --workspace demos/workflow-minimal`.
- [`workflow-trip-booking-saga`](./workflow-trip-booking-saga): primary saga example with cancellation-aware `Promise.race` and scheduler timeouts. Run `npm test --workspace demos/workflow-trip-booking-saga` or `npm run test:integration --workspace demos/workflow-trip-booking-saga`.
- [`workflow-ecommerce`](./workflow-ecommerce): shopping-cart workflow with reminders and abandonment. Run `npm test --workspace demos/workflow-ecommerce` or `npm run test:integration --workspace demos/workflow-ecommerce`.
- [`workflow-trip-booking-saga-versioned`](./workflow-trip-booking-saga-versioned): explicit handoff-based minor-version upgrade demo. Versioning is implemented as normal workflow code, including an upgrade-manager workflow and a delayed-release workflow. Run `npm test --workspace demos/workflow-trip-booking-saga-versioned` or `npm run test:integration --workspace demos/workflow-trip-booking-saga-versioned`.
- [`workflow-ecommerce-versioned`](./workflow-ecommerce-versioned): second versioning example using the same small helper package. This demonstrates that the versioning policy is reusable userland workflow code, not a runtime feature. Run `npm test --workspace demos/workflow-ecommerce-versioned` or `npm run test:integration --workspace demos/workflow-ecommerce-versioned`.
- [`workflow-expense-approval`](./workflow-expense-approval): human approval flow with reminders, escalation, and scheduler-driven timeouts. Run `npm test --workspace demos/workflow-expense-approval` or `npm run test:integration --workspace demos/workflow-expense-approval`.

Comparison demos:

- [`temporal-ports`](./temporal-ports): selected ports of official Temporal samples, each with a link to the upstream GitHub example.

Demo support packages:

- [`workflow-versioning-demo`](./workflow-versioning-demo): tiny envelope, version-rule, handoff, and upgrade-manager helpers used by the versioned demos.
- [`workflow-trip-booking-saga-v1_0`](./workflow-trip-booking-saga-v1_0), [`workflow-trip-booking-saga-v1_1`](./workflow-trip-booking-saga-v1_1), [`workflow-trip-booking-saga-v2_0`](./workflow-trip-booking-saga-v2_0): business-logic variants for the versioned trip-booking demo.
- [`workflow-ecommerce-v1_0`](./workflow-ecommerce-v1_0), [`workflow-ecommerce-v1_1`](./workflow-ecommerce-v1_1), [`workflow-ecommerce-v2_0`](./workflow-ecommerce-v2_0): business-logic variants for the versioned ecommerce demo.
