const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

process.env.EFFECTFUL_DEBUGGER_TRANSPORT = "none";

const NativePromise = Promise;
const Babel = require("@babel/core");
const Debugger = require("@effectful/debugger");
const Serialization = require("@effectful/serialization");
const RT = require("../lib/main.js");
let runtimeId = 0;
let stepRunId = 0;

function toNative(value) {
  return new NativePromise((resolve, reject) => {
    value.then(resolve, reject);
  });
}

function delay(ms, value, state, mode = "resolve") {
  return {
    then(resolve, reject) {
      const scope = RT.currentCancellationScope();
      assert.ok(scope, "expected active cancellation scope");

      let settled = false;
      const canceler = () => {
        if (settled) return;
        settled = true;
        scope.cancelers.delete(canceler);
        clearTimeout(timer);
        state.canceled++;
        reject(new RT.CancelToken());
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        scope.cancelers.delete(canceler);
        state.finished++;
        if (mode === "resolve") resolve(value);
        else reject(value);
      }, ms);

      scope.cancelers.add(canceler);
    }
  };
}

function createStepRuntime() {
  const refs = new Map();
  const runtime = {
    ...RT,
    ref(name) {
      const handle = RT.ref(name);
      refs.set(name, handle);
      return handle;
    }
  };
  Serialization.regOpaqueObject(
    runtime,
    `@effectful/kafka-workflow-rt/test-runtime/${++runtimeId}`
  );
  return { refs, runtime };
}

function createStepIds() {
  const run = `thread-${++stepRunId}`;
  return {
    thread: run,
    step(index) {
      return `${run}-step-${index}`;
    }
  };
}

async function withStepWorkflow(source, body) {
  const prevModule = globalThis.efwf$module;
  const prevRuntime = globalThis.__rtTestRuntime;
  const ctx = createStepRuntime();

  if (typeof Debugger.reset === "function") Debugger.reset();
  try {
    globalThis.__rtTestRuntime = ctx.runtime;
    const meta = Debugger.compileEval(
      `return async function main() {\n${source}\n}`,
      null,
      null,
      0,
      true,
      []
    );
    globalThis.efwf$module = meta.func(null)();
    await body(ctx);
  } finally {
    globalThis.efwf$module = prevModule;
    globalThis.__rtTestRuntime = prevRuntime;
    if (typeof Debugger.reset === "function") Debugger.reset();
  }
}

function compileBundledWorkflow(source) {
  const filename = path.join(__dirname, "bundle-style-workflow.js");
  const transformed = Babel.transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    presets: [
      [
        require.resolve("@effectful/debugger/config/babel/preset-zero-config"),
        {
          preInstrumentedLibs: true,
          react: false,
          rt: "@effectful/debugger/main"
        }
      ]
    ]
  });
  if (!transformed || !transformed.code) {
    throw new Error("Failed to transform bundle-style workflow");
  }
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(transformed.code, filename);
  return mod.exports;
}

async function withBundledStepWorkflow(source, body) {
  const prevModule = globalThis.efwf$module;
  const prevRuntime = globalThis.__rtTestRuntime;
  const ctx = createStepRuntime();

  if (typeof Debugger.reset === "function") Debugger.reset();
  try {
    globalThis.__rtTestRuntime = ctx.runtime;
    globalThis.efwf$module = compileBundledWorkflow(source);
    await body(ctx);
  } finally {
    globalThis.efwf$module = prevModule;
    globalThis.__rtTestRuntime = prevRuntime;
    if (typeof Debugger.reset === "function") Debugger.reset();
  }
}

