const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

export interface MinimalInput {
  name: string;
}

export interface GreetingReply {
  greeting: string;
}

export default async function entry(
  input: MinimalInput
): Promise<GreetingReply> {
  const reply = W.ref<GreetingReply>("greeting");
  W.outputJSON({ name: input.name, ref: reply.id }, "minimal-greeting-request");
  return await reply;
}

export const manifest = {
  outputTopics: ["minimal-greeting-request"]
};
