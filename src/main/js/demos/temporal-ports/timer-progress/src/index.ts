const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

export interface TimerProgressInput {
  steps?: number;
  tickMS?: number;
  increment?: number;
}

type TimerProgressEvent =
  | { type: "tick"; step: number }
  | { type: "getProgress"; reply: string };

export const topics = {
  progress: "temporal-timer-progress-progress",
  queryResult: "temporal-timer-progress-query-result",
  scheduler: "workflow-scheduler"
} as const;

function normalizeSteps(value: number | undefined): number {
  return Math.max(1, Math.trunc(value ?? 10));
}

function normalizeDelay(value: number | undefined): number {
  return Math.max(0, Math.trunc(value ?? 1000));
}

function tickResumeEvent(step: number): TimerProgressEvent {
  return {
    type: "tick",
    step
  };
}

function tickResumeKey(step: number): string {
  return `${W.threadId}|${JSON.stringify({
    ref: "main",
    value: tickResumeEvent(step)
  })}`;
}

function scheduleTick(step: number, tickMS: number): string {
  const key = tickResumeKey(step);
  W.output(`${tickMS}`, topics.scheduler, key);
  return key;
}

function publishProgress(step: number, progress: number): void {
  W.outputJSON({ step, progress }, topics.progress);
}

function publishProgressQuery(reply: string, progress: number): void {
  W.outputJSON({ reply, progress }, topics.queryResult, reply);
}

async function waitForTick(step: number, progress: number): Promise<void> {
  for (;;) {
    const event = await W.refId<TimerProgressEvent>("main");
    switch (event.type) {
      case "getProgress":
        publishProgressQuery(event.reply, progress);
        break;
      case "tick":
        if (event.step === step) {
          return;
        }
        break;
    }
  }
}

export default async function timerProgress(
  input: TimerProgressInput = {}
): Promise<{ progress: number }> {
  const steps = normalizeSteps(input.steps);
  const tickMS = normalizeDelay(input.tickMS);
  const increment = input.increment ?? 100 / steps;
  let progress = 0;

  for (let step = 1; step <= steps; step += 1) {
    scheduleTick(step, tickMS);
    await waitForTick(step, progress);
    progress = Math.min(100, progress + increment);
    publishProgress(step, progress);
  }

  return { progress };
}

export const manifest = {
  outputTopics: [topics.progress, topics.queryResult, topics.scheduler]
};
