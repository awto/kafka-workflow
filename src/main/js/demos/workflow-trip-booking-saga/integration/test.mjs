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
  return JSON.stringify(value);
}

async function waitReservation(harness, topic, threadId, timeoutMs = WAIT_TIMEOUT_MS) {
  return harness.next(topic, (record) => record.key === threadId, timeoutMs);
}

async function runSuccessfulBooking(harness) {
  const threadId = "trip-success";
  await harness.send("workflow-resume", threadId, newThread({}));
  await maybePause();

  const reserveCar = await waitReservation(
    harness,
    "saga-reserve-car",
    threadId
  );
  const reserveHotel = await waitReservation(
    harness,
    "saga-reserve-hotel",
    threadId
  );
  const reserveFlight = await waitReservation(
    harness,
    "saga-reserve-flight",
    threadId
  );
  const scheduler = await harness.next(
    "workflow-scheduler",
    (record) => record.key.startsWith(`${threadId}|`),
    WAIT_TIMEOUT_MS
  );

  assert.equal(scheduler.value, "1000");
  await maybePause();

  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ ref: reserveFlight.value })
  );
  await maybePause();
  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ ref: reserveHotel.value })
  );
  await maybePause();
  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ ref: reserveCar.value })
  );

  const result = await harness.next(
    "workflow-result",
    (record) => record.key === threadId,
    WAIT_TIMEOUT_MS
  );
  assert.deepEqual(JSON.parse(result.value), {
    car: { id: reserveCar.value },
    hotel: { id: reserveHotel.value },
    flight: { id: reserveFlight.value }
  });

  const cancelTimer = await harness.next(
    "workflow-scheduler",
    (record) => record.key === scheduler.key && record.value === "0",
    WAIT_TIMEOUT_MS
  );
  assert.equal(cancelTimer.value, "0");

  await harness.expectNone("workflow-error", (record) => record.key === threadId);
  await harness.expectNone("saga-cancel-car", (record) => record.key === threadId);
  await harness.expectNone(
    "saga-cancel-hotel",
    (record) => record.key === threadId
  );
  await harness.expectNone(
    "saga-cancel-flight",
    (record) => record.key === threadId
  );
}

async function runTimeoutBooking(harness) {
  const threadId = "trip-timeout";
  await harness.send("workflow-resume", threadId, newThread({}));
  await maybePause();

  const reserveCar = await waitReservation(
    harness,
    "saga-reserve-car",
    threadId
  );
  const reserveHotel = await waitReservation(
    harness,
    "saga-reserve-hotel",
    threadId
  );
  const reserveFlight = await waitReservation(
    harness,
    "saga-reserve-flight",
    threadId
  );
  await harness.next(
    "workflow-scheduler",
    (record) => record.key.startsWith(`${threadId}|`),
    WAIT_TIMEOUT_MS
  );
  await maybePause();

  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ ref: reserveFlight.value })
  );
  await maybePause();
  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ ref: reserveCar.value })
  );

  const error = await harness.next(
    "workflow-error",
    (record) => record.key === threadId,
    WAIT_TIMEOUT_MS
  );
  assert.equal(error.value, "\"timeout\"");

  const cancelCar = await harness.next(
    "saga-cancel-car",
    (record) => record.key === threadId,
    WAIT_TIMEOUT_MS
  );
  const cancelHotel = await harness.next(
    "saga-cancel-hotel",
    (record) => record.key === threadId,
    WAIT_TIMEOUT_MS
  );
  const cancelFlight = await harness.next(
    "saga-cancel-flight",
    (record) => record.key === threadId,
    WAIT_TIMEOUT_MS
  );

  assert.equal(cancelCar.value, reserveCar.value);
  assert.equal(cancelHotel.value, reserveHotel.value);
  assert.equal(cancelFlight.value, reserveFlight.value);
  await harness.expectNone("workflow-result", (record) => record.key === threadId);
}

const harness = await createHarness(
  "workflow-trip-booking-saga-integration-test",
  OBSERVED_TOPICS
);

try {
  await waitForConsumerGroups("workflow-trip-booking-saga-ready", [
    "workflow-engine-trip-booking-saga-it",
    "workflow-scheduler-trip-booking-saga-it"
  ]);
  await runSuccessfulBooking(harness);
  await runTimeoutBooking(harness);
  console.log("workflow-trip-booking-saga integration test passed");
} finally {
  await harness.stop();
}
