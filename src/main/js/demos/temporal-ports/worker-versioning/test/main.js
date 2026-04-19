const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  collectOutputs,
  externalOutputs,
  findOutput,
  parseOutput: parse
} = require("../../../_test/workflow-harness");

const WORKFLOW = "temporal-worker-versioning";

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-worker-versioning",
    defaultThreadId: "worker-versioning-thread",
    stepMode: "thread"
  });
}

function version(major, minor, patch) {
  return { major, minor, patch };
}

function startEnvelope(mode, v, id) {
  return {
    workflow: WORKFLOW,
    version: v,
    kind: "start",
    bookingId: id,
    payload: {
      mode
    }
  };
}

function main(value) {
  return {
    ref: "main",
    value
  };
}

function upgradeManagerEnvelope(targetVersion, targets) {
  return {
    workflow: "versioning-upgrade-manager",
    command: {
      workflow: WORKFLOW,
      targetVersion,
      targets
    }
  };
}

async function completeActivity(workflow, state, output, threadId) {
  return await workflow.step(
    {
      ref: parse(output).ref,
      value: { ok: true }
    },
    threadId,
    false
  );
}

test("bundle exposes worker-versioning topics", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-worker-versioning-activity",
    "temporal-worker-versioning-await-signal",
    "temporal-worker-versioning-incompatible-activity",
    "temporal-worker-versioning-state",
    "versioning-await-upgrade",
    "versioning-handoff",
    "versioning-upgrade-dispatch",
    "workflow-error",
    "workflow-result"
  ]);
});

test("auto workflow hands compatible v1 state to v1.1 and runs patched activity", async () => {
  const workflow = createHarness();
  const started = await workflow.step(
    startEnvelope("auto", version(1, 0, 0), "auto-1"),
    "auto-1",
    true
  );
  const upgrade = parse(findOutput(started.outputs, "versioning-await-upgrade"));
  assert.deepEqual(upgrade.currentVersion, version(1, 0, 0));

  const requested = await workflow.step(main({ type: "do-activity" }), "auto-1");
  const activity = findOutput(requested.outputs, "temporal-worker-versioning-activity");
  assert.deepEqual(parse(activity), {
    calledBy: "v1",
    ref: parse(activity).ref
  });

  const activityDone = await completeActivity(workflow, requested.state, activity, "auto-1");
  const queried = await workflow.step(main({ type: "query", reply: "state-1" }), "auto-1");
  assert.deepEqual(parse(findOutput(queried.outputs, "temporal-worker-versioning-state")), {
    reply: "state-1",
    version: version(1, 0, 0),
    mode: "auto",
    activities: ["someActivity:v1"]
  });

  const manager = await workflow.step(
    upgradeManagerEnvelope(version(1, 1, 0), [
      {
        bookingId: "auto-1",
        ref: upgrade.ref
      }
    ]),
    "upgrade-auto-1",
    true
  );
  const managerOutputs = [
    ...externalOutputs(manager.outputs),
    ...(await workflow.drainInternal(manager.outputs))
  ];
  assert.deepEqual(parse(findOutput(managerOutputs, "versioning-upgrade-dispatch")), {
    bookingId: "auto-1",
    ref: upgrade.ref,
    targetVersion: version(1, 1, 0)
  });
  const results = collectOutputs(managerOutputs, "workflow-result").map(parse);
  assert.deepEqual(results[0], {
    targetVersion: version(1, 1, 0),
    dispatched: ["auto-1"],
    skipped: []
  });
  assert.deepEqual(results[1], {
    status: "upgraded",
    mode: "auto",
    fromVersion: version(1, 0, 0),
    toVersion: version(1, 1, 0),
    activities: ["someActivity:v1"]
  });

  const handoff = parse(findOutput(managerOutputs, "versioning-handoff"));
  const adopted = await workflow.step(handoff, "auto-1", true);
  assert.deepEqual(
    parse(findOutput(adopted.outputs, "temporal-worker-versioning-await-signal")).version,
    version(1, 1, 0)
  );

  const patched = await workflow.step(main({ type: "do-activity" }), "auto-1");
  const incompatible = findOutput(
    patched.outputs,
    "temporal-worker-versioning-incompatible-activity"
  );
  assert.deepEqual(parse(incompatible), {
    calledBy: "v1b",
    moreData: "hello!",
    ref: parse(incompatible).ref
  });

  await completeActivity(workflow, patched.state, incompatible, "auto-1");
  const finished = await workflow.step(main({ type: "conclude" }), "auto-1");
  assert.equal(finished.state, "");
  assert.deepEqual(parse(findOutput(finished.outputs, "workflow-result")), {
    status: "completed",
    version: version(1, 1, 0),
    mode: "auto",
    activities: ["someActivity:v1", "someIncompatibleActivity:v1b"]
  });

  assert.notEqual(activityDone.state, "");
});

