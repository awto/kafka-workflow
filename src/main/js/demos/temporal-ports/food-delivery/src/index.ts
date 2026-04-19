const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

export type OrderState =
  | "Charging card"
  | "Paid"
  | "Picked up"
  | "Delivered"
  | "Refunding";

export interface FoodDeliveryInput {
  productId: number;
  pickupTimeoutMS?: number;
  deliveryTimeoutMS?: number;
  ratingDelayMS?: number;
}

type Product = {
  id: number;
  name: string;
};

type OrderStatus = {
  productId: number;
  state: OrderState;
  deliveredAt?: string;
};

type TimeoutStage = "pickup" | "delivery" | "rating";

type Signal =
  | { type: "query" }
  | { type: "pickedUp" }
  | { type: "delivered" }
  | { type: "timeout"; stage: TimeoutStage };

const PRODUCTS = new Map<number, Product>([
  [1, { id: 1, name: "Burger" }],
  [2, { id: 2, name: "Pizza" }],
  [3, { id: 3, name: "Salad" }]
]);

const DEFAULT_PICKUP_TIMEOUT_MS = 100;
const DEFAULT_DELIVERY_TIMEOUT_MS = 100;
const DEFAULT_RATING_DELAY_MS = 50;

function getProductById(productId: number): Product | undefined {
  return PRODUCTS.get(productId);
}

function currentStatus(
  productId: number,
  state: OrderState,
  deliveredAt?: string
): OrderStatus {
  return deliveredAt ? { productId, state, deliveredAt } : { productId, state };
}

function emitStatus(
  productId: number,
  state: OrderState,
  deliveredAt?: string
): void {
  W.outputJSON(
    currentStatus(productId, state, deliveredAt),
    "temporal-food-delivery-status"
  );
}

function scheduleTimeout(stage: TimeoutStage, ms: number): string {
  const key = `${W.threadId}|${JSON.stringify({
    ref: "main",
    value: { type: "timeout", stage } satisfies Signal
  })}`;
  W.output(`${ms}`, "workflow-scheduler", key);
  return key;
}

function cancelTimeout(key: string): void {
  W.output("0", "workflow-scheduler", key);
}

function notify(message: string): void {
  W.output(message, "temporal-food-delivery-push-notification");
}

function refund(product: Product): void {
  W.outputJSON(product, "temporal-food-delivery-refund-order");
}

function charge(product: Product): void {
  W.outputJSON(product, "temporal-food-delivery-charge-customer");
}

async function waitForStage(
  product: Product,
  stage: TimeoutStage,
  timeoutMS: number,
  status: { state: OrderState; deliveredAt?: string }
): Promise<Signal> {
  const timeoutKey = scheduleTimeout(stage, timeoutMS);
  for (;;) {
    const signal = await W.refId<Signal>("main");
    if (signal.type === "query") {
      emitStatus(product.id, status.state, status.deliveredAt);
      continue;
    }
    if (signal.type === "timeout") {
      if (signal.stage !== stage) {
        continue;
      }
      return signal;
    }
    if (stage === "pickup" && signal.type === "pickedUp") {
      cancelTimeout(timeoutKey);
      return signal;
    }
    if (stage === "delivery" && signal.type === "delivered") {
      cancelTimeout(timeoutKey);
      return signal;
    }
  }
}

export default async function entry(
  input: FoodDeliveryInput
): Promise<OrderStatus> {
  const product = getProductById(input.productId);
  if (!product) {
    throw new Error(`Product ${input.productId} not found`);
  }

  const state: { state: OrderState; deliveredAt?: string } = {
    state: "Charging card"
  };

  charge(product);
  state.state = "Paid";

  const pickedUp = await waitForStage(
    product,
    "pickup",
    input.pickupTimeoutMS ?? DEFAULT_PICKUP_TIMEOUT_MS,
    state
  );
  if (pickedUp.type === "timeout") {
    state.state = "Refunding";
    refund(product);
    notify(
      "⚠️ No drivers were available to pick up your order. Your payment has been refunded."
    );
    throw new Error("Not picked up in time");
  }

  state.state = "Picked up";
  notify("🚗 Order picked up");

  const delivered = await waitForStage(
    product,
    "delivery",
    input.deliveryTimeoutMS ?? DEFAULT_DELIVERY_TIMEOUT_MS,
    state
  );
  if (delivered.type === "timeout") {
    state.state = "Refunding";
    refund(product);
    notify(
      "⚠️ Your driver was unable to deliver your order. Your payment has been refunded."
    );
    throw new Error("Not delivered in time");
  }

  state.state = "Delivered";
  state.deliveredAt = new Date().toISOString();
  notify("✅ Order delivered!");

  const ratingTimeout = scheduleTimeout(
    "rating",
    input.ratingDelayMS ?? DEFAULT_RATING_DELAY_MS
  );
  for (;;) {
    const signal = await W.refId<Signal>("main");
    if (signal.type === "query") {
      emitStatus(product.id, state.state, state.deliveredAt);
      continue;
    }
    if (signal.type === "timeout" && signal.stage === "rating") {
      notify(`✍️ Rate your meal. How was the ${product.name.toLowerCase()}?`);
      return currentStatus(product.id, state.state, state.deliveredAt);
    }
  }
}

export const manifest = {
  outputTopics: [
    "workflow-scheduler",
    "temporal-food-delivery-charge-customer",
    "temporal-food-delivery-refund-order",
    "temporal-food-delivery-push-notification",
    "temporal-food-delivery-status"
  ]
};
