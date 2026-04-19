const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

export type TimerExamplesInput =
  | {
      kind: "processOrder";
      orderProcessingMS?: number;
      sendDelayedEmailTimeoutMS?: number;
    }
  | {
      kind: "countdown";
      initialDelayMS?: number;
    };

type CountdownSignal =
  | { type: "setDeadline"; delayMS: number }
  | { type: "getTimeLeft"; reply: string };

type ProcessOrderEvent =
  | { type: "processed" }
  | { type: "timeout" };

type CountdownEvent =
  | CountdownSignal
  | { type: "timeout"; timerId: number };

type CountdownQueryReply = {
  reply: string;
  timeLeftMS: number;
};

const DEFAULT_ORDER_PROCESSING_MS = 300;
const DEFAULT_REMINDER_MS = 100;
const DEFAULT_COUNTDOWN_MS = 1000;

function processOrderResumeEvent(): ProcessOrderEvent {
  return { type: "processed" };
}

function reminderTimeoutKey(): string {
  return `${W.threadId}|${JSON.stringify({
    ref: "main",
    value: {
      type: "timeout"
    } satisfies ProcessOrderEvent
  })}`;
}

function scheduleReminderTimeout(ms: number): string {
  const key = reminderTimeoutKey();
  W.output(`${ms}`, "workflow-scheduler", key);
  return key;
}

function publishProcessOrderRequest(): void {
  W.outputJSON(
    {
      ref: "main",
      value: processOrderResumeEvent()
    },
    "temporal-timer-examples-process-order"
  );
}

async function waitForTimeout(label: string, ms: number): Promise<void> {
  const resume = W.ref(`scheduler-${label}`);
  W.output(`${ms}`, "workflow-scheduler", resume.key);
  try {
    await resume;
  } catch (error) {
    if (error instanceof W.CancelToken) {
      W.output("0", "workflow-scheduler", resume.key);
    }
    throw error;
  }
}

function countdownTimeoutResumeKey(timerId: number): string {
  return `${W.threadId}|${JSON.stringify({
    ref: "main",
    value: {
      type: "timeout",
      timerId
    } satisfies CountdownEvent
  })}`;
}

function scheduleCountdownTimeout(timerId: number, delayMS: number): string {
  const key = countdownTimeoutResumeKey(timerId);
  W.output(`${delayMS}`, "workflow-scheduler", key);
  return key;
}

function cancelCountdownTimeout(key: string): void {
  W.output("0", "workflow-scheduler", key);
}

async function processOrderWorkflow(
  input: Extract<TimerExamplesInput, { kind: "processOrder" }>
): Promise<string> {
  const orderProcessingMS =
    input.orderProcessingMS ?? DEFAULT_ORDER_PROCESSING_MS;
  const sendDelayedEmailTimeoutMS =
    input.sendDelayedEmailTimeoutMS ?? DEFAULT_REMINDER_MS;
  publishProcessOrderRequest();
  const reminderKey = scheduleReminderTimeout(sendDelayedEmailTimeoutMS);

  for (;;) {
    const event = await W.refId<ProcessOrderEvent>("main");
    if (event.type === "processed") {
      cancelCountdownTimeout(reminderKey);
      return "Order completed!";
    }
    W.outputJSON(
      {
        message:
          "Order processing is taking longer than expected, but don't worry—the job is still running!",
        orderProcessingMS,
        sendDelayedEmailTimeoutMS
      },
      "temporal-timer-examples-send-notification-email"
    );
    for (;;) {
      const followUp = await W.refId<ProcessOrderEvent>("main");
      if (followUp.type === "processed") {
        return "Order completed!";
      }
    }
  }
}

function publishTimeLeft(reply: string, timeLeftMS: number): void {
  W.outputJSON(
    {
      reply,
      timeLeftMS
    } satisfies CountdownQueryReply,
    "temporal-timer-examples-countdown-state"
  );
}

async function countdownWorkflow(
  input: Extract<TimerExamplesInput, { kind: "countdown" }>
): Promise<{ status: "done" }> {
  let delayMS = input.initialDelayMS ?? DEFAULT_COUNTDOWN_MS;
  let timerId = 0;
  let timerKey = scheduleCountdownTimeout(timerId, delayMS);

  for (;;) {
    const event = await W.refId<CountdownEvent>("main");
    switch (event.type) {
      case "getTimeLeft":
        publishTimeLeft(event.reply, delayMS);
        break;
      case "setDeadline":
        cancelCountdownTimeout(timerKey);
        delayMS = event.delayMS;
        timerId += 1;
        timerKey = scheduleCountdownTimeout(timerId, delayMS);
        break;
      case "timeout":
        if (event.timerId !== timerId) {
          break;
        }
        W.outputJSON({ status: "done" }, "temporal-timer-examples-countdown-done");
        return { status: "done" };
    }
  }
}

export default async function entry(
  input: TimerExamplesInput
): Promise<string | { status: "done" }> {
  if (input.kind === "processOrder") {
    return await processOrderWorkflow(input);
  }
  return await countdownWorkflow(input);
}

export const manifest = {
  outputTopics: [
    "workflow-scheduler",
    "temporal-timer-examples-process-order",
    "temporal-timer-examples-send-notification-email",
    "temporal-timer-examples-countdown-state",
    "temporal-timer-examples-countdown-done"
  ]
};
