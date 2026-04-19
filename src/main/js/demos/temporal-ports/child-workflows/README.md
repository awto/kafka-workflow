# Temporal Port: child-workflows

Original Temporal sample: [temporalio/samples-typescript/tree/main/child-workflows](https://github.com/temporalio/samples-typescript/tree/main/child-workflows)

This port keeps the same core idea:

- a parent workflow starts child workflows;
- the children complete independently;
- the parent waits for all child results and combines them.

Run with:

```sh
npm test --workspace demos/temporal-ports/child-workflows
```
