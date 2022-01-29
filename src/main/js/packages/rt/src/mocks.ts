/**
 * lightweight workflow's testing
 *
 * the workflow functions are usual JS async functions, and can be debugged and tested as any other JS function
 */
export const config = {
  outputTopics: new Set(["workflow-result", "workflow-error"]),
  resultTopic: "workflow-result",
  errorTopic: "workflow-error"
};

export let threadId = "testThread";
export let stepId = "testStep";

export const __topicHandlers = new Map<
  string,
  (msg: string, dest: string, topic: string) => unknown
>();

interface Output {
  msg: string;
  dest: string;
  topic: string;
}

export const __trace: any[] = [];
export const __suspended = new Map<string, Suspended>();
export let __lastTopicUpdate: {[topicName:string]:{k:string,v:string}} = {};

export async function __resume(id: string, value: unknown) {
  __trace.push({resume:id, value});
  await new Promise(i => setTimeout(i, 0))
  const suspended = __suspended.get(id);
  if (!suspended) throw new Error(`nothing is suspended with id ${id}`);
  __suspended.delete(id);
  for (const i of suspended.onfulfilled) i(value);
  await new Promise(i => setTimeout(i, 0))
}

export async function __reject(id: string, reason: unknown) {
  await new Promise(i => setTimeout(i, 10))
  __trace.push({reject:id, reason});
  const suspended = __suspended.get(id);
  if (!suspended) throw new Error(`nothing is suspended with id ${id}`);
  __suspended.delete(id);
  for (const i of suspended.onrejected) i(reason);
  // suspended.onrejected && suspended.onrejected(reason);
  await new Promise(i => setTimeout(i, 10))
}

/** resets state in tests setup */
export function __reset() {
  __lastTopicUpdate = {}
  __trace.length = 0;
  Suspended.count = 0;
  __topicHandlers.clear();
}

export class Suspended {
  static count = 0;
  onfulfilled: ((arg: unknown) => unknown)[] = [];
  onrejected: ((arg: unknown) => unknown)[] = [];
  constructor(public id: string = `${stepId}:${++Suspended.count}`) {
    __suspended.set(id, this);
  }
  then(onff: (arg: unknown) => unknown, onrj?: (arg: unknown) => unknown) {
    this.onfulfilled.push(onff);
    if (onrj) this.onrejected.push(onrj);
  }
}

export function suspend(id?: string): any {
  return new Suspended(id);
}

export function output(msg: string, topic: string, dest = threadId) {
  const item = { dest, msg, topic };
  __trace.push(item);
  const handler = __topicHandlers.get(topic);
  __lastTopicUpdate[topic] = {k:dest, v:msg};
  if (handler) handler(msg, dest, topic);
}

export function outputJSON(msg: unknown, topic: string, dest = threadId) {
  return output(JSON.stringify(msg), topic, dest);
}

export const any = (arr:any[]) => Promise.race(arr);
export const all = (arr:any[]) => Promise.all(arr);
export const anyWithCancel = any;
export const allWithCancel = all;
