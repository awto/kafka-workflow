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
    bundle: "temporal-food-delivery",
    defaultThreadId: "food-order-1",
    stepMode: "state"
  });
}

function findActiveSchedulerOutput(outputs) {
  return outputs.find(
    (output) => output.topic === "workflow-scheduler" && output.value !== "0"
  );
}

test("food-delivery exposes current paid state via query", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-food-delivery-charge-customer",
    "temporal-food-delivery-push-notification",
    "temporal-food-delivery-refund-order",
    "temporal-food-delivery-status",
    "workflow-error",
    "workflow-result",
    "workflow-scheduler"
  ]);

  const first = await workflow.step({
    productId: 1,
    pickupTimeoutMS: 50,
    deliveryTimeoutMS: 50,
    ratingDelayMS: 20
  });
  assert.deepEqual(parseOutput(findOutput(first.outputs, "temporal-food-delivery-charge-customer")), {
    id: 1,
    name: "Burger"
  });

  const second = await workflow.step({ ref: "main", value: { type: "query" } }, first.state);
  assert.deepEqual(parseOutput(findOutput(second.outputs, "temporal-food-delivery-status")), {
    productId: 1,
    state: "Paid"
  });
});

test("food-delivery completes after pickup, delivery, and rating timeout", async () => {
  const workflow = createHarness();
  const first = await workflow.step({
    productId: 2,
    pickupTimeoutMS: 50,
    deliveryTimeoutMS: 50,
    ratingDelayMS: 20
  });

  const second = await workflow.step(
    { ref: "main", value: { type: "pickedUp" } },
    first.state
  );
  assert.deepEqual(
    collectOutputs(second.outputs, "temporal-food-delivery-push-notification").map((output) => output.value),
    ["🚗 Order picked up"]
  );

  const third = await workflow.step(
    { ref: "main", value: { type: "delivered" } },
    second.state
  );
  assert.deepEqual(
    collectOutputs(third.outputs, "temporal-food-delivery-push-notification").map((output) => output.value),
    ["✅ Order delivered!"]
  );

  const fourth = await workflow.step(
    schedulerResume(findActiveSchedulerOutput(third.outputs)),
    third.state
  );
  assert.deepEqual(
    collectOutputs(fourth.outputs, "temporal-food-delivery-push-notification").map((output) => output.value),
    ["✍️ Rate your meal. How was the pizza?"]
  );
  const result = parseOutput(findOutput(fourth.outputs, "workflow-result"));
  assert.equal(result.productId, 2);
  assert.equal(result.state, "Delivered");
  assert.equal(typeof result.deliveredAt, "string");
});

test("food-delivery refunds if nobody picks up in time", async () => {
  const workflow = createHarness();
  const first = await workflow.step({
    productId: 3,
    pickupTimeoutMS: 50,
    deliveryTimeoutMS: 50,
    ratingDelayMS: 20
  });

  const second = await workflow.step(
    schedulerResume(findActiveSchedulerOutput(first.outputs)),
    first.state
  );
  assert.deepEqual(parseOutput(findOutput(second.outputs, "temporal-food-delivery-refund-order")), {
    id: 3,
    name: "Salad"
  });
  assert.deepEqual(
    collectOutputs(second.outputs, "temporal-food-delivery-push-notification").map((output) => output.value),
    ["⚠️ No drivers were available to pick up your order. Your payment has been refunded."]
  );
  assert.equal(
    findOutput(second.outputs, "workflow-error").value,
    "\"Error: Not picked up in time\""
  );
});

test("food-delivery refunds if delivery takes too long", async () => {
  const workflow = createHarness();
  const first = await workflow.step({
    productId: 1,
    pickupTimeoutMS: 50,
    deliveryTimeoutMS: 50,
    ratingDelayMS: 20
  });
  const second = await workflow.step(
    { ref: "main", value: { type: "pickedUp" } },
    first.state
  );
  const third = await workflow.step(
    schedulerResume(findActiveSchedulerOutput(second.outputs)),
    second.state
  );
  assert.deepEqual(parseOutput(findOutput(third.outputs, "temporal-food-delivery-refund-order")), {
    id: 1,
    name: "Burger"
  });
  assert.deepEqual(
    collectOutputs(third.outputs, "temporal-food-delivery-push-notification").map((output) => output.value),
    [
      "⚠️ Your driver was unable to deliver your order. Your payment has been refunded."
    ]
  );
  assert.equal(
    findOutput(third.outputs, "workflow-error").value,
    "\"Error: Not delivered in time\""
  );
});
