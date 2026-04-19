const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

export interface EarlyReturnInput {
  confirmDelayMS?: number;
  completeDelayMS?: number;
}

type TransactionReport =
  | { status: "confirmed" }
  | { status: "complete"; finalAmount: number };

type Command = { type: "awaitConfirmation"; reply: string };

type Event =
  | Command
  | { type: "confirmTimeout" }
  | { type: "completeTimeout" };

type EarlyReply = {
  reply: string;
  value: TransactionReport;
};

const DEFAULT_CONFIRM_DELAY_MS = 500;
const DEFAULT_COMPLETE_DELAY_MS = 5000;

function timeoutKey(event: Extract<Event, { type: "confirmTimeout" | "completeTimeout" }>): string {
  return `${W.threadId}|${JSON.stringify({
    ref: "main",
    value: event
  })}`;
}

function schedule(event: Extract<Event, { type: "confirmTimeout" | "completeTimeout" }>, ms: number): void {
  W.output(`${ms}`, "workflow-scheduler", timeoutKey(event));
}

function replyConfirmed(reply: string): void {
  W.outputJSON(
    {
      reply,
      value: { status: "confirmed" }
    } satisfies EarlyReply,
    "temporal-early-return-reply"
  );
}

export default async function transactionWorkflow(
  input: EarlyReturnInput = {}
): Promise<TransactionReport> {
  const confirmDelayMS = input.confirmDelayMS ?? DEFAULT_CONFIRM_DELAY_MS;
  const completeDelayMS = input.completeDelayMS ?? DEFAULT_COMPLETE_DELAY_MS;
  let confirmed = false;
  const pendingReplies: string[] = [];

  schedule({ type: "confirmTimeout" }, confirmDelayMS);

  for (;;) {
    const event = await W.refId<Event>("main");
    switch (event.type) {
      case "awaitConfirmation":
        if (confirmed) {
          replyConfirmed(event.reply);
        } else {
          pendingReplies.push(event.reply);
        }
        break;
      case "confirmTimeout":
        if (!confirmed) {
          confirmed = true;
          for (const reply of pendingReplies) {
            replyConfirmed(reply);
          }
          pendingReplies.length = 0;
          schedule({ type: "completeTimeout" }, completeDelayMS);
        }
        break;
      case "completeTimeout":
        return {
          status: "complete",
          finalAmount: 77
        };
    }
  }
}

export const manifest = {
  outputTopics: ["workflow-scheduler", "temporal-early-return-reply"]
};
