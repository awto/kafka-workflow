const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  externalOutputs,
  findOutput,
  parseOutput: parse
} = require("../../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-nexus-hello",
    defaultThreadId: "nexus-hello-thread",
    stepMode: "state"
  });
}

test("bundle exposes Nexus hello topics", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-nexus-hello-service-completed",
    "temporal-nexus-hello-start-operation",
    "workflow-error",
    "workflow-result"
  ]);
});

test("echo caller invokes a service operation through a durable ref", async () => {
  const workflow = createHarness();
  const started = await workflow.threadStep(
    {
      workflow: "echoCaller",
      message: "This message is from the client"
    },
    "echo-caller",
    true
  );

  assert.deepEqual(
    parse(findOutput(started.outputs, "temporal-nexus-hello-start-operation")),
    {
      operation: "echo",
      operationId: "echo:This message is from the client",
      message: "This message is from the client",
      ref: parse(findOutput(started.outputs, "temporal-nexus-hello-start-operation")).ref
    }
  );

  const drained = [
    ...externalOutputs(started.outputs),
    ...(await workflow.drainInternal(started.outputs))
  ];
  assert.deepEqual(
    parse(findOutput(drained, "temporal-nexus-hello-service-completed")),
    {
      operationId: "echo:This message is from the client",
      result: {
        message: "This message is from the client"
      }
    }
  );
  assert.deepEqual(parse(findOutput(drained, "workflow-result")), {
    message: "This message is from the client"
  });

  const callerResult = parse(
    drained.filter((output) => output.topic === "workflow-result")[1]
  );
  assert.equal(callerResult, "This message is from the client");
});

test("hello caller invokes a service workflow through a durable ref", async () => {
  const workflow = createHarness();
  const started = await workflow.threadStep(
    {
      workflow: "helloCaller",
      name: "Temporal",
      language: "fr"
    },
    "hello-caller",
    true
  );
  const operation = parse(
    findOutput(started.outputs, "temporal-nexus-hello-start-operation")
  );
  assert.deepEqual(operation, {
    operation: "hello",
    operationId: "hello:Temporal:fr",
    name: "Temporal",
    language: "fr",
    ref: operation.ref
  });

  const drained = await workflow.drainInternal(started.outputs);
  assert.deepEqual(
    parse(findOutput(drained, "temporal-nexus-hello-service-completed")),
    {
      operationId: "hello:Temporal:fr",
      result: {
        message: "Bonjour, Temporal!"
      }
    }
  );
  assert.equal(
    parse(drained.filter((output) => output.topic === "workflow-result")[1]),
    "Bonjour, Temporal!"
  );
});

test("hello service workflow remains plain code", async () => {
  const workflow = createHarness();
  const result = await workflow.step(
    {
      workflow: "helloWorkflow",
      name: "Ada",
      language: "tr"
    },
    "",
    "hello-service"
  );
  assert.equal(result.state, "");
  assert.deepEqual(parse(findOutput(result.outputs, "workflow-result")), {
    message: "Merhaba, Ada!"
  });
});

test("echo service workflow remains plain code", async () => {
  const workflow = createHarness();
  const result = await workflow.step(
    {
      workflow: "echoService",
      operationId: "echo:direct",
      message: "Direct service call"
    },
    "",
    "echo-service"
  );
  assert.equal(result.state, "");
  assert.deepEqual(parse(findOutput(result.outputs, "workflow-result")), {
    message: "Direct service call"
  });
  assert.deepEqual(
    parse(findOutput(result.outputs, "temporal-nexus-hello-service-completed")),
    {
      operationId: "echo:direct",
      result: { message: "Direct service call" }
    }
  );
});
