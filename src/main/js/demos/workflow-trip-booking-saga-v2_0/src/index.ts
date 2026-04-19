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
  major: 2,
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
  reserveHotel: "versioned-reserve-hotel",
  reserveFlight: "versioned-reserve-flight",
  reserveTaxi: "versioned-reserve-taxi",
  cancelHotel: "versioned-cancel-hotel",
  cancelFlight: "versioned-cancel-flight",
  cancelTaxi: "versioned-cancel-taxi"
} as const;

function reserveTopic(kind: BookedResourceKind): string {
  switch (kind) {
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
  kind: Extract<BookedResourceKind, "hotel" | "flight" | "taxi">
): Promise<BookedResource> {
  const resume = W.ref(`${kind}-reservation`);
  const reservationId = `${bookingId}:${kind}:v2.0`;
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
  kind: Extract<BookedResourceKind, "hotel" | "flight" | "taxi">
): Promise<BookedResource> {
  const existing = adopted.get(kind);
  if (existing) {
    Release.cancelDelayedRelease(bookingId, existing);
    return Promise.resolve(existing);
  }
  return reserve(bookingId, kind);
}

export async function runTripBookingV2_0(
  envelope: VersionedEnvelope<TripRequest> | HandoffEnvelope<TripRequest>
): Promise<unknown> {
  const handoff =
    envelope.kind === "handoff"
      ? (envelope as HandoffEnvelope<TripRequest>).payload
      : null;
  if (handoff && !V.canReuse(handoff.fromVersion, VERSION)) {
    throw new Error(
      `cannot adopt ${V.formatVersion(handoff.fromVersion)} in ${V.formatVersion(
        VERSION
      )}`
    );
  }
  const adopted = toBookedMap(handoff?.booked ?? []);
  const compensations: Array<() => Promise<void>> = [];
  try {
    const [hotel, flight, taxi] = await Promise.all([
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
        const result = await adoptOrReserve(envelope.bookingId, adopted, "taxi");
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
      transport: taxi
    };
  } catch (error) {
    await Promise.all(compensations.map((compensation) => compensation()));
    throw error;
  }
}

export const outputTopics = [
  Release.topics.releaseCancel,
  topics.reserveHotel,
  topics.reserveFlight,
  topics.reserveTaxi,
  topics.cancelHotel,
  topics.cancelFlight,
  topics.cancelTaxi
];

(S as any).regOpaqueObject?.(exports, "workflow-trip-booking-saga-v2_0");