test("host output topics exclude internal workflow loop topic", () => {
  const prevModule = globalThis.efwf$module;
  const prevOutputTopics = globalThis.efwf$outputTopics;
  const prevStep = globalThis.efwf$step;
  const configTopics = [...RT.config.outputTopics];

  try {
    RT.config.outputTopics.add("workflow-resume");
    RT.installWorkflowHost({
      manifest: {
        outputTopics: ["workflow-resume", "external-topic"]
      }
    });

    const topics = new Set();
    globalThis.efwf$outputTopics(topics);
    assert.deepEqual([...topics].sort(), [
      "external-topic",
      "workflow-error",
      "workflow-result"
    ]);
  } finally {
    globalThis.efwf$module = prevModule;
    globalThis.efwf$outputTopics = prevOutputTopics;
    globalThis.efwf$step = prevStep;
    RT.config.outputTopics.clear();
    for (const topic of configTopics) RT.config.outputTopics.add(topic);
  }
});

test("Promise.race cancels losers and waits for cancellation unwinding", async () => {
  const s1 = { canceled: 0, finished: 0 };
  const s2 = { canceled: 0, finished: 0 };
  const root = new RT.CancellationScope();

  const value = await toNative(
    RT.withCancellationScope(root, () =>
      RT.Promise.race([delay(5, 1, s1), delay(50, 2, s2)])
    )
  );

  assert.equal(value, 1);
  assert.equal(s1.canceled, 0);
  assert.equal(s2.canceled, 1);
  assert.equal(s1.finished, 1);
  assert.equal(s2.finished, 0);
});

test("Promise.all rejection cancels remaining branches", async () => {
  const s1 = { canceled: 0, finished: 0 };
  const s2 = { canceled: 0, finished: 0 };
  const s3 = { canceled: 0, finished: 0 };
  const root = new RT.CancellationScope();

  await assert.rejects(
    toNative(
      RT.withCancellationScope(root, () =>
        RT.Promise.all([
          delay(5, 1, s1),
          delay(10, new Error("boom"), s2, "reject"),
          delay(50, 3, s3)
        ])
      )
    ),
    /boom/
  );

  assert.equal(s1.finished, 1);
  assert.equal(s2.canceled, 0);
  assert.equal(s3.canceled, 1);
  assert.equal(s3.finished, 0);
});

test("parent cancellation propagates into child scopes", async () => {
  const s1 = { canceled: 0, finished: 0 };
  const s2 = { canceled: 0, finished: 0 };
  const root = new RT.CancellationScope();

  const promise = RT.withCancellationScope(root, () =>
    RT.Promise.race([delay(50, 1, s1), delay(60, 2, s2)])
  );

  await toNative(RT.cancelScope(root, RT.Promise));

  await assert.rejects(
    toNative(promise),
    (error) => error instanceof RT.CancelToken
  );

  assert.equal(s1.canceled, 1);
  assert.equal(s2.canceled, 1);
  assert.equal(s1.finished, 0);
  assert.equal(s2.finished, 0);
});

test("ref resolves and cancels through the current scope", async () => {
  const root = new RT.CancellationScope();
  const ok = RT.ref("ok");
  const cancel = RT.ref("cancel");

  const resolved = RT.withCancellationScope(root, () => RT.Promise.resolve(ok));
  ok.resolve(42);
  assert.equal(await toNative(resolved), 42);

  const rejected = RT.withCancellationScope(root, () => RT.Promise.resolve(cancel));
  await toNative(RT.cancelScope(root, RT.Promise));
  await assert.rejects(
    toNative(rejected),
    (error) => error instanceof RT.CancelToken
  );
  cancel.reject(new Error("closed"));
});

test("instrumented native await ref resolves", async () => {
  let lastRef;
  const runtime = {
    ...RT,
    ref(name) {
      lastRef = RT.ref(name);
      return lastRef;
    }
  };
  if (typeof Debugger.reset === "function") Debugger.reset();
  try {
    const meta = Debugger.compileEval(
      `
        return async function main() {
          const ref = W.ref("wait");
          const value = await ref;
          return { value };
        }
      `,
      null,
      null,
      0,
      true,
      ["W"]
    );
    const main = meta.func(null)(runtime);
    const result = main();

    assert.ok(lastRef, "expected workflow to create a ref");
    lastRef.resolve(123);
    assert.deepEqual(await toNative(result), { value: 123 });
  } finally {
    if (typeof Debugger.reset === "function") Debugger.reset();
  }
});

