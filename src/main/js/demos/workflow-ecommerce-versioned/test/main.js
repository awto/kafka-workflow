const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  externalOutputs,
  findOutput,
  parseOutput,
  resumeEventFromKey: timeoutResume
} = require("../../_test/workflow-harness");

const WORKFLOW = "ecommerce-versioned";

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "ecommerce-versioned",
    defaultThreadId: "cart-1",
    stepMode: "thread"
  });
}

function version(major, minor, patch) {
  return { major, minor, patch };
}

function startEnvelope(v, bookingId = "cart-1") {
  return {
    workflow: WORKFLOW,
    version: v,
    kind: "start",
    bookingId,
    payload: {
      abandonedCartTimeoutMS: 50
    }
  };
}

function mainSignal(value) {
  return { ref: "main", value };
}

function upgradeManagerEnvelope(workflow, targetVersion, targets) {
  return {
    workflow: "versioning-upgrade-manager",
    command: {
      workflow,
      targetVersion,
      targets
    }
  };
}

test("bundle exposes versioning topics", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "checkoutError",
    "ecommerce-discount-reminder",
    "ecommerce-reminder",
    "ecommerce-v2-reminder",
    "getCart",
    "versioning-await-upgrade",
    "versioning-handoff",
    "versioning-upgrade-dispatch",
    "workflow-error",
    "workflow-result",
    "workflow-scheduler"
  ]);
});

test("minor upgrade hands off cart state and v1.1 adds a discount reminder", async () => {
  const workflow = createHarness();
  const first = await workflow.step(startEnvelope(version(1, 0, 0)), "cart-1", true);
  await workflow.drainInternal(first.outputs);

  const second = await workflow.step(
    mainSignal({
      type: "addToCart",
      item: { productId: "teapot", quantity: 2 }
    }),
    "cart-1"
  );
  const third = await workflow.step(
    mainSignal({ type: "updateEmail", email: "cart@example.com" }),
    "cart-1"
  );
  const fourth = await workflow.step(
    timeoutResume(findOutput(third.outputs, "workflow-scheduler")),
    "cart-1"
  );
  assert.equal(findOutput(fourth.outputs, "ecommerce-reminder").value, "cart@example.com");

  const manager = await workflow.step(
    upgradeManagerEnvelope(WORKFLOW, version(1, 1, 0), [
      { bookingId: "cart-1", ref: "main" }
    ]),
    "cart-upgrade",
    true
  );
  const managerOutputs = [
    ...externalOutputs(manager.outputs),
    ...(await workflow.drainInternal(manager.outputs))
  ];
  const handoff = parseOutput(findOutput(managerOutputs, "versioning-handoff"));
  assert.deepEqual(handoff.payload.input, {
    config: { abandonedCartTimeoutMS: 50 },
    items: [{ productId: "teapot", quantity: 2 }],
    email: "cart@example.com",
    reminderStage: 1
  });

  const fifth = await workflow.step(handoff, "cart-1", true);
  const sixth = await workflow.step(
    timeoutResume(findOutput(fifth.outputs, "workflow-scheduler")),
    "cart-1"
  );
  assert.deepEqual(
    parseOutput(findOutput(sixth.outputs, "ecommerce-discount-reminder")),
    {
      email: "cart@example.com",
      code: "SAVE10"
    }
  );

  const final = await workflow.step(mainSignal({ type: "checkout" }), "cart-1");
  assert.equal(final.state, "");
  assert.deepEqual(parseOutput(findOutput(final.outputs, "workflow-result")), {
    version: version(1, 1, 0),
    email: "cart@example.com",
    items: [{ productId: "teapot", quantity: 2 }],
    discountCode: "SAVE10"
  });
});

test("patch changes do not require upgrade flow", async () => {
  const workflow = createHarness();
  const first = await workflow.step(startEnvelope(version(1, 1, 9), "cart-patch"), "cart-patch", true);
  assert.equal(findOutput(first.outputs, "versioning-await-upgrade"), undefined);

  const second = await workflow.step(
    mainSignal({
      type: "addToCart",
      item: { productId: "sugar", quantity: 1 }
    }),
    "cart-patch"
  );
  const third = await workflow.step(
    mainSignal({ type: "updateEmail", email: "patch@example.com" }),
    "cart-patch"
  );
  const final = await workflow.step(mainSignal({ type: "checkout" }), "cart-patch");

  assert.equal(second.state === "", false);
  assert.equal(third.state === "", false);
  assert.deepEqual(parseOutput(findOutput(final.outputs, "workflow-result")), {
    version: version(1, 1, 0),
    email: "patch@example.com",
    items: [{ productId: "sugar", quantity: 1 }]
  });
});

test("major 2 starts a fresh workflow", async () => {
  const workflow = createHarness();
  const first = await workflow.step(startEnvelope(version(2, 0, 0), "cart-major"), "cart-major", true);
  assert.equal(findOutput(first.outputs, "versioning-await-upgrade"), undefined);

  const second = await workflow.step(
    mainSignal({
      type: "addToCart",
      item: { productId: "coffee", quantity: 4 }
    }),
    "cart-major"
  );
  const third = await workflow.step(
    mainSignal({ type: "updateEmail", email: "major@example.com" }),
    "cart-major"
  );
  const fourth = await workflow.step(
    timeoutResume(findOutput(third.outputs, "workflow-scheduler")),
    "cart-major"
  );
  assert.deepEqual(parseOutput(findOutput(fourth.outputs, "ecommerce-v2-reminder")), {
    email: "major@example.com",
    channel: "sms"
  });

  const final = await workflow.step(mainSignal({ type: "checkout" }), "cart-major");
  assert.deepEqual(parseOutput(findOutput(final.outputs, "workflow-result")), {
    version: version(2, 0, 0),
    email: "major@example.com",
    items: [{ productId: "coffee", quantity: 4 }],
    channel: "v2"
  });
  assert.equal(second.state === "", false);
});
