const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  collectOutputs,
  findOutput,
  parseOutput: parse
} = require("../../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-cancellation-scopes",
    defaultThreadId: "cancellation-scopes-thread",
    stepMode: "state"
  });
}

test("bundle exposes cancellation scope topics", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-cancellation-scopes-await-cancel",
    "temporal-cancellation-scopes-await-timeout",
    "temporal-cancellation-scopes-callback-resolved",
    "temporal-cancellation-scopes-callback-scheduled",
    "temporal-cancellation-scopes-cancel-observed",
    "temporal-cancellation-scopes-cleanup",
    "temporal-cancellation-scopes-http-get",
    "temporal-cancellation-scopes-http-get-cancel",
    "temporal-cancellation-scopes-http-post",
    "temporal-cancellation-scopes-http-post-cancel",
    "temporal-cancellation-scopes-shared-winner",
    "temporal-cancellation-scopes-timer-cancelled",
    "workflow-error",
    "workflow-result",
    "workflow-scheduler"
  ]);
});

test("cancelTimer cancels the scheduled timer before returning", async () => {
  const workflow = createHarness();
  const result = await workflow.step({ mode: "cancelTimer" });

  assert.equal(result.state, "");
  const schedulerWrites = collectOutputs(result.outputs, "workflow-scheduler");
  assert.equal(schedulerWrites[0].value, "60000");
  assert.equal(schedulerWrites[1].value, "0");
  assert.deepEqual(parse(findOutput(result.outputs, "temporal-cancellation-scopes-timer-cancelled")), {
    timer: "timer"
  });
  assert.deepEqual(parse(findOutput(result.outputs, "workflow-result")), {
    status: "timer-cancelled"
  });
});

test("cancelTimerAltImpl cancels a timer through an explicit scope", async () => {
  const workflow = createHarness();
  const result = await workflow.step({ mode: "cancelTimerAltImpl" });

  assert.equal(result.state, "");
  const schedulerWrites = collectOutputs(result.outputs, "workflow-scheduler");
  assert.equal(schedulerWrites[0].value, "60000");
  assert.equal(schedulerWrites[1].value, "0");
  assert.deepEqual(parse(findOutput(result.outputs, "temporal-cancellation-scopes-timer-cancelled")), {
    timer: "timer-alt"
  });
  assert.deepEqual(parse(findOutput(result.outputs, "workflow-result")), {
    status: "timer-cancelled-alt"
  });
});

test("cleanupAfterCancel emits activity cancellation and cleanup", async () => {
  const workflow = createHarness();
  const result = await workflow.step({
    mode: "cleanupAfterCancel",
    urls: ["https://example.com/post"]
  });

  assert.equal(result.state, "");
  const post = parse(findOutput(result.outputs, "temporal-cancellation-scopes-http-post"));
  assert.deepEqual(parse(findOutput(result.outputs, "temporal-cancellation-scopes-http-post-cancel")), {
    url: "https://example.com/post",
    ref: post.ref
  });
  assert.deepEqual(parse(findOutput(result.outputs, "temporal-cancellation-scopes-cleanup")), {
    url: "https://example.com/post"
  });
  assert.deepEqual(parse(findOutput(result.outputs, "workflow-result")), {
    status: "cleaned-up"
  });
});

test("externalCancellationCleanup waits for cancel and then runs cleanup", async () => {
  const workflow = createHarness();
  const started = await workflow.step({
    mode: "externalCancellationCleanup",
    urls: ["https://example.com/post"],
    data: { payload: true }
  });
  const post = parse(findOutput(started.outputs, "temporal-cancellation-scopes-http-post"));
  assert.deepEqual(parse(findOutput(started.outputs, "temporal-cancellation-scopes-await-cancel")), {
    ref: "cancel"
  });

  const cancelled = await workflow.step(
    { ref: "cancel", value: { reason: "operator requested" } },
    started.state
  );

  assert.equal(cancelled.state, "");
  assert.deepEqual(parse(findOutput(cancelled.outputs, "temporal-cancellation-scopes-http-post-cancel")), {
    url: "https://example.com/post",
    ref: post.ref
  });
  assert.deepEqual(parse(findOutput(cancelled.outputs, "temporal-cancellation-scopes-cleanup")), {
    url: "https://example.com/post"
  });
  assert.deepEqual(parse(findOutput(cancelled.outputs, "workflow-result")), {
    status: "cleaned-up-after-external-cancel",
    reason: "operator requested",
    data: { payload: true }
  });
});

test("one timeout branch cancels all grouped activities", async () => {
  const workflow = createHarness();
  const first = await workflow.step({
    mode: "multipleActivitiesSingleTimeout",
    urls: ["https://example.com/a", "https://example.com/b"],
    timeoutMS: 50
  });
  const timeout = parse(findOutput(first.outputs, "temporal-cancellation-scopes-await-timeout"));
  assert.deepEqual(timeout, { timeoutMS: 50, ref: "timeout" });

  const timedOut = await workflow.step({ ref: timeout.ref, value: { timedOut: true } }, first.state);

  assert.equal(timedOut.state, "");
  assert.deepEqual(
    collectOutputs(timedOut.outputs, "temporal-cancellation-scopes-http-get-cancel")
      .map(parse)
      .map((value) => value.url)
      .sort(),
    ["https://example.com/a", "https://example.com/b"]
  );
  assert.deepEqual(parse(findOutput(timedOut.outputs, "workflow-result")), {
    status: "timed-out"
  });
});