test("step persists and resumes native await ref", async () => {
  await withStepWorkflow(
    `
      const ref = globalThis.__rtTestRuntime.ref("wait");
      const value = await ref;
      return { value };
    `,
    async ({ refs }) => {
      const ids = createStepIds();
      const lastRef = refs.get("wait");
      assert.equal(lastRef, undefined);

      const first = await toNative(RT.step("{}", "", ids.thread, ids.step(1)));
      const waitRef = refs.get("wait");
      assert.ok(waitRef, "expected workflow to create a ref");
      assert.ok(first.state, "expected state to be persisted");
      assert.equal(first.outputs.length, 0);

      const second = await toNative(
        RT.step(
          JSON.stringify({ ref: waitRef.id, value: 321 }),
          first.state,
          ids.thread,
          ids.step(2)
        )
      );

      assert.equal(second.state, "");
      assert.deepEqual(
        second.outputs.map((item) => ({
          topic: item.topic,
          value: JSON.parse(item.value)
        })),
        [{ topic: "workflow-result", value: { value: 321 } }]
      );
    }
  );
});

test("step persists and resumes nested async return chains", async () => {
  await withStepWorkflow(
    `
      async function reserve(name) {
        const ref = globalThis.__rtTestRuntime.ref(name);
        const value = await ref;
        return { name, value };
      }
      const result = await (async () => await reserve("wait"))();
      return result;
    `,
    async ({ refs }) => {
      const ids = createStepIds();
      const first = await toNative(RT.step("{}", "", ids.thread, ids.step(1)));
      const waitRef = refs.get("wait");
      assert.ok(waitRef, "expected nested async workflow to create a ref");
      assert.ok(first.state, "expected nested async workflow state to be persisted");

      const second = await toNative(
        RT.step(
          JSON.stringify({ ref: waitRef.id, value: 321 }),
          first.state,
          ids.thread,
          ids.step(2)
        )
      );

      assert.equal(second.state, "");
      assert.deepEqual(
        second.outputs.map((item) => ({
          topic: item.topic,
          value: JSON.parse(item.value)
        })),
        [{ topic: "workflow-result", value: { name: "wait", value: 321 } }]
      );
    }
  );
});

test("step persists and resumes native await Promise.race with loser cancellation", async () => {
  await withStepWorkflow(
    `
      let loserCanceled = false;
      const left = (async () => {
        try {
          return await globalThis.__rtTestRuntime.ref("left");
        } catch (error) {
          if (error instanceof globalThis.__rtTestRuntime.CancelToken) {
            loserCanceled = true;
          }
          throw error;
        }
      })();
      const right = (async () => {
        try {
          return await globalThis.__rtTestRuntime.ref("right");
        } catch (error) {
          if (error instanceof globalThis.__rtTestRuntime.CancelToken) {
            loserCanceled = true;
          }
          throw error;
        }
      })();
      const value = await Promise.race([left, right]);
      return { value, loserCanceled };
    `,
    async ({ refs }) => {
      const ids = createStepIds();
      const first = await toNative(RT.step("{}", "", ids.thread, ids.step(1)));
      const left = refs.get("left");
      const right = refs.get("right");
      assert.ok(left && right, "expected workflow to create race refs");
      assert.ok(first.state, "expected race state to be persisted");

      const second = await toNative(
        RT.step(
          JSON.stringify({ ref: left.id, value: "winner" }),
          first.state,
          ids.thread,
          ids.step(2)
        )
      );

      assert.equal(second.state, "");
      assert.deepEqual(
        second.outputs.map((item) => ({
          topic: item.topic,
          value: JSON.parse(item.value)
        })),
        [{ topic: "workflow-result", value: { value: "winner", loserCanceled: true } }]
      );

      right.resolve("late");
    }
  );
});

