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
    bundle: "temporal-query-subscriptions",
    defaultThreadId: "counter-thread",
    stepMode: "state"
  });
}

test("query-subscriptions publishes each state update directly from workflow code", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-query-subscriptions-state",
    "workflow-error",
    "workflow-result",
    "workflow-scheduler"
  ]);

  let result = await workflow.step({
    initialValue: 0,
    iterations: 3,
    tickMS: 10
  });
  const states = [
    parseOutput(findOutput(result.outputs, "temporal-query-subscriptions-state"))
  ];

  while (findOutput(result.outputs, "workflow-scheduler")) {
    result = await workflow.step(
      schedulerResume(findOutput(result.outputs, "workflow-scheduler")),
      result.state
    );
    states.push(
      ...collectOutputs(result.outputs, "temporal-query-subscriptions-state").map(
        parseOutput
      )
    );
  }

  assert.deepEqual(states, [
    { version: 0, value: 0 },
    { version: 1, value: 10 },
    { version: 2, value: 20 },
    { version: 3, value: 30 }
  ]);
  assert.equal(parseOutput(findOutput(result.outputs, "workflow-result")), 30);
});
