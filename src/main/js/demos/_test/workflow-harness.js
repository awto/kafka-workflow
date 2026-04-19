const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { performance } = require("node:perf_hooks");

function builtPath(testDir, bundle) {
  let dir = path.resolve(testDir);
  for (;;) {
    const candidate = path.join(dir, "resources/static/built", bundle, "index.js");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`cannot find built bundle ${bundle} from ${testDir}`);
}

function createSandbox(built) {
  const req = createRequire(built);
  const sandbox = {
    console,
    process: {
      env: {
        EFFECTFUL_DEBUGGER_TRANSPORT: "none"
      },
      nextTick: process.nextTick.bind(process),
      domain: null
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,
    queueMicrotask,
    structuredClone,
    atob,
    btoa,
    performance,
    require: req,
    module: {
      exports: {},
      filename: built,
      id: built,
      loaded: false,
      path: path.dirname(built),
      children: [],
      paths: []
    },
    exports: {},
    __filename: built,
    __dirname: path.dirname(built)
  };
  sandbox.exports = sandbox.module.exports;
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

function createWorkflowHarness(
  testDir,
  { bundle, defaultThreadId, stepMode = "state" }
) {
  const built = builtPath(testDir, bundle);
  const sandbox = createSandbox(built);
  vm.createContext(sandbox);
  new vm.Script(fs.readFileSync(built, "utf8"), { filename: built }).runInContext(
    sandbox
  );

  let stepIndex = 0;
  const states = new Map();

  async function run(eventString, threadId, state) {
    const result = await Promise.resolve(
      sandbox["efwf$step"](eventString, state, threadId, `${stepIndex++}`)
    );
    const cloned = structuredClone(result);
    if (cloned.state) {
      states.set(threadId, cloned.state);
    } else {
      states.delete(threadId);
    }
    return cloned;
  }

  async function stepWithState(event, state = "", threadId = defaultThreadId) {
    return await run(JSON.stringify(event), threadId, state);
  }

  async function stepWithStoredState(
    event,
    threadId = defaultThreadId,
    newThread = false
  ) {
    return await run(
      JSON.stringify(event),
      threadId,
      newThread ? "" : states.get(threadId) ?? ""
    );
  }

  async function drainInternal(outputs) {
    const queue = outputs.filter((output) => output.topic === "workflow-resume");
    const collected = [];
    while (queue.length > 0) {
      const output = queue.shift();
      const newThread = output.value.startsWith("new:");
      const initThread = output.value.startsWith("init:");
      if (initThread && states.has(output.key)) {
        continue;
      }
      const startThread = newThread || initThread;
      const prefixLength = newThread ? 4 : 5;
      const eventString = startThread
        ? JSON.stringify(JSON.parse(output.value.slice(prefixLength)))
        : output.value;
      const result = await run(
        eventString,
        output.key,
        startThread ? "" : states.get(output.key) ?? ""
      );
      for (const next of result.outputs) {
        if (next.topic === "workflow-resume") {
          queue.push(next);
        } else {
          collected.push(next);
        }
      }
    }
    return collected;
  }

  return {
    topics() {
      const topics = new Set();
      sandbox["efwf$outputTopics"](topics);
      return [...topics].sort();
    },
    step: stepMode === "thread" ? stepWithStoredState : stepWithState,
    threadStep: stepWithStoredState,
    drainInternal
  };
}

function findOutput(outputs, topic) {
  return outputs.find((output) => output.topic === topic);
}

function findOutputByKey(outputs, topic, key) {
  return outputs.find((output) => output.topic === topic && output.key === key);
}

function collectOutputs(outputs, topic) {
  return outputs.filter((output) => output.topic === topic);
}

function externalOutputs(outputs) {
  return outputs.filter((output) => output.topic !== "workflow-resume");
}

function parseOutput(output) {
  return JSON.parse(output.value);
}

function resumeEventFromKey(output) {
  return JSON.parse(output.key.split("|")[1]);
}

module.exports = {
  createWorkflowHarness,
  findOutput,
  findOutputByKey,
  collectOutputs,
  externalOutputs,
  parseOutput,
  resumeEventFromKey
};
