const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

export interface CounterInput {
  initialValue: number;
  iterations?: number;
  tickMS?: number;
}

type CounterState = {
  version: number;
  value: number;
};

type TimeoutSignal = {
  type: "tick";
  iteration: number;
};

const DEFAULT_ITERATIONS = 10;
const DEFAULT_TICK_MS = 50;

function timeoutResumeKey(iteration: number): string {
  return `${W.threadId}|${JSON.stringify({
    ref: "main",
    value: { type: "tick", iteration } satisfies TimeoutSignal
  })}`;
}

function emitState(state: CounterState): void {
  W.outputJSON(state, "temporal-query-subscriptions-state");
}

async function waitForTick(iteration: number, tickMS: number): Promise<void> {
  W.output(`${tickMS}`, "workflow-scheduler", timeoutResumeKey(iteration));
  const signal = await W.refId<TimeoutSignal>("main");
  if (signal.type !== "tick" || signal.iteration !== iteration) {
    throw new Error(`unexpected tick signal at iteration ${iteration}`);
  }
}

export default async function entry(
  input: CounterInput
): Promise<number> {
  const iterations = input.iterations ?? DEFAULT_ITERATIONS;
  const tickMS = input.tickMS ?? DEFAULT_TICK_MS;
  const state: CounterState = {
    version: 0,
    value: input.initialValue
  };

  emitState(state);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    await waitForTick(iteration, tickMS);
    state.value += 10;
    state.version += 1;
    emitState(state);
  }

  return state.value;
}

export const manifest = {
  outputTopics: ["temporal-query-subscriptions-state", "workflow-scheduler"]
};
