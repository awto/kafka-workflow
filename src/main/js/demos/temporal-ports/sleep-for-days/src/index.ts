const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

type Input = {
  days?: number;
  message?: string;
};

type CompletionSignal = {
  completedBy?: string;
};

type ActivityResult = {
  sent: true;
};

export const topics = {
  sendEmail: "temporal-sleep-for-days-send-email",
  awaitComplete: "temporal-sleep-for-days-await-complete",
  awaitCompleteCancel: "temporal-sleep-for-days-await-complete-cancel",
  scheduler: "workflow-scheduler"
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

async function sendEmail(message: string, iteration: number): Promise<void> {
  const reply = W.ref<ActivityResult>(`send-email:${iteration}`);
  W.outputJSON({ iteration, message, ref: reply.id }, topics.sendEmail);
  await reply;
}

async function sleep(ms: number, iteration: number): Promise<void> {
  const timer = W.ref(`sleep:${iteration}`);
  W.output(`${ms}`, topics.scheduler, timer.key);
  try {
    await timer;
  } catch (error) {
    if (error instanceof W.CancelToken) {
      W.output("0", topics.scheduler, timer.key);
    }
    throw error;
  }
}

async function sleepBranch(days: number, iteration: number) {
  await sleep(days * DAY_MS, iteration);
  return {
    type: "timer" as const
  };
}

async function completeBranch(): Promise<{
  type: "complete";
  signal: CompletionSignal;
}> {
  const complete = W.refId<CompletionSignal>("complete");
  W.outputJSON({ ref: complete.id }, topics.awaitComplete);
  try {
    return {
      type: "complete",
      signal: await complete
    };
  } catch (error) {
    if (error instanceof W.CancelToken) {
      W.outputJSON({ ref: complete.id }, topics.awaitCompleteCancel);
    }
    throw error;
  }
}

export default async function sleepForDays(input: Input = {}): Promise<unknown> {
  const days = input.days ?? 30;
  const message = input.message ?? "Still sleeping";
  let emailsSent = 0;

  for (;;) {
    emailsSent++;
    await sendEmail(`${message}: ${emailsSent}`, emailsSent);
    const result = await Promise.race([
      sleepBranch(days, emailsSent),
      completeBranch()
    ]);
    if (result.type === "complete") {
      return {
        status: "completed",
        completedBy: result.signal.completedBy ?? "unknown",
        emailsSent
      };
    }
  }
}

export const manifest = {
  outputTopics: [
    topics.sendEmail,
    topics.awaitComplete,
    topics.awaitCompleteCancel,
    topics.scheduler
  ]
};