test("nonCancellable completes without emitting cancellation", async () => {
  const workflow = createHarness();
  const first = await workflow.step({
    mode: "nonCancellable",
    urls: ["https://example.com/non-cancellable"]
  });
  const request = parse(findOutput(first.outputs, "temporal-cancellation-scopes-http-get"));

  const completed = await workflow.step(
    { ref: request.ref, value: { value: { ok: true } } },
    first.state
  );

  assert.equal(completed.state, "");
  assert.equal(
    findOutput(completed.outputs, "temporal-cancellation-scopes-http-get-cancel"),
    undefined
  );
  assert.deepEqual(parse(findOutput(completed.outputs, "workflow-result")), {
    status: "completed",
    value: { ok: true }
  });
});

test("resumeAfterCancellation observes cancel and waits for shielded activity", async () => {
  const workflow = createHarness();
  const first = await workflow.step({
    mode: "resumeAfterCancellation",
    urls: ["https://example.com/resume"]
  });
  const request = parse(findOutput(first.outputs, "temporal-cancellation-scopes-http-get"));
  assert.deepEqual(parse(findOutput(first.outputs, "temporal-cancellation-scopes-await-cancel")), {
    ref: "cancel"
  });

  const cancelled = await workflow.step(
    { ref: "cancel", value: { reason: "stop requested" } },
    first.state
  );
  assert.notEqual(cancelled.state, "");
  assert.deepEqual(parse(findOutput(cancelled.outputs, "temporal-cancellation-scopes-cancel-observed")), {
    url: "https://example.com/resume",
    reason: "stop requested"
  });
  assert.equal(
    findOutput(cancelled.outputs, "temporal-cancellation-scopes-http-get-cancel"),
    undefined
  );

  const completed = await workflow.step(
    { ref: request.ref, value: { value: "late-result" } },
    cancelled.state
  );
  assert.equal(completed.state, "");
  assert.deepEqual(parse(findOutput(completed.outputs, "workflow-result")), {
    status: "resumed-after-cancel",
    value: "late-result"
  });
});

test("cancellationScopesWithCallbacks resumes from callback ref", async () => {
  const workflow = createHarness();
  const first = await workflow.step({ mode: "cancellationScopesWithCallbacks" });
  assert.deepEqual(parse(findOutput(first.outputs, "temporal-cancellation-scopes-callback-scheduled")), {
    ref: "callback"
  });

  const completed = await workflow.step(
    { ref: "callback", value: { ok: true } },
    first.state
  );
  assert.equal(completed.state, "");
  assert.deepEqual(parse(findOutput(completed.outputs, "temporal-cancellation-scopes-callback-resolved")), {
    ref: "callback"
  });
  assert.deepEqual(parse(findOutput(completed.outputs, "workflow-result")), {
    status: "callback-resolved"
  });
});

test("sharedScopes observes the first result without canceling shared requests", async () => {
  const workflow = createHarness();
  const first = await workflow.step({
    mode: "sharedScopes",
    urls: ["https://example.com/a", "https://example.com/b"]
  });
  assert.deepEqual(
    collectOutputs(first.outputs, "temporal-cancellation-scopes-http-get")
      .map(parse)
      .map((value) => value.url)
      .sort(),
    ["https://example.com/a", "https://example.com/b"]
  );

  const completed = await workflow.step(
    { ref: "shared:first", value: { index: 1, value: "b" } },
    first.state
  );
  assert.equal(completed.state, "");
  assert.equal(
    collectOutputs(completed.outputs, "temporal-cancellation-scopes-http-get-cancel").length,
    0
  );
  assert.deepEqual(parse(findOutput(completed.outputs, "temporal-cancellation-scopes-shared-winner")), {
    url: "https://example.com/b",
    ref: "shared-get:1",
    value: "b"
  });
  assert.deepEqual(parse(findOutput(completed.outputs, "workflow-result")), {
    status: "first-completed",
    winner: {
      url: "https://example.com/b",
      ref: "shared-get:1",
      value: "b"
    }
  });
});

test("shieldAwaitedActivity observes cancellation without canceling activity", async () => {
  const workflow = createHarness();
  const result = await workflow.step({
    mode: "shieldAwaitedActivity",
    urls: ["https://example.com/keep-running"]
  });

  assert.equal(result.state, "");
  assert.deepEqual(parse(findOutput(result.outputs, "temporal-cancellation-scopes-http-get")), {
    url: "https://example.com/keep-running",
    ref: "shielded-get:https://example.com/keep-running"
  });
  assert.equal(findOutput(result.outputs, "temporal-cancellation-scopes-http-get-cancel"), undefined);
  assert.deepEqual(parse(findOutput(result.outputs, "workflow-result")), {
    status: "cancel-observed-activity-kept-running",
    shieldedRef: "shielded-get:https://example.com/keep-running"
  });
});
