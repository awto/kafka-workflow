import { createTopics } from "./kafka-test-lib.mjs";
import { ALL_TOPICS } from "./topics.mjs";

await createTopics("workflow-trip-booking-saga-topics", ALL_TOPICS);
