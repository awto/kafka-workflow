const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");
const S =
  require("@effectful/serialization") as typeof import("@effectful/serialization");
const V = require("../../workflow-versioning-demo/src/index") as typeof import("../../workflow-versioning-demo/src/index");
const Release = require("../../workflow-trip-booking-saga-versioned/src/release") as typeof import("../../workflow-trip-booking-saga-versioned/src/release");

import type {
  BookedResource,
  BookedResourceKind,
  VersionedEnvelope,
  WorkflowVersion
} from "../../workflow-versioning-demo/src/index";

declare const exports: Record<string, unknown>;

export const VERSION: WorkflowVersion = {
  major: 1,
  minor: 0,
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
  cancelCar: "versioned-cancel-car",
  cancelHotel: "versioned-cancel-hotel",
  cancelFlight: "versioned-cancel-flight"
} as const;

function reserveTopic(kind: BookedResourceKind): string {
  switch (kind) {
    case "car":
      return topics.reserveCar;
    case "hotel":
      return topics.reserveHotel;
    case "flight":
      return topics.reserveFlight;
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
    default:
      throw new Error(`unsupported kind ${kind}`);
  }
}

async function reserve(
  bookingId: string,
  kind: Exclude<BookedResourceKind, "taxi">
): Promise<BookedResource> {
  const resume = W.ref(`${kind}-reservation`);
  const reservationId = `${bookingId}:${kind}:v1.0`;
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

function asResourceMap(booked: BookedResource[]): Map<string, BookedResource> {
  return new Map(booked.map((resource) => [resource.kind, resource]));
}

export async function runTripBookingV1_0(
  envelope: VersionedEnvelope<TripRequest>
): Promise<unknown> {
  const booked: BookedResource[] = [];
  const compensations: Array<() => Promise<void>> = [];
  try {
    const outcome = await Promise.race([
      Promise.all([
        (async () => {
          const hotel = await reserve(envelope.bookingId, "hotel");
          booked.push(hotel);
          compensations.push(async () => {
            W.outputJSON(
              {
                bookingId: envelope.bookingId,
                reservationId: hotel.reservationId,
                kind: hotel.kind
              },
              topics.cancelHotel
            );
          });
          return hotel;
        })(),
        (async () => {
          const flight = await reserve(envelope.bookingId, "flight");
          booked.push(flight);
          compensations.push(async () => {
            W.outputJSON(
              {
                bookingId: envelope.bookingId,
                reservationId: flight.reservationId,
                kind: flight.kind
              },
              topics.cancelFlight
            );
          });
          return flight;
        })(),
        (async () => {
          const car = await reserve(envelope.bookingId, "car");
          booked.push(car);
          compensations.push(async () => {
            W.outputJSON(
              {
                bookingId: envelope.bookingId,
                reservationId: car.reservationId,
                kind: car.kind
              },
              topics.cancelCar
            );
          });
          return car;
        })()
      ]),
      V.waitForUpgrade(VERSION)
    ]);
    if (!Array.isArray(outcome)) {
      for (const resource of booked) {
        Release.requestDelayedRelease(
          envelope.bookingId,
          resource,
          envelope.payload.releaseAfterMS
        );
      }
      W.outputJSON(
        V.createHandoffEnvelope(
          envelope.workflow,
          envelope.bookingId,
          VERSION,
          outcome.targetVersion,
          envelope.payload,
          [...asResourceMap(booked).values()]
        ),
        V.topics.handoff
      );
      return {
        status: "upgraded",
        fromVersion: VERSION,
        toVersion: outcome.targetVersion,
        booked: booked.map((resource) => ({
          kind: resource.kind,
          reservationId: resource.reservationId
        }))
      };
    }
    const [hotel, flight, car] = outcome;
    return {
      version: VERSION,
      bookingId: envelope.bookingId,
      hotel,
      flight,
      transport: car
    };
  } catch (error) {
    await Promise.all(compensations.map((compensation) => compensation()));
    throw error;
  }
}

export const outputTopics = [
  V.topics.awaitUpgrade,
  V.topics.handoff,
  Release.topics.releaseStart,
  topics.reserveCar,
  topics.reserveHotel,
  topics.reserveFlight,
  topics.cancelCar,
  topics.cancelHotel,
  topics.cancelFlight
];

(S as any).regOpaqueObject?.(exports, "workflow-trip-booking-saga-v1_0");
