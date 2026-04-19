const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  collectOutputs,
  externalOutputs,
  findOutput,
  parseOutput,
  resumeEventFromKey: schedulerResume
} = require("../../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-mutex",
    defaultThreadId: "mutex-thread",
    stepMode: "state"
  });
}

function mainSignal(value) {
  return { ref: "main", value };
}

test("mutex serializes lock ownership and grants the next waiter", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-mutex-critical-section",
    "temporal-mutex-invalid-release",
    "temporal-mutex-lock-acquired",
    "temporal-mutex-lock-requested",
    "temporal-mutex-notify-locked",
    "temporal-mutex-notify-unlocked",
    "temporal-mutex-state",
    "workflow-error",
    "workflow-result",
    "workflow-scheduler"
  ]);

  const first = await workflow.step({ lockId: "db-migration" });
  const second = await workflow.step(
    mainSignal({ type: "acquire", owner: "alice" }),
    first.state
  );
  assert.deepEqual(
    parseOutput(findOutput(second.outputs, "temporal-mutex-lock-acquired")),
    { lockId: "db-migration", owner: "alice" }
  );
  assert.equal(findOutput(second.outputs, "temporal-mutex-lock-acquired").key, "alice");

  const third = await workflow.step(
    mainSignal({ type: "acquire", owner: "bob" }),
    second.state
  );
  assert.deepEqual(
    parseOutput(findOutput(third.outputs, "temporal-mutex-lock-requested")),
    { lockId: "db-migration", owner: "bob", position: 1 }
  );

  const fourth = await workflow.step(mainSignal({ type: "query" }), third.state);
  assert.deepEqual(
    parseOutput(findOutput(fourth.outputs, "temporal-mutex-state")),
    {
      lockId: "db-migration",
      holder: "alice",
      releaseRef: "release:db-migration:alice",
      timeoutKey: null,
      timeoutRef: null,
      queue: [{ owner: "bob" }]
    }
  );

  const fifth = await workflow.step(
    mainSignal({ type: "release", owner: "charlie" }),
    fourth.state
  );
  assert.deepEqual(
    parseOutput(findOutput(fifth.outputs, "temporal-mutex-invalid-release")),
    { lockId: "db-migration", owner: "charlie", holder: "alice" }
  );

  const sixth = await workflow.step(
    mainSignal({ type: "release", owner: "alice" }),
    fifth.state
  );
  assert.deepEqual(
    parseOutput(findOutput(sixth.outputs, "temporal-mutex-lock-acquired")),
    { lockId: "db-migration", owner: "bob" }
  );

  const seventh = await workflow.step(mainSignal({ type: "query" }), sixth.state);
  assert.deepEqual(
    parseOutput(findOutput(seventh.outputs, "temporal-mutex-state")),
    {
      lockId: "db-migration",
      holder: "bob",
      releaseRef: "release:db-migration:bob",
      timeoutKey: null,
      timeoutRef: null,
      queue: []
    }
  );

  const final = await workflow.step(mainSignal({ type: "shutdown" }), seventh.state);
  assert.equal(final.state, "");
  assert.deepEqual(parseOutput(findOutput(final.outputs, "workflow-result")), {
    lockId: "db-migration",
    holder: "bob",
    releaseRef: "release:db-migration:bob",
    timeoutKey: null,
    timeoutRef: null,
    queue: []
  });
  assert.equal(collectOutputs(final.outputs, "workflow-error").length, 0);
});

