import * as S from "@effectful/serialization";

class JavaArrayListClass {
  constructor(public arr: any[] = []) {}
  add(el: any) {
    this.arr.push(el);
    return this;
  }
}

S.regConstructor(JavaArrayListClass);

class JavaExceptionClass {
  constructor(public msg: string) {}
}

S.regConstructor(JavaExceptionClass);

class JavaListClass {
  static of(...args: any[]) {
    return args;
  }
}

S.regConstructor(JavaListClass);

(<any>global).Java = {
  type(name: string) {
    switch (name) {
      case "java.util.ArrayList":
        return JavaArrayListClass;
      case "java.util.List":
        return JavaListClass;
      case "java.lang.Exception":
        return JavaExceptionClass;
      default:
        throw new TypeError(`unknown type ${name}`);
    }
  }
};

export async function trace(fun: (arg1: string, arg2: string) => void) {
  (<any>global).efwf$module = fun;
  const resTrace: any[] = [];
  const jobs: string[] = [`{"name":"arg2"}`];
  let state = `{"name":"arg1"}`;
  while (jobs.length) {
    const event = <any>jobs.pop();
    const promise: Promise<JavaArrayListClass> = new Promise(
      (complete, completeExceptionally) =>
        (<any>global).efwf$step(event, state, "testTid", "testSid", {
          complete,
          completeExceptionally
        })
    );
    const stepResults = (await promise).arr;
    resTrace.push(stepResults);
    expect(stepResults.length).toBeGreaterThan(0);
    const [stateTup, ...others] = stepResults;
    expect(stateTup.length).toBe(1);
    const nextState = stateTup[0];
    expect(typeof nextState).toBe("string");
    if (!nextState.length) continue;
    for (const [dest, msg, topic] of others) {
      const [thread, ref] = dest.split("|");
      expect(thread).toBe("testTid");
      if (topic === "schedule") jobs.push(JSON.stringify({ ref, value: msg }));
    }
    state = nextState;
  }
  expect(resTrace).toMatchSnapshot();
  return resTrace;
}
