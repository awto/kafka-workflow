const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

export const workflows = {
  lockWorkflow: "lockWorkflow",
  oneAtATimeWorkflow: "oneAtATimeWorkflow"
} as const;

const topics = {
  workflowResume: "workflow-resume",
  lockAcquired: "temporal-mutex-lock-acquired",
  lockRequested: "temporal-mutex-lock-requested",
  invalidRelease: "temporal-mutex-invalid-release",
  state: "temporal-mutex-state",
  notifyLocked: "temporal-mutex-notify-locked",
  criticalSection: "temporal-mutex-critical-section",
  notifyUnlocked: "temporal-mutex-notify-unlocked",
  scheduler: "workflow-scheduler"
} as const;

export interface MutexInput {
  workflow?: typeof workflows.lockWorkflow;
  lockId: string;
}

export interface OneAtATimeInput {
  workflow: typeof workflows.oneAtATimeWorkflow;
  resourceId: string;
  owner?: string;
  sleepForMS?: number;
  lockTimeoutMS?: number;
}

type LockAcquireSignal = {
  type: "acquire";
  owner: string;
  replyThread?: string;
  replyRef?: string;
  releaseRef?: string;
  timeoutMS?: number;
};

type MutexSignal =
  | LockAcquireSignal
  | { type: "release"; owner: string }
  | { type: "query" }
  | { type: "shutdown" };

type MutexEvent = MutexSignal | { type: "timeout" };

type ReleaseSignal = {
  owner?: string;
};

type LockRequest = {
  owner: string;
  replyThread?: string;
  replyRef?: string;
  releaseRef?: string;
  timeoutMS?: number;
};

type LockGranted = {
  lockId: string;
  owner: string;
  releaseRef: string;
};

type CriticalSectionAck = {
  ok: true;
};

type MutexState = {
  lockId: string;
  holder: string | null;
  releaseRef: string | null;
  timeoutRef: string | null;
  timeoutKey: string | null;
  queue: LockRequest[];
};

function emitState(state: MutexState): void {
  W.outputJSON(state, topics.state);
}

function emitGranted(lockId: string, owner: string): void {
  W.outputJSON({ lockId, owner }, topics.lockAcquired, owner);
}

function emitQueued(lockId: string, owner: string, position: number): void {
  W.outputJSON({ lockId, owner, position }, topics.lockRequested, owner);
}

function emitInvalidRelease(
  lockId: string,
  owner: string,
  holder: string | null
): void {
  W.outputJSON(
    { lockId, owner, holder },
    topics.invalidRelease,
    owner
  );
}

function workflowResume(threadId: string, event: unknown): void {
  W.output(JSON.stringify(event), topics.workflowResume, threadId);
}

function resumeKey(ref: string): string {
  return `${W.threadId}|${JSON.stringify({ ref })}`;
}

function requestToLockRequest(signal: LockAcquireSignal): LockRequest {
  return {
    owner: signal.owner,
    replyThread: signal.replyThread,
    replyRef: signal.replyRef,
    releaseRef: signal.releaseRef,
    timeoutMS: signal.timeoutMS
  };
}

function grantLock(state: MutexState, request: LockRequest): void {
  const releaseRef =
    request.releaseRef ?? `release:${state.lockId}:${request.owner}`;
  state.holder = request.owner;
  state.releaseRef = releaseRef;
  if (request.timeoutMS !== undefined) {
    state.timeoutRef = `timeout:${releaseRef}`;
    state.timeoutKey = resumeKey(state.timeoutRef);
    W.output(`${request.timeoutMS}`, topics.scheduler, state.timeoutKey);
  } else {
    state.timeoutRef = null;
    state.timeoutKey = null;
  }
  emitGranted(state.lockId, request.owner);

  if (request.replyThread && request.replyRef) {
    workflowResume(request.replyThread, {
      ref: request.replyRef,
      value: {
        lockId: state.lockId,
        owner: request.owner,
        releaseRef
      } satisfies LockGranted
    });
  }
}

function grantNextQueuedLock(state: MutexState): void {
  const next = state.queue.shift();
  if (next) {
    grantLock(state, next);
  }
}

function cancelLockTimeout(state: MutexState): void {
  if (state.timeoutKey) {
    W.output("0", topics.scheduler, state.timeoutKey);
  }
  state.timeoutRef = null;
  state.timeoutKey = null;
}

