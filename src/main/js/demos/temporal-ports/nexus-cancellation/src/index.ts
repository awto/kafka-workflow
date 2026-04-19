const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

type LanguageCode = "en" | "fr" | "de" | "es" | "tr";

type CallerInput = {
  kind?: "caller";
  name: string;
  language: LanguageCode;
};

type ServiceInput = {
  kind: "service";
  name: string;
  language: LanguageCode;
};

type OperationResult = {
  message: string;
};

type CancelSignal = {
  reason?: string;
};

export const topics = {
  startOperation: "temporal-nexus-cancel-start-operation",
  awaitCancel: "temporal-nexus-cancel-await-cancel",
  cancelOperation: "temporal-nexus-cancel-cancel-operation"
} as const;

function hello({ name, language }: ServiceInput): OperationResult {
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

async function waitForOperation(input: CallerInput): Promise<OperationResult> {
  const operation = W.ref<OperationResult>("operation");
  const operationId = `${input.name}:${input.language}:hello`;
  W.outputJSON(
    {
      operationId,
      ref: operation.id,
      name: input.name,
      language: input.language
    },
    topics.startOperation
  );
  try {
    return await operation;
  } catch (error) {
    if (error instanceof W.CancelToken) {
      W.outputJSON(
        {
          operationId,
          ref: operation.id
        },
        topics.cancelOperation
      );
    }
    throw error;
  }
}

async function waitForCancel(): Promise<CancelSignal> {
  const cancel = W.refId<CancelSignal>("cancel");
  W.outputJSON({ ref: cancel.id }, topics.awaitCancel);
  return await cancel;
}

async function operationBranch(input: CallerInput) {
  const operation = await waitForOperation(input);
  return {
    type: "completed" as const,
    operation
  };
}

async function cancelBranch() {
  const signal = await waitForCancel();
  return {
    type: "cancelled" as const,
    signal
  };
}

async function caller(input: CallerInput): Promise<unknown> {
  const result = await Promise.race([operationBranch(input), cancelBranch()]);
  if (result.type === "cancelled") {
    return {
      status: "cancelled",
      reason: result.signal.reason ?? "cancel requested"
    };
  }
  return result.operation.message;
}

export default function entry(input: CallerInput | ServiceInput): unknown {
  if (input.kind === "service") {
    return hello(input);
  }
  return caller(input);
}

export const manifest = {
  outputTopics: [
    topics.startOperation,
    topics.awaitCancel,
    topics.cancelOperation
  ]
};
