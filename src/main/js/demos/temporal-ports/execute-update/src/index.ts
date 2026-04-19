const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

type Command =
  | { type: "fetchAndAdd"; arg: number; reply: string }
  | { type: "done" };

export interface UpdateReply {
  reply: string;
  value?: number;
  error?: string;
}

function rejectUpdate(reply: string, error: string): void {
  W.outputJSON({ reply, error } satisfies UpdateReply, "temporal-execute-update-reply");
}

function acceptUpdate(reply: string, value: number): void {
  W.outputJSON({ reply, value } satisfies UpdateReply, "temporal-execute-update-reply");
}

export default async function counter(): Promise<number> {
  let count = 0;

  for (;;) {
    const command = await W.refId<Command>("main");
    switch (command.type) {
      case "fetchAndAdd":
        if (command.arg < 0) {
          rejectUpdate(command.reply, "Argument must not be negative");
          break;
        }
        acceptUpdate(command.reply, count);
        count += command.arg;
        break;
      case "done":
        return count;
    }
  }
}

export const manifest = {
  outputTopics: ["temporal-execute-update-reply"]
};
