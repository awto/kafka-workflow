const test = require("node:test");
const assert = require("node:assert/strict");
const {
  collectOutputs,
  createWorkflowHarness,
  findOutput,
  parseOutput,
  resumeEventFromKey: schedulerResume
} = require("../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "trip-booking-saga",
    defaultThreadId: "thread1",
    stepMode: "state"
  });
}

function collectValues(outputs, topic) {
  return collectOutputs(outputs, topic)
    .map((output) => output.value)
    .sort();
}

test("built bundle exposes expected topics and resolves all reservations", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "saga-cancel-car",
    "saga-cancel-flight",
    "saga-cancel-hotel",
    "saga-reserve-car",
    "saga-reserve-flight",
    "saga-reserve-hotel",
    "workflow-error",
    "workflow-result",
    "workflow-scheduler"
  ]);

  const first = await workflow.step({});
  const reserveCar = findOutput(first.outputs, "saga-reserve-car");
  const reserveHotel = findOutput(first.outputs, "saga-reserve-hotel");
  const reserveFlight = findOutput(first.outputs, "saga-reserve-flight");
  const scheduler = findOutput(first.outputs, "workflow-scheduler");

  assert.equal(reserveCar.value, "0:saga-reserve-car:1");
  assert.equal(reserveHotel.value, "0:saga-reserve-hotel:2");
  assert.equal(reserveFlight.value, "0:saga-reserve-flight:3");
  assert.equal(scheduler.value, "1000");

  const second = await workflow.step({ ref: reserveFlight.value }, first.state);
  const third = await workflow.step({ ref: reserveHotel.value }, second.state);
  const fourth = await workflow.step({ ref: reserveCar.value }, third.state);

  assert.equal(fourth.state, "");
  assert.equal(findOutput(fourth.outputs, "workflow-scheduler").value, "0");
  assert.deepEqual(
    parseOutput(findOutput(fourth.outputs, "workflow-result")),
    {
      car: { id: "0:saga-reserve-car:1" },
      hotel: { id: "0:saga-reserve-hotel:2" },
      flight: { id: "0:saga-reserve-flight:3" }
    }
  );
});

test("built bundle cancels completed reservations when user code throws", async () => {
  const workflow = createHarness();
  const first = await workflow.step({ throwAfterHotel: true });
  const reserveCar = findOutput(first.outputs, "saga-reserve-car");
  const reserveHotel = findOutput(first.outputs, "saga-reserve-hotel");
  const reserveFlight = findOutput(first.outputs, "saga-reserve-flight");

  const second = await workflow.step({ ref: reserveFlight.value }, first.state);
  const third = await workflow.step({ ref: reserveCar.value }, second.state);
  const fourth = await workflow.step({ ref: reserveHotel.value }, third.state);

  assert.equal(fourth.state, "");
  assert.equal(findOutput(fourth.outputs, "workflow-scheduler").value, "0");
  assert.deepEqual(collectValues(fourth.outputs, "saga-cancel-car"), [
    "0:saga-reserve-car:1"
  ]);
  assert.deepEqual(collectValues(fourth.outputs, "saga-cancel-hotel"), [
    "0:saga-reserve-hotel:2"
  ]);
  assert.deepEqual(collectValues(fourth.outputs, "saga-cancel-flight"), [
    "0:saga-reserve-flight:3"
  ]);
  assert.equal(
    findOutput(fourth.outputs, "workflow-error").value,
    "\"something is wrong\""
  );
});

test("built bundle cancels siblings after a reservation error", async () => {
  const workflow = createHarness();
  const first = await workflow.step({});
  const reserveCar = findOutput(first.outputs, "saga-reserve-car");
  const reserveHotel = findOutput(first.outputs, "saga-reserve-hotel");
  const reserveFlight = findOutput(first.outputs, "saga-reserve-flight");

  const second = await workflow.step({ ref: reserveFlight.value }, first.state);
  const third = await workflow.step({ ref: reserveCar.value }, second.state);
  const fourth = await workflow.step(
    { ref: reserveHotel.value, error: "hotel is not available" },
    third.state
  );

  assert.equal(fourth.state, "");
  assert.equal(findOutput(fourth.outputs, "workflow-scheduler").value, "0");
  assert.deepEqual(collectValues(fourth.outputs, "saga-cancel-car"), [
    "0:saga-reserve-car:1"
  ]);
  assert.deepEqual(collectValues(fourth.outputs, "saga-cancel-flight"), [
    "0:saga-reserve-flight:3"
  ]);
  assert.deepEqual(collectValues(fourth.outputs, "saga-cancel-hotel"), []);
  assert.equal(
    findOutput(fourth.outputs, "workflow-error").value,
    "\"hotel is not available\""
  );
});

test("built bundle timeout cancels remaining reservations", async () => {
  const workflow = createHarness();
  const first = await workflow.step({});
  const reserveCar = findOutput(first.outputs, "saga-reserve-car");
  const reserveFlight = findOutput(first.outputs, "saga-reserve-flight");
  const scheduler = findOutput(first.outputs, "workflow-scheduler");

  const second = await workflow.step({ ref: reserveFlight.value }, first.state);
  const third = await workflow.step({ ref: reserveCar.value }, second.state);
  const fourth = await workflow.step(schedulerResume(scheduler), third.state);

  assert.equal(fourth.state, "");
  assert.deepEqual(collectValues(fourth.outputs, "saga-cancel-car"), [
    "0:saga-reserve-car:1"
  ]);
  assert.deepEqual(collectValues(fourth.outputs, "saga-cancel-hotel"), [
    "0:saga-reserve-hotel:2"
  ]);
  assert.deepEqual(collectValues(fourth.outputs, "saga-cancel-flight"), [
    "0:saga-reserve-flight:3"
  ]);
  assert.equal(findOutput(fourth.outputs, "workflow-error").value, "\"timeout\"");
});
