const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  findOutput,
  parseOutput
} = require("../../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-state",
    defaultThreadId: "state-thread",
    stepMode: "state"
  });
}

test("state handles set, query, and cancel in one loop", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-state-query-result",
    "workflow-error",
    "workflow-result"
  ]);

  const started = await workflow.step({});
  assert.equal(started.outputs.length, 0);

  const firstQuery = await workflow.step(
    {
      ref: "main",
      value: { type: "getValue", key: "meaning", reply: "query-1" }
    },
    started.state
  );
  assert.deepEqual(
    parseOutput(findOutput(firstQuery.outputs, "temporal-state-query-result")),
    { reply: "query-1", key: "meaning" }
  );

  const updated = await workflow.step(
    {
      ref: "main",
      value: { type: "setValue", key: "meaning", value: 42 }
    },
    firstQuery.state
  );
  assert.equal(updated.outputs.length, 0);

  const secondQuery = await workflow.step(
    {
      ref: "main",
      value: { type: "getValue", key: "meaning", reply: "query-2" }
    },
    updated.state
  );
  assert.deepEqual(
    parseOutput(findOutput(secondQuery.outputs, "temporal-state-query-result")),
    { reply: "query-2", key: "meaning", value: 42 }
  );

  const finished = await workflow.step(
    {
      ref: "main",
      value: { type: "cancel" }
    },
    secondQuery.state
  );
  assert.equal(finished.state, "");
  assert.deepEqual(
    parseOutput(findOutput(finished.outputs, "workflow-result")),
    { entries: { meaning: 42 } }
  );
});
