const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");
const V = require("../../../workflow-versioning-demo/src/index") as typeof import("../../../workflow-versioning-demo/src/index");

import type {
  HandoffEnvelope,
  UpgradeManagerCommand,
  UpgradeManagerEnvelope,
  UpgradeManagerResult,
  VersionedEnvelope,
  WorkflowVersion
} from "../../../workflow-versioning-demo/src/index";

type WorkflowMode = "auto" | "pinned";

type WorkerVersioningPayload = {
  mode: WorkflowMode;
  activities?: string[];
};

type WorkerVersioningState = {
  mode: WorkflowMode;
  activities: string[];
};

type WorkerVersioningCommand =
  | { type: "do-activity" }
  | { type: "conclude" }
  | { type: "query"; reply: string }
  | { type: "upgrade"; targetVersion: WorkflowVersion };

type ActivityAck = {
  ok?: true;
};

const WORKFLOW = "temporal-worker-versioning";
const RESUME_TOPIC = "workflow-resume";

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

const VERSION_2_0: WorkflowVersion = {
  major: 2,
  minor: 0,
  patch: 0
};

export const topics = {
  awaitSignal: "temporal-worker-versioning-await-signal",
  activity: "temporal-worker-versioning-activity",
  incompatibleActivity: "temporal-worker-versioning-incompatible-activity",
  state: "temporal-worker-versioning-state"
} as const;

function normalizeState(
  envelope:
    | VersionedEnvelope<WorkerVersioningPayload>
    | HandoffEnvelope<WorkerVersioningPayload>
): WorkerVersioningState {
  const payload =
    envelope.kind === "handoff"
      ? (envelope as HandoffEnvelope<WorkerVersioningPayload>).payload.input
      : (envelope as VersionedEnvelope<WorkerVersioningPayload>).payload;
  return {
    mode: payload.mode,
    activities: [...(payload.activities ?? [])]
  };
}

function publishState(
  reply: string,
  version: WorkflowVersion,
  state: WorkerVersioningState
): void {
  W.outputJSON(
    {
      reply,
      version,
      mode: state.mode,
      activities: state.activities
    },
    topics.state,
    reply
  );
}

async function nextCommand(
  version: WorkflowVersion,
  state: WorkerVersioningState,
  upgradeable = false
): Promise<WorkerVersioningCommand> {
  const signal = W.refId<WorkerVersioningCommand>("main");
  W.outputJSON(
    {
      ref: signal.id,
      version,
      mode: state.mode
    },
    topics.awaitSignal
  );
  if (upgradeable) {
    W.outputJSON(
      {
        ref: signal.id,
        currentVersion: version
      },
      V.topics.awaitUpgrade
    );
  }
  return await signal;
}

async function requestActivity(
  topic: string,
  state: WorkerVersioningState,
  activity: string,
  payload: Record<string, unknown>
): Promise<void> {
  const reply = W.ref<ActivityAck>(`${activity}:${state.activities.length}`);
  W.outputJSON(
    {
      ...payload,
      ref: reply.id
    },
    topic
  );
  await reply;
  state.activities.push(activity);
}

async function someActivity(
  state: WorkerVersioningState,
  calledBy: string
): Promise<void> {
  await requestActivity(topics.activity, state, `someActivity:${calledBy}`, {
    calledBy
  });
}

async function someIncompatibleActivity(
  state: WorkerVersioningState,
  payload: { calledBy: string; moreData: string }
): Promise<void> {
  await requestActivity(
    topics.incompatibleActivity,
    state,
    `someIncompatibleActivity:${payload.calledBy}`,
    payload
  );
}

function upgradedResult(
  fromVersion: WorkflowVersion,
  toVersion: WorkflowVersion,
  state: WorkerVersioningState
) {
  return {
    status: "upgraded",
    mode: state.mode,
    fromVersion,
    toVersion,
    activities: state.activities
  };
}

function completedResult(
  version: WorkflowVersion,
  state: WorkerVersioningState
) {
  return {
    status: "completed",
    version,
    mode: state.mode,
    activities: state.activities
  };
}

async function runAutoV1_0(
  envelope: VersionedEnvelope<WorkerVersioningPayload>
): Promise<unknown> {
  const state = normalizeState(envelope);
  for (;;) {
    const command = await nextCommand(VERSION_1_0, state, true);
    if (command.type === "upgrade") {
      V.resolveUpgrade(VERSION_1_0, {
        targetVersion: command.targetVersion
      });
      W.outputJSON(
        V.createHandoffEnvelope(
          WORKFLOW,
          envelope.bookingId,
          VERSION_1_0,
          command.targetVersion,
          state,
          []
        ),
        V.topics.handoff
      );
      return upgradedResult(VERSION_1_0, command.targetVersion, state);
    }
    switch (command.type) {
      case "do-activity":
        await someActivity(state, "v1");
        break;
      case "query":
        publishState(command.reply, VERSION_1_0, state);
        break;
      case "conclude":
        return completedResult(VERSION_1_0, state);
    }
  }
}

