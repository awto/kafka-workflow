import assert from "node:assert/strict";
import process from "node:process";

const WAIT_TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || "30000");
const WORKFLOW = "ecommerce-versioned";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function version(major, minor, patch) {
  return { major, minor, patch };
}

function newThread(value) {
  return `new:${JSON.stringify(value)}`;
}

function resumeValue(value) {
  return JSON.stringify({
    ref: "main",
    value
  });
}

function startEnvelope(
  threadId,
  timeoutMS = 200,
  workflowVersion = version(1, 0, 0)
) {
  return {
    workflow: WORKFLOW,
    version: workflowVersion,
    kind: "start",
    bookingId: threadId,
    payload: {
      abandonedCartTimeoutMS: timeoutMS
    }
  };
}

function upgradeManagerEnvelope(targetVersion, target) {
  return {
    workflow: "versioning-upgrade-manager",
    command: {
      workflow: WORKFLOW,
      targetVersion,
      targets: [target]
    }
  };
}

function parseJson(record) {
  return JSON.parse(record.value);
}

function matchJson(predicate) {
  return (record) => {
    try {
      return predicate(parseJson(record), record);
    } catch (_error) {
      return false;
    }
  };
}

async function nextJson(harness, topic, predicate, timeoutMs = WAIT_TIMEOUT_MS) {
  const record = await harness.next(topic, matchJson(predicate), timeoutMs);
  return {
    record,
    value: parseJson(record)
  };
}

function noJson(predicate) {
  return (record) => {
    try {
      return predicate(parseJson(record), record);
    } catch (_error) {
      return false;
    }
  };
}

async function expectNoJson(harness, topic, predicate, quietMs = 750) {
  await harness.expectNone(topic, noJson(predicate), quietMs);
}

async function dispatchManagedUpgrade(harness, threadId, targetVersion, target) {
  const managerThreadId = `upgrade-manager:${threadId}`;
  await harness.send(
    "workflow-resume",
    managerThreadId,
    newThread(upgradeManagerEnvelope(targetVersion, target))
  );
  return (
    await nextJson(
      harness,
      "workflow-result",
      (value, record) =>
        record.key === managerThreadId &&
        value.targetVersion?.major === targetVersion.major &&
        value.targetVersion?.minor === targetVersion.minor
    )
  ).value;
}

export async function runMinorUpgradeAdoption(
  harness,
  {
    threadId = "ecommerce-versioned-upgrade",
    timeoutMS = 5000,
    onStep = async () => {}
  } = {}
) {
  await harness.send(
    "workflow-resume",
    threadId,
    newThread(startEnvelope(threadId, timeoutMS))
  );

  const upgrade = (
    await nextJson(
      harness,
      "versioning-await-upgrade",
      (value, record) => record.key === threadId && value.currentVersion.minor === 0
    )
  ).value;
  assert.equal(upgrade.ref, "main");

  const timeout = await harness.next(
    "workflow-scheduler",
    (record) => record.key.startsWith(`${threadId}|`) && record.value === `${timeoutMS}`,
    WAIT_TIMEOUT_MS
  );

  await onStep("started");

  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({
      type: "addToCart",
      item: { productId: "teapot", quantity: 2 }
    })
  );
  await onStep("item-added");

  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ type: "updateEmail", email: "cart@example.com" })
  );
  await onStep("email-updated");

  const reminder = await harness.next(
    "ecommerce-reminder",
    (record) => record.key === threadId,
    WAIT_TIMEOUT_MS
  );
  assert.equal(reminder.value, "cart@example.com");
  await onStep("reminded");

  const managerResult = await dispatchManagedUpgrade(
    harness,
    threadId,
    version(1, 1, 0),
    { bookingId: threadId, ref: "main" }
  );
  const upgradeDispatch = (
    await nextJson(
      harness,
      "versioning-upgrade-dispatch",
      (value, record) =>
        record.key === threadId &&
        value.ref === "main" &&
        value.targetVersion.minor === 1
    )
  ).value;
  assert.equal(upgradeDispatch.bookingId, threadId);
  assert.deepEqual(managerResult, {
    targetVersion: version(1, 1, 0),
    dispatched: [threadId],
    skipped: []
  });
  await onStep("manager-dispatched");

  const upgraded = (
    await nextJson(
      harness,
      "workflow-result",
      (value, record) => record.key === threadId && value.status === "upgraded"
    )
  ).value;
  assert.equal(upgraded.status, "upgraded");
  await onStep("legacy-upgraded");

  const handoff = (
    await nextJson(
      harness,
      "versioning-handoff",
      (value, record) => record.key === threadId && value.version.minor === 1
    )
  ).value;
  assert.deepEqual(handoff.payload.input, {
    config: { abandonedCartTimeoutMS: timeoutMS },
    items: [{ productId: "teapot", quantity: 2 }],
    email: "cart@example.com",
    reminderStage: 1
  });

  await harness.send("workflow-resume", threadId, newThread(handoff));
  await onStep("handoff-started");

  const discount = (
    await nextJson(
      harness,
      "ecommerce-discount-reminder",
      (_value, record) => record.key === threadId
    )
  ).value;
  assert.deepEqual(discount, {
    email: "cart@example.com",
    code: "SAVE10"
  });
  await onStep("discount-sent");

  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ type: "checkout" })
  );
  await onStep("checkout-sent");

  const final = (
    await nextJson(
      harness,
      "workflow-result",
      (value, record) =>
        record.key === threadId && value.version?.minor === 1
    )
  ).value;
  assert.deepEqual(final, {
    version: version(1, 1, 0),
    email: "cart@example.com",
    items: [{ productId: "teapot", quantity: 2 }],
    discountCode: "SAVE10"
  });
  await onStep("final-result");

  await expectNoJson(
    harness,
    "workflow-error",
    (_value, record) => record.key === threadId
  );
}

