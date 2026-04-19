export const ALL_TOPICS = [
  "workflow-resume",
  "workflow-result",
  "workflow-error",
  "workflow-scheduler",
  "checkoutError",
  "ecommerce-reminder",
  "ecommerce-discount-reminder",
  "ecommerce-v2-reminder",
  "getCart",
  "versioning-await-upgrade",
  "versioning-handoff",
  "versioning-upgrade-dispatch"
];

export const OBSERVED_TOPICS = ALL_TOPICS.filter(
  (topic) => topic !== "workflow-resume"
);
