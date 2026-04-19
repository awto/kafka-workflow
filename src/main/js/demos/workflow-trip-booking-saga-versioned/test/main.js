const test = require("node:test");
const assert = require("node:assert/strict");
const {
  collectOutputs,
  createWorkflowHarness,
  externalOutputs,
  findOutput,
  parseOutput,
  resumeEventFromKey: schedulerResume
} = require("../../_test/workflow-harness");

const WORKFLOW = "trip-booking-versioned";

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "trip-booking-saga-versioned",
    defaultThreadId: "booking-1",
    stepMode: "thread"
  });
}

function version(major, minor, patch) {
  return { major, minor, patch };
}

function startEnvelope(v, bookingId = "booking-1") {
  return {
    workflow: "trip-booking-versioned",
    version: v,
    kind: "start",
    bookingId,
    payload: {
      releaseAfterMS: 3_600_000
    }
  };
}

function delayedReleaseEnvelope(releaseId, delayMS = 1000) {
  return {
    workflow: "versioning-delayed-release",
    command: {
      bookingId: "booking-release",
      delayMS,
      resource: {
        kind: "hotel",
        reservationId: "booking-release:hotel:v1.0",
        releaseId
      }
    }
  };
}

function upgradeManagerEnvelope(workflow, targetVersion, targets) {
  return {
    workflow: "versioning-upgrade-manager",
    command: {
      workflow,
      targetVersion,
      targets
    }
  };
}

test("bundle exposes versioning topics", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "versioned-cancel-car",
    "versioned-cancel-flight",
    "versioned-cancel-hotel",
    "versioned-cancel-taxi",
    "versioned-reserve-car",
    "versioned-reserve-flight",
    "versioned-reserve-hotel",
    "versioned-reserve-taxi",
    "versioning-await-retain",
    "versioning-await-upgrade",
    "versioning-handoff",
    "versioning-release-cancel",
    "versioning-release-fired",
    "versioning-release-retained",
    "versioning-release-start",
    "versioning-upgrade-dispatch",
    "workflow-error",
    "workflow-result",
    "workflow-scheduler"
  ]);
});

test("minor upgrade hands off booked reservations and v1.1 adopts them", async () => {
  const workflow = createHarness();
  const first = await workflow.step(startEnvelope(version(1, 0, 0)), "booking-1", true);
  await workflow.drainInternal(first.outputs);
  const reserveHotel = parseOutput(findOutput(first.outputs, "versioned-reserve-hotel"));
  const reserveFlight = parseOutput(findOutput(first.outputs, "versioned-reserve-flight"));
  const reserveCar = parseOutput(findOutput(first.outputs, "versioned-reserve-car"));
  const upgrade = parseOutput(findOutput(first.outputs, "versioning-await-upgrade"));

  const second = await workflow.step({
    ref: reserveHotel.ref,
    value: { accepted: true }
  });
  const third = await workflow.step({
    ref: reserveFlight.ref,
    value: { accepted: true }
  });

  const manager = await workflow.step(
    upgradeManagerEnvelope(WORKFLOW, version(1, 1, 0), [
      { bookingId: "booking-1", ref: upgrade.ref }
    ]),
    "upgrade-1",
    true
  );
  const managerOutputs = [
    ...externalOutputs(manager.outputs),
    ...(await workflow.drainInternal(manager.outputs))
  ];
  assert.equal(
    parseOutput(
      collectOutputs(managerOutputs, "workflow-result").find((output) =>
        Array.isArray(parseOutput(output).dispatched)
      )
    ).dispatched[0],
    "booking-1"
  );
  assert.deepEqual(parseOutput(findOutput(managerOutputs, "versioning-upgrade-dispatch")), {
    bookingId: "booking-1",
    ref: upgrade.ref,
    targetVersion: version(1, 1, 0)
  });

  assert.equal(
    parseOutput(
      collectOutputs(managerOutputs, "workflow-result").find(
        (output) => parseOutput(output).status === "upgraded"
      )
    ).status,
    "upgraded"
  );
  assert.equal(parseOutput(findOutput(managerOutputs, "versioned-cancel-car")).ref, reserveCar.ref);

  const handoff = parseOutput(findOutput(managerOutputs, "versioning-handoff"));
  assert.deepEqual(
    handoff.payload.booked.map((resource) => resource.kind).sort(),
    ["flight", "hotel"]
  );
  assert.deepEqual(
    collectOutputs(managerOutputs, "versioning-release-start")
      .map(parseOutput)
      .map((value) => value.resource.kind)
      .sort(),
    ["flight", "hotel"]
  );

  const fifth = await workflow.step(handoff, "booking-1", true);
  assert.deepEqual(
    collectOutputs(fifth.outputs, "versioning-release-cancel")
      .map(parseOutput)
      .map((value) => value.kind)
      .sort(),
    ["flight", "hotel"]
  );
  const nextCar = parseOutput(findOutput(fifth.outputs, "versioned-reserve-car"));

  const sixth = await workflow.step({ ref: nextCar.ref, error: "car unavailable" });
  const taxi = parseOutput(findOutput(sixth.outputs, "versioned-reserve-taxi"));
  const seventh = await workflow.step({ ref: taxi.ref, value: { accepted: true } });

  assert.equal(seventh.state, "");
  assert.deepEqual(parseOutput(findOutput(seventh.outputs, "workflow-result")), {
    version: version(1, 1, 0),
    bookingId: "booking-1",
    hotel: handoff.payload.booked.find((resource) => resource.kind === "hotel"),
    flight: handoff.payload.booked.find((resource) => resource.kind === "flight"),
    transport: {
      kind: "taxi",
      reservationId: "booking-1:taxi:v1.1",
      releaseId: "booking-1:taxi:booking-1:taxi:v1.1:release"
    }
  });
});

