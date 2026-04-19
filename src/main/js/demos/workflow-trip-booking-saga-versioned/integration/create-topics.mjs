import { createTopics } from "../../workflow-trip-booking-saga/integration/kafka-test-lib.mjs";
import { ALL_TOPICS } from "./topics.mjs";

await createTopics("workflow-trip-booking-saga-versioned-topics", ALL_TOPICS);
