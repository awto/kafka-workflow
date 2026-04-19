const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

type Mode =
  | "cancelTimer"
  | "cancelTimerAltImpl"
  | "cleanupAfterCancel"
  | "externalCancellationCleanup"
  | "multipleActivitiesSingleTimeout"
  | "nonCancellable"
  | "resumeAfterCancellation"
  | "cancellationScopesWithCallbacks"
  | "sharedScopes"
  | "shieldAwaitedActivity";

type Input = {
  mode: Mode;
  urls?: string[];
  timeoutMS?: number;
  data?: unknown;
};

type ActivityResult = {
  value: unknown;
};

type CancelSignal = {
  reason?: string;
};

export const topics = {
  timerCancelled: "temporal-cancellation-scopes-timer-cancelled",
  awaitTimeout: "temporal-cancellation-scopes-await-timeout",
  awaitCancel: "temporal-cancellation-scopes-await-cancel",
  httpGet: "temporal-cancellation-scopes-http-get",
  httpGetCancel: "temporal-cancellation-scopes-http-get-cancel",
  httpPost: "temporal-cancellation-scopes-http-post",
  httpPostCancel: "temporal-cancellation-scopes-http-post-cancel",
  cleanup: "temporal-cancellation-scopes-cleanup",
  callbackScheduled: "temporal-cancellation-scopes-callback-scheduled",
  callbackResolved: "temporal-cancellation-scopes-callback-resolved",
  cancelObserved: "temporal-cancellation-scopes-cancel-observed",
  sharedWinner: "temporal-cancellation-scopes-shared-winner",
  scheduler: "workflow-scheduler"
} as const;

async function sleep(ms: number, name: string): Promise<void> {
  const timer = W.ref(name);
  W.output(`${ms}`, topics.scheduler, timer.key);
  try {
    await timer;
  } catch (error) {
    if (error instanceof W.CancelToken) {
      W.output("0", topics.scheduler, timer.key);
    }
    throw error;
  }
}

async function httpGetJSON(url: string): Promise<unknown> {
  const reply = W.ref<ActivityResult>(`get:${url}`);
  W.outputJSON({ url, ref: reply.id }, topics.httpGet);
  try {
    return (await reply).value;
  } catch (error) {
    if (error instanceof W.CancelToken) {
      W.outputJSON({ url, ref: reply.id }, topics.httpGetCancel);
    }
    throw error;
  }
}

async function httpPostJSON(url: string): Promise<void> {
  const reply = W.ref<ActivityResult>(`post:${url}`);
  W.outputJSON({ url, ref: reply.id }, topics.httpPost);
  try {
    await reply;
  } catch (error) {
    if (error instanceof W.CancelToken) {
      W.outputJSON({ url, ref: reply.id }, topics.httpPostCancel);
      W.outputJSON({ url }, topics.cleanup);
    }
    throw error;
  }
}

async function waitForCancel(): Promise<CancelSignal> {
  const cancel = W.refId<CancelSignal>("cancel");
  W.outputJSON({ ref: cancel.id }, topics.awaitCancel);
  return await cancel;
}

async function cancelTimer(): Promise<unknown> {
  try {
    await Promise.race([
      sleep(60_000, "timer"),
      (async () => ({ cancelled: true }))()
    ]);
  } catch (error) {
    if (error instanceof W.CancelToken) {
      W.outputJSON({ timer: "timer" }, topics.timerCancelled);
      return { status: "timer-cancelled" };
    }
    throw error;
  }
  W.outputJSON({ timer: "timer" }, topics.timerCancelled);
  return { status: "timer-cancelled" };
}

async function cancelTimerAltImpl(): Promise<unknown> {
  const scope = new W.CancellationScope();
  const promise = W.withCancellationScope(scope, () =>
    sleep(60_000, "timer-alt")
  );
  try {
    await W.cancelScope(scope);
    await promise;
  } catch (error) {
    if (error instanceof W.CancelToken) {
      W.outputJSON({ timer: "timer-alt" }, topics.timerCancelled);
      return { status: "timer-cancelled-alt" };
    }
    throw error;
  }
  W.outputJSON({ timer: "timer-alt" }, topics.timerCancelled);
  return { status: "timer-cancelled-alt" };
}

async function cleanupAfterCancel(url: string): Promise<unknown> {
  try {
    await Promise.race([
      httpPostJSON(url),
      (async () => ({ cancelled: true }))()
    ]);
  } catch (error) {
    if (error instanceof W.CancelToken) {
      return { status: "cleaned-up" };
    }
    throw error;
  }
  return { status: "cleaned-up" };
}

