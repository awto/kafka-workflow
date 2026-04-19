# Temporal Port: worker-versioning

Original Temporal sample:
[temporalio/samples-typescript/tree/main/worker-versioning](https://github.com/temporalio/samples-typescript/tree/main/worker-versioning)

This port keeps the workflow-level behavior from the sample:

- auto-upgrading workflows can hand off compatible state from `1.0` to `1.1`;
- patch-level changes start on the latest compatible path without an upgrade;
- pinned workflows keep the behavior of the version they started on;
- incompatible major-version handoff is rejected.

Comparison point: Temporal models this with worker deployment versions,
versioning behavior options, and patch markers. This port keeps that policy in
explicit workflow envelopes and handoff messages, so deployment/versioning
policy remains demo code and the runtime stays small.

Run:

```sh
npm test --workspace demos/temporal-ports/worker-versioning
```
