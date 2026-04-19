const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  collectOutputs,
  externalOutputs,
  findOutput,
  findOutputByKey,
  parseOutput
} = require("../../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-child-workflows",
    defaultThreadId: "parent-1",
    stepMode: "thread"
  });
}

test("child-workflows starts children and combines their results", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-child-workflows-child-completed",
    "temporal-child-workflows-request",
    "workflow-error",
    "workflow-result"
  ]);

  const first = await workflow.step(
    {
      workflow: "parent",
      payload: { names: ["Alice", "Bob", "Charlie"] }
    },
    "parent-1",
    true
  );
  const initial = await workflow.drainInternal(first.outputs);
  const requests = collectOutputs(initial, "temporal-child-workflows-request").map(parseOutput);
  assert.deepEqual(
    requests.map((request) => request.name),
    ["Alice", "Bob", "Charlie"]
  );

  const completeChild = async (request) => {
    const childResult = await workflow.step(
      {
        ref: request.completeRef,
        value: { message: `I am a child named ${request.name}` }
      },
      request.childThreadId
    );
    return [
      ...externalOutputs(childResult.outputs),
      ...(await workflow.drainInternal(childResult.outputs))
    ];
  };

  const outputs = [
    ...(await completeChild(requests[0])),
    ...(await completeChild(requests[1])),
    ...(await completeChild(requests[2]))
  ];
  const childCompletions = collectOutputs(
    outputs,
    "temporal-child-workflows-child-completed"
  ).map(parseOutput);
  assert.deepEqual(
    childCompletions.map((completion) => completion.name),
    ["Alice", "Bob", "Charlie"]
  );

  assert.equal(
    parseOutput(findOutputByKey(outputs, "workflow-result", "parent-1")),
    "I am a child named Alice\nI am a child named Bob\nI am a child named Charlie"
  );
});
