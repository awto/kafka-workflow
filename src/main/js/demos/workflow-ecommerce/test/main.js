const test = require("node:test");
const assert = require("node:assert/strict");
const {
  collectOutputs,
  createWorkflowHarness,
  findOutput,
  parseOutput,
  resumeEventFromKey: timeoutResume
} = require("../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "ecommerce",
    defaultThreadId: "thread1",
    stepMode: "state"
  });
}

function collectValues(outputs, topic) {
  return collectOutputs(outputs, topic).map((output) => output.value);
}

function mainSignal(value) {
  return { ref: "main", value };
}

test("built bundle exposes expected topics and completes cart checkout", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "checkoutError",
    "ecommerce-reminder",
    "getCart",
    "workflow-error",
    "workflow-result",
    "workflow-scheduler"
  ]);

  const first = await workflow.step({ abandonedCartTimeoutMS: 50 });
  assert.equal(findOutput(first.outputs, "workflow-scheduler").value, "50");
  assert.deepEqual(timeoutResume(findOutput(first.outputs, "workflow-scheduler")), {
    ref: "main",
    value: { type: "timeout" }
  });

  const second = await workflow.step(mainSignal({ type: "checkout" }), first.state);
  assert.deepEqual(collectValues(second.outputs, "checkoutError"), [
    "Must have items to check out!"
  ]);

  const third = await workflow.step(
    mainSignal({ type: "updateEmail", email: "someone@example.com" }),
    second.state
  );
  const fourth = await workflow.step(mainSignal({ type: "checkout" }), third.state);
  assert.deepEqual(collectValues(fourth.outputs, "checkoutError"), [
    "Must have items to check out!"
  ]);

  const fifth = await workflow.step(
    mainSignal({
      type: "addToCart",
      item: { quantity: 10, productId: "teapot" }
    }),
    fourth.state
  );
  const sixth = await workflow.step(
    mainSignal({
      type: "addToCart",
      item: { quantity: 11, productId: "sigar" }
    }),
    fifth.state
  );
  const seventh = await workflow.step(
    mainSignal({
      type: "addToCart",
      item: { quantity: 20, productId: "teapot" }
    }),
    sixth.state
  );
  const eighth = await workflow.step(
    mainSignal({ type: "updateEmail", email: "someone.else@example.com" }),
    seventh.state
  );
  const ninth = await workflow.step(
    mainSignal({
      type: "removeFromCart",
      item: { quantity: 11, productId: "sigar" }
    }),
    eighth.state
  );
  const tenth = await workflow.step(
    mainSignal({
      type: "addToCart",
      item: { quantity: 2, productId: "sugar" }
    }),
    ninth.state
  );
  const final = await workflow.step(mainSignal({ type: "checkout" }), tenth.state);

  assert.equal(final.state, "");
  assert.equal(findOutput(final.outputs, "workflow-scheduler").value, "0");
  assert.deepEqual(parseOutput(findOutput(final.outputs, "workflow-result")), {
    email: "someone.else@example.com",
    items: [
      { productId: "teapot", quantity: 30 },
      { productId: "sugar", quantity: 2 }
    ]
  });
});

test("built bundle sends an abandoned-cart reminder and then resumes checkout", async () => {
  const workflow = createHarness();
  const first = await workflow.step({ abandonedCartTimeoutMS: 50 });
  const second = await workflow.step(
    mainSignal({ type: "updateEmail", email: "someone@example.com" }),
    first.state
  );
  const third = await workflow.step(
    timeoutResume(findOutput(second.outputs, "workflow-scheduler")),
    second.state
  );
  assert.deepEqual(collectValues(third.outputs, "ecommerce-reminder"), [
    "someone@example.com"
  ]);

  const fourth = await workflow.step(
    mainSignal({
      type: "addToCart",
      item: { quantity: 2, productId: "sugar" }
    }),
    third.state
  );
  const final = await workflow.step(mainSignal({ type: "checkout" }), fourth.state);

  assert.equal(final.state, "");
  assert.equal(findOutput(final.outputs, "workflow-scheduler").value, "0");
  assert.deepEqual(parseOutput(findOutput(final.outputs, "workflow-result")), {
    email: "someone@example.com",
    items: [{ productId: "sugar", quantity: 2 }]
  });
});

test("built bundle resolves to abandoned after two timeouts", async () => {
  const workflow = createHarness();
  const first = await workflow.step({ abandonedCartTimeoutMS: 50 });
  const second = await workflow.step(
    mainSignal({ type: "updateEmail", email: "someone@example.com" }),
    first.state
  );
  const third = await workflow.step(
    timeoutResume(findOutput(second.outputs, "workflow-scheduler")),
    second.state
  );
  const final = await workflow.step(
    timeoutResume(findOutput(third.outputs, "workflow-scheduler")),
    third.state
  );

  assert.equal(final.state, "");
  assert.equal(findOutput(final.outputs, "workflow-result").value, "\"abondoned\"");
});

test("built bundle reports the current cart state", async () => {
  const workflow = createHarness();
  const first = await workflow.step({ abandonedCartTimeoutMS: 50 });
  const second = await workflow.step(
    mainSignal({
      type: "addToCart",
      item: { quantity: 2, productId: "sugar" }
    }),
    first.state
  );
  const third = await workflow.step(
    mainSignal({ type: "updateEmail", email: "someone@example.com" }),
    second.state
  );
  const fourth = await workflow.step(mainSignal({ type: "getCart" }), third.state);

  assert.notEqual(fourth.state, "");
  assert.deepEqual(parseOutput(findOutput(fourth.outputs, "getCart")), {
    email: "someone@example.com",
    items: [{ productId: "sugar", quantity: 2 }]
  });
});
