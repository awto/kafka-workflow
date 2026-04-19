# workflow-expense-approval

Advanced workflow demo showing a human approval flow with two scheduler-driven deadlines.

- Emits an approval request with a resume id the external approver can answer.
- Sends a reminder when the first deadline passes.
- Escalates when the second deadline passes.
- Uses the standard runtime only: `ref(...)`, `Promise.race(...)`, output topics, and scheduler cancellation.

Builds to [`src/main/resources/static/built/expense-approval/index.js`](../../../resources/static/built/expense-approval/index.js).

Run the bundle/unit tests with:

```sh
npm test --workspace demos/workflow-expense-approval
```

Run the Docker Compose integration test with:

```sh
npm run test:integration --workspace demos/workflow-expense-approval
```

Notes:

- Docker Desktop or another running Docker daemon is required.
