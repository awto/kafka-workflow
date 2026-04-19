import assert from "node:assert/strict";
import process from "node:process";

const WAIT_TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || "30000");
const WORKFLOW = "trip-booking-versioned";

function version(major, minor, patch) {
  return { major, minor, patch };
}

function newThread(value) {
  return `new:${JSON.stringify(value)}`;
}

function resumeValue(value) {
  return JSON.stringify(value);
}

function startEnvelope(threadId, releaseAfterMS, workflowVersion = version(1, 0, 0)) {
  return {
    workflow: WORKFLOW,
    version: workflowVersion,
    kind: "start",
    bookingId: threadId,
    payload: { releaseAfterMS }
  };
}

function upgradeManagerEnvelope(targetVersion, target) {
  return {
    workflow: "versioning-upgrade-manager",
    command: {
      workflow: WORKFLOW,
      targetVersion,
      targets: [target]
    }
  };
}

function parseJson(record) {
  return JSON.parse(record.value);
}

function matchJson(predicate) {
  return (record) => {
    try {
      return predicate(parseJson(record), record);
    } catch (_error) {
      return false;
    }
  };
}

async function nextJson(harness, topic, predicate, timeoutMs = WAIT_TIMEOUT_MS) {
  const record = await harness.next(topic, matchJson(predicate), timeoutMs);
  return {
    record,
    value: parseJson(record)
  };
}

function noJson(predicate) {
  return (record) => {
    try {
      return predicate(parseJson(record), record);
    } catch (_error) {
      return false;
    }
  };
}

async function expectNoJson(harness, topic, predicate, quietMs = 750) {
  await harness.expectNone(topic, noJson(predicate), quietMs);
}

export async function runMinorUpgradeAdoption(
  harness,
  {
    threadId = "versioned-upgrade",
    releaseAfterMS = 5000,
    onStep = async () => {}
  } = {}
) {
  await harness.send(
    "workflow-resume",
    threadId,
    newThread(startEnvelope(threadId, releaseAfterMS))
  );

  const reserveHotel = (
    await nextJson(
      harness,
      "versioned-reserve-hotel",
      (value, record) => record.key === threadId && value.kind === "hotel"
    )
  ).value;
  const reserveFlight = (
    await nextJson(
      harness,
      "versioned-reserve-flight",
      (value, record) => record.key === threadId && value.kind === "flight"
    )
  ).value;
  const reserveCar = (
    await nextJson(
      harness,
      "versioned-reserve-car",
      (value, record) => record.key === threadId && value.kind === "car"
    )
  ).value;
  const upgrade = (
    await nextJson(
      harness,
      "versioning-await-upgrade",
      (value, record) => record.key === threadId && value.currentVersion.minor === 0
    )
  ).value;

  await onStep("started");

  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ ref: reserveHotel.ref, value: { accepted: true } })
  );
  await onStep("hotel-accepted");

  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ ref: reserveFlight.ref, value: { accepted: true } })
  );
  await onStep("flight-accepted");

  await harness.send(
    "workflow-resume",
    `upgrade-manager:${threadId}`,
    newThread(
      upgradeManagerEnvelope(version(1, 1, 0), {
        bookingId: threadId,
        ref: upgrade.ref
      })
    )
  );
  const dispatched = (
    await nextJson(
      harness,
      "versioning-upgrade-dispatch",
      (value, record) =>
        record.key === threadId &&
        value.ref === upgrade.ref &&
        value.targetVersion.minor === 1
    )
  );
  assert.equal(dispatched.value.bookingId, threadId);

  const upgraded = (
    await nextJson(
      harness,
      "workflow-result",
      (value, record) => record.key === threadId && value.status === "upgraded"
    )
  ).value;
  assert.equal(upgraded.toVersion.minor, 1);

  const cancelCar = (
    await nextJson(
      harness,
      "versioned-cancel-car",
      (value, record) => record.key === threadId && value.ref === reserveCar.ref
    )
  ).value;
  assert.equal(cancelCar.ref, reserveCar.ref);

  const handoff = (
    await nextJson(
      harness,
      "versioning-handoff",
      (value, record) => record.key === threadId && value.version.minor === 1
    )
  ).value;

  const releaseStartHotel = (
    await nextJson(
      harness,
      "versioning-release-start",
      (value, record) => record.key === threadId && value.resource.kind === "hotel"
    )
  ).value;
  const releaseStartFlight = (
    await nextJson(
      harness,
      "versioning-release-start",
      (value, record) => record.key === threadId && value.resource.kind === "flight"
    )
  ).value;
  assert.deepEqual(
    [releaseStartHotel.resource.kind, releaseStartFlight.resource.kind].sort(),
    ["flight", "hotel"]
  );

  await onStep("upgraded");

  await harness.send("workflow-resume", threadId, newThread(handoff));
  await onStep("handoff-started");

  const releaseCancelHotel = (
    await nextJson(
      harness,
      "versioning-release-cancel",
      (value, record) => record.key === threadId && value.kind === "hotel"
    )
  ).value;
  const releaseCancelFlight = (
    await nextJson(
      harness,
      "versioning-release-cancel",
      (value, record) => record.key === threadId && value.kind === "flight"
    )
  ).value;
  assert.deepEqual(
    [releaseCancelHotel.kind, releaseCancelFlight.kind].sort(),
    ["flight", "hotel"]
  );

  const retainedHotel = (
    await nextJson(
      harness,
      "versioning-release-retained",
      (value) => value.bookingId === threadId && value.resource.kind === "hotel"
    )
  ).value;
  const retainedFlight = (
    await nextJson(
      harness,
      "versioning-release-retained",
      (value) => value.bookingId === threadId && value.resource.kind === "flight"
    )
  ).value;
  assert.deepEqual(
    [retainedHotel.resource.kind, retainedFlight.resource.kind].sort(),
    ["flight", "hotel"]
  );

  const nextCar = (
    await nextJson(
      harness,
      "versioned-reserve-car",
      (value, record) =>
        record.key === threadId && value.reservationId === `${threadId}:car:v1.1`
    )
  ).value;

  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ ref: nextCar.ref, error: "car unavailable" })
  );

  const taxi = (
    await nextJson(
      harness,
      "versioned-reserve-taxi",
      (value, record) =>
        record.key === threadId && value.reservationId === `${threadId}:taxi:v1.1`
    )
  ).value;
  await onStep("taxi-reserved");

  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ ref: taxi.ref, value: { accepted: true } })
  );

  const final = (
    await nextJson(
      harness,
      "workflow-result",
      (value, record) =>
        record.key === threadId &&
        value.version?.minor === 1 &&
        value.transport?.kind === "taxi"
    )
  ).value;

  assert.deepEqual(final, {
    version: version(1, 1, 0),
    bookingId: threadId,
    hotel: handoff.payload.booked.find((resource) => resource.kind === "hotel"),
    flight: handoff.payload.booked.find((resource) => resource.kind === "flight"),
    transport: {
      kind: "taxi",
      reservationId: `${threadId}:taxi:v1.1`,
      releaseId: `${threadId}:taxi:${threadId}:taxi:v1.1:release`
    }
  });

  await expectNoJson(
    harness,
    "workflow-error",
    (_value, record) => record.key === threadId
  );
  await expectNoJson(
    harness,
    "versioning-release-fired",
    (value) => value.bookingId === threadId,
    500
  );
}

