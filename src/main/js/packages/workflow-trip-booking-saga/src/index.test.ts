import * as W from "@effectful/kafka-workflow/lib/mocks";
import * as Index from "./index";

afterEach(() => {
  W.__reset();
});

async function resumeResource(kind: string) {
  await W.__resume(W.__lastTopicUpdate[`saga-reserve-${kind}`].v, {
    id: `${kind}-id`
  });
}

test("concurent execution", async function () {
  const res = Index.main();
  await resumeResource("flight");
  await resumeResource("hotel");
  await resumeResource("car");
  const item = await res;
  expect(item).toEqual({
    car: {
      id: "testStep:1"
    },
    flight: {
      id: "testStep:3"
    },
    hotel: {
      id: "testStep:2"
    }
  });
  expect(W.__trace).toMatchSnapshot();
  expect(W.__suspended.has("main")).toBe(false);
});

test("one thread is rejected", async function () {
  const res = Index.main();
  expect(res).rejects.toBe("not available")
  await resumeResource("flight");
  await W.__reject(
    W.__lastTopicUpdate[`saga-reserve-hotel`].v,
    "not available"
  );
  expect(W.__trace).toMatchSnapshot();
  expect(W.__suspended.has("main")).toBe(false);
});

test("timeout", async function () {
  const res = Index.main();
  expect(res).rejects.toBe("timeout");
  await resumeResource("car");
  await W.__resume(
    JSON.parse(W.__lastTopicUpdate[`workflow-scheduler`].k.split("|")[1]).ref,
    undefined
  );
  expect(W.__trace).toMatchSnapshot();
  expect(W.__suspended.has("main")).toBe(false);
});
