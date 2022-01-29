import * as R from "@effectful/es-persist/index";
import * as S from "@effectful/serialization";
import * as RS from "@effectful/es-persist-serialization";
export {
  all,
  any,
  allWithCancel,
  anyWithCancel,
  CancelToken,
  cancel
} from "@effectful/es-persist/index";

type Handler = (params: unknown, stateParams: unknown) => R.AsyncValue<unknown>;

declare const global: {
  efwf$step: typeof step;
  efwf$module?: Handler | { main?: Handler; default?: Handler };
  efwf$outputTopics?: (any: { add: (name: string) => void }) => void;
  Java: any;
};

/** script configuration passed to Kafka Streams */
export const config = {
  /** topics the script can output too */
  outputTopics: new Set(["workflow-result", "workflow-error"]),
  /** if `main` function exits its result will be written in this topic */
  resultTopic: "workflow-result",
  /** if `main` function throws an unhandled exception it will be output here */
  errorTopic: "workflow-error"
};

global.efwf$outputTopics = function (dest: { add: (name: string) => void }) {
  for (const i of config.outputTopics) dest.add(i);
};

/** current unique thread id */
export let threadId = "none";

/** current unique step id (unique within a thread) */
export let stepId = "none";

let suspended = new Map<string, Suspended>();
const toOutput: { key: string; value: string; topic: string }[] = [];

/* TODO: must port everything to TS */
const { async, asyncGenerator } = <any>R;
const { asyncFunction, asyncGeneratorFunction } = <any>RS;
const { iterator, iteratorM, forInIterator } = <any>R;

export { iterator, iteratorM };
export { forInIterator };
export { asyncFunction, asyncGeneratorFunction };

export { async, asyncGenerator };

/** 
 * If this object is used as an argument to `await` expression, 
 * the execution will be suspended until `workflow-resume` 
 * topic gets  a record with current `threadId` as key and 
 * a JSON with fields "ref" and "value" in its value. 
 * 
 * The "ref" field should have a value equal to "id" field of this object.
 * And the "value" field will be a result value of the `await` expression.
 */
export class Suspended extends R.Residual<any> {
  static count = 0;
  constructor(public id: string = `${stepId}:${++Suspended.count}`) {
    super();
    suspended.set(this.id, this);
  }
  resume(value: any) {
    suspended.delete(this.id);
    return super.resume(value);
  }
  reject(reason: any) {
    suspended.delete(this.id);
    return super.reject(reason);
  }
}

S.regConstructor(Suspended);

class FinalCont implements R.Continuation<unknown> {
  resume(value: unknown): void {
    suspended.clear();
    if (config.resultTopic) outputJSON(value, config.resultTopic);
  }
  reject(reason: any): void {
    suspended.clear();
    if (config.errorTopic) outputJSON(String(reason), config.errorTopic);
  }
}

S.regConstructor(FinalCont);

/** returns a `Suspend` object with its id field to be `id` or unique (if not defined) */
export function suspend(id?: string): Suspended {
  return new Suspended(id);
}

/**
 *  outputs a record with `key` and `value` into `topic`
 *  the topic must be in `config.outputTopics`
 */
export function output(value: string, topic: string, key = threadId) {
  toOutput.push({ key: key, value: value, topic });
}

/** same as `output` but also adds `JSON.stringify` for its first parameter */
export function outputJSON(value: unknown, topic: string, key = threadId) {
  return output(JSON.stringify(value), topic, key);
}

const Java = global.Java;

const ArrayListClass = Java.type("java.util.ArrayList");
const ListClass = Java.type("java.util.List");
const ExceptionClass = Java.type("java.lang.Exception");

function step(
  eventString: string,
  stateString: string,
  tid: string,
  sid: string,
  future: any
) {
  try {
    threadId = tid;
    stepId = sid;
    Suspended.count = 0;
    let stJSON: any = null;
    const eventJSON = JSON.parse(eventString);
    if (
      stateString &&
      stateString.length &&
      (stJSON = JSON.parse(stateString)).running
    ) {
      const state = S.read(JSON.parse(stateString));
      suspended = state.suspended;
      let cont: Suspended | undefined;
      if (eventJSON.ref) cont = suspended.get(<string>eventJSON.ref);
      if (!cont) {
        const result = new ArrayListClass();
        result.add(ListClass.of(stateString));
        future.complete(result);
        return;
      }
      if ("error" in eventJSON) cont.reject(eventJSON.error);
      else cont.resume(eventJSON.value);
    } else {
      let main = global.efwf$module;
      if (main && typeof main !== "function") main = main.default || main.main;
      if (!main) throw new TypeError("No workflow code");
      let res = main(eventJSON, stJSON);
      if (res[R.awaitSymbol]) res[R.awaitSymbol](new FinalCont());
    }
    R.eventLoopScheduler.onIdle({
      run() {
        try {
          const result = new ArrayListClass();
          if (suspended.size > 0) {
            const stateData = S.write(
              {
                suspended
              },
              {
                verbose: true,
                warnIgnored: true
              }
            );
            stateData.running = true;
            result.add(ListClass.of(JSON.stringify(stateData)));
          } else {
            result.add(ListClass.of(""));
          }
          for (const { key, value, topic } of toOutput)
            result.add(ListClass.of(key, value, topic));
          suspended.clear();
          toOutput.length = 0;
          future.complete(result);
        } catch (err) {
          future.completeExceptionally(new ExceptionClass(String(err)));
        }
      }
    });
  } catch (err) {
    future.completeExceptionally(new ExceptionClass(String(err)));
  }
}
global.efwf$step = step;
(<any>Promise).all = R.allWithCancel;
(<any>Promise).race = R.anyWithCancel;

Function.prototype.bind = function(this: any, self: any, ...args:any[]) {
  return S.bind(this, self, ...args)
}
