const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");
const S =
  require("@effectful/serialization") as typeof import("@effectful/serialization");

declare const exports: Record<string, unknown>;

import type { BookedResource } from "../../workflow-versioning-demo/src/index";

export type DelayedReleaseCommand = {
  bookingId: string;
  resource: BookedResource;
  delayMS: number;
};

export type DelayedReleaseEnvelope = {
  workflow: typeof workflows.delayedRelease;
  command: DelayedReleaseCommand;
};

export const DEFAULT_RELEASE_DELAY_MS = 60 * 60 * 1000;
const RESUME_TOPIC = "workflow-resume";

export const workflows = {
  delayedRelease: "versioning-delayed-release"
} as const;

export const topics = {
  awaitRetain: "versioning-await-retain",
  releaseStart: "versioning-release-start",
  releaseCancel: "versioning-release-cancel",
  releaseFired: "versioning-release-fired",
  releaseRetained: "versioning-release-retained",
  scheduler: "workflow-scheduler"
} as const;

export function delayedReleaseThreadId(releaseId: string): string {
  return `versioning-release:${releaseId}`;
}

export function delayedReleaseRetainRefId(releaseId: string): string {
  return `versioning-retain:${releaseId}`;
}

export function requestDelayedRelease(
  bookingId: string,
  resource: BookedResource,
  delayMS = DEFAULT_RELEASE_DELAY_MS
): DelayedReleaseCommand {
  const command = { bookingId, resource, delayMS };
  W.outputJSON(command, topics.releaseStart);
  W.output(
    `new:${JSON.stringify({
      workflow: workflows.delayedRelease,
      command
    } satisfies DelayedReleaseEnvelope)}`,
    RESUME_TOPIC,
    delayedReleaseThreadId(resource.releaseId)
  );
  return command;
}

export function cancelDelayedRelease(
  bookingId: string,
  resource: BookedResource
): void {
  const retain = {
    bookingId,
    releaseId: resource.releaseId,
    reservationId: resource.reservationId,
    kind: resource.kind
  };
  W.outputJSON(retain, topics.releaseCancel);
  W.output(
    JSON.stringify({
      ref: delayedReleaseRetainRefId(resource.releaseId),
      value: retain
    }),
    RESUME_TOPIC,
    delayedReleaseThreadId(resource.releaseId)
  );
}

async function waitForReleaseTimeout(delayMS: number): Promise<"timeout"> {
  const resume = W.ref("scheduler");
  W.output(`${delayMS}`, topics.scheduler, resume.key);
  try {
    await resume;
  } catch (error) {
    if (error instanceof W.CancelToken) {
      W.output("0", topics.scheduler, resume.key);
    }
    throw error;
  }
  return "timeout";
}

export async function delayedReleaseWorkflow(
  command: DelayedReleaseCommand
): Promise<{ released?: string; retained?: string }> {
  const retain = W.refId(
    delayedReleaseRetainRefId(command.resource.releaseId)
  );
  W.outputJSON(
    {
      ref: retain.id,
      bookingId: command.bookingId,
      releaseId: command.resource.releaseId
    },
    topics.awaitRetain
  );
  const winner = await Promise.race([
    (async () => {
      await retain;
      return "retained" as const;
    })(),
    waitForReleaseTimeout(command.delayMS)
  ]);
  if (winner === "timeout") {
    W.outputJSON(command, topics.releaseFired);
    return { released: command.resource.reservationId };
  }
  W.outputJSON(command, topics.releaseRetained);
  return { retained: command.resource.reservationId };
}

export const outputTopics = [
  topics.awaitRetain,
  topics.releaseStart,
  topics.releaseCancel,
  topics.releaseFired,
  topics.releaseRetained,
  topics.scheduler
];

(S as any).regOpaqueObject?.(exports, "workflow-trip-booking-saga-versioned-release");
