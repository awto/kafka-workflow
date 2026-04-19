const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  findOutput,
  parseOutput
} = require("../../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-hello-world",
    defaultThreadId: "hello-thread",
    stepMode: "state"
  });
}

test("hello-world emits one request and completes on reply", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-hello-world-greet",
    "workflow-error",
    "workflow-result"
  ]);

  const first = await workflow.step({ name: "Temporal" });
  const greet = findOutput(first.outputs, "temporal-hello-world-greet");
  assert.deepEqual(parseOutput(greet), {
    name: "Temporal",
    ref: parseOutput(greet).ref
  });

  const second = await workflow.step(
    {
      ref: parseOutput(greet).ref,
      value: { greeting: "Hello, Temporal" }
    },
    first.state
  );

  assert.equal(second.state, "");
  assert.deepEqual(parseOutput(findOutput(second.outputs, "workflow-result")), {
    greeting: "Hello, Temporal"
  });
});
