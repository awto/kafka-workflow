const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");
const S =
  require("@effectful/serialization") as typeof import("@effectful/serialization");
const V = require("../../workflow-versioning-demo/src/index") as typeof import("../../workflow-versioning-demo/src/index");

import type {
  HandoffEnvelope,
  VersionedEnvelope,
  WorkflowVersion
} from "../../workflow-versioning-demo/src/index";
import type {
  CartItem,
  CartSignal,
  CartSnapshot,
  EcommerceInput
} from "../../workflow-ecommerce-v1_0/src/index";

declare const exports: Record<string, unknown>;

export const VERSION: WorkflowVersion = {
  major: 1,
  minor: 1,
  patch: 0
};

const MAIN_REF_ID = "main";
const DEFAULT_TIMEOUT_MS = 10_000;

export const topics = {
  checkoutError: "checkoutError",
  reminder: "ecommerce-reminder",
  discountReminder: "ecommerce-discount-reminder",
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

function startState(
  envelope: VersionedEnvelope<EcommerceInput> | HandoffEnvelope<CartSnapshot>
): CartSnapshot {
  if (envelope.kind === "handoff") {
    const handoff = envelope as HandoffEnvelope<CartSnapshot>;
    if (!V.canReuse(handoff.payload.fromVersion, VERSION)) {
      throw new Error(
        `cannot adopt ${V.formatVersion(
          handoff.payload.fromVersion
        )} in ${V.formatVersion(VERSION)}`
      );
    }
    return {
      config: normalizeInput(handoff.payload.input.config),
      items: cloneItems(handoff.payload.input.items),
      email: handoff.payload.input.email,
      reminderStage: handoff.payload.input.reminderStage,
      discountCode: handoff.payload.input.discountCode
    };
  }
  return {
    config: normalizeInput((envelope as VersionedEnvelope<EcommerceInput>).payload),
    items: [],
    email: "",
    reminderStage: 0,
    discountCode: undefined
  };
}

function getExistingItem(items: CartItem[], item: CartItem): CartItem | undefined {
  return items.find(({ productId }) => productId === item.productId);
}

function snapshotState(state: CartSnapshot): CartSnapshot {
  return {
    config: state.config,
    items: cloneItems(state.items),
    email: state.email,
    reminderStage: state.reminderStage,
    discountCode: state.discountCode
  };
}

export async function runEcommerceV1_1(
  envelope: VersionedEnvelope<EcommerceInput> | HandoffEnvelope<CartSnapshot>
): Promise<unknown> {
  const state = startState(envelope);
  for (;;) {
    const timeoutKey = scheduleTimeout(state.config.abandonedCartTimeoutMS);
    const signal = await W.refId<CartSignal>(MAIN_REF_ID);
    if (signal.type !== "timeout") {
      cancelTimeout(timeoutKey);
    }
    const item = "item" in signal ? signal.item : undefined;
    switch (signal.type) {
      case "addToCart": {
        const existing = getExistingItem(state.items, item!);
        if (existing) {
          existing.quantity += item!.quantity;
        } else {
          state.items.push({ ...item! });
        }
        break;
      }
      case "removeFromCart": {
        const index = state.items.findIndex(
          ({ productId }) => productId === item!.productId
        );
        if (index === -1) break;
        const existing = state.items[index];
        existing.quantity -= item!.quantity;
        if (existing.quantity <= 0) {
          state.items.splice(index, 1);
        }
        break;
      }
      case "timeout":
        if (!state.email || state.reminderStage >= 2) {
          return "abondoned";
        }
        if (state.reminderStage === 0) {
          state.reminderStage = 1;
          W.output(state.email, topics.reminder);
          break;
        }
        state.reminderStage = 2;
        state.discountCode ??= "SAVE10";
        W.outputJSON(
          {
            email: state.email,
            code: state.discountCode
          },
          topics.discountReminder
        );
        break;
      case "updateEmail":
        state.email = signal.email;
        break;
      case "checkout":
        if (!state.email) {
          W.output("Must have email to check out!", topics.checkoutError);
          break;
        }
        if (state.items.length === 0) {
          W.output("Must have items to check out!", topics.checkoutError);
          break;
        }
        return {
          version: VERSION,
          email: state.email,
          items: cloneItems(state.items),
          discountCode: state.discountCode
        };
      case "getCart":
        W.outputJSON(snapshotState(state), topics.getCart);
        break;
    }
  }
}

export const outputTopics = [
  topics.checkoutError,
  topics.reminder,
  topics.discountReminder,
  topics.getCart,
  topics.scheduler
];

(S as any).regOpaqueObject?.(exports, "workflow-ecommerce-v1_1");
