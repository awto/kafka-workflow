const V = require("../../workflow-versioning-demo/src/index") as typeof import("../../workflow-versioning-demo/src/index");
const EcommerceV1_0 = require("../../workflow-ecommerce-v1_0/src/index") as typeof import("../../workflow-ecommerce-v1_0/src/index");
const EcommerceV1_1 = require("../../workflow-ecommerce-v1_1/src/index") as typeof import("../../workflow-ecommerce-v1_1/src/index");
const EcommerceV2_0 = require("../../workflow-ecommerce-v2_0/src/index") as typeof import("../../workflow-ecommerce-v2_0/src/index");

import type {
  HandoffEnvelope,
  UpgradeManagerEnvelope,
  VersionedEnvelope
} from "../../workflow-versioning-demo/src/index";
import type {
  CartSnapshot,
  EcommerceInput
} from "../../workflow-ecommerce-v1_0/src/index";

const WORKFLOW = "ecommerce-versioned";

function assertWorkflow(value: string): void {
  if (value !== WORKFLOW) {
    throw new Error(`unsupported workflow ${value}`);
  }
}

function runMajor1Workflow(
  envelope: VersionedEnvelope<EcommerceInput> | HandoffEnvelope<CartSnapshot>
): unknown {
  if (envelope.kind === "handoff") {
    const handoff = envelope as HandoffEnvelope<CartSnapshot>;
    if (!V.canReuse(handoff.payload.fromVersion, handoff.version)) {
      throw new Error(
        `cannot reuse ${V.formatVersion(
          handoff.payload.fromVersion
        )} in ${V.formatVersion(handoff.version)}`
      );
    }
    return EcommerceV1_1.runEcommerceV1_1(handoff);
  }
  const start = envelope as VersionedEnvelope<EcommerceInput>;
  if (start.version.minor === EcommerceV1_0.VERSION.minor) {
    return EcommerceV1_0.runEcommerceV1_0(start);
  }
  return EcommerceV1_1.runEcommerceV1_1(start);
}

function runMajor2Workflow(
  envelope: VersionedEnvelope<EcommerceInput> | HandoffEnvelope<CartSnapshot>
): unknown {
  return EcommerceV2_0.runEcommerceV2_0(
    envelope as VersionedEnvelope<EcommerceInput> | HandoffEnvelope<CartSnapshot>
  );
}

export default function entry(
  envelope:
    | VersionedEnvelope<EcommerceInput>
    | HandoffEnvelope<CartSnapshot>
    | UpgradeManagerEnvelope
): unknown {
  if (envelope.workflow === V.workflows.upgradeManager) {
    return V.runVersioningWorkflow(envelope as UpgradeManagerEnvelope);
  }
  assertWorkflow(envelope.workflow);
  const ecommerceEnvelope = envelope as
    | VersionedEnvelope<EcommerceInput>
    | HandoffEnvelope<CartSnapshot>;
  switch (ecommerceEnvelope.version.major) {
    case EcommerceV1_1.VERSION.major:
      return runMajor1Workflow(ecommerceEnvelope);
    case EcommerceV2_0.VERSION.major:
      return runMajor2Workflow(ecommerceEnvelope);
    default:
      throw new Error(
        `unsupported major version ${V.formatVersion(ecommerceEnvelope.version)}`
      );
  }
}

export const manifest = {
  outputTopics: [
    ...new Set([
      ...EcommerceV1_0.outputTopics,
      ...EcommerceV1_1.outputTopics,
      ...EcommerceV2_0.outputTopics,
      V.topics.upgradeDispatch
    ])
  ]
};
