import { createTopics } from "./kafka-test-lib.mjs";
import { ALL_TOPICS } from "./topics.mjs";

await createTopics("temporal-mutex-topics", ALL_TOPICS);
