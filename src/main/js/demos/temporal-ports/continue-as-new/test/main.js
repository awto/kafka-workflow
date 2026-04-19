const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  collectOutputs,
  findOutput,
  parseOutput,
  resumeEventFromKey: schedulerResume
} = require("../../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-continue-as-new",
    defaultThreadId: "continue-as-new-thread",
    stepMode: "state"
  });
}

test("continue-as-new loops durably until the final iteration", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-continue-as-new-iteration",
    "workflow-error",
    "workflow-result",
    "workflow-scheduler"
  ]);

  let result = await workflow.step({
    iteration: 0,
    maxIterations: 3,
    delayMS: 10
  });
  const iterations = [
    parseOutput(findOutput(result.outputs, "temporal-continue-as-new-iteration")).iteration
  ];

  while (findOutput(result.outputs, "workflow-scheduler")) {
    result = await workflow.step(
      schedulerResume(findOutput(result.outputs, "workflow-scheduler")),
      result.state
    );
    const output = findOutput(result.outputs, "temporal-continue-as-new-iteration");
    if (output) {
      iterations.push(parseOutput(output).iteration);
    }
  }

  assert.deepEqual(iterations, [0, 1, 2]);
  assert.deepEqual(parseOutput(findOutput(result.outputs, "workflow-result")), {
    iterations: 3,
    status: "completed"
  });
  assert.equal(collectOutputs(result.outputs, "workflow-scheduler").length, 0);
});
