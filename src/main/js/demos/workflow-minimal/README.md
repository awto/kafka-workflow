# workflow-minimal

Smallest runnable workflow demo.

This example is meant to explain the core runtime shape before sagas,
versioning, child workflows, or integration tests:

- create one durable external wait with `W.ref(...)`;
- emit one JSON command with `W.outputJSON(...)`;
- resume the workflow with a matching `workflow-resume` ref;
- return one workflow result;
- declare the external topic with `manifest.outputTopics`.

Run:

```sh
npm test --workspace demos/workflow-minimal
```
