const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

export interface HelloWorldInput {
  name: string;
}

export interface GreetingReply {
  greeting: string;
}

async function greet(name: string): Promise<GreetingReply> {
  const reply = W.ref<GreetingReply>("greet");
  W.outputJSON({ name, ref: reply.id }, "temporal-hello-world-greet");
  return await reply;
}

export default async function entry(
  input: HelloWorldInput
): Promise<GreetingReply> {
  return await greet(input.name);
}

export const manifest = {
  outputTopics: ["temporal-hello-world-greet"]
};
