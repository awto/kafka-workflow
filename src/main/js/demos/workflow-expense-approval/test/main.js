const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  findOutput,
  parseOutput,
  resumeEventFromKey: schedulerResume
} = require("../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "expense-approval",
    defaultThreadId: "expense-thread",
    stepMode: "state"
  });
}

function outputJson(outputs, topic) {
  const output = findOutput(outputs, topic);
  return output ? parseOutput(output) : undefined;
}

function decisionEvent(decisionRef, value) {
  return {
    ref: decisionRef,
    value
  };
}

test("built bundle exposes expected topics and approves before the deadline", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "expense-approval-approved",
    "expense-approval-escalated",
    "expense-approval-rejected",
    "expense-approval-reminder",
    "expense-approval-request",
    "workflow-error",
    "workflow-result",
    "workflow-scheduler"
  ]);

  const first = await workflow.step({
    amount: 4200,
    requester: "alice",
    approverEmail: "lead@example.com",
    description: "Conference travel",
    approvalTimeoutMS: 250,
    reminderTimeoutMS: 400
  });
  const request = outputJson(first.outputs, "expense-approval-request");
  assert.equal(request.stage, "requested");
  assert.equal(request.expenseId, "expense-thread");
  assert.equal(findOutput(first.outputs, "workflow-scheduler").value, "250");

  const final = await workflow.step(
    decisionEvent(request.decisionRef, {
      type: "approve",
      decidedBy: "lead@example.com",
      comment: "Approved"
    }),
    first.state
  );

  assert.equal(final.state, "");
  assert.equal(findOutput(final.outputs, "workflow-scheduler").value, "0");
  assert.deepEqual(outputJson(final.outputs, "expense-approval-approved"), {
    status: "approved",
    expenseId: "expense-thread",
    amount: 4200,
    requester: "alice",
    approverEmail: "lead@example.com",
    description: "Conference travel",
    stage: "requested",
    decidedBy: "lead@example.com",
    comment: "Approved"
  });
  assert.deepEqual(parseOutput(findOutput(final.outputs, "workflow-result")), {
    status: "approved",
    expenseId: "expense-thread",
    amount: 4200,
    requester: "alice",
    approverEmail: "lead@example.com",
    description: "Conference travel",
    stage: "requested",
    decidedBy: "lead@example.com",
    comment: "Approved"
  });
});

test("built bundle rejects before the deadline", async () => {
  const workflow = createHarness();
  const first = await workflow.step({
    amount: 1800,
    requester: "bob",
    approverEmail: "manager@example.com",
    approvalTimeoutMS: 250,
    reminderTimeoutMS: 400
  });
  const request = outputJson(first.outputs, "expense-approval-request");

  const final = await workflow.step(
    decisionEvent(request.decisionRef, {
      type: "reject",
      decidedBy: "manager@example.com",
      comment: "Budget frozen"
    }),
    first.state
  );

  assert.equal(final.state, "");
  assert.equal(findOutput(final.outputs, "workflow-scheduler").value, "0");
  assert.deepEqual(outputJson(final.outputs, "expense-approval-rejected"), {
    status: "rejected",
    expenseId: "expense-thread",
    amount: 1800,
    requester: "bob",
    approverEmail: "manager@example.com",
    stage: "requested",
    decidedBy: "manager@example.com",
    comment: "Budget frozen"
  });
});

test("built bundle sends a reminder and then accepts a late approval", async () => {
  const workflow = createHarness();
  const first = await workflow.step({
    amount: 960,
    requester: "charlie",
    approverEmail: "finance@example.com",
    approvalTimeoutMS: 250,
    reminderTimeoutMS: 400
  });

  const second = await workflow.step(
    schedulerResume(findOutput(first.outputs, "workflow-scheduler")),
    first.state
  );
  const reminder = outputJson(second.outputs, "expense-approval-reminder");
  assert.equal(reminder.stage, "reminded");
  assert.equal(findOutput(second.outputs, "workflow-scheduler").value, "400");

  const final = await workflow.step(
    decisionEvent(reminder.decisionRef, {
      type: "approve",
      decidedBy: "finance@example.com",
      comment: "Approved after reminder"
    }),
    second.state
  );

  assert.equal(final.state, "");
  assert.equal(findOutput(final.outputs, "workflow-scheduler").value, "0");
  assert.deepEqual(outputJson(final.outputs, "expense-approval-approved"), {
    status: "approved",
    expenseId: "expense-thread",
    amount: 960,
    requester: "charlie",
    approverEmail: "finance@example.com",
    stage: "reminded",
    decidedBy: "finance@example.com",
    comment: "Approved after reminder"
  });
});

test("built bundle escalates after two missed deadlines", async () => {
  const workflow = createHarness();
  const first = await workflow.step({
    amount: 15000,
    requester: "dana",
    approverEmail: "director@example.com",
    description: "Team offsite",
    approvalTimeoutMS: 250,
    reminderTimeoutMS: 350
  });
  const second = await workflow.step(
    schedulerResume(findOutput(first.outputs, "workflow-scheduler")),
    first.state
  );
  const third = await workflow.step(
    schedulerResume(findOutput(second.outputs, "workflow-scheduler")),
    second.state
  );

  assert.equal(third.state, "");
  assert.deepEqual(outputJson(third.outputs, "expense-approval-escalated"), {
    status: "escalated",
    expenseId: "expense-thread",
    amount: 15000,
    requester: "dana",
    approverEmail: "director@example.com",
    description: "Team offsite",
    stage: "reminded"
  });
  assert.deepEqual(parseOutput(findOutput(third.outputs, "workflow-result")), {
    status: "escalated",
    expenseId: "expense-thread",
    amount: 15000,
    requester: "dana",
    approverEmail: "director@example.com",
    description: "Team offsite",
    stage: "reminded"
  });
});
