const V = require("../../workflow-versioning-demo/src/index") as typeof import("../../workflow-versioning-demo/src/index");
const SagaV1_0 = require("../../workflow-trip-booking-saga-v1_0/src/index") as typeof import("../../workflow-trip-booking-saga-v1_0/src/index");
const SagaV1_1 = require("../../workflow-trip-booking-saga-v1_1/src/index") as typeof import("../../workflow-trip-booking-saga-v1_1/src/index");
const SagaV2_0 = require("../../workflow-trip-booking-saga-v2_0/src/index") as typeof import("../../workflow-trip-booking-saga-v2_0/src/index");
const Release = require("./release") as typeof import("./release");

import type {
  HandoffEnvelope,
  UpgradeManagerEnvelope,
  VersionedEnvelope
} from "../../workflow-versioning-demo/src/index";
import type { TripRequest } from "../../workflow-trip-booking-saga-v1_0/src/index";
import type { DelayedReleaseEnvelope } from "./release";

const WORKFLOW = "trip-booking-versioned";

function assertWorkflow(value: string): void {
  if (value !== WORKFLOW) {
    throw new Error(`unsupported workflow ${value}`);
  }
}

function runMajor1Workflow(
  envelope: VersionedEnvelope<TripRequest> | HandoffEnvelope<TripRequest>
): unknown {
  if (envelope.kind === "handoff") {
    const handoff = envelope as HandoffEnvelope<TripRequest>;
    if (!V.canReuse(handoff.payload.fromVersion, handoff.version)) {
      throw new Error(
        `cannot reuse ${V.formatVersion(
          handoff.payload.fromVersion
        )} in ${V.formatVersion(handoff.version)}`
      );
    }
    return SagaV1_1.runTripBookingV1_1(handoff);
  }
  const start = envelope as VersionedEnvelope<TripRequest>;
  if (start.version.minor === SagaV1_0.VERSION.minor) {
    return SagaV1_0.runTripBookingV1_0(start);
  }
  return SagaV1_1.runTripBookingV1_1(start);
}

function runMajor2Workflow(
  envelope: VersionedEnvelope<TripRequest> | HandoffEnvelope<TripRequest>
): unknown {
  return SagaV2_0.runTripBookingV2_0(
    envelope as VersionedEnvelope<TripRequest> | HandoffEnvelope<TripRequest>
  );
}

export default function entry(
  envelope:
    | VersionedEnvelope<TripRequest>
    | HandoffEnvelope<TripRequest>
    | DelayedReleaseEnvelope
    | UpgradeManagerEnvelope
): unknown {
  if (envelope.workflow === Release.workflows.delayedRelease) {
    return Release.delayedReleaseWorkflow(
      (envelope as DelayedReleaseEnvelope).command
    );
  }
  if (envelope.workflow === V.workflows.upgradeManager) {
    return V.runVersioningWorkflow(envelope as UpgradeManagerEnvelope);
  }
  assertWorkflow(envelope.workflow);
  const tripEnvelope = envelope as
    | VersionedEnvelope<TripRequest>
    | HandoffEnvelope<TripRequest>;
  switch (tripEnvelope.version.major) {
    case SagaV1_1.VERSION.major:
      return runMajor1Workflow(tripEnvelope);
    case SagaV2_0.VERSION.major:
      return runMajor2Workflow(tripEnvelope);
    default:
      throw new Error(
        `unsupported major version ${V.formatVersion(tripEnvelope.version)}`
      );
  }
}

export const manifest = {
  outputTopics: [
    ...new Set([
      ...SagaV1_0.outputTopics,
      ...SagaV1_1.outputTopics,
      ...SagaV2_0.outputTopics,
      ...Release.outputTopics,
      V.topics.upgradeDispatch
    ])
  ]
};
