const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  findOutput,
  parseOutput: parse
} = require("../../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-nexus-cancellation",
    defaultThreadId: "nexus-cancel-thread",
    stepMode: "state"
  });
}

test("bundle exposes Nexus cancellation topics", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-nexus-cancel-await-cancel",
    "temporal-nexus-cancel-cancel-operation",
    "temporal-nexus-cancel-start-operation",
    "workflow-error",
    "workflow-result"
  ]);
});

test("caller cancels an in-flight operation when cancel wins the race", async () => {
  const workflow = createHarness();
  const first = await workflow.step({ name: "Ada", language: "fr" });
  const operation = parse(findOutput(first.outputs, "temporal-nexus-cancel-start-operation"));
  const cancel = parse(findOutput(first.outputs, "temporal-nexus-cancel-await-cancel"));

  assert.deepEqual(operation, {
    operationId: "Ada:fr:hello",
    ref: operation.ref,
    name: "Ada",
    language: "fr"
  });

  const cancelled = await workflow.step(
    { ref: cancel.ref, value: { reason: "operator requested" } },
    first.state
  );
  assert.equal(cancelled.state, "");
  assert.deepEqual(parse(findOutput(cancelled.outputs, "temporal-nexus-cancel-cancel-operation")), {
    operationId: "Ada:fr:hello",
    ref: operation.ref
  });
  assert.deepEqual(parse(findOutput(cancelled.outputs, "workflow-result")), {
    status: "cancelled",
    reason: "operator requested"
  });
});

test("caller returns operation result when operation completes first", async () => {
  const workflow = createHarness();
  const first = await workflow.step({ name: "Ada", language: "fr" }, "", "nexus-complete-thread");
  const operation = parse(findOutput(first.outputs, "temporal-nexus-cancel-start-operation"));

  const completed = await workflow.step(
    { ref: operation.ref, value: { message: "Bonjour, Ada!" } },
    first.state,
    "nexus-complete-thread"
  );
  assert.equal(completed.state, "");
  assert.equal(findOutput(completed.outputs, "temporal-nexus-cancel-cancel-operation"), undefined);
  assert.deepEqual(parse(findOutput(completed.outputs, "workflow-result")), "Bonjour, Ada!");
});

test("service workflow remains plain code", async () => {
  const workflow = createHarness();
  const result = await workflow.step(
    { kind: "service", name: "Ada", language: "tr" },
    "",
    "nexus-service-thread"
  );
  assert.equal(result.state, "");
  assert.deepEqual(parse(findOutput(result.outputs, "workflow-result")), {
    message: "Merhaba, Ada!"
  });
});
