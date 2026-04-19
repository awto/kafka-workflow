const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

type LanguageCode = "en" | "fr" | "de" | "es" | "tr";

export const workflows = {
  echoCaller: "echoCaller",
  echoService: "echoService",
  helloCaller: "helloCaller",
  helloWorkflow: "helloWorkflow"
} as const;

type EchoCallerInput = {
  workflow?: typeof workflows.echoCaller;
  message: string;
};

type HelloCallerInput = {
  workflow: typeof workflows.helloCaller;
  name: string;
  language: LanguageCode;
};

type EchoServiceInput = {
  workflow: typeof workflows.echoService;
  operationId: string;
  callerThread?: string;
  callerRef?: string;
  message: string;
};

type HelloServiceInput = {
  workflow: typeof workflows.helloWorkflow;
  operationId?: string;
  callerThread?: string;
  callerRef?: string;
  name: string;
  language: LanguageCode;
};

type Input =
  | EchoCallerInput
  | HelloCallerInput
  | EchoServiceInput
  | HelloServiceInput;

type OperationResult = {
  message: string;
};

export const topics = {
  startOperation: "temporal-nexus-hello-start-operation",
  serviceCompleted: "temporal-nexus-hello-service-completed",
  workflowResume: "workflow-resume"
} as const;

function operationId(operation: string, payload: string): string {
  return `${operation}:${payload}`;
}

function replyOperation(
  input: { callerThread?: string; callerRef?: string; operationId?: string },
  result: OperationResult
): void {
  if (input.operationId) {
    W.outputJSON(
      {
        operationId: input.operationId,
        result
      },
      topics.serviceCompleted,
      input.operationId
    );
  }
  if (input.callerThread && input.callerRef) {
    W.output(
      JSON.stringify({
        ref: input.callerRef,
        value: result
      }),
      topics.workflowResume,
      input.callerThread
    );
  }
}

function helloMessage(name: string, language: LanguageCode): OperationResult {
  switch (language) {
    case "en":
      return { message: `Hello, ${name}!` };
    case "fr":
      return { message: `Bonjour, ${name}!` };
    case "de":
      return { message: `Hallo, ${name}!` };
    case "es":
      return { message: `Hola, ${name}!` };
    case "tr":
      return { message: `Merhaba, ${name}!` };
    default:
      throw new Error(`Unsupported language: ${language}`);
  }
}

export async function echoCaller(input: EchoCallerInput): Promise<string> {
  const reply = W.ref<OperationResult>("echo");
  const id = operationId("echo", input.message);
  W.outputJSON(
    {
      operation: "echo",
      operationId: id,
      message: input.message,
      ref: reply.id
    },
    topics.startOperation
  );
  W.ensureThread(
    {
      workflow: workflows.echoService,
      operationId: id,
      callerThread: W.threadId,
      callerRef: reply.id,
      message: input.message
    } satisfies EchoServiceInput,
    `${W.threadId}:nexus:${id}`
  );
  return (await reply).message;
}

export async function helloCaller(input: HelloCallerInput): Promise<string> {
  const reply = W.ref<OperationResult>("hello");
  const id = operationId("hello", `${input.name}:${input.language}`);
  W.outputJSON(
    {
      operation: "hello",
      operationId: id,
      name: input.name,
      language: input.language,
      ref: reply.id
    },
    topics.startOperation
  );
  W.ensureThread(
    {
      workflow: workflows.helloWorkflow,
      operationId: id,
      callerThread: W.threadId,
      callerRef: reply.id,
      name: input.name,
      language: input.language
    } satisfies HelloServiceInput,
    `${W.threadId}:nexus:${id}`
  );
  return (await reply).message;
}

export function echoService(input: EchoServiceInput): OperationResult {
  const result = { message: input.message };
  replyOperation(input, result);
  return result;
}

export function helloWorkflow(input: HelloServiceInput): OperationResult {
  const result = helloMessage(input.name, input.language);
  replyOperation(input, result);
  return result;
}

export default function entry(input: Input): Promise<string> | OperationResult {
  switch (input.workflow) {
    case workflows.helloCaller:
      return helloCaller(input);
    case workflows.echoService:
      return echoService(input);
    case workflows.helloWorkflow:
      return helloWorkflow(input);
    case workflows.echoCaller:
    case undefined:
      return echoCaller(input as EchoCallerInput);
  }
}

export const manifest = {
  outputTopics: [
    topics.startOperation,
    topics.serviceCompleted,
    topics.workflowResume
  ]
};