async function runAutoV1_1(
  envelope:
    | VersionedEnvelope<WorkerVersioningPayload>
    | HandoffEnvelope<WorkerVersioningPayload>,
  version = VERSION_1_1
): Promise<unknown> {
  if (envelope.kind === "handoff") {
    const handoff = envelope as HandoffEnvelope<WorkerVersioningPayload>;
    if (!V.canReuse(handoff.payload.fromVersion, version)) {
      throw new Error(
        `cannot reuse ${V.formatVersion(
          handoff.payload.fromVersion
        )} in ${V.formatVersion(version)}`
      );
    }
  }
  const state = normalizeState(envelope);
  for (;;) {
    const command = await nextCommand(version, state);
    switch (command.type) {
      case "do-activity":
        await someIncompatibleActivity(state, {
          calledBy: "v1b",
          moreData: "hello!"
        });
        break;
      case "query":
        publishState(command.reply, version, state);
        break;
      case "conclude":
        return completedResult(version, state);
      case "upgrade":
        throw new Error(
          `workflow is already running ${V.formatVersion(version)}`
        );
    }
  }
}

async function runPinnedV1(
  envelope: VersionedEnvelope<WorkerVersioningPayload>
): Promise<unknown> {
  const state = normalizeState(envelope);
  for (;;) {
    const command = await nextCommand(VERSION_1_0, state);
    switch (command.type) {
      case "query":
        publishState(command.reply, VERSION_1_0, state);
        break;
      case "do-activity":
        break;
      case "conclude":
        await someActivity(state, "Pinned-v1");
        return completedResult(VERSION_1_0, state);
      case "upgrade":
        throw new Error("pinned workflows do not accept upgrades");
    }
  }
}

async function runPinnedV2(
  envelope: VersionedEnvelope<WorkerVersioningPayload>
): Promise<unknown> {
  const state = normalizeState(envelope);
  await someActivity(state, "Pinned-v2");
  for (;;) {
    const command = await nextCommand(VERSION_2_0, state);
    switch (command.type) {
      case "query":
        publishState(command.reply, VERSION_2_0, state);
        break;
      case "do-activity":
        break;
      case "conclude":
        await someIncompatibleActivity(state, {
          calledBy: "Pinned-v2",
          moreData: "hi"
        });
        return completedResult(VERSION_2_0, state);
      case "upgrade":
        throw new Error("pinned workflows do not accept upgrades");
    }
  }
}

function dispatchWorkerUpgrade(
  command: UpgradeManagerCommand
): UpgradeManagerResult {
  const seen = new Set<string>();
  const dispatched: string[] = [];
  for (const target of command.targets) {
    if (!target.bookingId || !target.ref) continue;
    const id = `${target.bookingId}:${target.ref}`;
    if (seen.has(id)) continue;
    seen.add(id);
    dispatched.push(target.bookingId);
    W.outputJSON(
      {
        bookingId: target.bookingId,
        ref: target.ref,
        targetVersion: command.targetVersion
      },
      V.topics.upgradeDispatch,
      target.bookingId
    );
    W.output(
      JSON.stringify({
        ref: target.ref,
        value: {
          type: "upgrade",
          targetVersion: command.targetVersion
        } satisfies WorkerVersioningCommand
      }),
      RESUME_TOPIC,
      target.bookingId
    );
  }
  return {
    targetVersion: command.targetVersion,
    dispatched,
    skipped: []
  };
}

export default function entry(
  envelope:
    | VersionedEnvelope<WorkerVersioningPayload>
    | HandoffEnvelope<WorkerVersioningPayload>
    | UpgradeManagerEnvelope
): unknown {
  if (envelope.workflow === V.workflows.upgradeManager) {
    return dispatchWorkerUpgrade((envelope as UpgradeManagerEnvelope).command);
  }
  if (envelope.workflow !== WORKFLOW) {
    throw new Error(`unsupported workflow ${envelope.workflow}`);
  }

  const workflowEnvelope = envelope as
    | VersionedEnvelope<WorkerVersioningPayload>
    | HandoffEnvelope<WorkerVersioningPayload>;
  const state = normalizeState(workflowEnvelope);

  if (state.mode === "pinned") {
    if (workflowEnvelope.kind === "handoff") {
      throw new Error("pinned workflows do not accept handoff envelopes");
    }
    if (workflowEnvelope.version.major >= VERSION_2_0.major) {
      return runPinnedV2(
        workflowEnvelope as VersionedEnvelope<WorkerVersioningPayload>
      );
    }
    return runPinnedV1(
      workflowEnvelope as VersionedEnvelope<WorkerVersioningPayload>
    );
  }

  if (workflowEnvelope.kind === "handoff") {
    return runAutoV1_1(workflowEnvelope, workflowEnvelope.version);
  }
  if (workflowEnvelope.version.major >= VERSION_2_0.major) {
    return runAutoV1_1(workflowEnvelope, VERSION_2_0);
  }
  if (workflowEnvelope.version.minor >= VERSION_1_1.minor) {
    return runAutoV1_1(workflowEnvelope);
  }
  return runAutoV1_0(
    workflowEnvelope as VersionedEnvelope<WorkerVersioningPayload>
  );
}

export const manifest = {
  outputTopics: [
    topics.awaitSignal,
    topics.activity,
    topics.incompatibleActivity,
    topics.state,
    V.topics.awaitUpgrade,
    V.topics.handoff,
    V.topics.upgradeDispatch
  ]
};
