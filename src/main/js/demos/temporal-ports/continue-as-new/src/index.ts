const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

export interface ContinueAsNewInput {
  iteration?: number;
  maxIterations?: number;
  delayMS?: number;
}

type TimeoutSignal = {
  type: "timeout";
  iteration: number;
};

const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_DELAY_MS = 50;

function timeoutResumeKey(iteration: number): string {
  return `${W.threadId}|${JSON.stringify({
    ref: "main",
    value: { type: "timeout", iteration } satisfies TimeoutSignal
  })}`;
}

async function waitForTimer(iteration: number, delayMS: number): Promise<void> {
  const key = timeoutResumeKey(iteration);
  W.output(`${delayMS}`, "workflow-scheduler", key);
  const signal = await W.refId<TimeoutSignal>("main");
  if (signal.type !== "timeout" || signal.iteration !== iteration) {
    throw new Error(`unexpected signal at iteration ${iteration}`);
  }
}

export default async function entry(
  input: ContinueAsNewInput = {}
): Promise<{ iterations: number; status: "completed" }> {
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const delayMS = input.delayMS ?? DEFAULT_DELAY_MS;

  for (let iteration = input.iteration ?? 0; iteration < maxIterations; iteration += 1) {
    W.outputJSON({ iteration }, "temporal-continue-as-new-iteration");
    await waitForTimer(iteration, delayMS);
  }

  return {
    iterations: maxIterations,
    status: "completed"
  };
}

export const manifest = {
  outputTopics: ["temporal-continue-as-new-iteration", "workflow-scheduler"]
};
