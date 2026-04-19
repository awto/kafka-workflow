const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

export enum Language {
  ARABIC = "ARABIC",
  CHINESE = "CHINESE",
  ENGLISH = "ENGLISH",
  FRENCH = "FRENCH",
  HINDI = "HINDI",
  PORTUGUESE = "PORTUGUESE",
  SPANISH = "SPANISH"
}

type Command =
  | { type: "getLanguages"; includeUnsupported: boolean; reply: string }
  | { type: "getLanguage"; reply: string }
  | { type: "setLanguage"; language: Language; reply: string }
  | { type: "setLanguageUsingActivity"; language: Language; reply: string }
  | { type: "approve"; name: string };

type GreetingServiceReply = {
  greeting?: string;
};

type ReplyValue = Language[] | Language;

export interface MessageReply {
  reply: string;
  value?: ReplyValue;
  error?: string;
}

const localGreetings: Partial<Record<Language, string>> = {
  [Language.CHINESE]: "你好，世界",
  [Language.ENGLISH]: "Hello, world"
};

function supportedLocalLanguages(): Language[] {
  return Object.keys(localGreetings) as Language[];
}

function allLanguages(): Language[] {
  return Object.values(Language);
}

function publishReply(reply: string, value: ReplyValue): void {
  W.outputJSON(
    {
      reply,
      value
    } satisfies MessageReply,
    "temporal-message-introduction-reply"
  );
}

function publishError(reply: string, error: string): void {
  W.outputJSON(
    {
      reply,
      error
    } satisfies MessageReply,
    "temporal-message-introduction-reply"
  );
}

async function lookupGreeting(language: Language): Promise<string | undefined> {
  const resume = W.ref<GreetingServiceReply>("greeting-service");
  W.outputJSON(
    {
      language,
      ref: resume.id
    },
    "temporal-message-introduction-greeting-service"
  );
  return (await resume).greeting;
}

export default async function greetingWorkflow(): Promise<string> {
  const greetings: Partial<Record<Language, string>> = { ...localGreetings };
  let approvedForRelease = false;
  let language = Language.ENGLISH;

  while (!approvedForRelease) {
    const command = await W.refId<Command>("main");
    switch (command.type) {
      case "getLanguages":
        publishReply(
          command.reply,
          command.includeUnsupported ? allLanguages() : supportedLocalLanguages()
        );
        break;
      case "getLanguage":
        publishReply(command.reply, language);
        break;
      case "setLanguage":
        if (!(command.language in greetings)) {
          publishError(command.reply, `${command.language} is not supported`);
          break;
        }
        publishReply(command.reply, language);
        language = command.language;
        break;
      case "setLanguageUsingActivity":
        if (!(command.language in greetings)) {
          const greeting = await lookupGreeting(command.language);
          if (!greeting) {
            publishError(
              command.reply,
              `${command.language} is not supported by the greeting service`
            );
            break;
          }
          greetings[command.language] = greeting;
        }
        publishReply(command.reply, language);
        language = command.language;
        break;
      case "approve":
        approvedForRelease = true;
        break;
    }
  }

  return greetings[language] as string;
}

export const manifest = {
  outputTopics: [
    "temporal-message-introduction-reply",
    "temporal-message-introduction-greeting-service"
  ]
};
