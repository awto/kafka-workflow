const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");
const S =
  require("@effectful/serialization") as typeof import("@effectful/serialization");

import type {
  HandoffEnvelope,
  VersionedEnvelope,
  WorkflowVersion
} from "../../workflow-versioning-demo/src/index";
import type {
  CartItem,
  CartSignal,
  EcommerceInput
} from "../../workflow-ecommerce-v1_0/src/index";

declare const exports: Record<string, unknown>;

export const VERSION: WorkflowVersion = {
  major: 2,
  minor: 0,
  patch: 0
};

const MAIN_REF_ID = "main";
const DEFAULT_TIMEOUT_MS = 10_000;

export const topics = {
  checkoutError: "checkoutError",
  reminder: "ecommerce-v2-reminder",
  getCart: "getCart",
  scheduler: "workflow-scheduler"
} as const;

function normalizeInput(
  input: EcommerceInput | undefined
): Required<EcommerceInput> {
  return {
    abandonedCartTimeoutMS: input?.abandonedCartTimeoutMS ?? DEFAULT_TIMEOUT_MS
  };
}

function cloneItems(items: CartItem[]): CartItem[] {
  return items.map((item) => ({ ...item }));
}

function timeoutResumeKey() {
  return `${W.threadId}|${JSON.stringify({
    ref: MAIN_REF_ID,
    value: { type: "timeout" }
  })}`;
}

function scheduleTimeout(ms: number): string {
  const key = timeoutResumeKey();
  W.output(`${ms}`, topics.scheduler, key);
  return key;
}

function cancelTimeout(key: string): void {
  W.output("0", topics.scheduler, key);
}

function getExistingItem(items: CartItem[], item: CartItem): CartItem | undefined {
  return items.find(({ productId }) => productId === item.productId);
}

export async function runEcommerceV2_0(
  envelope: VersionedEnvelope<EcommerceInput> | HandoffEnvelope<unknown>
): Promise<unknown> {
  if (envelope.kind === "handoff") {
    throw new Error("major 2 does not reuse major 1 handoffs");
  }
  const config = normalizeInput((envelope as VersionedEnvelope<EcommerceInput>).payload);
  const items: CartItem[] = [];
  let email = "";
  let reminderSent = false;
  for (;;) {
    const timeoutKey = scheduleTimeout(config.abandonedCartTimeoutMS);
    const signal = await W.refId<CartSignal>(MAIN_REF_ID);
    if (signal.type !== "timeout") {
      cancelTimeout(timeoutKey);
    }
    const item = "item" in signal ? signal.item : undefined;
    switch (signal.type) {
      case "addToCart": {
        const existing = getExistingItem(items, item!);
        if (existing) {
          existing.quantity += item!.quantity;
        } else {
          items.push({ ...item! });
        }
        break;
      }
      case "removeFromCart": {
        const index = items.findIndex(
          ({ productId }) => productId === item!.productId
        );
        if (index === -1) break;
        const existing = items[index];
        existing.quantity -= item!.quantity;
        if (existing.quantity <= 0) {
          items.splice(index, 1);
        }
        break;
      }
      case "timeout":
        if (!email || reminderSent) {
          return "abondoned";
        }
        reminderSent = true;
        W.outputJSON(
          {
            email,
            channel: "sms"
          },
          topics.reminder
        );
        break;
      case "updateEmail":
        email = signal.email;
        break;
      case "checkout":
        if (!email) {
          W.output("Must have email to check out!", topics.checkoutError);
          break;
        }
        if (items.length === 0) {
          W.output("Must have items to check out!", topics.checkoutError);
          break;
        }
        return {
          version: VERSION,
          email,
          items: cloneItems(items),
          channel: "v2"
        };
      case "getCart":
        W.outputJSON({ config, items: cloneItems(items), email, reminderSent }, topics.getCart);
        break;
    }
  }
}

export const outputTopics = [
  topics.checkoutError,
  topics.reminder,
  topics.getCart,
  topics.scheduler
];

(S as any).regOpaqueObject?.(exports, "workflow-ecommerce-v2_0");
