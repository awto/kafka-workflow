const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  findOutput,
  parseOutput
} = require("../../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-safe-message-handlers",
    defaultThreadId: "cluster-thread",
    stepMode: "state"
  });
}

test("safe-message-handlers serializes cluster commands in a direct workflow loop", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-safe-message-handlers-assign-nodes",
    "temporal-safe-message-handlers-shutdown-cluster",
    "temporal-safe-message-handlers-start-cluster",
    "temporal-safe-message-handlers-status",
    "temporal-safe-message-handlers-unassign-nodes",
    "workflow-error",
    "workflow-result"
  ]);

  const initial = await workflow.step({});
  const started = await workflow.step(
    { ref: "main", value: { type: "startCluster" } },
    initial.state
  );
  const startRequest = parseOutput(
    findOutput(started.outputs, "temporal-safe-message-handlers-start-cluster")
  );
  const afterStart = await workflow.step({ ref: startRequest.ref }, started.state);
  assert.deepEqual(
    parseOutput(findOutput(afterStart.outputs, "temporal-safe-message-handlers-status")),
    { maxAssignedNodes: 0, assignedNodes: 0 }
  );

  const assign = await workflow.step(
    { ref: "main", value: { type: "allocateNodesToJob", jobName: "job-a", numNodes: 3 } },
    afterStart.state
  );
  const assignRequest = parseOutput(
    findOutput(assign.outputs, "temporal-safe-message-handlers-assign-nodes")
  );
  assert.deepEqual(assignRequest.nodes, ["0", "1", "2"]);
  const afterAssign = await workflow.step({ ref: assignRequest.ref }, assign.state);
  assert.deepEqual(
    parseOutput(findOutput(afterAssign.outputs, "temporal-safe-message-handlers-status")),
    { maxAssignedNodes: 3, assignedNodes: 3 }
  );

  const query = await workflow.step(
    { ref: "main", value: { type: "getClusterStatus" } },
    afterAssign.state
  );
  assert.deepEqual(
    parseOutput(findOutput(query.outputs, "temporal-safe-message-handlers-status")),
    { maxAssignedNodes: 3, assignedNodes: 3 }
  );

  const deleted = await workflow.step(
    { ref: "main", value: { type: "deleteJob", jobName: "job-a" } },
    query.state
  );
  const deleteRequest = parseOutput(
    findOutput(deleted.outputs, "temporal-safe-message-handlers-unassign-nodes")
  );
  assert.deepEqual(deleteRequest.nodes, ["0", "1", "2"]);
  const afterDelete = await workflow.step({ ref: deleteRequest.ref }, deleted.state);
  assert.deepEqual(
    parseOutput(findOutput(afterDelete.outputs, "temporal-safe-message-handlers-status")),
    { maxAssignedNodes: 3, assignedNodes: 0 }
  );

  const shuttingDown = await workflow.step(
    { ref: "main", value: { type: "shutdownCluster" } },
    afterDelete.state
  );
  const shutdownRequest = parseOutput(
    findOutput(shuttingDown.outputs, "temporal-safe-message-handlers-shutdown-cluster")
  );
  const finished = await workflow.step({ ref: shutdownRequest.ref }, shuttingDown.state);
  assert.deepEqual(
    parseOutput(findOutput(finished.outputs, "workflow-result")),
    { maxAssignedNodes: 3, assignedNodes: 0 }
  );
});

test("safe-message-handlers rejects impossible allocations", async () => {
  const workflow = createHarness();
  const initial = await workflow.step({}, "", "cluster-thread-2");
  const started = await workflow.step(
    { ref: "main", value: { type: "startCluster" } },
    initial.state,
    "cluster-thread-2"
  );
  const startRequest = parseOutput(
    findOutput(started.outputs, "temporal-safe-message-handlers-start-cluster")
  );
  const afterStart = await workflow.step(
    { ref: startRequest.ref },
    started.state,
    "cluster-thread-2"
  );
  const failed = await workflow.step(
    {
      ref: "main",
      value: { type: "allocateNodesToJob", jobName: "job-a", numNodes: 30 }
    },
    afterStart.state,
    "cluster-thread-2"
  );
  assert.equal(
    findOutput(failed.outputs, "workflow-error").value,
    "\"Error: Cannot assign 30 nodes; have only 25 available\""
  );
});