test("oneAtATimeWorkflow contenders run the protected section serially", async () => {
  const workflow = createHarness();

  const aliceStarted = await workflow.threadStep(
    {
      workflow: "oneAtATimeWorkflow",
      resourceId: "shared-api",
      owner: "alice",
      sleepForMS: 25
    },
    "alice",
    true
  );
  const aliceInternal = await workflow.drainInternal(aliceStarted.outputs);
  const aliceCritical = parseOutput(
    findOutput(aliceInternal, "temporal-mutex-critical-section")
  );
  assert.equal(aliceCritical.resourceId, "shared-api");
  assert.equal(aliceCritical.owner, "alice");
  assert.equal(aliceCritical.sleepForMS, 25);
  assert.match(aliceCritical.ref, /critical-section/);

  const bobStarted = await workflow.threadStep(
    {
      workflow: "oneAtATimeWorkflow",
      resourceId: "shared-api",
      owner: "bob",
      sleepForMS: 25
    },
    "bob",
    true
  );
  const bobQueued = await workflow.drainInternal(bobStarted.outputs);
  assert.deepEqual(
    parseOutput(findOutput(bobQueued, "temporal-mutex-lock-requested")),
    { lockId: "shared-api", owner: "bob", position: 1 }
  );
  assert.equal(
    collectOutputs(bobQueued, "temporal-mutex-critical-section").length,
    0
  );

  const aliceFinished = await workflow.threadStep(
    { ref: aliceCritical.ref, value: { ok: true } },
    "alice"
  );
  const afterAliceRelease = [
    ...externalOutputs(aliceFinished.outputs),
    ...(await workflow.drainInternal(aliceFinished.outputs))
  ];
  assert.deepEqual(
    parseOutput(findOutput(afterAliceRelease, "temporal-mutex-notify-unlocked")),
    { resourceId: "shared-api", owner: "alice" }
  );
  assert.deepEqual(
    parseOutput(findOutput(afterAliceRelease, "workflow-result")),
    { resourceId: "shared-api", owner: "alice" }
  );

  const bobCritical = parseOutput(
    findOutput(afterAliceRelease, "temporal-mutex-critical-section")
  );
  assert.equal(bobCritical.resourceId, "shared-api");
  assert.equal(bobCritical.owner, "bob");
  assert.equal(bobCritical.sleepForMS, 25);
  assert.match(bobCritical.ref, /critical-section/);

  const bobFinished = await workflow.threadStep(
    { ref: bobCritical.ref, value: { ok: true } },
    "bob"
  );
  const afterBobRelease = [
    ...externalOutputs(bobFinished.outputs),
    ...(await workflow.drainInternal(bobFinished.outputs))
  ];
  assert.deepEqual(
    parseOutput(findOutput(afterBobRelease, "temporal-mutex-notify-unlocked")),
    { resourceId: "shared-api", owner: "bob" }
  );

  const queried = await workflow.threadStep(
    mainSignal({ type: "query" }),
    "shared-api"
  );
  assert.deepEqual(parseOutput(findOutput(queried.outputs, "temporal-mutex-state")), {
    lockId: "shared-api",
    holder: null,
    releaseRef: null,
    timeoutKey: null,
    timeoutRef: null,
    queue: []
  });
});

test("lockWorkflow auto releases timed out holders and grants the next contender", async () => {
  const workflow = createHarness();

  const aliceStarted = await workflow.threadStep(
    {
      workflow: "oneAtATimeWorkflow",
      resourceId: "timeout-lock",
      owner: "alice",
      lockTimeoutMS: 50
    },
    "alice",
    true
  );
  const aliceInternal = await workflow.drainInternal(aliceStarted.outputs);
  const aliceTimeout = findOutput(aliceInternal, "workflow-scheduler");
  assert.equal(aliceTimeout.value, "50");
  assert.equal(
    parseOutput(findOutput(aliceInternal, "temporal-mutex-critical-section"))
      .owner,
    "alice"
  );

  const bobStarted = await workflow.threadStep(
    {
      workflow: "oneAtATimeWorkflow",
      resourceId: "timeout-lock",
      owner: "bob",
      lockTimeoutMS: 50
    },
    "bob",
    true
  );
  const bobQueued = await workflow.drainInternal(bobStarted.outputs);
  assert.deepEqual(
    parseOutput(findOutput(bobQueued, "temporal-mutex-lock-requested")),
    { lockId: "timeout-lock", owner: "bob", position: 1 }
  );

  const timedOut = await workflow.threadStep(
    schedulerResume(aliceTimeout),
    "timeout-lock"
  );
  const afterTimeout = [
    ...externalOutputs(timedOut.outputs),
    ...(await workflow.drainInternal(timedOut.outputs))
  ];
  assert.equal(
    parseOutput(findOutput(afterTimeout, "temporal-mutex-critical-section")).owner,
    "bob"
  );

  const state = await workflow.threadStep(mainSignal({ type: "query" }), "timeout-lock");
  const snapshot = parseOutput(findOutput(state.outputs, "temporal-mutex-state"));
  assert.equal(snapshot.holder, "bob");
  assert.equal(snapshot.queue.length, 0);
});
