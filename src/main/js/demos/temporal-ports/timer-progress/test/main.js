const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  collectOutputs,
  findOutput,
  parseOutput: parse,
  resumeEventFromKey: schedulerResume
} = require("../../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-timer-progress",
    defaultThreadId: "timer-progress-thread",
    stepMode: "state"
  });
}

function query(reply) {
  return {
    ref: "main",
    value: {
      type: "getProgress",
      reply
    }
  };
}

test("bundle exposes timer-progress topics", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-timer-progress-progress",
    "temporal-timer-progress-query-result",
    "workflow-error",
    "workflow-result",
    "workflow-scheduler"
  ]);
});

test("timer-progress publishes progress and answers query-like reads", async () => {
  const workflow = createHarness();
  const started = await workflow.step({
    steps: 2,
    tickMS: 25,
    increment: 50
  });
  const firstTick = findOutput(started.outputs, "workflow-scheduler");
  assert.equal(firstTick.value, "25");

  const initialQuery = await workflow.step(query("q0"), started.state);
  assert.deepEqual(
    parse(findOutput(initialQuery.outputs, "temporal-timer-progress-query-result")),
    {
      reply: "q0",
      progress: 0
    }
  );

  const afterFirstTick = await workflow.step(
    schedulerResume(firstTick),
    initialQuery.state
  );
  assert.deepEqual(
    parse(findOutput(afterFirstTick.outputs, "temporal-timer-progress-progress")),
    {
      step: 1,
      progress: 50
    }
  );
  const secondTick = collectOutputs(afterFirstTick.outputs, "workflow-scheduler")[0];
  assert.equal(secondTick.value, "25");

  const midwayQuery = await workflow.step(query("q1"), afterFirstTick.state);
  assert.deepEqual(
    parse(findOutput(midwayQuery.outputs, "temporal-timer-progress-query-result")),
    {
      reply: "q1",
      progress: 50
    }
  );

  const completed = await workflow.step(schedulerResume(secondTick), midwayQuery.state);
  assert.equal(completed.state, "");
  assert.deepEqual(
    parse(findOutput(completed.outputs, "temporal-timer-progress-progress")),
    {
      step: 2,
      progress: 100
    }
  );
  assert.deepEqual(parse(findOutput(completed.outputs, "workflow-result")), {
    progress: 100
  });
});

test("timer-progress ignores stale timer events", async () => {
  const workflow = createHarness();
  const started = await workflow.step({
    steps: 1,
    tickMS: 25
  });

  const stale = await workflow.step(
    {
      ref: "main",
      value: {
        type: "tick",
        step: 2
      }
    },
    started.state
  );

  assert.notEqual(stale.state, "");
  assert.equal(findOutput(stale.outputs, "temporal-timer-progress-progress"), undefined);

  const completed = await workflow.step(
    schedulerResume(findOutput(started.outputs, "workflow-scheduler")),
    stale.state
  );
  assert.equal(completed.state, "");
  assert.deepEqual(parse(findOutput(completed.outputs, "workflow-result")), {
    progress: 100
  });
});
