import { execFile } from "node:child_process";
import { randomInt } from "node:crypto";
import process from "node:process";
import { promisify } from "node:util";

import {
  createHarness,
  waitForConsumerGroupsStable
} from "../../workflow-trip-booking-saga/integration/kafka-test-lib.mjs";
import { OBSERVED_TOPICS } from "./topics.mjs";
import { runMinorUpgradeAdoption } from "./scenario-lib.mjs";

const execFileAsync = promisify(execFile);
const composeFile = process.env.COMPOSE_FILE;
const WAIT_TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || "120000");
const SERVICES = ["scheduler"];
const GROUP_IDS = [
  "workflow-engine-trip-booking-saga-versioned-it",
  "workflow-scheduler-trip-booking-saga-versioned-it"
];

if (!composeFile) {
  throw new Error("COMPOSE_FILE is required");
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
    "workflow-trip-booking-saga-versioned-chaos-ready",
    GROUP_IDS,
    WAIT_TIMEOUT_MS
  );
}

const CHAOS_LABELS = new Set(["handoff-started"]);

const harness = await createHarness(
  "workflow-trip-booking-saga-versioned-chaos-test",
  OBSERVED_TOPICS
);

try {
  await waitForConsumerGroupsStable(
    "workflow-trip-booking-saga-versioned-chaos-init",
    GROUP_IDS,
    WAIT_TIMEOUT_MS
  );
  await runMinorUpgradeAdoption(harness, {
    threadId: "versioned-chaos-upgrade",
    releaseAfterMS: 5000,
    onStep: async (label) => {
      if (CHAOS_LABELS.has(label)) {
        await bounceRandomRunner();
      }
    }
  });
  console.log("workflow-trip-booking-saga-versioned chaos integration test passed");
} finally {
  await harness.stop();
}
