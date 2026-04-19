# @effectful/kafka-workflow-rt

Small runtime helpers for durable JavaScript workflows on Kafka Streams.

Workflow code stays ordinary TypeScript:

- create durable external waits with `ref(...)` or `refId(...)`;
- emit Kafka records with `outputJSON(...)`;
- start durable workflow threads with `ensureThread(...)`;
- rely on normal `Promise` combinators for persisted async control flow and
  structured cancellation.

The runtime does not own domain policy. Sagas, versioning, retries, delayed
cleanup, queries, updates, and service workflows are application protocols built
from these primitives.

```sh
npm install @effectful/kafka-workflow-rt
```

The package is intentionally small. Normal workflow code should start with the
first table and ignore the advanced/host-facing exports unless it is building a
new runner or experimenting with lower-level continuation behavior.

## Use These First

| API | Purpose |
| --- | --- |
| `ref(name?)` | Create a durable external wait point with a generated id. |
| `refId(id, key?)` | Create a durable external wait point with a protocol-defined id. |
| `outputJSON(value, topic, key?)` | Emit a JSON Kafka record. The key defaults to the current workflow thread id. |
| `output(value, topic, key?)` | Emit a raw string Kafka record. Use `outputJSON(...)` unless the protocol needs raw strings. |
| `ensureThread(value, key)` | Start another workflow thread by key if it does not already exist. |
| `CancelToken` | Cancellation error thrown into canceled `Promise` branches. Catch it to emit domain-specific cleanup/cancel commands. |
| `manifest.outputTopics` | Exported from the workflow module to declare external output topics. This is preferred over mutating runtime config from workflow code. |

These are enough for the main patterns in the demos: activities, timers, child
workflows, service-style workflows, sagas, queries/updates/signals, and
versioning protocols.

## Advanced Exports

These exist because the runtime also hosts the bundled workflow code and adapts
Effectful continuations to a Kafka Streams runner.

| API | Intended use |
| --- | --- |
| `step(...)`, `drainOutputs()`, `installWorkflowHost(...)` | Host/runner integration. Workflow code should not call these. |
| `config` | Host defaults for result/error topics and output-topic discovery. Examples prefer `manifest.outputTopics`. |
| `threadId`, `stepId` | Host-provided metadata for the current workflow step. Useful in rare protocol code, but not required for normal workflows. |
| `wait(...)`, `suspend(...)`, `Suspension` | Low-level continuation helpers. Prefer native `await` and `ref(...)`. |
| `Ref` | The awaitable handle class returned by `ref(...)` and `refId(...)`. Usually used through the factory functions. |
| `Promise` | Workflow-aware patched `Promise` implementation installed by the bundle. Normal code uses global `Promise`. |
| `CancellationScope`, `currentCancellationScope`, `withCancellationScope`, `addCanceler`, `removeCanceler`, `cancelScope` | Lower-level cancellation plumbing. Normal workflow code should rely on cancellation-aware `Promise` combinators and catch `CancelToken` at waits. |

## Design Rule

The runtime persists continuations, resumes refs, emits records, starts workflow
threads, and propagates cancellation. It does not own domain policy. Sagas,
versioning, message handlers, mutexes, retries, and schedulers are examples or
application code, not runtime features.

See the runnable demos in [../../demos](../../demos). Start with
[workflow-minimal](../../demos/workflow-minimal), then
[workflow-trip-booking-saga](../../demos/workflow-trip-booking-saga).
