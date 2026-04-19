const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

export interface OneClickBuyInput {
  itemId: string;
  confirmationWindowMS?: number;
}

type PurchaseState =
  | "PURCHASE_PENDING"
  | "PURCHASE_CONFIRMED"
  | "PURCHASE_CANCELED";

type Signal =
  | { type: "query" }
  | { type: "cancelPurchase" }
  | { type: "timeout" };

const DEFAULT_CONFIRMATION_WINDOW_MS = 200;

function timeoutResumeKey(): string {
  return `${W.threadId}|${JSON.stringify({
    ref: "main",
    value: { type: "timeout" } satisfies Signal
  })}`;
}

function scheduleTimeout(ms: number): string {
  const key = timeoutResumeKey();
  W.output(`${ms}`, "workflow-scheduler", key);
  return key;
}

function cancelTimeout(key: string): void {
  W.output("0", "workflow-scheduler", key);
}

function publishState(itemId: string, purchaseState: PurchaseState): void {
  W.outputJSON(
    { itemId, purchaseState },
    "temporal-nextjs-ecommerce-oneclick-state"
  );
}

export default async function entry(
  input: OneClickBuyInput
): Promise<{ itemId: string; purchaseState: PurchaseState }> {
  const confirmationWindowMS =
    input.confirmationWindowMS ?? DEFAULT_CONFIRMATION_WINDOW_MS;
  let purchaseState: PurchaseState = "PURCHASE_PENDING";
  const timerKey = scheduleTimeout(confirmationWindowMS);

  for (;;) {
    const signal = await W.refId<Signal>("main");
    switch (signal.type) {
      case "query":
        publishState(input.itemId, purchaseState);
        break;
      case "cancelPurchase":
        purchaseState = "PURCHASE_CANCELED";
        cancelTimeout(timerKey);
        W.outputJSON(
          { itemId: input.itemId, purchaseState },
          "temporal-nextjs-ecommerce-oneclick-canceled"
        );
        return { itemId: input.itemId, purchaseState };
      case "timeout":
        purchaseState = "PURCHASE_CONFIRMED";
        W.outputJSON(
          { itemId: input.itemId, purchaseState },
          "temporal-nextjs-ecommerce-oneclick-checkout"
        );
        return { itemId: input.itemId, purchaseState };
    }
  }
}

export const manifest = {
  outputTopics: [
    "workflow-scheduler",
    "temporal-nextjs-ecommerce-oneclick-state",
    "temporal-nextjs-ecommerce-oneclick-checkout",
    "temporal-nextjs-ecommerce-oneclick-canceled"
  ]
};
