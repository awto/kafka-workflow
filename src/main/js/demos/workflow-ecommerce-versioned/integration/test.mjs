import {
  createHarness,
  waitForConsumerGroupsStable
} from "./kafka-test-lib.mjs";
import { OBSERVED_TOPICS } from "./topics.mjs";
import {
  runMajorStartFresh,
  runMinorUpgradeAdoption,
  runPatchNoUpgrade
} from "./scenario-lib.mjs";

const harness = await createHarness(
  "workflow-ecommerce-versioned-integration-test",
  OBSERVED_TOPICS
);

async function runScenario(name, fn) {
  console.log(`scenario ${name} start`);
  await fn();
  console.log(`scenario ${name} done`);
}

try {
  await waitForConsumerGroupsStable("workflow-ecommerce-versioned-ready", [
    "workflow-engine-ecommerce-versioned-it",
    "workflow-scheduler-ecommerce-versioned-it"
  ]);
  await runScenario("minor-upgrade", () => runMinorUpgradeAdoption(harness));
  await runScenario("patch-no-upgrade", () => runPatchNoUpgrade(harness));
  await runScenario("major-start-fresh", () => runMajorStartFresh(harness));
  console.log("workflow-ecommerce-versioned integration test passed");
} finally {
  await harness.stop();
}