export async function runDelayedReleaseFire(
  harness,
  {
    threadId = "versioned-release-fire",
    releaseAfterMS = 80,
    onStep = async () => {}
  } = {}
) {
  await harness.send(
    "workflow-resume",
    threadId,
    newThread(startEnvelope(threadId, releaseAfterMS))
  );

  const reserveHotel = (
    await nextJson(
      harness,
      "versioned-reserve-hotel",
      (value, record) => record.key === threadId && value.kind === "hotel"
    )
  ).value;
  const reserveFlight = (
    await nextJson(
      harness,
      "versioned-reserve-flight",
      (value, record) => record.key === threadId && value.kind === "flight"
    )
  ).value;
  await nextJson(
    harness,
    "versioned-reserve-car",
    (value, record) => record.key === threadId && value.kind === "car"
  );
  const upgrade = (
    await nextJson(
      harness,
      "versioning-await-upgrade",
      (value, record) => record.key === threadId && value.currentVersion.minor === 0
    )
  ).value;

  await onStep("started");

  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ ref: reserveHotel.ref, value: { accepted: true } })
  );
  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ ref: reserveFlight.ref, value: { accepted: true } })
  );
  await onStep("resources-accepted");

  await harness.send(
    "workflow-resume",
    `upgrade-manager:${threadId}`,
    newThread(
      upgradeManagerEnvelope(version(1, 1, 0), {
        bookingId: threadId,
        ref: upgrade.ref
      })
    )
  );
  await nextJson(
    harness,
    "versioning-upgrade-dispatch",
    (value, record) =>
      record.key === threadId &&
      value.ref === upgrade.ref &&
      value.targetVersion.minor === 1
  );

  await nextJson(
    harness,
    "workflow-result",
    (value, record) => record.key === threadId && value.status === "upgraded"
  );
  await nextJson(
    harness,
    "versioned-cancel-car",
    (value, record) => record.key === threadId && value.kind === "car"
  );
  await nextJson(
    harness,
    "versioning-handoff",
    (value, record) => record.key === threadId && value.version.minor === 1
  );
  await nextJson(
    harness,
    "versioning-release-start",
    (value, record) => record.key === threadId && value.resource.kind === "hotel"
  );
  await nextJson(
    harness,
    "versioning-release-start",
    (value, record) => record.key === threadId && value.resource.kind === "flight"
  );

  await onStep("upgraded");

  const releaseHotel = (
    await nextJson(
      harness,
      "versioning-release-fired",
      (value) => value.bookingId === threadId && value.resource.kind === "hotel",
      WAIT_TIMEOUT_MS * 2
    )
  ).value;
  const releaseFlight = (
    await nextJson(
      harness,
      "versioning-release-fired",
      (value) => value.bookingId === threadId && value.resource.kind === "flight",
      WAIT_TIMEOUT_MS * 2
    )
  ).value;

  assert.deepEqual(
    [releaseHotel.resource.kind, releaseFlight.resource.kind].sort(),
    ["flight", "hotel"]
  );

  await expectNoJson(
    harness,
    "versioning-release-retained",
    (value) => value.bookingId === threadId,
    500
  );
}

