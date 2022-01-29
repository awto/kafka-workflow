import * as W from "../../main";

async function post(name: string, ref = "testRef") {
  W.output(name, "schedule", `${W.threadId}|${ref}`);
  return await W.suspend(ref);
}

export async function suspendResumeTest(arg1: string, arg2: string) {
  W.output(
    await post(`msg1:${JSON.stringify(arg1)}/${JSON.stringify(arg2)}`),
    "output"
  );
  W.output(
    await post(`msg1:${JSON.stringify(arg1)}/${JSON.stringify(arg2)}`),
    "output"
  );
  return "suspendResumeTestRet";
}
