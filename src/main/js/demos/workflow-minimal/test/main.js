const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  findOutput,
  parseOutput
} = require("../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "minimal",
    defaultThreadId: "minimal-thread",
    stepMode: "state"
  });
}

test("minimal workflow waits for one external reply", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "minimal-greeting-request",
    "workflow-error",
    "workflow-result"
  ]);

  const first = await workflow.step({ name: "Ada" });
  const request = parseOutput(findOutput(first.outputs, "minimal-greeting-request"));
  assert.deepEqual(request, {
    name: "Ada",
    ref: request.ref
  });
  assert.notEqual(first.state, "");

  const second = await workflow.step(
    {
      ref: request.ref,
      value: { greeting: "Hello, Ada" }
    },
    first.state
  );

  assert.equal(second.state, "");
  assert.deepEqual(parseOutput(findOutput(second.outputs, "workflow-result")), {
    greeting: "Hello, Ada"
  });
});
