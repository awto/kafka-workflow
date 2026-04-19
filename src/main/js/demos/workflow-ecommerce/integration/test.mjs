import assert from "node:assert/strict";
import process from "node:process";

import { createHarness, waitForConsumerGroups } from "./kafka-test-lib.mjs";
import { OBSERVED_TOPICS } from "./topics.mjs";

const WAIT_TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || "10000");
const CHAOS_STEP_DELAY_MS = Number(process.env.CHAOS_STEP_DELAY_MS || "0");

function maybePause() {
  if (CHAOS_STEP_DELAY_MS <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, CHAOS_STEP_DELAY_MS));
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

async function runCheckoutFlow(harness) {
  const threadId = "ecommerce-checkout";
  await harness.send(
    "workflow-resume",
    threadId,
    newThread({ abandonedCartTimeoutMS: 300 })
  );
  await maybePause();

  await harness.next(
    "workflow-scheduler",
    (record) => record.key.startsWith(`${threadId}|`) && record.value === "300",
    WAIT_TIMEOUT_MS
  );
  await maybePause();

  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ type: "updateEmail", email: "someone@example.com" })
  );
  await maybePause();
  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({
      type: "addToCart",
      item: { productId: "sugar", quantity: 2 }
    })
  );
  await maybePause();
  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ type: "checkout" })
  );

  const result = await harness.next(
    "workflow-result",
    (record) => record.key === threadId,
    WAIT_TIMEOUT_MS
  );
  assert.deepEqual(JSON.parse(result.value), {
    email: "someone@example.com",
    items: [{ productId: "sugar", quantity: 2 }]
  });

  await harness.expectNone(
    "ecommerce-reminder",
    (record) => record.key === threadId
  );
  await harness.expectNone("workflow-error", (record) => record.key === threadId);
}

async function runAbandonmentFlow(harness) {
  const threadId = "ecommerce-abandoned";
  await harness.send(
    "workflow-resume",
    threadId,
    newThread({ abandonedCartTimeoutMS: 200 })
  );
  await maybePause();

  await harness.next(
    "workflow-scheduler",
    (record) => record.key.startsWith(`${threadId}|`) && record.value === "200",
    WAIT_TIMEOUT_MS
  );
  await maybePause();

  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ type: "updateEmail", email: "late@example.com" })
  );

  const reminder = await harness.next(
    "ecommerce-reminder",
    (record) => record.key === threadId,
    WAIT_TIMEOUT_MS
  );
  assert.equal(reminder.value, "late@example.com");

  const result = await harness.next(
    "workflow-result",
    (record) => record.key === threadId,
    WAIT_TIMEOUT_MS
  );
  assert.equal(result.value, "\"abondoned\"");
}

const harness = await createHarness(
  "workflow-ecommerce-integration-test",
  OBSERVED_TOPICS
);

try {
  await waitForConsumerGroups("workflow-ecommerce-ready", [
    "workflow-engine-ecommerce-it",
    "workflow-scheduler-ecommerce-it"
  ]);
  await runCheckoutFlow(harness);
  await runAbandonmentFlow(harness);
  console.log("workflow-ecommerce integration test passed");
} finally {
  await harness.stop();
}