test("step persists and resumes native await Promise.all with sibling cancellation", async () => {
  await withStepWorkflow(
    `
      const canceled = [];
      const waitNamed = async (name) => {
        try {
          return await globalThis.__rtTestRuntime.ref(name);
        } catch (error) {
          if (error instanceof globalThis.__rtTestRuntime.CancelToken) {
            canceled.push(name);
          }
          throw error;
        }
      };
      try {
        await Promise.all([waitNamed("a"), waitNamed("b"), waitNamed("c")]);
        return { ok: true, canceled };
      } catch (error) {
        return {
          ok: false,
          message: error && error.message ? error.message : String(error),
          canceled: canceled.sort()
        };
      }
    `,
    async ({ refs }) => {
      const ids = createStepIds();
      const first = await toNative(RT.step("{}", "", ids.thread, ids.step(1)));
      const a = refs.get("a");
      const b = refs.get("b");
      const c = refs.get("c");
      assert.ok(a && b && c, "expected workflow to create all refs");
      assert.ok(first.state, "expected all state to be persisted");

      const second = await toNative(
        RT.step(
          JSON.stringify({ ref: b.id, error: { message: "boom" } }),
          first.state,
          ids.thread,
          ids.step(2)
        )
      );

      assert.equal(second.state, "");
      assert.deepEqual(
        second.outputs.map((item) => ({
          topic: item.topic,
          value: JSON.parse(item.value)
        })),
        [
          {
            topic: "workflow-result",
            value: { ok: false, message: "boom", canceled: ["a", "c"] }
          }
        ]
      );

      a.resolve("late-a");
      c.resolve("late-c");
    }
  );
});

test("step resumes nested awaited async branches inside persisted Promise.race/Promise.all", async () => {
  await withStepWorkflow(
    `
      async function reserve(name) {
        const ref = globalThis.__rtTestRuntime.ref(name);
        const value = await ref;
        return { name, value };
      }
      async function timeout() {
        const ref = globalThis.__rtTestRuntime.ref("scheduler");
        await ref;
        throw "timeout";
      }
      const result = await Promise.race([
        Promise.all([
          (async () => await reserve("a"))(),
          (async () => await reserve("b"))(),
          (async () => await reserve("c"))()
        ]),
        timeout()
      ]);
      return {
        values: result.map((entry) => entry.value)
      };
    `,
    async ({ refs }) => {
      const ids = createStepIds();
      const first = await toNative(RT.step("{}", "", ids.thread, ids.step(1)));
      const a = refs.get("a");
      const b = refs.get("b");
      const c = refs.get("c");
      const scheduler = refs.get("scheduler");
      assert.ok(a && b && c && scheduler, "expected nested race/all refs");
      assert.ok(first.state, "expected nested race/all state to be persisted");

      const second = await toNative(
        RT.step(
          JSON.stringify({ ref: c.id, value: "winner-c" }),
          first.state,
          ids.thread,
          ids.step(2)
        )
      );

      assert.ok(second.state, "expected pending state after first nested branch");
      assert.deepEqual(second.outputs, []);

      const third = await toNative(
        RT.step(
          JSON.stringify({ ref: b.id, value: "winner-b" }),
          second.state,
          ids.thread,
          ids.step(3)
        )
      );

      assert.ok(third.state, "expected pending state after second nested branch");
      assert.deepEqual(third.outputs, []);

      const fourth = await toNative(
        RT.step(
          JSON.stringify({ ref: a.id, value: "winner-a" }),
          third.state,
          ids.thread,
          ids.step(4)
        )
      );

      assert.equal(fourth.state, "");
      assert.deepEqual(
        fourth.outputs.map((item) => ({
          topic: item.topic,
          value: JSON.parse(item.value)
        })),
        [
          {
            topic: "workflow-result",
            value: {
              values: ["winner-a", "winner-b", "winner-c"]
            }
          }
        ]
      );
    }
  );
});

