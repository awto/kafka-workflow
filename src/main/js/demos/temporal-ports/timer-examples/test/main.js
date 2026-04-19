const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  collectOutputs,
  findOutput,
  parseOutput,
  resumeEventFromKey
} = require("../../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-timer-examples",
    defaultThreadId: "timer-examples-thread",
    stepMode: "state"
  });
}

test("timer-examples sends a reminder if order processing is slow", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-timer-examples-countdown-done",
    "temporal-timer-examples-countdown-state",
    "temporal-timer-examples-process-order",
    "temporal-timer-examples-send-notification-email",
    "workflow-error",
    "workflow-result",
    "workflow-scheduler"
  ]);

  const started = await workflow.step({
    kind: "processOrder",
    orderProcessingMS: 300,
    sendDelayedEmailTimeoutMS: 100
  });
  const processOrder = parseOutput(
    findOutput(started.outputs, "temporal-timer-examples-process-order")
  );
  const timer = findOutput(started.outputs, "workflow-scheduler");
  assert.equal(timer.value, "100");

  const reminded = await workflow.step(
    resumeEventFromKey(timer),
    started.state
  );
  assert.equal(
    findOutput(reminded.outputs, "temporal-timer-examples-send-notification-email")
      .topic,
    "temporal-timer-examples-send-notification-email"
  );

  const finished = await workflow.step(
    processOrder,
    reminded.state
  );
  assert.equal(finished.state, "");
  assert.equal(
    parseOutput(findOutput(finished.outputs, "workflow-result")),
    "Order completed!"
  );
});

test("timer-examples cancels the reminder timer if processing finishes first", async () => {
  const workflow = createHarness();
  const started = await workflow.step({
    kind: "processOrder",
    orderProcessingMS: 300,
    sendDelayedEmailTimeoutMS: 100
  });
  const processOrder = parseOutput(
    findOutput(started.outputs, "temporal-timer-examples-process-order")
  );

  const finished = await workflow.step(
    processOrder,
    started.state
  );
  const schedulerOutputs = collectOutputs(finished.outputs, "workflow-scheduler");
  assert.ok(schedulerOutputs.some((output) => output.value === "0"));
  assert.equal(
    findOutput(finished.outputs, "temporal-timer-examples-send-notification-email"),
    undefined
  );
  assert.equal(
    parseOutput(findOutput(finished.outputs, "workflow-result")),
    "Order completed!"
  );
});

test("timer-examples countdown updates the timer and completes on the new deadline", async () => {
  const workflow = createHarness();
  const started = await workflow.step({
    kind: "countdown",
    initialDelayMS: 1000
  });
  assert.deepEqual(
    collectOutputs(started.outputs, "workflow-scheduler").map((output) => output.value),
    ["1000"]
  );

  const updated = await workflow.step(
    {
      ref: "main",
      value: { type: "setDeadline", delayMS: 1 }
    },
    started.state
  );
  assert.deepEqual(
    collectOutputs(updated.outputs, "workflow-scheduler").map((output) => output.value),
    ["0", "1"]
  );
  const timeout = collectOutputs(updated.outputs, "workflow-scheduler").find(
    (output) => output.value === "1"
  );

  const stale = await workflow.step(
    {
      ref: "main",
      value: { type: "timeout", timerId: 0 }
    },
    updated.state
  );
  assert.notEqual(stale.state, "");
  assert.equal(findOutput(stale.outputs, "temporal-timer-examples-countdown-done"), undefined);
  assert.equal(findOutput(stale.outputs, "workflow-result"), undefined);

  const queried = await workflow.step(
    {
      ref: "main",
      value: { type: "getTimeLeft", reply: "query-1" }
    },
    stale.state
  );
  assert.deepEqual(
    parseOutput(findOutput(queried.outputs, "temporal-timer-examples-countdown-state")),
    { reply: "query-1", timeLeftMS: 1 }
  );

  const finished = await workflow.step(
    {
      ref: "main",
      value: { type: "timeout", timerId: 1 }
    },
    queried.state
  );
  assert.equal(
    findOutput(finished.outputs, "temporal-timer-examples-countdown-done").topic,
    "temporal-timer-examples-countdown-done"
  );
  assert.deepEqual(
    parseOutput(findOutput(finished.outputs, "workflow-result")),
    { status: "done" }
  );
});
