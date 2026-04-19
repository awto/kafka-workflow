const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  externalOutputs,
  findOutput,
  parseOutput: parse
} = require("../../../_test/workflow-harness");

const WORKFLOW = "temporal-patching-api";

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-patching-api",
    defaultThreadId: "customer-1",
    stepMode: "thread"
  });
}

function version(major, minor, patch) {
  return { major, minor, patch };
}

function startEnvelope(v, bookingId = "customer-1") {
  return {
    workflow: WORKFLOW,
    version: v,
    kind: "start",
    bookingId,
    payload: {
      customerId: bookingId
    }
  };
}

function upgradeManagerEnvelope(targetVersion, targets) {
  return {
    workflow: "versioning-upgrade-manager",
    command: {
      workflow: WORKFLOW,
      targetVersion,
      targets
    }
  };
}

test("bundle exposes patching and versioning topics", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-patching-api-await-complete",
    "temporal-patching-api-charge",
    "temporal-patching-api-send-receipt",
    "versioning-await-upgrade",
    "versioning-handoff",
    "versioning-upgrade-dispatch",
    "workflow-error",
    "workflow-result"
  ]);
});

test("minor upgrade replaces patch marker flow with versioned handoff", async () => {
  const workflow = createHarness();
  const first = await workflow.step(startEnvelope(version(1, 0, 0)), "customer-1", true);
  const charge = parse(findOutput(first.outputs, "temporal-patching-api-charge"));

  const second = await workflow.step({ ref: charge.ref, value: { ok: true } }, "customer-1");
  const upgrade = parse(findOutput(second.outputs, "versioning-await-upgrade"));
  parse(findOutput(second.outputs, "temporal-patching-api-await-complete"));

  const manager = await workflow.step(
    upgradeManagerEnvelope(version(1, 1, 0), [
      {
        bookingId: "customer-1",
        ref: upgrade.ref
      }
    ]),
    "upgrade-1",
    true
  );
  const managerOutputs = [
    ...externalOutputs(manager.outputs),
    ...(await workflow.drainInternal(manager.outputs))
  ];

  assert.deepEqual(parse(findOutput(managerOutputs, "versioning-upgrade-dispatch")), {
    bookingId: "customer-1",
    ref: upgrade.ref,
    targetVersion: version(1, 1, 0)
  });

  const handoff = parse(findOutput(managerOutputs, "versioning-handoff"));
  assert.deepEqual(handoff.payload.input, {
    customerId: "customer-1",
    chargeId: "customer-1:charge",
    charged: true,
    receiptSent: false
  });

  const adopted = await workflow.step(handoff, "customer-1", true);
  const receipt = parse(findOutput(adopted.outputs, "temporal-patching-api-send-receipt"));
  assert.equal(findOutput(adopted.outputs, "temporal-patching-api-charge"), undefined);

  const afterReceipt = await workflow.step(
    { ref: receipt.ref, value: { ok: true } },
    "customer-1"
  );
  const complete = parse(
    findOutput(afterReceipt.outputs, "temporal-patching-api-await-complete")
  );

  const finished = await workflow.step(
    { ref: complete.ref, value: { done: true } },
    "customer-1"
  );
  assert.equal(finished.state, "");
  assert.deepEqual(parse(findOutput(finished.outputs, "workflow-result")), {
    version: version(1, 1, 0),
    customerId: "customer-1",
    chargeId: "customer-1:charge",
    receiptSent: true
  });
});

test("patch changes run latest code without upgrade", async () => {
  const workflow = createHarness();
  const first = await workflow.step(startEnvelope(version(1, 1, 7), "customer-2"), "customer-2", true);
  assert.equal(findOutput(first.outputs, "versioning-await-upgrade"), undefined);
  const charge = parse(findOutput(first.outputs, "temporal-patching-api-charge"));

  const second = await workflow.step({ ref: charge.ref, value: { ok: true } }, "customer-2");
  const receipt = parse(findOutput(second.outputs, "temporal-patching-api-send-receipt"));

  const third = await workflow.step({ ref: receipt.ref, value: { ok: true } }, "customer-2");
  const complete = parse(findOutput(third.outputs, "temporal-patching-api-await-complete"));

  const finished = await workflow.step(
    { ref: complete.ref, value: { done: true } },
    "customer-2"
  );
  assert.equal(finished.state, "");
  assert.deepEqual(parse(findOutput(finished.outputs, "workflow-result")), {
    version: version(1, 1, 0),
    customerId: "customer-2",
    chargeId: "customer-2:charge",
    receiptSent: true
  });
});
