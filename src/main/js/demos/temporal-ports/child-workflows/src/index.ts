const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

type ParentEnvelope = {
  workflow: "parent";
  payload: {
    names: string[];
  };
};

type ChildEnvelope = {
  workflow: "child";
  payload: {
    parentThreadId: string;
    parentRef: string;
    name: string;
  };
};

type ChildCompletion = {
  message?: string;
};

type ChildResult = {
  name: string;
  message: string;
};

type WorkflowEnvelope = ParentEnvelope | ChildEnvelope;

async function runParentWorkflow(payload: ParentEnvelope["payload"]): Promise<string> {
  const replies = payload.names.map((name, index) => {
    const reply = W.ref<ChildResult>(`child-${index}`);
    W.ensureThread(
      {
        workflow: "child",
        payload: {
          parentThreadId: W.threadId,
          parentRef: reply.id,
          name
        }
      } satisfies ChildEnvelope,
      `${W.threadId}:child:${name}`
    );
    return reply;
  });
  const children = await Promise.all(replies);
  return children.map((child) => child.message).join("\n");
}

async function runChildWorkflow(payload: ChildEnvelope["payload"]): Promise<ChildResult> {
  const completion = W.refId<ChildCompletion>("complete");
  W.outputJSON(
    {
      childThreadId: W.threadId,
      name: payload.name,
      completeRef: completion.id
    },
    "temporal-child-workflows-request"
  );
  const result = {
    name: payload.name,
    message:
      (await completion).message ?? `I am a child named ${payload.name}`
  };
  W.outputJSON(result, "temporal-child-workflows-child-completed");
  W.output(
    JSON.stringify({
      ref: payload.parentRef,
      value: result
    }),
    "workflow-resume",
    payload.parentThreadId
  );
  return result;
}

export default async function entry(envelope: WorkflowEnvelope): Promise<string | ChildResult> {
  switch (envelope.workflow) {
    case "parent":
      return await runParentWorkflow(envelope.payload);
    case "child":
      return await runChildWorkflow(envelope.payload);
  }
}

export const manifest = {
  outputTopics: [
    "temporal-child-workflows-request",
    "temporal-child-workflows-child-completed"
  ]
};