test("step cancels nested Promise.all branches when a persisted timeout branch wins", async () => {
  await withStepWorkflow(
    `
      const canceled = [];
      async function reserve(name) {
        const ref = globalThis.__rtTestRuntime.ref(name);
        try {
          await ref;
          return name;
        } catch (error) {
          if (error instanceof globalThis.__rtTestRuntime.CancelToken) {
            canceled.push(name);
          }
          throw error;
        }
      }
      async function timeout() {
        const ref = globalThis.__rtTestRuntime.ref("scheduler");
        await ref;
        throw "timeout";
      }
      try {
        await Promise.race([
          Promise.all([
            (async () => await reserve("a"))(),
            (async () => await reserve("b"))(),
            (async () => await reserve("c"))()
          ]),
          timeout()
        ]);
        return { ok: true, canceled };
      } catch (error) {
        return {
          ok: false,
          message: error && error.message ? error.message : String(error),
          canceled: canceled.sort()
        };
      }
    `,
    async ({ refs }) => {
      const ids = createStepIds();
      const first = await toNative(RT.step("{}", "", ids.thread, ids.step(1)));
      const a = refs.get("a");
      const b = refs.get("b");
      const c = refs.get("c");
      const scheduler = refs.get("scheduler");
      assert.ok(a && b && c && scheduler, "expected nested timeout refs");
      assert.ok(first.state, "expected nested timeout state to be persisted");

      const second = await toNative(
        RT.step(
          JSON.stringify({ ref: a.id, value: "winner-a" }),
          first.state,
          ids.thread,
          ids.step(2)
        )
      );

      assert.ok(second.state, "expected pending state after first reservation");

      const third = await toNative(
        RT.step(
          JSON.stringify({ ref: scheduler.id }),
          second.state,
          ids.thread,
          ids.step(3)
        )
      );

      assert.equal(third.state, "");
      assert.deepEqual(
        third.outputs.map((item) => ({
          topic: item.topic,
          value: JSON.parse(item.value)
        })),
        [
          {
            topic: "workflow-result",
            value: { ok: false, message: "timeout", canceled: ["b", "c"] }
          }
        ]
      );

      b.resolve("late-b");
      c.resolve("late-c");
    }
  );
});

test("step persists and resumes native await Promise.any with sibling cancellation", async () => {
  await withStepWorkflow(
    `
      const canceled = [];
      const waitNamed = async (name) => {
        try {
          return await globalThis.__rtTestRuntime.ref(name);
        } catch (error) {
          if (error instanceof globalThis.__rtTestRuntime.CancelToken) {
            canceled.push(name);
          }
          throw error;
        }
      };
      const value = await Promise.any([
        waitNamed("a"),
        waitNamed("b"),
        waitNamed("c")
      ]);
      return { value, canceled: canceled.sort() };
    `,
    async ({ refs }) => {
      const ids = createStepIds();
      const first = await toNative(RT.step("{}", "", ids.thread, ids.step(1)));
      const a = refs.get("a");
      const b = refs.get("b");
      const c = refs.get("c");
      assert.ok(a && b && c, "expected workflow to create any refs");
      assert.ok(first.state, "expected any state to be persisted");

      const second = await toNative(
        RT.step(
          JSON.stringify({ ref: b.id, value: "winner" }),
          first.state,
          ids.thread,
          ids.step(2)
        )
      );

      assert.equal(second.state, "");
      assert.deepEqual(
        second.outputs.map((item) => ({
          topic: item.topic,
          value: JSON.parse(item.value)
        })),
        [
          {
            topic: "workflow-result",
            value: { value: "winner", canceled: ["a", "c"] }
          }
        ]
      );

      a.resolve("late-a");
      c.resolve("late-c");
    }
  );
});