test("patch changes do not require upgrade flow", async () => {
  const workflow = createHarness();
  const first = await workflow.step(startEnvelope(version(1, 1, 9), "booking-2"), "booking-2", true);
  assert.equal(findOutput(first.outputs, "versioning-await-upgrade"), undefined);
  const reserveHotel = parseOutput(findOutput(first.outputs, "versioned-reserve-hotel"));
  const reserveFlight = parseOutput(findOutput(first.outputs, "versioned-reserve-flight"));
  const reserveCar = parseOutput(findOutput(first.outputs, "versioned-reserve-car"));

  const second = await workflow.step({ ref: reserveHotel.ref, value: { accepted: true } }, "booking-2");
  const third = await workflow.step({ ref: reserveFlight.ref, value: { accepted: true } }, "booking-2");
  const fourth = await workflow.step({ ref: reserveCar.ref, value: { accepted: true } }, "booking-2");

  assert.equal(fourth.state, "");
  assert.equal(
    parseOutput(findOutput(fourth.outputs, "workflow-result")).transport.kind,
    "car"
  );
});

test("major 2 starts a fresh workflow", async () => {
  const workflow = createHarness();
  const first = await workflow.step(startEnvelope(version(2, 0, 0), "booking-major"), "booking-major", true);
  assert.equal(findOutput(first.outputs, "versioning-await-upgrade"), undefined);
  assert.equal(findOutput(first.outputs, "versioned-reserve-car"), undefined);

  const reserveHotel = parseOutput(findOutput(first.outputs, "versioned-reserve-hotel"));
  const reserveFlight = parseOutput(findOutput(first.outputs, "versioned-reserve-flight"));
  const reserveTaxi = parseOutput(findOutput(first.outputs, "versioned-reserve-taxi"));

  const second = await workflow.step({ ref: reserveHotel.ref, value: { accepted: true } }, "booking-major");
  const third = await workflow.step({ ref: reserveFlight.ref, value: { accepted: true } }, "booking-major");
  const fourth = await workflow.step({ ref: reserveTaxi.ref, value: { accepted: true } }, "booking-major");

  assert.equal(fourth.state, "");
  assert.deepEqual(parseOutput(findOutput(fourth.outputs, "workflow-result")), {
    version: version(2, 0, 0),
    bookingId: "booking-major",
    hotel: {
      kind: "hotel",
      reservationId: "booking-major:hotel:v2.0",
      releaseId: "booking-major:hotel:booking-major:hotel:v2.0:release"
    },
    flight: {
      kind: "flight",
      reservationId: "booking-major:flight:v2.0",
      releaseId: "booking-major:flight:booking-major:flight:v2.0:release"
    },
    transport: {
      kind: "taxi",
      reservationId: "booking-major:taxi:v2.0",
      releaseId: "booking-major:taxi:booking-major:taxi:v2.0:release"
    }
  });
});

test("delayed release workflow retains on retain signal", async () => {
  const workflow = createHarness();
  const first = await workflow.step(delayedReleaseEnvelope("booking-release:hotel:1:release"), "release-retain", true);
  const retain = parseOutput(findOutput(first.outputs, "versioning-await-retain"));
  const scheduler = findOutput(first.outputs, "workflow-scheduler");

  assert.equal(scheduler.value, "1000");

  const second = await workflow.step({ ref: retain.ref, value: { retained: true } }, "release-retain");

  assert.equal(second.state, "");
  assert.equal(findOutput(second.outputs, "workflow-scheduler").value, "0");
  assert.deepEqual(parseOutput(findOutput(second.outputs, "versioning-release-retained")), {
    bookingId: "booking-release",
    resource: {
      kind: "hotel",
      reservationId: "booking-release:hotel:v1.0",
      releaseId: "booking-release:hotel:1:release"
    },
    delayMS: 1000
  });
});

test("delayed release workflow fires after scheduler timeout", async () => {
  const workflow = createHarness();
  const first = await workflow.step(delayedReleaseEnvelope("booking-release:hotel:2:release", 25), "release-timeout", true);
  const scheduler = findOutput(first.outputs, "workflow-scheduler");

  const second = await workflow.step(schedulerResume(scheduler), "release-timeout");

  assert.equal(second.state, "");
  assert.deepEqual(parseOutput(findOutput(second.outputs, "versioning-release-fired")), {
    bookingId: "booking-release",
    resource: {
      kind: "hotel",
      reservationId: "booking-release:hotel:v1.0",
      releaseId: "booking-release:hotel:2:release"
    },
    delayMS: 25
  });
});
