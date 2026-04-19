const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");
const S =
  require("@effectful/serialization") as typeof import("@effectful/serialization");

declare const exports: Record<string, unknown>;

export type WorkflowVersion = {
  major: number;
  minor: number;
  patch: number;
};

export type VersionedEnvelope<T = unknown> = {
  workflow: string;
  version: WorkflowVersion;
  kind: "start" | "handoff";
  bookingId: string;
  payload: T;
};

export type UpgradeRequest = {
  targetVersion: WorkflowVersion;
};

export type UpgradeTarget = {
  bookingId: string;
  ref: string;
};

export type BookedResourceKind = "car" | "hotel" | "flight" | "taxi";

export type BookedResource = {
  kind: BookedResourceKind;
  reservationId: string;
  releaseId: string;
};

export type HandoffPayload<T = unknown> = {
  fromVersion: WorkflowVersion;
  toVersion: WorkflowVersion;
  input: T;
  booked: BookedResource[];
};

export type HandoffEnvelope<T = unknown> = VersionedEnvelope<HandoffPayload<T>>;

export type UpgradeManagerCommand = {
  workflow: string;
  targetVersion: WorkflowVersion;
  targets: UpgradeTarget[];
};

export type UpgradeManagerEnvelope = {
  workflow: typeof workflows.upgradeManager;
  command: UpgradeManagerCommand;
};

export type UpgradeManagerResult = {
  targetVersion: WorkflowVersion;
  dispatched: string[];
  skipped: string[];
};

export type UpgradeResolution = {
  kind: "upgrade";
  targetVersion: WorkflowVersion;
};

const RESUME_TOPIC = "workflow-resume";
const UPGRADE_REF_ID = "versioning-upgrade";

export const workflows = {
  upgradeManager: "versioning-upgrade-manager"
} as const;

export const topics = {
  awaitUpgrade: "versioning-await-upgrade",
  upgradeDispatch: "versioning-upgrade-dispatch",
  handoff: "versioning-handoff"
} as const;

export function formatVersion(version: WorkflowVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

export function sameMajor(
  left: WorkflowVersion,
  right: WorkflowVersion
): boolean {
  return left.major === right.major;
}

export function sameMinor(
  left: WorkflowVersion,
  right: WorkflowVersion
): boolean {
  return sameMajor(left, right) && left.minor === right.minor;
}

export function canReuse(
  current: WorkflowVersion,
  target: WorkflowVersion
): boolean {
  return sameMajor(current, target);
}

export function needsMinorUpgrade(
  current: WorkflowVersion,
  target: WorkflowVersion
): boolean {
  return sameMajor(current, target) && target.minor > current.minor;
}

export function ignoresPatchDifference(
  current: WorkflowVersion,
  target: WorkflowVersion
): boolean {
  return sameMinor(current, target);
}

export function stableReleaseId(
  bookingId: string,
  kind: BookedResourceKind,
  reservationId: string
): string {
  return `${bookingId}:${kind}:${reservationId}:release`;
}

export function createBookedResource(
  bookingId: string,
  kind: BookedResourceKind,
  reservationId: string
): BookedResource {
  return {
    kind,
    reservationId,
    releaseId: stableReleaseId(bookingId, kind, reservationId)
  };
}

export function createEnvelope<T>(
  workflow: string,
  version: WorkflowVersion,
  kind: VersionedEnvelope<T>["kind"],
  bookingId: string,
  payload: T
): VersionedEnvelope<T> {
  return { workflow, version, kind, bookingId, payload };
}

export function createHandoffEnvelope<T>(
  workflow: string,
  bookingId: string,
  fromVersion: WorkflowVersion,
  toVersion: WorkflowVersion,
  input: T,
  booked: BookedResource[]
): HandoffEnvelope<T> {
  return {
    workflow,
    version: toVersion,
    kind: "handoff",
    bookingId,
    payload: {
      fromVersion,
      toVersion,
      input,
      booked
    }
  };
}

export function createUpgradeManagerEnvelope(
  workflow: string,
  targetVersion: WorkflowVersion,
  targets: UpgradeTarget[]
): UpgradeManagerEnvelope {
  return {
    workflow: workflows.upgradeManager,
    command: {
      workflow,
      targetVersion,
      targets
    }
  };
}

export function requestUpgrade(currentVersion: WorkflowVersion) {
  const control = W.refId<UpgradeRequest>(UPGRADE_REF_ID);
  W.outputJSON(
    {
      ref: control.id,
      currentVersion
    },
    topics.awaitUpgrade
  );
  return control;
}

export function dispatchUpgrade(
  target: UpgradeTarget,
  targetVersion: WorkflowVersion
): void {
  W.outputJSON(
    {
      bookingId: target.bookingId,
      ref: target.ref,
      targetVersion
    },
    topics.upgradeDispatch,
    target.bookingId
  );
  W.output(
    JSON.stringify({
      ref: target.ref,
      value: { targetVersion }
    } satisfies { ref: string; value: UpgradeRequest }),
    RESUME_TOPIC,
    target.bookingId
  );
}

export function dispatchManagedUpgrade(
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
    dispatchUpgrade(target, command.targetVersion);
  }
  return {
    targetVersion: command.targetVersion,
    dispatched,
    skipped: []
  };
}

export async function runUpgradeManagerWorkflow(
  command: UpgradeManagerCommand
): Promise<UpgradeManagerResult> {
  return dispatchManagedUpgrade(command);
}

export function runVersioningWorkflow(
  envelope: UpgradeManagerEnvelope
): unknown {
  if (envelope.workflow !== workflows.upgradeManager) {
    throw new Error(`unsupported versioning workflow ${envelope.workflow}`);
  }
  return runUpgradeManagerWorkflow(envelope.command);
}

export function resolveUpgrade(
  currentVersion: WorkflowVersion,
  signal: UpgradeRequest
): UpgradeResolution {
  if (!canReuse(currentVersion, signal.targetVersion)) {
    throw new Error(
      `cannot reuse ${formatVersion(currentVersion)} for ${formatVersion(
        signal.targetVersion
      )}`
    );
  }
  if (!needsMinorUpgrade(currentVersion, signal.targetVersion)) {
    throw new Error(
      `target ${formatVersion(signal.targetVersion)} does not require a minor upgrade`
    );
  }
  return {
    kind: "upgrade",
    targetVersion: signal.targetVersion
  };
}

export async function waitForUpgrade(
  currentVersion: WorkflowVersion
): Promise<UpgradeResolution> {
  return resolveUpgrade(currentVersion, await requestUpgrade(currentVersion));
}

(S as any).regOpaqueObject?.(exports, "workflow-versioning-demo");
