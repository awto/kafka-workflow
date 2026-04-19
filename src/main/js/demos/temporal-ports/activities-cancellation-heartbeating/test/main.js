const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  findOutput,
  parseOutput: parse
} = require("../../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-activities-cancellation-heartbeating",
    defaultThreadId: "activity-cancel-thread",
    stepMode: "state"
  });
}

test("bundle exposes cancellation topics", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-activity-cancel-await-cancel",
    "temporal-activity-cancel-cancel-activity",
    "temporal-activity-cancel-cleanup",
    "temporal-activity-cancel-heartbeat",
    "temporal-activity-cancel-start",
    "workflow-error",
    "workflow-result"
  ]);
});

test("cancel signal cancels the running progress branch and waits for cleanup", async () => {
  const workflow = createHarness();
  const first = await workflow.step({ total: 100 });
  const start = parse(findOutput(first.outputs, "temporal-activity-cancel-start"));
  const cancel = parse(findOutput(first.outputs, "temporal-activity-cancel-await-cancel"));

  const second = await workflow.step(
    { ref: start.ref, value: { type: "progress", progress: 42 } },
    first.state
  );
  assert.deepEqual(parse(findOutput(second.outputs, "temporal-activity-cancel-heartbeat")), {
    progress: 42
  });

  const cancelled = await workflow.step(
    { ref: cancel.ref, value: { reason: "user requested" } },
    second.state
  );
  assert.equal(cancelled.state, "");
  assert.deepEqual(parse(findOutput(cancelled.outputs, "temporal-activity-cancel-cancel-activity")), {
    ref: start.ref,
    lastProgress: 42
  });
  assert.deepEqual(parse(findOutput(cancelled.outputs, "temporal-activity-cancel-cleanup")), {
    lastProgress: 42
  });
  assert.deepEqual(parse(findOutput(cancelled.outputs, "workflow-result")), {
    status: "cancelled",
    reason: "user requested"
  });
});

test("activity completion cancels the cancel watcher without cleanup", async () => {
  const workflow = createHarness();
  const first = await workflow.step({ total: 100 }, "", "activity-complete-thread");
  const start = parse(findOutput(first.outputs, "temporal-activity-cancel-start"));

  const finished = await workflow.step(
    { ref: start.ref, value: { type: "done" } },
    first.state,
    "activity-complete-thread"
  );
  assert.equal(finished.state, "");
  assert.equal(findOutput(finished.outputs, "temporal-activity-cancel-cancel-activity"), undefined);
  assert.equal(findOutput(finished.outputs, "temporal-activity-cancel-cleanup"), undefined);
  assert.deepEqual(parse(findOutput(finished.outputs, "workflow-result")), {
    status: "completed"
  });
});
