# Workflow-as-code on Kafka

[![CI](https://github.com/awto/kafka-workflow/actions/workflows/main.yml/badge.svg)](https://github.com/awto/kafka-workflow/actions/workflows/main.yml)

The project is a minimalistic but feature-complete workflow-as-code approach implementation.

Define workflows as usual JavaScript/TypeScript async functions except `await` expressions there may await for events much longer (hours, days, months, etc.). 

Workflow scripts run on [Kafka Streams](https://kafka.apache.org/documentation/streams/) clusters. The scripts store their state in their stream's local state and listen to events on a dedicated continuation topic (`"workflow-resume"`).

Kafka takes all the burden of making such workflows highly scalable, elastic, fault-tolerant, distributed, and much more. In addition, workflows are simple, easy to read, easy to write, easy to maintain, and easy to integrate with other components of Kafka-based infrastructure.

Typical use cases include:

  * Business Process Automation
  * Microservices Orchestration
  * Distributed Transactions
  * Infrastructure Provisioning
  * Monitoring and Polling
  * Data Pipelines

The workflow code in JavaScript looks like this:

```javascript
export async function main() {
  const compensations = [];
  try {
    const car = await reserveCar();
    compensations.push(cancelCar.bind(undefined, car));
    const hotel = await reserveHotel();
    compensations.push(cancelHotel.bind(undefined, hotel));
    const flight = await reserveFlight();
    compensations.push(cancelFlight.bind(undefined, flight));
  } catch (e) {
    await Promise.all(compensations.map(i => i()));
  }
}
```

There are workflow examples in [src/main/js/packages](src/main/js/packages)  - [workflow-ecommerce](src/main/js/packages/) 

Kafka Workflow tool compiles JavaScript workflow definitions using [effectful.js](https://github.com/awto/effectfuljs) transpiler into another a lower level JavaScript. It is an own implementation of async functions. Moreover, the whole script state can serialize and deserialize the entire state using [@effectfuljs/serialization](https://github.com/awto/effectfuljs/tree/main/packages/serialization) library.

Kafka Streams processor uses GraalVM JS engine to run the low-level JavaScript file. The engine has a high node.js compatibility level, so most npm packages are available in the scripts.

## Usage

This project is in a proof of concept stage at the moment. However, since it is tiny, it isn't that hard to reproduce the same but considering the specific needs of your projects, use this one as a template or entirely from scratch.

Building it currently requires JDK 17. It is mainly for code readability and can be easily changed to any earlier JDK version (supported by Kafka Streams).

To run a workflow, execute a class `org.js.effectful.kafka.workflow.Engine`.  It expects "workflow-resume" and other topics required by workflow to be already available. The first argument is a path to a built `.js` file. The optional second argument is a property file passed to Kafka Streams. 

Examples also use Scheduler stream for running delayed jobs. It is just a simple demo class, and it doesn't fit for production usage. In production, you'd better use something based on a third-party scheduler, such as Quartz, some cloud service, cron, and maybe your message broker already has some scheduling. To run this demo scheduler execute `org.js.effectful.kafka.workflow.Scheduler` class.

## How to write workflow scripts

Workflow script is a TypeScript/JavaScript file exporting async "main" function. For example [workflow-ecommerce/src/index.ts](src/main/js/packages/workflow-ecommerce/src/index.ts) and [workflow-trip-booking-saga/src/index.ts](src/main/js/packages/workflow-trip-booking-saga/src/index.ts).

Create a plain node package and add "@effectful/Kafka-workflow" dependency (along with [a few other 3rd party dependencies](https://github.com/awto/kafka-workflow/blob/main/src/main/js/packages/workflow-ecommerce/package.json). Transpile the script into a single independent JavaScript file using webpack. There is a TypeScript project helper in "@effectful/kafka-workflow/webpack-config-ts". It takes two arguments - an index file and an output directory. There is an example in [workflow-ecommerce/webpack.config.js](https://github.com/awto/kafka-workflow/blob/main/src/main/js/packages/workflow-ecommerce/webpack.config.js)). 

Import the runtime library:

```javascript
import * as W from "@effectful/kafka-workflow" 
```

There is a dedicated `"workflow-resume"` topic to pass events to the workflow program. 

To start a new workflow, send a record into `workflow-resume` topic with a value is a string beginning with `"new:"` prefix, and the rest is a JSON passed to `main` function as its argument. The key is a unique thread identifier (string). The same key identifies the thread in the next records (but its value shouldn't start with `"new:"` there). 

To output a record into a topic, use `W.output` function. Its first parameter is a string to put in the record's value, the second parameter is a topic name, and the third is an optional key, which is a current thread identifier by default. To use a topic in `W.output` add its name into `W.config.outputTopics` set.

There is a shortcut `W.outputJSON`, it wraps its first argument with `JSON.stringify`.

The most important function here is `W.suspend`. It returns a `W.Suspend` object which we can pass as an argument of `await` expression to suspend the whole program execution and save its state into local storage. `W.Suspend` is Thenable, but better not to use it with `then` in the current version - this can generate a not serializable state.

The suspended program will be resumed when `"workflow-resume"` gets a record with the current thread as its key and a JSON as a value with "ref" field equal to `W.Suspend` object's id on which the code is currently suspended (in `await` expression). 

If the JSON has "error" field, it will be a raised exception in `await` exception. Otherwise, the JSON's "value" field is a result of the `await` expression.

The program can suspend in many points simultaneously. And, like usual JavaScript, it can use `Promise.all`/`Promise.race`. 

So if we have a code like this:

```javascript
const car = await reserveCar();
const hotel = await reserveHotel();
```

and we want to start the reservation of a hotel immediately without waiting for a car we can change the code to:

```javascript
const [car, hotel] = await Promise.all([reserveCar(), reserveHotel()]);
```

Note `Promise.all`/`Promise.race` functions don't return a promise here. Instead, they are monkey-patched versions that support suspensions. 

## Cancelation

Calling of `W.cancel(asyncValue)` cancels the `asyncValue` execution. The current bottom `await` expression, which blocks the async value from being settled, will throw an exception with class `W.CancelToken`. It obviously won't cancel any running external job, but you can write a `try-catch` to properly cancel it (if possible).

For example:

```javascript
async function timeout(ms: number) {
  const resume = W.suspend();
  W.output(`${ms}`, "workflow-scheduler", `${W.threadId}|{"ref":"${resume.id}"}`);
  try {
    await resume;
  } catch (e: any) {
    if (e instanceof W.CancelToken)
      W.output(null, "workflow-scheduler", `${W.threadId}|{"ref":"${resume.id}"}`);
    throw e;
  }
  return { type: "timeout" };
}
```

Here, we write null to a topic with the same key to cancel a previously scheduled job.

`Promise.all`/`Promise.race` also adapted to benefit from cancelation. Namely, if any argument of `Promise.all` is rejected, the implementation cancels the other not yet settled values. For `Promise.race` after anything is settled, the others are canceled.

Cancelation is essential to avoid some concurrency bugs. 

Say, in this example:

```javascript
try {
   await Promise.race([
     (async () => {
        await timeout(100);
        throw new Error("timeout");
       })(),
     (async () => {
        const hotel = await reserveHotel();
        compensations.push(async () => { await cancelHotel(hotel); });
      })()]);
catch(e) {
   await Promise.all(compensations.map(i => i()));
}
```

Suppose the timeout arrives before `reserveHotel` returns the value. In that case, it won't be canceled because the `catch` there will be executed before `compensations.push` is run, so it will be an empty array.

There are `W.all`/`W.any` functions which are versions of `Promise.all`/`Promise.any` but without cancelation (they still propagate cancelation signals to arguments, though).

## Debugging

Currently, there is no special debugger for workflow scripts, but probably there'll be some soon. However, the workflow script is a usual async TS/JS program. So before transpiling it into a workflow definition, we can debug it as usual TS/JS program with any debugger of choice (I would recommend my productivity-boosting [effectful debugger](https://marketplace.visualstudio.com/items?itemName=effectful.debugger) for this - it has time traveling, data breakpoints, and more).

If `EFFECTFUL_KAFKA_WORKFLOW_MOCK` environment variable isn't empty, the import will load the library with mocks for API functions for testing and debugging.

## Running multiple workflows

Only one index file is possible in the current version, which means we can run only one workflow. However, we can integrate a workflow dispatcher in this master index file. It will use some argument of "new:" messages to run any workflow. There are many better not implemented (but simple to implement) options.

---

## Possible extensions

The project's current goal is to provide a simple example for workflow definitions. However, many possible (easy to implement) extensions make workflows even simpler and more reliable.

### TODO: Better serialization

The whole script state is stored into a schema-less JSON using [@effectful/serialization](https://github.com/awto/effectfuljs/tree/main/packages/serialization) library. It is worth adding support for typed binary serialization, especially for data processing workflows.

In the current version, many values are still not serializable. Functions must be registered in a serialization library if we want function references to be serializable. This is, however, an easy-to-solve limitation because it is a transpiler. Effectful debugger already has all the functions with captured variables serializable by default (including many runtime objects, not serializable here, such as Promise).

Not serializable values must be registered with `S.regOpaqueObject` (`S.regConstructor` for classes constructor) and `bind` method usage instead of closures for functions. Here `S` is an import of `@effectful/serialization`. You can also use any third-party serialization library instead. 

### TODO: Implicit parallelism

EffectfulJS has experimental support of implicit parallelism, but its implementation is highly experimental and doesn't yet support state serialization. Nevertheless, it can significantly clean up the resulting code. However, for efficient usage, it needs a debugger.

### TODO: Debugger

Effectful JS is used for debugger's implementation already, namely [Effectful Debugger](https://marketplace.visualstudio.com/items?itemName=effectful.debugger). Its primary but not yet finished goal is to add debugging features to effectful programs. However, it already works for plain JS/TS and has a few extra productivity-boosting features such as time-traveling, persistent state, data breakpoints.

For Kafka, we'll have time traveling for free. Since topics (if compaction is disabled) will keep the whole history.

### TODO: Conflicts resolutions

Async computations are notorious for introducing non-determinism in JavaScript and concurrency-related problems. Say, for example, we have code like this:

```javascript
const car = await availableCar();
if (account.balance >= car.cost) {
  await reserve(car);
  account.balance-=car.cost; 
}
```

Here we have a common concurrency bug. The balance there may become negative if something else reduced it when this thread rested in `await reserve`. It is not a problem specific to long-running workflows scripts, it would work the same way with usual JavaScript async functions. 

However, we can leverage Kafka again to fix this in workflow scripts and make them deterministic. We can use a technique similar to Software Transactional Memory, which is based on the same log concept. It is simple to record changes in script objects and local variables and detect conflicts. If there is any, we roll back the whole transaction and start it from scratch. We can also handle side effects here by simulating some exceptions and the output places, thus forcing them to be canceled.

We can use the feature to define even more tidy workflows.

```javascript
const car = await availableCar();
if (account.balance >= car.cost) {
  await reserve(car);
  account.balance -= car.cost; 
} else { 
  await W.retry; 
}
```

If the balance amount isn't enough, we retry the whole transaction, hoping it will have more money next. But it won't replay it immediately, only when there is a change to any variable read in this thread.

### TODO: Always running workflows

Instead of long running workflow scripts we can have always running scripts. In this case, when the workflow starts, it never ends so that we can write code like this:

```javascript
let paid = 0
for(const i of subscriptions) {
  for (cost j of i.payments) {
    paid += j
  }
}
```

The script runs like a usual JS. First we load subscriptions and payments from some DB. If it is plain JS we need to re-execute the whole script to keep the "paid" variable up to date. But we can also derive which part of the execution trace to recalculate. And in this case, this can be just a single iteration.

It is, however, a big task, with quite a few complex things to solve, e.g., how to update a script to a new version (we don't want to recalculate the whole program there too, only some affected parts). Moreover, the Kafka log doesn't fit here too. For example, we need a higher-level logarithmic time access tree instead of a constant time access sequence. However, we can probably implement this kind of data structure on the Kafka log.

### TODO: Other runners

This approach doesn't require Kafka and will work on any streams processor. It only needs a join capability of a stream with a state. The system will inherit all the reliability and scalability from the runner.  

Some RDBMS may be a runner too, since the concept of tables is dual to streams. 
