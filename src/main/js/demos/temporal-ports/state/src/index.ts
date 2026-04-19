const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

type Command =
  | { type: "setValue"; key: string; value: number }
  | { type: "getValue"; key: string; reply: string }
  | { type: "cancel" };

export interface QueryReply {
  reply: string;
  key: string;
  value: number | undefined;
}

export interface StateSnapshot {
  entries: Record<string, number>;
}

function snapshot(state: Map<string, number>): StateSnapshot {
  return {
    entries: Object.fromEntries(
      [...state.entries()].sort(([left], [right]) => left.localeCompare(right))
    )
  };
}

export default async function trackState(): Promise<StateSnapshot> {
  const state = new Map<string, number>();

  for (;;) {
    const command = await W.refId<Command>("main");
    switch (command.type) {
      case "setValue":
        state.set(command.key, command.value);
        break;
      case "getValue":
        W.outputJSON(
          {
            reply: command.reply,
            key: command.key,
            value: state.get(command.key)
          } satisfies QueryReply,
          "temporal-state-query-result"
        );
        break;
      case "cancel":
        return snapshot(state);
    }
  }
}

export const manifest = {
  outputTopics: ["temporal-state-query-result"]
};
