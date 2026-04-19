const test = require("node:test");
const assert = require("node:assert/strict");

const V = require("../lib/index.js");

test("major version controls reuse while patch changes are ignored", () => {
  assert.equal(
    V.canReuse(
      { major: 1, minor: 0, patch: 0 },
      { major: 1, minor: 1, patch: 0 }
    ),
    true
  );
  assert.equal(
    V.canReuse(
      { major: 1, minor: 1, patch: 0 },
      { major: 2, minor: 0, patch: 0 }
    ),
    false
  );
  assert.equal(
    V.ignoresPatchDifference(
      { major: 1, minor: 1, patch: 0 },
      { major: 1, minor: 1, patch: 9 }
    ),
    true
  );
});

test("handoff envelopes carry both source and target versions", () => {
  const handoff = V.createHandoffEnvelope(
    "trip-booking-versioned",
    "booking-1",
    { major: 1, minor: 0, patch: 0 },
    { major: 1, minor: 1, patch: 0 },
    { customer: "alice" },
    [
      V.createBookedResource(
        "booking-1",
        "hotel",
        "booking-1:hotel:v1"
      )
    ]
  );
  assert.equal(handoff.kind, "handoff");
  assert.deepEqual(handoff.payload.fromVersion, {
    major: 1,
    minor: 0,
    patch: 0
  });
  assert.deepEqual(handoff.payload.toVersion, {
    major: 1,
    minor: 1,
    patch: 0
  });
  assert.equal(handoff.payload.booked[0].releaseId.includes(":release"), true);
});

test("upgrade manager envelopes carry explicit targets", () => {
  const envelope = V.createUpgradeManagerEnvelope(
    "trip-booking-versioned",
    { major: 1, minor: 1, patch: 0 },
    [{ bookingId: "booking-1", ref: "versioning-upgrade" }]
  );
  assert.deepEqual(envelope, {
    workflow: "versioning-upgrade-manager",
    command: {
      workflow: "trip-booking-versioned",
      targetVersion: { major: 1, minor: 1, patch: 0 },
      targets: [{ bookingId: "booking-1", ref: "versioning-upgrade" }]
    }
  });
});
