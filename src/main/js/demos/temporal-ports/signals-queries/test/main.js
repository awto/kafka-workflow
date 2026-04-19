const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  findOutput,
  parseOutput
} = require("../../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-signals-queries",
    defaultThreadId: "signals-thread",
    stepMode: "state"
  });
}

function mainSignal(value) {
  return { ref: "main", value };
}

test("signals-queries keeps mutable workflow state and returns it on finish", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-signals-queries-state",
    "workflow-error",
    "workflow-result"
  ]);

  const first = await workflow.step({});
  assert.ok(first.state);

  const second = await workflow.step(mainSignal({ type: "query" }), first.state);
  assert.deepEqual(
    parseOutput(findOutput(second.outputs, "temporal-signals-queries-state")),
    { blocked: true, history: [] }
  );

  const third = await workflow.step(mainSignal({ type: "unblock" }), second.state);
  const fourth = await workflow.step(
    mainSignal({ type: "addMessage", message: "worker ready" }),
    third.state
  );
  const fifth = await workflow.step(mainSignal({ type: "query" }), fourth.state);
  assert.deepEqual(
    parseOutput(findOutput(fifth.outputs, "temporal-signals-queries-state")),
    { blocked: false, history: ["unblock", "worker ready"] }
  );

  const final = await workflow.step(mainSignal({ type: "finish" }), fifth.state);
  assert.equal(final.state, "");
  assert.deepEqual(parseOutput(findOutput(final.outputs, "workflow-result")), {
    status: "finished",
    blocked: false,
    history: ["unblock", "worker ready"]
  });
});

test("signals-queries can return a canceled result", async () => {
  const workflow = createHarness();
  const first = await workflow.step({ initiallyBlocked: false });
  const second = await workflow.step(mainSignal({ type: "block" }), first.state);
  const third = await workflow.step(
    mainSignal({ type: "addMessage", message: "operator canceled" }),
    second.state
  );

  const final = await workflow.step(mainSignal({ type: "cancel" }), third.state);
  assert.equal(final.state, "");
  assert.deepEqual(parseOutput(findOutput(final.outputs, "workflow-result")), {
    status: "canceled",
    blocked: true,
    history: ["block", "operator canceled"]
  });
});
