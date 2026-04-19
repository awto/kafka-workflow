const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

export interface SignalsQueriesInput {
  initiallyBlocked?: boolean;
}

type Signal =
  | { type: "query" }
  | { type: "unblock" }
  | { type: "block" }
  | { type: "addMessage"; message: string }
  | { type: "finish" }
  | { type: "cancel" };

type WorkflowState = {
  blocked: boolean;
  history: string[];
};

export default async function entry(
  input: SignalsQueriesInput = {}
): Promise<{ status: "finished" | "canceled"; blocked: boolean; history: string[] }> {
  const state: WorkflowState = {
    blocked: input.initiallyBlocked ?? true,
    history: []
  };

  for (;;) {
    const signal = await W.refId<Signal>("main");
    switch (signal.type) {
      case "query":
        W.outputJSON(state, "temporal-signals-queries-state");
        break;
      case "unblock":
        state.blocked = false;
        state.history.push("unblock");
        break;
      case "block":
        state.blocked = true;
        state.history.push("block");
        break;
      case "addMessage":
        state.history.push(signal.message);
        break;
      case "cancel":
        return { status: "canceled", blocked: state.blocked, history: state.history };
      case "finish":
        return { status: "finished", blocked: state.blocked, history: state.history };
    }
  }
}

export const manifest = {
  outputTopics: ["temporal-signals-queries-state"]
};
