const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  findOutput,
  parseOutput
} = require("../../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-execute-update",
    defaultThreadId: "execute-update-thread",
    stepMode: "state"
  });
}

test("execute-update replies with previous count and rejects negatives", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-execute-update-reply",
    "workflow-error",
    "workflow-result"
  ]);

  const started = await workflow.step({});
  assert.equal(started.outputs.length, 0);

  const firstUpdate = await workflow.step(
    {
      ref: "main",
      value: { type: "fetchAndAdd", arg: 4, reply: "update-1" }
    },
    started.state
  );
  assert.deepEqual(
    parseOutput(findOutput(firstUpdate.outputs, "temporal-execute-update-reply")),
    { reply: "update-1", value: 0 }
  );

  const secondUpdate = await workflow.step(
    {
      ref: "main",
      value: { type: "fetchAndAdd", arg: 7, reply: "update-2" }
    },
    firstUpdate.state
  );
  assert.deepEqual(
    parseOutput(findOutput(secondUpdate.outputs, "temporal-execute-update-reply")),
    { reply: "update-2", value: 4 }
  );

  const rejected = await workflow.step(
    {
      ref: "main",
      value: { type: "fetchAndAdd", arg: -1, reply: "update-3" }
    },
    secondUpdate.state
  );
  assert.deepEqual(
    parseOutput(findOutput(rejected.outputs, "temporal-execute-update-reply")),
    { reply: "update-3", error: "Argument must not be negative" }
  );

  const finalUpdate = await workflow.step(
    {
      ref: "main",
      value: { type: "fetchAndAdd", arg: 2, reply: "update-4" }
    },
    rejected.state
  );
  assert.deepEqual(
    parseOutput(findOutput(finalUpdate.outputs, "temporal-execute-update-reply")),
    { reply: "update-4", value: 11 }
  );

  const finished = await workflow.step(
    {
      ref: "main",
      value: { type: "done" }
    },
    finalUpdate.state
  );
  assert.equal(finished.state, "");
  assert.deepEqual(parseOutput(findOutput(finished.outputs, "workflow-result")), 13);
});
