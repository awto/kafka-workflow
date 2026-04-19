const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  findOutput,
  parseOutput,
  resumeEventFromKey
} = require("../../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-early-return",
    defaultThreadId: "early-return-thread",
    stepMode: "state"
  });
}

test("early-return replies at confirmation and completes later", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-early-return-reply",
    "workflow-error",
    "workflow-result",
    "workflow-scheduler"
  ]);

  const started = await workflow.step({
    confirmDelayMS: 50,
    completeDelayMS: 100
  });
  const confirmTimer = findOutput(started.outputs, "workflow-scheduler");
  assert.equal(confirmTimer.value, "50");
  assert.deepEqual(resumeEventFromKey(confirmTimer), {
    ref: "main",
    value: { type: "confirmTimeout" }
  });

  const waiting = await workflow.step(
    {
      ref: "main",
      value: { type: "awaitConfirmation", reply: "confirm-1" }
    },
    started.state
  );
  assert.equal(waiting.outputs.length, 0);

  const confirmed = await workflow.step(
    resumeEventFromKey(confirmTimer),
    waiting.state
  );
  assert.deepEqual(
    parseOutput(findOutput(confirmed.outputs, "temporal-early-return-reply")),
    {
      reply: "confirm-1",
      value: { status: "confirmed" }
    }
  );
  const completionTimer = findOutput(confirmed.outputs, "workflow-scheduler");
  assert.equal(completionTimer.value, "100");
  assert.deepEqual(resumeEventFromKey(completionTimer), {
    ref: "main",
    value: { type: "completeTimeout" }
  });

  const lateWaiter = await workflow.step(
    {
      ref: "main",
      value: { type: "awaitConfirmation", reply: "confirm-2" }
    },
    confirmed.state
  );
  assert.deepEqual(
    parseOutput(findOutput(lateWaiter.outputs, "temporal-early-return-reply")),
    {
      reply: "confirm-2",
      value: { status: "confirmed" }
    }
  );

  const finished = await workflow.step(
    resumeEventFromKey(completionTimer),
    lateWaiter.state
  );
  assert.equal(finished.state, "");
  assert.deepEqual(
    parseOutput(findOutput(finished.outputs, "workflow-result")),
    {
      status: "complete",
      finalAmount: 77
    }
  );
});
