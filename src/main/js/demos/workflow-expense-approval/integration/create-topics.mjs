import { createTopics } from "../../workflow-trip-booking-saga/integration/kafka-test-lib.mjs";
import { ALL_TOPICS } from "./topics.mjs";

await createTopics("workflow-expense-approval-topics", ALL_TOPICS);
