const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  findOutput,
  parseOutput,
  resumeEventFromKey: schedulerResume
} = require("../../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-expense",
    defaultThreadId: "expense-thread",
    stepMode: "state"
  });
}

test("expense creates and completes on approval", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-expense-create",
    "temporal-expense-pay",
    "workflow-error",
    "workflow-result",
    "workflow-scheduler"
  ]);

  const first = await workflow.step({
    amount: 1200,
    reason: "client dinner",
    requester: "alice",
    approvalTimeoutMS: 200
  });
  assert.deepEqual(parseOutput(findOutput(first.outputs, "temporal-expense-create")), {
    expenseId: "expense-thread",
    amount: 1200,
    reason: "client dinner",
    requester: "alice"
  });

  const second = await workflow.step(
    {
      ref: "approval",
      value: { type: "approve", approvedBy: "manager" }
    },
    first.state
  );
  assert.equal(findOutput(second.outputs, "workflow-scheduler").value, "0");
  assert.deepEqual(parseOutput(findOutput(second.outputs, "temporal-expense-pay")), {
    expenseId: "expense-thread",
    amount: 1200,
    approvedBy: "manager"
  });
  assert.deepEqual(parseOutput(findOutput(second.outputs, "workflow-result")), {
    status: "COMPLETED",
    expenseId: "expense-thread",
    amount: 1200
  });
});

test("expense returns rejected when rejected", async () => {
  const workflow = createHarness();
  const first = await workflow.step({
    amount: 500,
    reason: "desk lamp",
    requester: "bob",
    approvalTimeoutMS: 200
  });
  const second = await workflow.step(
    {
      ref: "approval",
      value: { type: "reject", rejectedBy: "manager" }
    },
    first.state
  );
  assert.equal(findOutput(second.outputs, "workflow-scheduler").value, "0");
  assert.deepEqual(parseOutput(findOutput(second.outputs, "workflow-result")), {
    status: "REJECTED",
    expenseId: "expense-thread",
    amount: 500
  });
});

test("expense times out if nobody responds", async () => {
  const workflow = createHarness();
  const first = await workflow.step({
    amount: 2400,
    reason: "conference hotel",
    requester: "charlie",
    approvalTimeoutMS: 200
  });
  const second = await workflow.step(
    schedulerResume(findOutput(first.outputs, "workflow-scheduler")),
    first.state
  );
  assert.deepEqual(parseOutput(findOutput(second.outputs, "workflow-result")), {
    status: "TIMED_OUT",
    expenseId: "expense-thread",
    amount: 2400
  });
});
