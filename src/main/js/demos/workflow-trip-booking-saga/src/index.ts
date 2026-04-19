const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

const TIMEOUT_MS = 1000;

type Reservation = { id: string };

async function timeout(ms = TIMEOUT_MS): Promise<void> {
  const resume = W.ref("scheduler");
  W.output(`${ms}`, "workflow-scheduler", resume.key);
  try {
    await resume;
  } catch (error) {
    if (error instanceof W.CancelToken) {
      W.output("0", "workflow-scheduler", resume.key);
      return;
    }
    throw error;
  }
  throw "timeout";
}

function reserveCancelPair(
  kind: string
): [() => Promise<Reservation>, (handler: Reservation) => Promise<void>] {
  async function reserve(): Promise<Reservation> {
    const resume = W.ref(`saga-reserve-${kind}`);
    const ret = { id: resume.id };
    W.output(resume.id, `saga-reserve-${kind}`);
    try {
      await resume;
    } catch (error) {
      if (error instanceof W.CancelToken) {
        await cancel(ret);
      }
      throw error;
    }
    return ret;
  }

  async function cancel(handler: Reservation): Promise<void> {
    W.output(handler.id, `saga-cancel-${kind}`);
  }

  return [reserve, cancel];
}

const [reserveCar, cancelCar] = reserveCancelPair("car");
const [reserveHotel, cancelHotel] = reserveCancelPair("hotel");
const [reserveFlight, cancelFlight] = reserveCancelPair("flight");

export default async function entry(opts: {
  uid?: number;
  throwAfterHotel?: boolean;
  timeoutMS?: number;
} = {}) {
  const { throwAfterHotel = false, timeoutMS = TIMEOUT_MS } = opts;
  const compensations: Array<() => Promise<void>> = [];

  try {
    const result = await Promise.race([
      Promise.all([
        (async () => {
          const car = await reserveCar();
          compensations.push(cancelCar.bind(undefined, car));
          return car;
        })(),
        (async () => {
          const hotel = await reserveHotel();
          compensations.push(cancelHotel.bind(undefined, hotel));
          if (throwAfterHotel) {
            throw "something is wrong";
          }
          return hotel;
        })(),
        (async () => {
          const flight = await reserveFlight();
          compensations.push(cancelFlight.bind(undefined, flight));
          return flight;
        })()
      ]),
      timeout(timeoutMS)
    ]);
    if (!result) {
      throw new TypeError("timeout branch resolved unexpectedly");
    }
    const [car, hotel, flight] = result;
    return { car, hotel, flight };
  } catch (error) {
    await Promise.all(compensations.map((compensation) => compensation()));
    throw error;
  }
}

export const manifest = {
  outputTopics: [
    "workflow-scheduler",
    "saga-reserve-car",
    "saga-reserve-hotel",
    "saga-reserve-flight",
    "saga-cancel-car",
    "saga-cancel-hotel",
    "saga-cancel-flight"
  ]
};
