import { createHarness, waitForConsumerGroups } from "./kafka-test-lib.mjs";
import { runSerialContenders, runTimeoutGrant } from "./scenario-lib.mjs";
import { OBSERVED_TOPICS } from "./topics.mjs";

const harness = await createHarness(
  "temporal-mutex-integration-test",
  OBSERVED_TOPICS
);

try {
  await waitForConsumerGroups("temporal-mutex-ready", [
    "workflow-engine-temporal-mutex-it",
    "workflow-scheduler-temporal-mutex-it"
  ]);
  await runSerialContenders(harness);
  await runTimeoutGrant(harness);
  console.log("temporal-mutex integration test passed");
} finally {
  await harness.stop();
}