test("pinned workflows keep the behavior of their start version", async () => {
  const workflow = createHarness();
  const pinnedV1 = await workflow.step(
    startEnvelope("pinned", version(1, 0, 0), "pinned-1"),
    "pinned-1",
    true
  );
  assert.equal(findOutput(pinnedV1.outputs, "versioning-await-upgrade"), undefined);

  const v1Conclude = await workflow.step(main({ type: "conclude" }), "pinned-1");
  const v1Activity = findOutput(
    v1Conclude.outputs,
    "temporal-worker-versioning-activity"
  );
  assert.deepEqual(parse(v1Activity), {
    calledBy: "Pinned-v1",
    ref: parse(v1Activity).ref
  });
  const v1Finished = await completeActivity(workflow, v1Conclude.state, v1Activity, "pinned-1");
  assert.deepEqual(parse(findOutput(v1Finished.outputs, "workflow-result")), {
    status: "completed",
    version: version(1, 0, 0),
    mode: "pinned",
    activities: ["someActivity:Pinned-v1"]
  });

  const pinnedV2 = await workflow.step(
    startEnvelope("pinned", version(2, 0, 0), "pinned-2"),
    "pinned-2",
    true
  );
  const v2FirstActivity = findOutput(
    pinnedV2.outputs,
    "temporal-worker-versioning-activity"
  );
  assert.deepEqual(parse(v2FirstActivity), {
    calledBy: "Pinned-v2",
    ref: parse(v2FirstActivity).ref
  });

  const v2ActivityDone = await completeActivity(
    workflow,
    pinnedV2.state,
    v2FirstActivity,
    "pinned-2"
  );
  const v2Conclude = await workflow.step(main({ type: "conclude" }), "pinned-2");
  const v2Incompatible = findOutput(
    v2Conclude.outputs,
    "temporal-worker-versioning-incompatible-activity"
  );
  assert.deepEqual(parse(v2Incompatible), {
    calledBy: "Pinned-v2",
    moreData: "hi",
    ref: parse(v2Incompatible).ref
  });
  const v2Finished = await completeActivity(
    workflow,
    v2Conclude.state,
    v2Incompatible,
    "pinned-2"
  );
  assert.deepEqual(parse(findOutput(v2Finished.outputs, "workflow-result")), {
    status: "completed",
    version: version(2, 0, 0),
    mode: "pinned",
    activities: [
      "someActivity:Pinned-v2",
      "someIncompatibleActivity:Pinned-v2"
    ]
  });
  assert.notEqual(v2ActivityDone.state, "");
});

test("auto workflow starts a new major version without reusing old state", async () => {
  const workflow = createHarness();
  const started = await workflow.step(
    startEnvelope("auto", version(2, 0, 0), "auto-2"),
    "auto-2",
    true
  );
  assert.equal(findOutput(started.outputs, "versioning-await-upgrade"), undefined);
  assert.deepEqual(
    parse(findOutput(started.outputs, "temporal-worker-versioning-await-signal")),
    {
      ref: "main",
      version: version(2, 0, 0),
      mode: "auto"
    }
  );

  const requested = await workflow.step(main({ type: "do-activity" }), "auto-2");
  const incompatible = findOutput(
    requested.outputs,
    "temporal-worker-versioning-incompatible-activity"
  );
  assert.deepEqual(parse(incompatible), {
    calledBy: "v1b",
    moreData: "hello!",
    ref: parse(incompatible).ref
  });

  const completedActivity = await completeActivity(
    workflow,
    requested.state,
    incompatible,
    "auto-2"
  );
  assert.notEqual(completedActivity.state, "");

  const finished = await workflow.step(main({ type: "conclude" }), "auto-2");
  assert.equal(finished.state, "");
  assert.deepEqual(parse(findOutput(finished.outputs, "workflow-result")), {
    status: "completed",
    version: version(2, 0, 0),
    mode: "auto",
    activities: ["someIncompatibleActivity:v1b"]
  });
});

test("auto workflow rejects incompatible major-version handoff", async () => {
  const workflow = createHarness();
  const started = await workflow.step(
    startEnvelope("auto", version(1, 0, 0), "auto-major"),
    "auto-major",
    true
  );
  const upgrade = parse(findOutput(started.outputs, "versioning-await-upgrade"));

  const manager = await workflow.step(
    upgradeManagerEnvelope(version(2, 0, 0), [
      {
        bookingId: "auto-major",
        ref: upgrade.ref
      }
    ]),
    "upgrade-auto-major",
    true
  );
  const managerOutputs = [
    ...externalOutputs(manager.outputs),
    ...(await workflow.drainInternal(manager.outputs))
  ];
  const error = parse(findOutput(managerOutputs, "workflow-error"));
  assert.match(error, /cannot reuse 1\.0\.0 for 2\.0\.0/);
});
