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
const SUCCESS_TIMEOUT_MS = Number(process.env.SUCCESS_TIMEOUT_MS || "60000");
const SERVICES = ["engine", "scheduler"];
const GROUP_IDS = [
  "workflow-engine-trip-booking-saga-it",
  "workflow-scheduler-trip-booking-saga-it"
];

if (!composeFile) {
  throw new Error("COMPOSE_FILE is required");
}

function newThread(value) {
  return `new:${JSON.stringify(value)}`;
}

function resumeValue(value) {
  return JSON.stringify(value);
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
    "workflow-trip-booking-saga-chaos-ready",
    GROUP_IDS,
    WAIT_TIMEOUT_MS
  );
}

async function waitReservation(harness, topic, threadId) {
  return harness.next(topic, (record) => record.key === threadId, WAIT_TIMEOUT_MS);
}

async function runSuccessfulBooking(harness) {
  const threadId = "trip-chaos-success";
  await harness.send(
    "workflow-resume",
    threadId,
    newThread({ timeoutMS: SUCCESS_TIMEOUT_MS })
  );

  const reserveCar = await waitReservation(harness, "saga-reserve-car", threadId);
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

  assert.equal(scheduler.value, String(SUCCESS_TIMEOUT_MS));

  await bounceRandomRunner();
  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ ref: reserveFlight.value })
  );

  await bounceRandomRunner();
  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ ref: reserveHotel.value })
  );
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

  await harness.next(
    "workflow-scheduler",
    (record) => record.key === scheduler.key && record.value === "0",
    WAIT_TIMEOUT_MS
  );
}

async function runTimeoutBooking(harness) {
  const threadId = "trip-chaos-timeout";
  await harness.send("workflow-resume", threadId, newThread({}));

  const reserveCar = await waitReservation(harness, "saga-reserve-car", threadId);
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

  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ ref: reserveFlight.value })
  );
  await bounceRandomRunner();
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
}

const harness = await createHarness(
  "workflow-trip-booking-saga-chaos-test",
  OBSERVED_TOPICS
);

try {
  await waitForConsumerGroupsStable(
    "workflow-trip-booking-saga-chaos-init",
    GROUP_IDS,
    WAIT_TIMEOUT_MS
  );
  await runSuccessfulBooking(harness);
  await runTimeoutBooking(harness);
  console.log("workflow-trip-booking-saga chaos integration test passed");
} finally {
  await harness.stop();
}
