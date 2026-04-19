const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  findOutput,
  parseOutput
} = require("../../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-message-introduction",
    defaultThreadId: "message-introduction-thread",
    stepMode: "state"
  });
}

test("message introduction handles queries, updates, async updates, and approval", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-message-introduction-greeting-service",
    "temporal-message-introduction-reply",
    "workflow-error",
    "workflow-result"
  ]);

  const started = await workflow.step({});
  assert.equal(started.outputs.length, 0);

  const supported = await workflow.step(
    {
      ref: "main",
      value: {
        type: "getLanguages",
        includeUnsupported: false,
        reply: "supported"
      }
    },
    started.state
  );
  assert.deepEqual(
    parseOutput(findOutput(supported.outputs, "temporal-message-introduction-reply")),
    { reply: "supported", value: ["CHINESE", "ENGLISH"] }
  );

  const setChinese = await workflow.step(
    {
      ref: "main",
      value: {
        type: "setLanguage",
        language: "CHINESE",
        reply: "set-1"
      }
    },
    supported.state
  );
  assert.deepEqual(
    parseOutput(findOutput(setChinese.outputs, "temporal-message-introduction-reply")),
    { reply: "set-1", value: "ENGLISH" }
  );

  const invalid = await workflow.step(
    {
      ref: "main",
      value: {
        type: "setLanguage",
        language: "PORTUGUESE",
        reply: "set-2"
      }
    },
    setChinese.state
  );
  assert.deepEqual(
    parseOutput(findOutput(invalid.outputs, "temporal-message-introduction-reply")),
    { reply: "set-2", error: "PORTUGUESE is not supported" }
  );

  const asyncUpdate = await workflow.step(
    {
      ref: "main",
      value: {
        type: "setLanguageUsingActivity",
        language: "ARABIC",
        reply: "set-3"
      }
    },
    invalid.state
  );
  const greetingService = findOutput(
    asyncUpdate.outputs,
    "temporal-message-introduction-greeting-service"
  );
  const greetingRequest = parseOutput(greetingService);
  assert.equal(greetingRequest.language, "ARABIC");

  const asyncResolved = await workflow.step(
    {
      ref: greetingRequest.ref,
      value: { greeting: "مرحبا بالعالم" }
    },
    asyncUpdate.state
  );
  assert.deepEqual(
    parseOutput(findOutput(asyncResolved.outputs, "temporal-message-introduction-reply")),
    { reply: "set-3", value: "CHINESE" }
  );

  const current = await workflow.step(
    {
      ref: "main",
      value: {
        type: "getLanguage",
        reply: "current"
      }
    },
    asyncResolved.state
  );
  assert.deepEqual(
    parseOutput(findOutput(current.outputs, "temporal-message-introduction-reply")),
    { reply: "current", value: "ARABIC" }
  );

  const finished = await workflow.step(
    {
      ref: "main",
      value: {
        type: "approve",
        name: "test-approver"
      }
    },
    current.state
  );
  assert.equal(finished.state, "");
  assert.equal(
    parseOutput(findOutput(finished.outputs, "workflow-result")),
    "مرحبا بالعالم"
  );
});
