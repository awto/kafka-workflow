# Temporal Ports

These demos port selected [Temporal](https://temporal.io/) samples into the much smaller `@effectful/kafka-workflow-rt` API.

Each port lives in its own folder and includes a direct reference to the original upstream sample on GitHub.

Coverage note:

- The ports focus on workflow behavior. Temporal worker, client, UI, and activity
  scaffolding is omitted unless it changes the workflow comparison.
- Multi-workflow samples keep their workflow roles in the port. For example,
  `mutex` includes both `lockWorkflow` and `oneAtATimeWorkflow`.
- Smaller ports are intentional, not watered down. The point of the comparison
  is that direct workflow code, durable refs, cancellation-aware promises, and
  demo-level versioned envelopes express the same behavior with less API surface
  and fewer runtime concepts.
- `cancellation-scopes` maps the exported workflow snippets from the upstream
  cancellation-scope file into the demo API. The port keeps the behavior
  comparison explicit without adding Temporal-style scope APIs to the runtime.

Category summary:

| Temporal concept | Kafka Workflow shape |
| --- | --- |
| Activities and external operations | Emit a command with `outputJSON(...)`, await a `ref`, and let the service resume the workflow. |
| Timers and long sleeps | Emit scheduler records and await refs. Canceling the wait emits a scheduler-cancel record. |
| Cancellation scopes | Use normal `async` control flow. Losing `Promise.race` branches and failed `Promise.all` siblings receive `CancelToken`. |
| Child workflows and services | Start ordinary workflow threads with `ensureThread(...)` and communicate through durable refs. |
| Queries, signals, and updates | Use a serialized workflow loop over ordinary messages with reply ids. |
| Sagas | Use direct code plus a compensation stack. |
| Versioning and patching | Keep rollout policy in demo workflow code. The shipped envelopes and handoff rules are examples, not runtime features. |

Coverage matrix:

| Local port | Upstream sample | Covered workflow behavior | Why the port is smaller |
| --- | --- | --- | --- |
| [`activities-cancellation-heartbeating`](./activities-cancellation-heartbeating) | [`activities-cancellation-heartbeating`](https://github.com/temporalio/samples-typescript/tree/main/activities-cancellation-heartbeating) | Long-running activity progress, cancellation, and cleanup. | Progress, cancellation, and cleanup are plain durable refs and `Promise.race`; no activity heartbeat API is needed in workflow code. |
| [`cancellation-scopes`](./cancellation-scopes) | [`activities-cancellation-heartbeating/src/cancellation-scopes.ts`](https://github.com/temporalio/samples-typescript/blob/main/activities-cancellation-heartbeating/src/cancellation-scopes.ts) | Exported timer, activity, callback, shared-scope, and shielded-cancellation snippets. | Cancellation stays attached to direct `async` control flow and cancellation-aware promise combinators instead of a large workflow-facing scope API. |
| [`child-workflows`](./child-workflows) | [`child-workflows`](https://github.com/temporalio/samples-typescript/tree/main/child-workflows) | Parent starts children, children complete independently, parent combines results. | Child workflows are ordinary workflow threads connected by refs; no special child-workflow SDK surface is required. |
| [`continue-as-new`](./continue-as-new) | [`continue-as-new`](https://github.com/temporalio/samples-typescript/tree/main/continue-as-new) | Durable repeated loop with timer waits. | Persisted continuations make the loop itself durable, so there is no separate `continueAsNew` concept in demo code. |
| [`early-return`](./early-return) | [`early-return`](https://github.com/temporalio/samples-typescript/tree/main/early-return) | Start, early confirmation reply, and later completion. | Update-with-start behavior is just a normal reply ref plus continuing workflow state. |
| [`execute-update`](./execute-update) | [`message-passing/execute-update`](https://github.com/temporalio/samples-typescript/tree/main/message-passing/execute-update) | Counter updates, validation, replies, and final completion. | A serialized workflow loop handles mutation and validation directly; there is no update-handler layer. |
| [`expense`](./expense) | [`expense`](https://github.com/temporalio/samples-typescript/tree/main/expense) | Approval, rejection, and timeout completion. | Approval and timeout are direct message/timer branches rather than separate signal definitions. |
| [`food-delivery`](./food-delivery) | [`food-delivery`](https://github.com/temporalio/samples-typescript/tree/main/food-delivery) | Charge, status query, pickup, delivery, refunds, and rating reminder. | The frontend, worker, and SDK scaffolding disappear; the domain state machine remains visible as workflow code. |
| [`hello-world`](./hello-world) | [`hello-world`](https://github.com/temporalio/samples-typescript/tree/main/hello-world) | One activity request and durable reply. | A single output plus ref captures the useful workflow behavior. |
| [`message-introduction`](./message-introduction) | [`message-passing/introduction`](https://github.com/temporalio/samples-typescript/tree/main/message-passing/introduction) | Queries, signals, updates, async update, and approval. | Query/update/signal handlers collapse into one explicit workflow loop; update ordering comes from the loop. |
| [`mutex`](./mutex) | [`mutex`](https://github.com/temporalio/samples-typescript/tree/main/mutex) | `lockWorkflow`, `oneAtATimeWorkflow`, queued grants, release refs, timeout release, and Docker chaos recovery for both stream runners. | Both roles are ordinary workflows exchanging `workflow-resume` records; no client-side mutex API is needed. |
| [`nexus-cancellation`](./nexus-cancellation) | [`nexus-cancellation`](https://github.com/temporalio/samples-typescript/tree/main/nexus-cancellation) | Caller cancellation and service workflow result. | Nexus operation cancellation becomes a durable operation ref raced against a cancel ref. |
| [`nexus-hello`](./nexus-hello) | [`nexus-hello`](https://github.com/temporalio/samples-typescript/tree/main/nexus-hello) | Echo caller, echo service operation, hello caller, and service hello workflow. | Nexus services, endpoints, operation handlers, and namespaces collapse into durable operation refs plus ordinary workflow threads. |
| [`nextjs-ecommerce-oneclick`](./nextjs-ecommerce-oneclick) | [`nextjs-ecommerce-oneclick`](https://github.com/temporalio/samples-typescript/tree/main/nextjs-ecommerce-oneclick) | Purchase pending state, cancellation, query, and confirmation timeout. | The web app and worker scaffolding are omitted; the purchase workflow is a compact state machine. |
| [`patching-api`](./patching-api) | [`patching-api`](https://github.com/temporalio/samples-typescript/tree/main/patching-api) | Minor-version upgrade handoff and patch-only latest-code starts. | Versioning is explicit demo workflow code with envelopes, which avoids permanently adding patch markers to the runtime. |
| [`query-subscriptions`](./query-subscriptions) | [`query-subscriptions`](https://github.com/temporalio/samples-typescript/tree/main/query-subscriptions) | State updates published directly from the workflow. | The simpler workflow-output approach replaces Redis streams and SDK interceptors. |
| [`safe-message-handlers`](./safe-message-handlers) | [`message-passing/safe-message-handlers`](https://github.com/temporalio/samples-typescript/tree/main/message-passing/safe-message-handlers) | Cluster start, allocation, deletion, query, and shutdown. | A direct serialized loop makes async handler safety explicit without a workflow mutex helper. |
| [`saga`](./saga) | [`saga`](https://github.com/temporalio/samples-typescript/tree/main/saga) | Account-opening steps and reverse-order compensation on failure. | Compensation is normal code over a small stack, not a framework-level saga abstraction. |
| [`signals-queries`](./signals-queries) | [`signals-queries`](https://github.com/temporalio/samples-typescript/tree/main/signals-queries) | Mutable workflow state, signal-like mutation, query-like read, and completion. | Signals and queries are ordinary messages, so the state logic stays in one place. |
| [`sleep-for-days`](./sleep-for-days) | [`sleep-for-days`](https://github.com/temporalio/samples-typescript/tree/main/sleep-for-days) | Long sleeps, completion signal race, timer cancellation, and repeated reminders. | Durable scheduler refs plus `Promise.race` replace workflow-specific sleep and condition APIs. |
| [`state`](./state) | [`state`](https://github.com/temporalio/samples-typescript/tree/main/state) | Map state mutation, query-like read, and cancellation. | State transitions are direct loop branches, not registered signal/query handlers. |
| [`timer-progress`](./timer-progress) | [`timer-progress`](https://github.com/temporalio/samples-typescript/tree/main/timer-progress) | Progress updates over durable timer ticks and query-like reads while running. | Query registration becomes a normal workflow message with a reply id, keeping progress state and timer handling in one loop. |
| [`timer-examples`](./timer-examples) | [`timer-examples`](https://github.com/temporalio/samples-typescript/tree/main/timer-examples) | Slow-order reminder and updatable countdown timer. | One shared scheduler primitive covers both examples without specialized timer helpers. |
| [`worker-versioning`](./worker-versioning) | [`worker-versioning`](https://github.com/temporalio/samples-typescript/tree/main/worker-versioning) | Auto-upgrade handoff, pinned workflow behavior, compatible minor changes, and incompatible major rejection. | Worker deployment policy is explicit workflow-envelope code instead of runtime-level worker versioning and patch marker APIs. |

Run all currently ported Temporal demos with:

```sh
npm run test:temporal-ports
```
