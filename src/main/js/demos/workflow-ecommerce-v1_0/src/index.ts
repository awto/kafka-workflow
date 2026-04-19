const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");
const S =
  require("@effectful/serialization") as typeof import("@effectful/serialization");
const V = require("../../workflow-versioning-demo/src/index") as typeof import("../../workflow-versioning-demo/src/index");

import type {
  UpgradeRequest,
  VersionedEnvelope,
  WorkflowVersion
} from "../../workflow-versioning-demo/src/index";

declare const exports: Record<string, unknown>;

export const VERSION: WorkflowVersion = {
  major: 1,
  minor: 0,
  patch: 0
};

export type CartItem = {
  productId: string;
  quantity: number;
};

export type EcommerceInput = {
  abandonedCartTimeoutMS?: number;
};

export type CartSignal =
  | { type: "addToCart"; item: CartItem }
  | { type: "removeFromCart"; item: CartItem }
  | { type: "updateEmail"; email: string }
  | { type: "checkout" }
  | { type: "getCart" }
  | { type: "timeout" };

export type CartSnapshot = {
  config: Required<EcommerceInput>;
  items: CartItem[];
  email: string;
  reminderStage: number;
  discountCode?: string;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const MAIN_REF_ID = "main";

export const topics = {
  checkoutError: "checkoutError",
  reminder: "ecommerce-reminder",
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

function cloneItems(items: CartItem[]): CartItem[] {
  return items.map((item) => ({ ...item }));
}

function snapshotState(
  config: Required<EcommerceInput>,
  items: CartItem[],
  email: string,
  reminderStage: number,
  discountCode?: string
): CartSnapshot {
  return {
    config,
    items: cloneItems(items),
    email,
    reminderStage,
    discountCode
  };
}

function emitAwaitUpgrade(currentVersion: WorkflowVersion): void {
  W.outputJSON(
    {
      ref: MAIN_REF_ID,
      currentVersion
    },
    V.topics.awaitUpgrade
  );
}

function isUpgradeRequest(value: unknown): value is UpgradeRequest {
  return !!value && typeof value === "object" && "targetVersion" in value;
}

async function nextSignal(): Promise<CartSignal | UpgradeRequest> {
  return await W.refId<CartSignal | UpgradeRequest>(MAIN_REF_ID);
}

function getExistingItem(items: CartItem[], item: CartItem): CartItem | undefined {
  return items.find(({ productId }) => productId === item.productId);
}

export async function runEcommerceV1_0(
  envelope: VersionedEnvelope<EcommerceInput>
): Promise<unknown> {
  const config = normalizeInput(envelope.payload);
  const items: CartItem[] = [];
  let email = "";
  let reminderStage = 0;

  emitAwaitUpgrade(VERSION);
  for (;;) {
    const timeoutKey = scheduleTimeout(config.abandonedCartTimeoutMS);
    const signal = await nextSignal();

    if (isUpgradeRequest(signal)) {
      cancelTimeout(timeoutKey);
      const upgrade = V.resolveUpgrade(VERSION, signal);
      W.outputJSON(
        V.createHandoffEnvelope(
          envelope.workflow,
          envelope.bookingId,
          VERSION,
          upgrade.targetVersion,
          snapshotState(config, items, email, reminderStage),
          []
        ),
        V.topics.handoff
      );
      return {
        status: "upgraded",
        fromVersion: VERSION,
        toVersion: upgrade.targetVersion,
        items: cloneItems(items),
        email,
        reminderStage
      };
    }

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
        if (!email || reminderStage >= 1) {
          return "abondoned";
        }
        reminderStage = 1;
        W.output(email, topics.reminder);
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
          items: cloneItems(items)
        };
      case "getCart":
        W.outputJSON(snapshotState(config, items, email, reminderStage), topics.getCart);
        break;
    }
  }
}

export const outputTopics = [
  V.topics.awaitUpgrade,
  V.topics.handoff,
  topics.checkoutError,
  topics.reminder,
  topics.getCart,
  topics.scheduler
];

(S as any).regOpaqueObject?.(exports, "workflow-ecommerce-v1_0");
