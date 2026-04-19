import { createTopics } from "./kafka-test-lib.mjs";
import { ALL_TOPICS } from "./topics.mjs";

await createTopics("workflow-ecommerce-versioned-topics", ALL_TOPICS);
