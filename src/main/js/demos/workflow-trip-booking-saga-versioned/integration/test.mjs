import { createHarness, waitForConsumerGroups } from "../../workflow-trip-booking-saga/integration/kafka-test-lib.mjs";
import { OBSERVED_TOPICS } from "./topics.mjs";
import {
  runDelayedReleaseFire,
  runMajorStartFresh,
  runMinorUpgradeAdoption,
  runPatchNoUpgrade
} from "./scenario-lib.mjs";

const harness = await createHarness(
  "workflow-trip-booking-saga-versioned-integration-test",
  OBSERVED_TOPICS
);

try {
  await waitForConsumerGroups("workflow-trip-booking-saga-versioned-ready", [
    "workflow-engine-trip-booking-saga-versioned-it",
    "workflow-scheduler-trip-booking-saga-versioned-it"
  ]);
  await runMinorUpgradeAdoption(harness);
  await runPatchNoUpgrade(harness);
  await runMajorStartFresh(harness);
  await runDelayedReleaseFire(harness);
  console.log("workflow-trip-booking-saga-versioned integration test passed");
} finally {
  await harness.stop();
}
