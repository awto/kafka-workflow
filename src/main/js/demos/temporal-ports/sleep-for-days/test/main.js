const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  collectOutputs,
  findOutput,
  parseOutput: parse,
  resumeEventFromKey: timerEvent
} = require("../../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-sleep-for-days",
    defaultThreadId: "sleep-for-days-thread",
    stepMode: "state"
  });
}

test("bundle exposes sleep-for-days topics", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-sleep-for-days-await-complete",
    "temporal-sleep-for-days-await-complete-cancel",
    "temporal-sleep-for-days-send-email",
    "workflow-error",
    "workflow-result",
    "workflow-scheduler"
  ]);
});

test("completion signal cancels the long sleep timer", async () => {
  const workflow = createHarness();
  const started = await workflow.step({ days: 30, message: "Still sleeping" });
  const email = parse(
    findOutput(started.outputs, "temporal-sleep-for-days-send-email")
  );

  assert.ok(started.state);
  assert.equal(email.iteration, 1);
  assert.equal(email.message, "Still sleeping: 1");
  assert.match(email.ref, /:send-email:1:\d+$/);

  const waiting = await workflow.step(
    { ref: email.ref, value: { sent: true } },
    started.state
  );
  const timer = findOutput(waiting.outputs, "workflow-scheduler");

  assert.ok(waiting.state);
  assert.equal(timer.value, "2592000000");
  assert.deepEqual(
    parse(findOutput(waiting.outputs, "temporal-sleep-for-days-await-complete")),
    {
      ref: "complete"
    }
  );

  const completed = await workflow.step(
    { ref: "complete", value: { completedBy: "user" } },
    waiting.state
  );

  assert.equal(completed.state, "");
  assert.deepEqual(
    collectOutputs(completed.outputs, "workflow-scheduler").map((output) => ({
      key: output.key,
      value: output.value
    })),
    [{ key: timer.key, value: "0" }]
  );
  assert.deepEqual(parse(findOutput(completed.outputs, "workflow-result")), {
    status: "completed",
    completedBy: "user",
    emailsSent: 1
  });
});

test("timer completion cancels the completion waiter and loops", async () => {
  const workflow = createHarness();
  const started = await workflow.step({ days: 1 });
  const firstEmail = parse(
    findOutput(started.outputs, "temporal-sleep-for-days-send-email")
  );
  const waiting = await workflow.step(
    { ref: firstEmail.ref, value: { sent: true } },
    started.state
  );
  const firstTimer = findOutput(waiting.outputs, "workflow-scheduler");

  const ticked = await workflow.step(timerEvent(firstTimer), waiting.state);
  const secondEmail = parse(
    findOutput(ticked.outputs, "temporal-sleep-for-days-send-email")
  );

  assert.ok(ticked.state);
  assert.deepEqual(
    parse(
      findOutput(ticked.outputs, "temporal-sleep-for-days-await-complete-cancel")
    ),
    {
      ref: "complete"
    }
  );
  assert.equal(secondEmail.iteration, 2);
  assert.equal(secondEmail.message, "Still sleeping: 2");
  assert.match(secondEmail.ref, /:send-email:2:\d+$/);
  assert.equal(findOutput(ticked.outputs, "workflow-result"), undefined);

  const waitingAgain = await workflow.step(
    { ref: secondEmail.ref, value: { sent: true } },
    ticked.state
  );
  const secondTimer = findOutput(waitingAgain.outputs, "workflow-scheduler");
  const completed = await workflow.step(
    { ref: "complete", value: { completedBy: "test" } },
    waitingAgain.state
  );

  assert.equal(completed.state, "");
  assert.deepEqual(
    collectOutputs(completed.outputs, "workflow-scheduler").map((output) => ({
      key: output.key,
      value: output.value
    })),
    [{ key: secondTimer.key, value: "0" }]
  );
  assert.deepEqual(parse(findOutput(completed.outputs, "workflow-result")), {
    status: "completed",
    completedBy: "test",
    emailsSent: 2
  });
});
