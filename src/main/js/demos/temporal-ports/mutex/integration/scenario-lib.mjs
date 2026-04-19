import assert from "node:assert/strict";
import process from "node:process";

export const WAIT_TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || "30000");

const CHAOS_STEP_DELAY_MS = Number(process.env.CHAOS_STEP_DELAY_MS || "0");

export function newThread(value) {
  return `new:${JSON.stringify(value)}`;
}

export function resumeValue(value) {
  return JSON.stringify(value);
}

export function parse(record) {
  return JSON.parse(record.value);
}

export function mainSignal(value) {
  return {
    ref: "main",
    value
  };
}

export async function maybePause() {
  if (CHAOS_STEP_DELAY_MS <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, CHAOS_STEP_DELAY_MS));
}

export async function startContender(
  harness,
  { threadId, resourceId, owner, lockTimeoutMS = 60_000 }
) {
  await harness.send(
    "workflow-resume",
    threadId,
    newThread({
      workflow: "oneAtATimeWorkflow",
      resourceId,
      owner,
      sleepForMS: 25,
      lockTimeoutMS
    })
  );
}

export async function waitCritical(harness, owner, timeoutMs = WAIT_TIMEOUT_MS) {
  const record = await harness.next(
    "temporal-mutex-critical-section",
    (next) => next.key === owner && parse(next).owner === owner,
    timeoutMs
  );
  return parse(record);
}

export async function ackCritical(harness, owner, ref) {
  await harness.send(
    "workflow-resume",
    owner,
    resumeValue({
      ref,
      value: { ok: true }
    })
  );
}

export async function waitWorkflowResult(
  harness,
  threadId,
  timeoutMs = WAIT_TIMEOUT_MS
) {
  const record = await harness.next(
    "workflow-result",
    (next) => next.key === threadId,
    timeoutMs
  );
  return parse(record);
}

export async function runSerialContenders(harness, prefix = "mutex-it") {
  const resourceId = `${prefix}-shared`;
  const alice = `${prefix}-alice`;
  const bob = `${prefix}-bob`;

  await startContender(harness, {
    threadId: alice,
    resourceId,
    owner: alice
  });
  await maybePause();
  const aliceCritical = await waitCritical(harness, alice);
  assert.equal(aliceCritical.resourceId, resourceId);

  await startContender(harness, {
    threadId: bob,
    resourceId,
    owner: bob
  });
  await maybePause();
  assert.deepEqual(
    parse(
      await harness.next(
        "temporal-mutex-lock-requested",
        (record) => parse(record).owner === bob,
        WAIT_TIMEOUT_MS
      )
    ),
    {
      lockId: resourceId,
      owner: bob,
      position: 1
    }
  );

  await ackCritical(harness, alice, aliceCritical.ref);
  await maybePause();
  assert.deepEqual(await waitWorkflowResult(harness, alice), {
    resourceId,
    owner: alice
  });

  const bobCritical = await waitCritical(harness, bob);
  assert.equal(bobCritical.resourceId, resourceId);
  await ackCritical(harness, bob, bobCritical.ref);
  assert.deepEqual(await waitWorkflowResult(harness, bob), {
    resourceId,
    owner: bob
  });
  await harness.expectNone("workflow-error", (record) =>
    [alice, bob, resourceId].includes(record.key)
  );
}

export async function runTimeoutGrant(
  harness,
  prefix = "mutex-it-timeout",
  { afterQueued } = {}
) {
  const resourceId = `${prefix}-shared`;
  const alice = `${prefix}-alice`;
  const bob = `${prefix}-bob`;

  await startContender(harness, {
    threadId: alice,
    resourceId,
    owner: alice,
    lockTimeoutMS: 3000
  });
  await maybePause();
  const aliceCritical = await waitCritical(harness, alice);
  assert.equal(aliceCritical.resourceId, resourceId);

  const timeout = await harness.next(
    "workflow-scheduler",
    (record) => record.key.startsWith(`${resourceId}|`) && record.value === "3000",
    WAIT_TIMEOUT_MS
  );
  assert.equal(timeout.value, "3000");

  await startContender(harness, {
    threadId: bob,
    resourceId,
    owner: bob,
    lockTimeoutMS: 60_000
  });
  assert.deepEqual(
    parse(
      await harness.next(
        "temporal-mutex-lock-requested",
        (record) => parse(record).owner === bob,
        WAIT_TIMEOUT_MS
      )
    ),
    {
      lockId: resourceId,
      owner: bob,
      position: 1
    }
  );
  if (afterQueued) {
    await afterQueued();
  }

  const bobCritical = await waitCritical(harness, bob, WAIT_TIMEOUT_MS);
  assert.equal(bobCritical.resourceId, resourceId);
  await ackCritical(harness, bob, bobCritical.ref);
  assert.deepEqual(await waitWorkflowResult(harness, bob), {
    resourceId,
    owner: bob
  });

  await harness.expectNone("workflow-result", (record) => record.key === alice);
  await harness.expectNone("workflow-error", (record) =>
    [alice, bob, resourceId].includes(record.key)
  );
}
