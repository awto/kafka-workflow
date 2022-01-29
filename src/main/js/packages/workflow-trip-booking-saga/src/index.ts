import * as W from "@effectful/kafka-workflow";
import * as S from "@effectful/serialization"
const TIMEOUT_MS = 1000;

async function timeout():Promise<any> {
  const resume = W.suspend();
  W.output(
    `${TIMEOUT_MS}`,
    "workflow-scheduler",
    `${W.threadId}|{"ref":"${resume.id}"}`
  );
  try {
    await resume;
  } catch (e) {
    if (e instanceof W.CancelToken)
      W.output("0", "workflow-scheduler", `${W.threadId}|{"ref":"${resume.id}"}`);
    return;
  }
  throw "timeout";
}

async function reserve(kind: string): Promise<{ id: string }> {
  const resume = W.suspend();
  W.output(resume.id, `saga-reserve-${kind}`);
  const ret = { id: resume.id };
  try {
    await resume;
  } catch (e) {
    if (typeof e === "object" && e instanceof W.CancelToken)
      cancel(kind, ret);
    throw e;
  }
  return { id: resume.id };
}

async function cancel(kind: string, handler: { id: string }) {
  W.output(handler.id, `saga-cancel-${kind}`);
}

/** 
 * in this version we need explicetly register functions to make them serializable
 * but since it is a transpiler we can fix this in future
 */
 S.regOpaqueObject(reserve);
 S.regOpaqueObject(cancel);
 
 function reserveCancelPair(
  kind: string
): [() => Promise<{ id: string }>, (handler: { id: string }) => Promise<void>] {
  W.config.outputTopics.add(`saga-reserve-${kind}`);
  W.config.outputTopics.add(`saga-cancel-${kind}`);
  return [reserve.bind(undefined, kind), cancel.bind(undefined, kind)];
}

const [reserveCar, cancelCar] = reserveCancelPair("car");
const [reserveHotel, cancelHotel] = reserveCancelPair("hotel");
const [reserveFlight, cancelFlight] = reserveCancelPair("flight");
W.config.outputTopics.add("workflow-scheduler");

export async function main(opts = {throwAfterHotel:false}) {
  const compensations: (() => Promise<void>)[] = [];
  try {
    const [car, hotel, flight] = await Promise.race([Promise.all([
      (async () => {
        const car = await reserveCar();
        compensations.push(cancelCar.bind(undefined, car));
        return car;
      })(),
      (async () => {
        const hotel = await reserveHotel();
        compensations.push(cancelHotel.bind(undefined, hotel));
        if (opts.throwAfterHotel)
          throw "something is wrong";
        return hotel;
      })(),
      (async () => {
        const flight = await reserveFlight();
        compensations.push(cancelFlight.bind(undefined, flight));
        return flight;
      })()
    ]),timeout()]);
    // ...... do anything with `car`, `hotel` and `flight`
    return { car, hotel, flight }
  } catch (e) {
    await Promise.all(compensations.map(i => i()));
    throw e;
  }
}