async function externalCancellationCleanup(
  url: string,
  data: unknown
): Promise<unknown> {
  let cancelSignal: CancelSignal | undefined;
  let result:
    | { type: "completed" }
    | { type: "cancelled"; signal: CancelSignal };
  try {
    result = await Promise.race([
      httpPostJSON(url).then(() => ({ type: "completed" as const })),
      waitForCancel().then((signal) => {
        cancelSignal = signal;
        return {
          type: "cancelled" as const,
          signal
        };
      })
    ]);
  } catch (error) {
    if (error instanceof W.CancelToken) {
      return {
        status: "cleaned-up-after-external-cancel",
        reason: cancelSignal?.reason ?? "cancel requested",
        data
      };
    }
    throw error;
  }
  if (result.type === "cancelled") {
    return {
      status: "cleaned-up-after-external-cancel",
      reason: result.signal.reason ?? "cancel requested",
      data
    };
  }
  return { status: "completed" };
}

async function timeoutResultBranch(timeoutMS: number) {
  const timeout = W.refId<{ timedOut: true }>("timeout");
  W.outputJSON({ timeoutMS, ref: timeout.id }, topics.awaitTimeout);
  await timeout;
  return {
    type: "timeout" as const
  };
}

async function multipleActivitiesSingleTimeout(
  urls: string[],
  timeoutMS: number
): Promise<unknown> {
  const result = await Promise.race([
    Promise.all(urls.map((url) => httpGetJSON(url))),
    timeoutResultBranch(timeoutMS)
  ]);
  if (!Array.isArray(result) && result.type === "timeout") {
    return { status: "timed-out" };
  }
  return {
    status: "completed",
    values: result
  };
}

async function nonCancellable(url: string): Promise<unknown> {
  const value = await W.withCancellationScope(undefined, () =>
    httpGetJSON(url)
  );
  return {
    status: "completed",
    value
  };
}

async function resumeAfterCancellation(url: string): Promise<unknown> {
  const reply = W.ref<ActivityResult>(`resume-after-cancel:${url}`);
  W.outputJSON({ url, ref: reply.id }, topics.httpGet);
  const cancel = await waitForCancel();
  W.outputJSON(
    { url, reason: cancel.reason ?? "cancel requested" },
    topics.cancelObserved
  );
  return {
    status: "resumed-after-cancel",
    value: (await reply).value
  };
}

async function cancellationScopesWithCallbacks(): Promise<unknown> {
  const callback = W.refId<{ ok: true }>("callback");
  W.outputJSON({ ref: callback.id }, topics.callbackScheduled);
  await callback;
  W.outputJSON({ ref: callback.id }, topics.callbackResolved);
  return { status: "callback-resolved" };
}

async function sharedScopes(urls: string[]): Promise<unknown> {
  const refs = urls.map((url, index) => `shared-get:${index}`);
  for (let index = 0; index < urls.length; index += 1) {
    W.outputJSON({ url: urls[index], ref: refs[index] }, topics.httpGet);
  }
  const first = await W.refId<{ index: number; value: unknown }>("shared:first");
  const winner = {
    url: urls[first.index],
    ref: refs[first.index],
    value: first.value
  };
  W.outputJSON(winner, topics.sharedWinner);
  return {
    status: "first-completed",
    winner
  };
}

async function shieldAwaitedActivity(url: string): Promise<unknown> {
  const replyId = `shielded-get:${url}`;
  W.outputJSON({ url, ref: replyId }, topics.httpGet);
  return {
    status: "cancel-observed-activity-kept-running",
    shieldedRef: replyId
  };
}

export default function entry(input: Input): Promise<unknown> {
  switch (input.mode) {
    case "cancelTimer":
      return cancelTimer();
    case "cancelTimerAltImpl":
      return cancelTimerAltImpl();
    case "cleanupAfterCancel":
      return cleanupAfterCancel(input.urls?.[0] ?? "https://example.com/post");
    case "externalCancellationCleanup":
      return externalCancellationCleanup(
        input.urls?.[0] ?? "https://example.com/post",
        input.data ?? { ok: true }
      );
    case "multipleActivitiesSingleTimeout":
      return multipleActivitiesSingleTimeout(
        input.urls ?? ["https://example.com/1", "https://example.com/2"],
        input.timeoutMS ?? 1000
      );
    case "nonCancellable":
      return nonCancellable(input.urls?.[0] ?? "https://example.com/get");
    case "resumeAfterCancellation":
      return resumeAfterCancellation(
        input.urls?.[0] ?? "https://example.com/get"
      );
    case "cancellationScopesWithCallbacks":
      return cancellationScopesWithCallbacks();
    case "sharedScopes":
      return sharedScopes(
        input.urls ?? ["https://example.com/1", "https://example.com/2"]
      );
    case "shieldAwaitedActivity":
      return shieldAwaitedActivity(input.urls?.[0] ?? "https://example.com/get");
  }
}

export const manifest = {
  outputTopics: [
    topics.timerCancelled,
    topics.awaitTimeout,
    topics.awaitCancel,
    topics.httpGet,
    topics.httpGetCancel,
    topics.httpPost,
    topics.httpPostCancel,
    topics.cleanup,
    topics.callbackScheduled,
    topics.callbackResolved,
    topics.cancelObserved,
    topics.sharedWinner,
    topics.scheduler
  ]
};