function releaseLock(
  state: MutexState,
  owner: string,
  timedOut = false
): void {
  if (owner !== state.holder) {
    emitInvalidRelease(state.lockId, owner, state.holder);
    return;
  }
  if (!timedOut) {
    cancelLockTimeout(state);
  } else {
    state.timeoutRef = null;
    state.timeoutKey = null;
  }
  state.holder = null;
  state.releaseRef = null;
  grantNextQueuedLock(state);
}

async function nextMutexEvent(state: MutexState): Promise<MutexEvent> {
  const main = W.refId<MutexSignal>("main");
  if (!state.releaseRef) {
    return await main;
  }

  const release = W.refId<ReleaseSignal>(state.releaseRef);
  const branches: Promise<
    | { kind: "main"; signal: MutexSignal }
    | { kind: "release"; signal: ReleaseSignal }
    | { kind: "timeout"; signal: unknown }
  >[] = [
    (async () => ({ kind: "main" as const, signal: await main }))(),
    (async () => ({ kind: "release" as const, signal: await release }))()
  ];
  if (state.timeoutRef) {
    const timeout = W.refId<unknown>(state.timeoutRef);
    branches.push(
      (async () => ({ kind: "timeout" as const, signal: await timeout }))()
    );
  }

  const event = await Promise.race(branches);
  if (event.kind === "main") {
    return event.signal;
  }
  if (event.kind === "timeout") {
    return { type: "timeout" };
  }
  return {
    type: "release",
    owner: event.signal.owner ?? state.holder ?? ""
  };
}

export async function lockWorkflow(input: MutexInput): Promise<MutexState> {
  const state: MutexState = {
    lockId: input.lockId,
    holder: null,
    releaseRef: null,
    timeoutRef: null,
    timeoutKey: null,
    queue: []
  };

  for (;;) {
    const signal = await nextMutexEvent(state);
    switch (signal.type) {
      case "acquire":
        if (state.holder === null) {
          grantLock(state, requestToLockRequest(signal));
        } else {
          state.queue.push(requestToLockRequest(signal));
          emitQueued(state.lockId, signal.owner, state.queue.length);
        }
        break;
      case "release":
        releaseLock(state, signal.owner);
        break;
      case "timeout":
        if (state.holder) {
          releaseLock(state, state.holder, true);
        }
        break;
      case "query":
        emitState(state);
        break;
      case "shutdown":
        return state;
    }
  }
}

export async function oneAtATimeWorkflow(
  input: OneAtATimeInput
): Promise<{ resourceId: string; owner: string }> {
  const owner = input.owner ?? W.threadId;
  const lockGranted = W.ref<LockGranted>("lock-acquired");
  const releaseRef = `${owner}:release:${lockGranted.id}`;

  W.ensureThread(
    {
      workflow: workflows.lockWorkflow,
      lockId: input.resourceId
    } satisfies MutexInput,
    input.resourceId
  );
  workflowResume(input.resourceId, {
    ref: "main",
    value: {
      type: "acquire",
      owner,
      replyThread: W.threadId,
      replyRef: lockGranted.id,
      releaseRef,
      timeoutMS: input.lockTimeoutMS ?? 1000
    } satisfies LockAcquireSignal
  });

  const granted = await lockGranted;
  W.outputJSON(
    {
      resourceId: input.resourceId,
      owner,
      releaseRef: granted.releaseRef
    },
    topics.notifyLocked,
    owner
  );

  const criticalSection = W.ref<CriticalSectionAck>("critical-section");
  W.outputJSON(
    {
      resourceId: input.resourceId,
      owner,
      sleepForMS: input.sleepForMS ?? 500,
      ref: criticalSection.id
    },
    topics.criticalSection,
    owner
  );
  await criticalSection;

  workflowResume(input.resourceId, {
    ref: granted.releaseRef,
    value: {
      owner
    } satisfies ReleaseSignal
  });
  W.outputJSON(
    { resourceId: input.resourceId, owner },
    topics.notifyUnlocked,
    owner
  );

  return {
    resourceId: input.resourceId,
    owner
  };
}

export default function entry(
  input: MutexInput | OneAtATimeInput
): Promise<MutexState | { resourceId: string; owner: string }> {
  if (input.workflow === workflows.oneAtATimeWorkflow) {
    return oneAtATimeWorkflow(input);
  }
  return lockWorkflow(input as MutexInput);
}

export const manifest = {
  outputTopics: [
    topics.lockAcquired,
    topics.lockRequested,
    topics.invalidRelease,
    topics.state,
    topics.notifyLocked,
    topics.criticalSection,
    topics.notifyUnlocked,
    topics.scheduler
  ]
};
