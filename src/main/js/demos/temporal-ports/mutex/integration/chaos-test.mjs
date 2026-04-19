import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

import {
  createHarness,
  waitForConsumerGroupsStable
} from "./kafka-test-lib.mjs";
import {
  WAIT_TIMEOUT_MS,
  ackCritical,
  runTimeoutGrant,
  startContender,
  waitCritical,
  waitWorkflowResult
} from "./scenario-lib.mjs";
import { OBSERVED_TOPICS } from "./topics.mjs";

const execFileAsync = promisify(execFile);
const composeFile = process.env.COMPOSE_FILE;
const CHAOS_SETTLE_MS = Number(process.env.CHAOS_SETTLE_MS || "1000");
const SERVICES = ["engine", "scheduler"];
const SERIAL_BOUNCES = (
  process.env.CHAOS_SERIAL_SERVICES || "engine,scheduler,engine"
)
  .split(",")
  .map((service) => service.trim())
  .filter(Boolean);
const GROUP_IDS = [
  "workflow-engine-temporal-mutex-it",
  "workflow-scheduler-temporal-mutex-it"
];

if (!composeFile) {
  throw new Error("COMPOSE_FILE is required");
}
if (
  SERIAL_BOUNCES.length === 0 ||
  SERIAL_BOUNCES.some((service) => !SERVICES.includes(service))
) {
  throw new Error(
    `CHAOS_SERIAL_SERVICES must contain only: ${SERVICES.join(", ")}`
  );
}

async function compose(...args) {
  await execFileAsync("docker", ["compose", "-f", composeFile, ...args], {
    env: process.env
  });
}

async function settleBeforeKill() {
  if (CHAOS_SETTLE_MS <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, CHAOS_SETTLE_MS));
}

let nextBounceIndex = 0;

async function bounceNextRunner() {
  const service = SERIAL_BOUNCES[nextBounceIndex % SERIAL_BOUNCES.length];
  nextBounceIndex += 1;
  await bounceRunner(service);
}

async function bounceRunner(service) {
  await settleBeforeKill();
  console.log(`chaos kill ${service}`);
  await compose("kill", "-s", "KILL", service);
  await compose("up", "-d", "--no-deps", service);
  await waitForConsumerGroupsStable(
    "temporal-mutex-chaos-ready",
    GROUP_IDS,
    WAIT_TIMEOUT_MS
  );
}

async function runSerialContendersWithChaos(harness) {
  const resourceId = "temporal-mutex-chaos-shared";
  const alice = "temporal-mutex-chaos-alice";
  const bob = "temporal-mutex-chaos-bob";

  await startContender(harness, {
    threadId: alice,
    resourceId,
    owner: alice
  });
  const aliceCritical = await waitCritical(harness, alice);

  await bounceNextRunner();
  await startContender(harness, {
    threadId: bob,
    resourceId,
    owner: bob
  });
  await harness.next(
    "temporal-mutex-lock-requested",
    (record) => JSON.parse(record.value).owner === bob,
    WAIT_TIMEOUT_MS
  );

  await bounceNextRunner();
  await ackCritical(harness, alice, aliceCritical.ref);
  await waitWorkflowResult(harness, alice);

  const bobCritical = await waitCritical(harness, bob);
  await bounceNextRunner();
  await ackCritical(harness, bob, bobCritical.ref);
  await waitWorkflowResult(harness, bob);
}

async function runTimeoutGrantWithSchedulerChaos(harness) {
  await runTimeoutGrant(harness, "temporal-mutex-chaos-timeout", {
    holderLockTimeoutMS: 15_000,
    afterQueued: () => bounceRunner("scheduler")
  });
}

const harness = await createHarness(
  "temporal-mutex-chaos-test",
  OBSERVED_TOPICS
);

try {
  await waitForConsumerGroupsStable(
    "temporal-mutex-chaos-init",
    GROUP_IDS,
    WAIT_TIMEOUT_MS
  );
  await runSerialContendersWithChaos(harness);
  await runTimeoutGrantWithSchedulerChaos(harness);
  console.log("temporal-mutex chaos integration test passed");
} finally {
  await harness.stop();
}
