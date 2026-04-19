const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");
const S =
  require("@effectful/serialization") as typeof import("@effectful/serialization");
const V = require("../../workflow-versioning-demo/src/index") as typeof import("../../workflow-versioning-demo/src/index");
const Release = require("../../workflow-trip-booking-saga-versioned/src/release") as typeof import("../../workflow-trip-booking-saga-versioned/src/release");

import type {
  BookedResource,
  BookedResourceKind,
  HandoffEnvelope,
  VersionedEnvelope,
  WorkflowVersion
} from "../../workflow-versioning-demo/src/index";

declare const exports: Record<string, unknown>;

export const VERSION: WorkflowVersion = {
  major: 1,
  minor: 1,
  patch: 0
};

export type TripRequest = {
  releaseAfterMS?: number;
};

type ReservationNotice = {
  ref: string;
  bookingId: string;
  reservationId: string;
  kind: BookedResourceKind;
};

export const topics = {
  reserveCar: "versioned-reserve-car",
  reserveHotel: "versioned-reserve-hotel",
  reserveFlight: "versioned-reserve-flight",
  reserveTaxi: "versioned-reserve-taxi",
  cancelCar: "versioned-cancel-car",
  cancelHotel: "versioned-cancel-hotel",
  cancelFlight: "versioned-cancel-flight",
  cancelTaxi: "versioned-cancel-taxi"
} as const;

function reserveTopic(kind: BookedResourceKind): string {
  switch (kind) {
    case "car":
      return topics.reserveCar;
    case "hotel":
      return topics.reserveHotel;
    case "flight":
      return topics.reserveFlight;
    case "taxi":
      return topics.reserveTaxi;
    default:
      throw new Error(`unsupported kind ${kind}`);
  }
}

function cancelTopic(kind: BookedResourceKind): string {
  switch (kind) {
    case "car":
      return topics.cancelCar;
    case "hotel":
      return topics.cancelHotel;
    case "flight":
      return topics.cancelFlight;
    case "taxi":
      return topics.cancelTaxi;
    default:
      throw new Error(`unsupported kind ${kind}`);
  }
}

async function reserve(
  bookingId: string,
  kind: BookedResourceKind
): Promise<BookedResource> {
  const resume = W.ref(`${kind}-reservation`);
  const reservationId = `${bookingId}:${kind}:v1.1`;
  const notice: ReservationNotice = {
    ref: resume.id,
    bookingId,
    reservationId,
    kind
  };
  W.outputJSON(notice, reserveTopic(kind));
  try {
    await resume;
  } catch (error) {
    if (error instanceof W.CancelToken) {
      W.outputJSON(notice, cancelTopic(kind));
    }
    throw error;
  }
  return V.createBookedResource(bookingId, kind, reservationId);
}

function toBookedMap(resources: BookedResource[]): Map<string, BookedResource> {
  return new Map(resources.map((resource) => [resource.kind, resource]));
}

function adoptOrReserve(
  bookingId: string,
  adopted: Map<string, BookedResource>,
  kind: Exclude<BookedResourceKind, "taxi">
): Promise<BookedResource> {
  const existing = adopted.get(kind);
  if (existing) {
    Release.cancelDelayedRelease(bookingId, existing);
    return Promise.resolve(existing);
  }
  return reserve(bookingId, kind);
}

async function reserveTransport(
  bookingId: string,
  adopted: Map<string, BookedResource>
): Promise<BookedResource> {
  const existingCar = adopted.get("car");
  if (existingCar) {
    Release.cancelDelayedRelease(bookingId, existingCar);
    return existingCar;
  }
  try {
    return await reserve(bookingId, "car");
  } catch (error) {
    if (error === "car unavailable") {
      return await reserve(bookingId, "taxi");
    }
    throw error;
  }
}

export async function runTripBookingV1_1(
  envelope: VersionedEnvelope<TripRequest> | HandoffEnvelope<TripRequest>
): Promise<unknown> {
  const handoff =
    envelope.kind === "handoff"
      ? (envelope as HandoffEnvelope<TripRequest>).payload
      : null;
  if (handoff && !V.canReuse(handoff.fromVersion, VERSION)) {
    throw new Error(
      `cannot adopt ${handoff.fromVersion.major}.${handoff.fromVersion.minor}.${handoff.fromVersion.patch} from major ${VERSION.major}`
    );
  }
  const adopted = toBookedMap(handoff?.booked ?? []);
  const compensations: Array<() => Promise<void>> = [];
  try {
    const [hotel, flight, transport] = await Promise.all([
      (async () => {
        const result = await adoptOrReserve(envelope.bookingId, adopted, "hotel");
        compensations.push(async () => {
          W.outputJSON(
            {
              bookingId: envelope.bookingId,
              reservationId: result.reservationId,
              kind: result.kind
            },
            cancelTopic(result.kind)
          );
        });
        return result;
      })(),
      (async () => {
        const result = await adoptOrReserve(envelope.bookingId, adopted, "flight");
        compensations.push(async () => {
          W.outputJSON(
            {
              bookingId: envelope.bookingId,
              reservationId: result.reservationId,
              kind: result.kind
            },
            cancelTopic(result.kind)
          );
        });
        return result;
      })(),
      (async () => {
        const result = await reserveTransport(envelope.bookingId, adopted);
        compensations.push(async () => {
          W.outputJSON(
            {
              bookingId: envelope.bookingId,
              reservationId: result.reservationId,
              kind: result.kind
            },
            cancelTopic(result.kind)
          );
        });
        return result;
      })()
    ]);
    return {
      version: VERSION,
      bookingId: envelope.bookingId,
      hotel,
      flight,
      transport
    };
  } catch (error) {
    await Promise.all(compensations.map((compensation) => compensation()));
    throw error;
  }
}

export const outputTopics = [
  Release.topics.releaseCancel,
  topics.reserveCar,
  topics.reserveHotel,
  topics.reserveFlight,
  topics.reserveTaxi,
  topics.cancelCar,
  topics.cancelHotel,
  topics.cancelFlight,
  topics.cancelTaxi
];

(S as any).regOpaqueObject?.(exports, "workflow-trip-booking-saga-v1_1");
