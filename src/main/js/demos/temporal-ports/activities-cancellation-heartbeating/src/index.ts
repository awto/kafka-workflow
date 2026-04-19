const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

export type ProgressInput = {
  total?: number;
};

type ProgressEvent =
  | {
      type: "progress";
      progress: number;
    }
  | {
      type: "done";
    };

type CancelSignal = {
  reason?: string;
};

export const topics = {
  startActivity: "temporal-activity-cancel-start",
  heartbeat: "temporal-activity-cancel-heartbeat",
  awaitCancel: "temporal-activity-cancel-await-cancel",
  cancelActivity: "temporal-activity-cancel-cancel-activity",
  cleanup: "temporal-activity-cancel-cleanup"
} as const;

async function fakeProgress(total: number): Promise<"completed"> {
  let lastProgress = 0;
  W.outputJSON(
    {
      ref: "progress",
      total
    },
    topics.startActivity
  );
  try {
    while (lastProgress < total) {
      const event = await W.refId<ProgressEvent>("progress");
      if (event.type === "done") {
        return "completed";
      }
      lastProgress = event.progress;
      W.outputJSON(
        {
          progress: lastProgress
        },
        topics.heartbeat
      );
    }
    return "completed";
  } catch (error) {
    if (error instanceof W.CancelToken) {
      W.outputJSON(
        {
          ref: "progress",
          lastProgress
        },
        topics.cancelActivity
      );
      W.outputJSON(
        {
          lastProgress
        },
        topics.cleanup
      );
    }
    throw error;
  }
}

async function waitForCancel(): Promise<CancelSignal> {
  const cancel = W.refId<CancelSignal>("cancel");
  W.outputJSON({ ref: cancel.id }, topics.awaitCancel);
  return await cancel;
}

async function progressBranch(total: number) {
  const status = await fakeProgress(total);
  return {
    type: "completed" as const,
    status
  };
}

async function cancelBranch() {
  const signal = await waitForCancel();
  return {
    type: "cancelled" as const,
    signal
  };
}

export default async function runCancellableActivity(
  input: ProgressInput = {}
): Promise<unknown> {
  const total = input.total ?? 100;
  const result = await Promise.race([progressBranch(total), cancelBranch()]);
  if (result.type === "cancelled") {
    return {
      status: "cancelled",
      reason: result.signal.reason ?? "cancel requested"
    };
  }
  return {
    status: result.status
  };
}

export const manifest = {
  outputTopics: [
    topics.startActivity,
    topics.heartbeat,
    topics.awaitCancel,
    topics.cancelActivity,
    topics.cleanup
  ]
};
