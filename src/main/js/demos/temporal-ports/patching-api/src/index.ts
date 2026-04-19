const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");
const V = require("../../../workflow-versioning-demo/src/index") as typeof import("../../../workflow-versioning-demo/src/index");

import type {
  HandoffEnvelope,
  UpgradeManagerEnvelope,
  VersionedEnvelope,
  WorkflowVersion
} from "../../../workflow-versioning-demo/src/index";

type PatchWorkflowInput = {
  customerId: string;
  chargeId?: string;
  charged?: boolean;
  receiptSent?: boolean;
};

type ActivityAck = {
  ok?: true;
};

const WORKFLOW = "temporal-patching-api";

const VERSION_1_0: WorkflowVersion = {
  major: 1,
  minor: 0,
  patch: 0
};

const VERSION_1_1: WorkflowVersion = {
  major: 1,
  minor: 1,
  patch: 0
};

export const topics = {
  charge: "temporal-patching-api-charge",
  sendReceipt: "temporal-patching-api-send-receipt",
  awaitComplete: "temporal-patching-api-await-complete"
} as const;

function normalizeState(
  envelope: VersionedEnvelope<PatchWorkflowInput> | HandoffEnvelope<PatchWorkflowInput>
): PatchWorkflowInput {
  const source =
    envelope.kind === "handoff"
      ? (envelope as HandoffEnvelope<PatchWorkflowInput>).payload.input
      : (envelope as VersionedEnvelope<PatchWorkflowInput>).payload;
  return {
    customerId: source.customerId,
    chargeId: source.chargeId ?? `${envelope.bookingId}:charge`,
    charged: source.charged === true,
    receiptSent: source.receiptSent === true
  };
}

async function request(topic: string, payload: Record<string, unknown>): Promise<void> {
  const reply = W.ref<ActivityAck>(topic);
  W.outputJSON({ ...payload, ref: reply.id }, topic);
  await reply;
}

async function charge(state: PatchWorkflowInput): Promise<PatchWorkflowInput> {
  await request(topics.charge, {
    customerId: state.customerId,
    chargeId: state.chargeId
  });
  return {
    ...state,
    charged: true
  };
}

async function sendReceipt(state: PatchWorkflowInput): Promise<PatchWorkflowInput> {
  await request(topics.sendReceipt, {
    customerId: state.customerId,
    chargeId: state.chargeId
  });
  return {
    ...state,
    receiptSent: true
  };
}

async function waitForCompletion(): Promise<void> {
  const finish = W.refId<{ done: true }>("complete");
  W.outputJSON({ ref: finish.id }, topics.awaitComplete);
  await finish;
}

async function runV1_0(
  envelope: VersionedEnvelope<PatchWorkflowInput>
): Promise<unknown> {
  let state = normalizeState(envelope);
  if (!state.charged) {
    state = await charge(state);
  }
  const outcome = await Promise.race([
    waitForCompletion(),
    V.waitForUpgrade(VERSION_1_0)
  ]);
  if (outcome && typeof outcome === "object" && "targetVersion" in outcome) {
    W.outputJSON(
      V.createHandoffEnvelope(
        WORKFLOW,
        envelope.bookingId,
        VERSION_1_0,
        outcome.targetVersion,
        state,
        []
      ),
      V.topics.handoff
    );
    return {
      status: "upgraded",
      fromVersion: VERSION_1_0,
      toVersion: outcome.targetVersion,
      charged: state.charged === true
    };
  }
  return {
    version: VERSION_1_0,
    customerId: state.customerId,
    chargeId: state.chargeId,
    receiptSent: false
  };
}

async function runV1_1(
  envelope: VersionedEnvelope<PatchWorkflowInput> | HandoffEnvelope<PatchWorkflowInput>
): Promise<unknown> {
  if (envelope.kind === "handoff") {
    const handoff = envelope as HandoffEnvelope<PatchWorkflowInput>;
    if (!V.canReuse(handoff.payload.fromVersion, VERSION_1_1)) {
      throw new Error(
        `cannot reuse ${V.formatVersion(
          handoff.payload.fromVersion
        )} in ${V.formatVersion(VERSION_1_1)}`
      );
    }
  }
  let state = normalizeState(envelope);
  if (!state.charged) {
    state = await charge(state);
  }
  if (!state.receiptSent) {
    state = await sendReceipt(state);
  }
  await waitForCompletion();
  return {
    version: VERSION_1_1,
    customerId: state.customerId,
    chargeId: state.chargeId,
    receiptSent: true
  };
}

export default function entry(
  envelope:
    | VersionedEnvelope<PatchWorkflowInput>
    | HandoffEnvelope<PatchWorkflowInput>
    | UpgradeManagerEnvelope
): unknown {
  if (envelope.workflow === V.workflows.upgradeManager) {
    return V.runVersioningWorkflow(envelope as UpgradeManagerEnvelope);
  }
  if (envelope.workflow !== WORKFLOW) {
    throw new Error(`unsupported workflow ${envelope.workflow}`);
  }
  const patchEnvelope = envelope as
    | VersionedEnvelope<PatchWorkflowInput>
    | HandoffEnvelope<PatchWorkflowInput>;
  if (patchEnvelope.version.major !== VERSION_1_0.major) {
    throw new Error(
      `unsupported major version ${V.formatVersion(patchEnvelope.version)}`
    );
  }
  if (
    patchEnvelope.kind === "handoff" ||
    patchEnvelope.version.minor >= VERSION_1_1.minor
  ) {
    return runV1_1(patchEnvelope);
  }
  return runV1_0(patchEnvelope as VersionedEnvelope<PatchWorkflowInput>);
}

export const manifest = {
  outputTopics: [
    topics.charge,
    topics.sendReceipt,
    topics.awaitComplete,
    V.topics.awaitUpgrade,
    V.topics.handoff,
    V.topics.upgradeDispatch
  ]
};
