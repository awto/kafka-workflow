import * as W from "@effectful/kafka-workflow";

/* # Types */

export interface CartItem {
  productId: string;
  quantity: number;
}

/* # Options */

W.config.outputTopics.add("ecommerce-reminder");
W.config.outputTopics.add("workflow-scheduler");

/* # Kit */

async function timeout(ms: number) {
  const resume = W.suspend();
  W.output(
    `${ms}`,
    "workflow-scheduler",
    `${W.threadId}|{"ref":"${resume.id}"}`
  );
  try {
    await resume;
  } catch (e: any) {
    W.output(`0`, "workflow-scheduler", `${W.threadId}|{"ref":"${resume.id}"}`);
    throw e;
  }
  return { type: "timeout" };
}

/* # Workflow */

export async function main(arg1 = { abandonedCartTimeoutMS: 10000 }) {
  const items: CartItem[] = [];
  let email: string = "";
  let abandoned = false;
  let iter = 0;
  for (;;) {
    const signal = await W.anyWithCancel([
      W.suspend("main"),
      timeout(arg1.abandonedCartTimeoutMS)
    ]);
    const item: CartItem = signal.item;
    if (abandoned && signal.type !== "timeout") abandoned = false;
    switch (signal.type) {
      case "addToCart":
        {
          const existingItem = items.find(
            ({ productId }) => productId === item.productId
          );
          if (existingItem !== undefined) {
            existingItem.quantity += item.quantity;
          } else {
            items.push(item);
          }
        }
        break;
      case "removeFromCart":
        {
          const index = items.findIndex(
            ({ productId }) => productId === item.productId
          );
          if (index === -1) break;
          const existingItem = items[index];
          existingItem.quantity -= item.quantity;
          if (existingItem.quantity <= 0) {
            items.splice(index, 1);
          }
        }
        break;
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
        if (email === undefined) {
          W.output("Must have email to check out!", "checkoutError");
          break;
        }
        if (items.length === 0) {
          W.output("Must have items to check out!", "checkoutError");
          break;
        }
        return {
          items,
          email
        };
      case "getCart":
        W.outputJSON({ items, email }, "getCart");
        break;
    }
  }
}
