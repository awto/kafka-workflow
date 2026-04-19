const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

export interface CartItem {
  productId: string;
  quantity: number;
}

type CartSignal =
  | { type: "addToCart"; item: CartItem }
  | { type: "removeFromCart"; item: CartItem }
  | { type: "updateEmail"; email: string }
  | { type: "checkout" }
  | { type: "getCart" }
  | { type: "timeout" };

function timeoutResumeKey() {
  return `${W.threadId}|${JSON.stringify({
    ref: "main",
    value: { type: "timeout" }
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

export default async function entry(arg1 = { abandonedCartTimeoutMS: 10000 }) {
  const items: CartItem[] = [];
  let email = "";
  let abandoned = false;

  for (;;) {
    const timeoutKey = scheduleTimeout(arg1.abandonedCartTimeoutMS);
    const signal = await W.refId<CartSignal>("main");

    if (signal.type !== "timeout") {
      cancelTimeout(timeoutKey);
    }

    const item = "item" in signal ? signal.item : undefined;
    if (abandoned && signal.type !== "timeout") abandoned = false;

    switch (signal.type) {
      case "addToCart": {
        const existingItem = items.find(
          ({ productId }) => productId === item!.productId
        );
        if (existingItem !== undefined) {
          existingItem.quantity += item!.quantity;
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
        const existingItem = items[index];
        existingItem.quantity -= item!.quantity;
        if (existingItem.quantity <= 0) {
          items.splice(index, 1);
        }
        break;
      }
      case "timeout":
        if (!email || abandoned) {
          return "abondoned";
        }
        abandoned = true;
        W.output(email, "ecommerce-reminder");
        break;
      case "updateEmail":
        email = signal.email;
        break;
      case "checkout":
        if ((email as any) === undefined) {
          W.output("Must have email to check out!", "checkoutError");
          break;
        }
        if (items.length === 0) {
          W.output("Must have items to check out!", "checkoutError");
          break;
        }
        return { items, email };
      case "getCart":
        W.outputJSON({ items, email }, "getCart");
        break;
    }
  }
}

export const manifest = {
  outputTopics: [
    "checkoutError",
    "ecommerce-reminder",
    "getCart",
    "workflow-scheduler"
  ]
};
