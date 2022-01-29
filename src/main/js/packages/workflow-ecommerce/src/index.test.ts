import * as W from "@effectful/kafka-workflow/lib/mocks";
import * as Index from "./index";

afterEach(() => {
  W.__reset();
});

test("cart operations", async function () {
  const res = Index.main({ abandonedCartTimeoutMS: 50 });
  await W.__resume("main", { type: "checkout" });
  await W.__resume("main", {
    type: "updateEmail",
    email: "someone@example.com"
  });
  await W.__resume("main", { type: "checkout" });
  await W.__resume("main", {
    type: "addToCart",
    item: { quantity: 10, productId: "teapot" }
  });
  await W.__resume("main", {
    type: "addToCart",
    item: { quantity: 11, productId: "sigar" }
  });
  await W.__resume("main", {
    type: "addToCart",
    item: { quantity: 20, productId: "teapot" }
  });
  await W.__resume("main", {
    type: "updateEmail",
    email: "someone.else@example.com"
  });
  await W.__resume("main", {
    type: "removeFromCart",
    item: { quantity: 11, productId: "sigar" }
  });
  await W.__resume("main", {
    type: "addToCart",
    item: { quantity: 2, productId: "sugar" }
  });
  await W.__resume("main", { type: "checkout" });
  const item = await res;
  expect(item).toEqual({
    email: "someone.else@example.com",
    items: [
      {
        productId: "teapot",
        quantity: 30
      },
      {
        productId: "sugar",
        quantity: 2
      }
    ]
  });
  expect(W.__trace).toMatchSnapshot();
  expect(W.__suspended.has("main")).toBe(false);
});

function setUpScheduler(data: { ref: string }) {
  W.__topicHandlers.set(
    "workflow-scheduler",
    function (_msg: string, dest: string) {
      const [thread, ref] = dest.split("|");
      expect(thread).toBe(W.threadId);
      data.ref = JSON.parse(ref).ref;
    }
  );
}

function curRef() {
  const [thread, ref] = W.__lastTopicUpdate["workflow-scheduler"].k.split("|");
  expect(thread).toBe(W.threadId);
  return JSON.parse(ref).ref;
}

test("abondoned and resumed", async function () {
  const res = Index.main({ abandonedCartTimeoutMS: 50 });
  await W.__resume("main", {
    type: "updateEmail",
    email: "someone@example.com"
  });
  await W.__resume(curRef(), undefined);
  await W.__resume("main", {
    type: "addToCart",
    item: { quantity: 2, productId: "sugar" }
  });
  await W.__resume("main", { type: "checkout" });
  const item = await res;
  expect(item).toEqual({
    email: "someone@example.com",
    items: [
      {
        productId: "sugar",
        quantity: 2
      }
    ]
  });
  expect(W.__trace).toMatchSnapshot();
  expect(W.__suspended.has("main")).toBe(false);
});

test("abondoned forever", async function () {
  const res = Index.main({ abandonedCartTimeoutMS: 50 });
  await W.__resume("main", {
    type: "updateEmail",
    email: "someone@example.com"
  });
  await W.__resume(curRef(), undefined);
  await W.__resume(curRef(), undefined);
  const item = await res;
  expect(item).toBe("abondoned");
  expect(W.__trace).toMatchSnapshot();
});
