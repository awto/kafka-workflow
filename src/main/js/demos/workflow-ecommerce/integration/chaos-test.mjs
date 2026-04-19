import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomInt } from "node:crypto";
import process from "node:process";

import {
  createHarness,
  waitForConsumerGroupsStable
} from "./kafka-test-lib.mjs";
import { OBSERVED_TOPICS } from "./topics.mjs";

const execFileAsync = promisify(execFile);
const composeFile = process.env.COMPOSE_FILE;
const WAIT_TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || "120000");
const CHECKOUT_ABANDONED_CART_TIMEOUT_MS = Number(
  process.env.CHECKOUT_ABANDONED_CART_TIMEOUT_MS || "60000"
);
const SERVICES = ["engine", "scheduler"];
const GROUP_IDS = [
  "workflow-engine-ecommerce-it",
  "workflow-scheduler-ecommerce-it"
];

if (!composeFile) {
  throw new Error("COMPOSE_FILE is required");
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

async function compose(...args) {
  await execFileAsync("docker", ["compose", "-f", composeFile, ...args], {
    env: process.env
  });
}

async function bounceRandomRunner() {
  const service = SERVICES[randomInt(SERVICES.length)];
  console.log(`chaos kill ${service}`);
  await compose("kill", "-s", "KILL", service);
  await compose("up", "-d", "--no-deps", service);
  await waitForConsumerGroupsStable(
    "workflow-ecommerce-chaos-ready",
    GROUP_IDS,
    WAIT_TIMEOUT_MS
  );
}

async function runCheckoutFlow(harness) {
  const threadId = "ecommerce-chaos-checkout";
  await harness.send(
    "workflow-resume",
    threadId,
    newThread({ abandonedCartTimeoutMS: CHECKOUT_ABANDONED_CART_TIMEOUT_MS })
  );

  await harness.next(
    "workflow-scheduler",
    (record) =>
      record.key.startsWith(`${threadId}|`) &&
      record.value === String(CHECKOUT_ABANDONED_CART_TIMEOUT_MS),
    WAIT_TIMEOUT_MS
  );

  await bounceRandomRunner();
  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ type: "updateEmail", email: "someone@example.com" })
  );

  await bounceRandomRunner();
  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({
      type: "addToCart",
      item: { productId: "sugar", quantity: 2 }
    })
  );
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
}

async function runAbandonmentFlow(harness) {
  const threadId = "ecommerce-chaos-abandoned";
  await harness.send(
    "workflow-resume",
    threadId,
    newThread({ abandonedCartTimeoutMS: 200 })
  );

  await harness.next(
    "workflow-scheduler",
    (record) => record.key.startsWith(`${threadId}|`) && record.value === "200",
    WAIT_TIMEOUT_MS
  );

  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ type: "updateEmail", email: "late@example.com" })
  );
  await bounceRandomRunner();

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
  "workflow-ecommerce-chaos-test",
  OBSERVED_TOPICS
);

try {
  await waitForConsumerGroupsStable(
    "workflow-ecommerce-chaos-init",
    GROUP_IDS,
    WAIT_TIMEOUT_MS
  );
  await runCheckoutFlow(harness);
  await runAbandonmentFlow(harness);
  console.log("workflow-ecommerce chaos integration test passed");
} finally {
  await harness.stop();
}
