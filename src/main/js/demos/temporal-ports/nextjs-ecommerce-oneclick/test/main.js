const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  findOutput,
  parseOutput,
  resumeEventFromKey: schedulerResume
} = require("../../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-nextjs-ecommerce-oneclick",
    defaultThreadId: "oneclick-thread",
    stepMode: "state"
  });
}

test("oneclick-ecommerce returns purchase state while pending", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-nextjs-ecommerce-oneclick-canceled",
    "temporal-nextjs-ecommerce-oneclick-checkout",
    "temporal-nextjs-ecommerce-oneclick-state",
    "workflow-error",
    "workflow-result",
    "workflow-scheduler"
  ]);

  const first = await workflow.step({
    itemId: "sku-1",
    confirmationWindowMS: 50
  });
  const second = await workflow.step({ ref: "main", value: { type: "query" } }, first.state);
  assert.deepEqual(parseOutput(findOutput(second.outputs, "temporal-nextjs-ecommerce-oneclick-state")), {
    itemId: "sku-1",
    purchaseState: "PURCHASE_PENDING"
  });
  assert.equal(second.state.length > 0, true);
});

test("oneclick-ecommerce cancels before confirmation timeout", async () => {
  const workflow = createHarness();
  const first = await workflow.step({
    itemId: "sku-2",
    confirmationWindowMS: 50
  });
  const second = await workflow.step(
    { ref: "main", value: { type: "cancelPurchase" } },
    first.state
  );
  assert.equal(findOutput(second.outputs, "workflow-scheduler").value, "0");
  assert.deepEqual(parseOutput(findOutput(second.outputs, "temporal-nextjs-ecommerce-oneclick-canceled")), {
    itemId: "sku-2",
    purchaseState: "PURCHASE_CANCELED"
  });
  assert.deepEqual(parseOutput(findOutput(second.outputs, "workflow-result")), {
    itemId: "sku-2",
    purchaseState: "PURCHASE_CANCELED"
  });
});

test("oneclick-ecommerce confirms after the timeout window", async () => {
  const workflow = createHarness();
  const first = await workflow.step({
    itemId: "sku-3",
    confirmationWindowMS: 50
  });
  const second = await workflow.step(
    schedulerResume(findOutput(first.outputs, "workflow-scheduler")),
    first.state
  );
  assert.deepEqual(parseOutput(findOutput(second.outputs, "temporal-nextjs-ecommerce-oneclick-checkout")), {
    itemId: "sku-3",
    purchaseState: "PURCHASE_CONFIRMED"
  });
  assert.deepEqual(parseOutput(findOutput(second.outputs, "workflow-result")), {
    itemId: "sku-3",
    purchaseState: "PURCHASE_CONFIRMED"
  });
});