export async function runPatchNoUpgrade(
  harness,
  { threadId = "ecommerce-versioned-patch", timeoutMS = 5000 } = {}
) {
  await harness.send(
    "workflow-resume",
    threadId,
    newThread(startEnvelope(threadId, timeoutMS, version(1, 1, 9)))
  );

  await expectNoJson(
    harness,
    "versioning-await-upgrade",
    (_value, record) => record.key === threadId
  );

  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({
      type: "addToCart",
      item: { productId: "sugar", quantity: 1 }
    })
  );
  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ type: "updateEmail", email: "patch@example.com" })
  );
  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ type: "checkout" })
  );

  const result = (
    await nextJson(
      harness,
      "workflow-result",
      (value, record) =>
        record.key === threadId && value.version?.minor === 1
    )
  ).value;
  assert.deepEqual(result, {
    version: version(1, 1, 0),
    email: "patch@example.com",
    items: [{ productId: "sugar", quantity: 1 }]
  });
}

export async function runMajorStartFresh(
  harness,
  { threadId = "ecommerce-versioned-major-2", timeoutMS = 5000 } = {}
) {
  await harness.send(
    "workflow-resume",
    threadId,
    newThread(startEnvelope(threadId, timeoutMS, version(2, 0, 0)))
  );

  await expectNoJson(
    harness,
    "versioning-await-upgrade",
    (_value, record) => record.key === threadId
  );

  await harness.next(
    "workflow-scheduler",
    (record) => record.key.startsWith(`${threadId}|`) && record.value === `${timeoutMS}`,
    WAIT_TIMEOUT_MS
  );

  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({
      type: "addToCart",
      item: { productId: "coffee", quantity: 4 }
    })
  );
  await sleep(250);
  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ type: "updateEmail", email: "major@example.com" })
  );
  await sleep(250);
  const reminder = (
    await nextJson(
      harness,
      "ecommerce-v2-reminder",
      (_value, record) => record.key === threadId
    )
  ).value;
  assert.deepEqual(reminder, {
    email: "major@example.com",
    channel: "sms"
  });

  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ type: "checkout" })
  );

  const result = (
    await nextJson(
      harness,
      "workflow-result",
      (value, record) =>
        record.key === threadId && value.version?.major === 2
    )
  ).value;
  assert.deepEqual(result, {
    version: version(2, 0, 0),
    email: "major@example.com",
    items: [{ productId: "coffee", quantity: 4 }],
    channel: "v2"
  });
}