export async function runPatchNoUpgrade(
  harness,
  {
    threadId = "versioned-patch-no-upgrade",
    releaseAfterMS = 5000
  } = {}
) {
  await harness.send(
    "workflow-resume",
    threadId,
    newThread(startEnvelope(threadId, releaseAfterMS, version(1, 1, 9)))
  );

  await expectNoJson(
    harness,
    "versioning-await-upgrade",
    (_value, record) => record.key === threadId
  );

  const reserveHotel = (
    await nextJson(
      harness,
      "versioned-reserve-hotel",
      (value, record) =>
        record.key === threadId && value.reservationId === `${threadId}:hotel:v1.1`
    )
  ).value;
  const reserveFlight = (
    await nextJson(
      harness,
      "versioned-reserve-flight",
      (value, record) =>
        record.key === threadId && value.reservationId === `${threadId}:flight:v1.1`
    )
  ).value;
  const reserveCar = (
    await nextJson(
      harness,
      "versioned-reserve-car",
      (value, record) =>
        record.key === threadId && value.reservationId === `${threadId}:car:v1.1`
    )
  ).value;

  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ ref: reserveHotel.ref, value: { accepted: true } })
  );
  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ ref: reserveFlight.ref, value: { accepted: true } })
  );
  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ ref: reserveCar.ref, value: { accepted: true } })
  );

  const final = (
    await nextJson(
      harness,
      "workflow-result",
      (value, record) =>
        record.key === threadId &&
        value.version?.major === 1 &&
        value.version?.minor === 1 &&
        value.transport?.kind === "car"
    )
  ).value;

  assert.equal(final.bookingId, threadId);
  assert.equal(final.transport.reservationId, `${threadId}:car:v1.1`);

  await expectNoJson(
    harness,
    "workflow-error",
    (_value, record) => record.key === threadId
  );
  await expectNoJson(
    harness,
    "versioning-handoff",
    (_value, record) => record.key === threadId
  );
  await expectNoJson(
    harness,
    "versioning-release-start",
    (_value, record) => record.key === threadId
  );
}

export async function runMajorStartFresh(
  harness,
  {
    threadId = "versioned-major-start",
    releaseAfterMS = 5000
  } = {}
) {
  await harness.send(
    "workflow-resume",
    threadId,
    newThread(startEnvelope(threadId, releaseAfterMS, version(2, 0, 0)))
  );

  await expectNoJson(
    harness,
    "versioning-await-upgrade",
    (_value, record) => record.key === threadId
  );
  await expectNoJson(
    harness,
    "versioned-reserve-car",
    (_value, record) => record.key === threadId
  );

  const reserveHotel = (
    await nextJson(
      harness,
      "versioned-reserve-hotel",
      (value, record) =>
        record.key === threadId && value.reservationId === `${threadId}:hotel:v2.0`
    )
  ).value;
  const reserveFlight = (
    await nextJson(
      harness,
      "versioned-reserve-flight",
      (value, record) =>
        record.key === threadId && value.reservationId === `${threadId}:flight:v2.0`
    )
  ).value;
  const reserveTaxi = (
    await nextJson(
      harness,
      "versioned-reserve-taxi",
      (value, record) =>
        record.key === threadId && value.reservationId === `${threadId}:taxi:v2.0`
    )
  ).value;

  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ ref: reserveHotel.ref, value: { accepted: true } })
  );
  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ ref: reserveFlight.ref, value: { accepted: true } })
  );
  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue({ ref: reserveTaxi.ref, value: { accepted: true } })
  );

  const final = (
    await nextJson(
      harness,
      "workflow-result",
      (value, record) =>
        record.key === threadId &&
        value.version?.major === 2 &&
        value.transport?.kind === "taxi"
    )
  ).value;
  assert.equal(final.bookingId, threadId);
  assert.equal(final.transport.reservationId, `${threadId}:taxi:v2.0`);

  await expectNoJson(
    harness,
    "versioning-handoff",
    (_value, record) => record.key === threadId
  );
}