test("step persists native await Promise.allSettled until the last branch settles", async () => {
  await withStepWorkflow(
    `
      const canceled = [];
      const waitNamed = async (name) => {
        try {
          return await globalThis.__rtTestRuntime.ref(name);
        } catch (error) {
          if (error instanceof globalThis.__rtTestRuntime.CancelToken) {
            canceled.push(name);
          }
          throw error;
        }
      };
      const result = await Promise.allSettled([
        waitNamed("a"),
        waitNamed("b"),
        waitNamed("c")
      ]);
      return {
        canceled: canceled.sort(),
        result: result.map((entry) =>
          entry.status === "fulfilled"
            ? { status: entry.status, value: entry.value }
            : {
                status: entry.status,
                reason:
                  entry.reason && entry.reason.message
                    ? entry.reason.message
                    : String(entry.reason)
              }
        )
      };
    `,
    async ({ refs }) => {
      const ids = createStepIds();
      const first = await toNative(RT.step("{}", "", ids.thread, ids.step(1)));
      const a = refs.get("a");
      const b = refs.get("b");
      const c = refs.get("c");
      assert.ok(a && b && c, "expected workflow to create allSettled refs");
      assert.ok(first.state, "expected allSettled state to be persisted");

      const second = await toNative(
        RT.step(
          JSON.stringify({ ref: a.id, value: "one" }),
          first.state,
          ids.thread,
          ids.step(2)
        )
      );
      assert.ok(second.state, "expected state after first allSettled branch");
      assert.deepEqual(second.outputs, []);

      const third = await toNative(
        RT.step(
          JSON.stringify({ ref: b.id, error: { message: "boom" } }),
          second.state,
          ids.thread,
          ids.step(3)
        )
      );
      assert.ok(third.state, "expected state after second allSettled branch");
      assert.deepEqual(third.outputs, []);

      const fourth = await toNative(
        RT.step(
          JSON.stringify({ ref: c.id, value: "three" }),
          third.state,
          ids.thread,
          ids.step(4)
        )
      );

      assert.equal(fourth.state, "");
      assert.deepEqual(
        fourth.outputs.map((item) => ({
          topic: item.topic,
          value: JSON.parse(item.value)
        })),
        [
          {
            topic: "workflow-result",
            value: {
              canceled: [],
              result: [
                { status: "fulfilled", value: "one" },
                { status: "rejected", reason: "boom" },
                { status: "fulfilled", value: "three" }
              ]
            }
          }
        ]
      );
    }
  );
});

test("step persists and resumes bundle-style nested async Promise.race/Promise.all", async () => {
  await withBundledStepWorkflow(
    `
      const W = globalThis.__rtTestRuntime;

      async function timeout() {
        const resume = W.ref("timeout");
        await resume;
        throw new Error("timeout");
      }

      function pair(name) {
        return async function reserve() {
          const resume = W.ref(name);
          return await resume;
        };
      }

      const reserveA = pair("a");
      const reserveB = pair("b");
      const reserveC = pair("c");

      module.exports = async function main() {
        const result = await Promise.race([
          Promise.all([
            (async () => await reserveA())(),
            (async () => await reserveB())(),
            (async () => await reserveC())()
          ]),
          timeout()
        ]);
        const [a, b, c] = result;
        return { a, b, c };
      };
    `,
    async ({ refs }) => {
      const ids = createStepIds();

      const first = await toNative(RT.step("{}", "", ids.thread, ids.step(0)));
      assert.notEqual(first.state, "");

      refs.get("b").resolve("two");
      const second = await toNative(
        RT.step(
          JSON.stringify({ ref: refs.get("b").id, value: "two" }),
          first.state,
          ids.thread,
          ids.step(1)
        )
      );
      assert.notEqual(second.state, "");

      refs.get("c").resolve("three");
      const third = await toNative(
        RT.step(
          JSON.stringify({ ref: refs.get("c").id, value: "three" }),
          second.state,
          ids.thread,
          ids.step(2)
        )
      );
      assert.notEqual(third.state, "");

      refs.get("a").resolve("one");
      const fourth = await toNative(
        RT.step(
          JSON.stringify({ ref: refs.get("a").id, value: "one" }),
          third.state,
          ids.thread,
          ids.step(3)
        )
      );

      assert.equal(fourth.state, "");
      assert.deepEqual(
        fourth.outputs.map((item) => ({
          topic: item.topic,
          value: JSON.parse(item.value)
        })),
        [
          {
            topic: "workflow-result",
            value: { a: "one", b: "two", c: "three" }
          }
        ]
      );
    }
  );
});
