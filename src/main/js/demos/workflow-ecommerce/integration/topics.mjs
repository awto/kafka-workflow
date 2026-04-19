export const ALL_TOPICS = [
  "workflow-resume",
  "workflow-result",
  "workflow-error",
  "workflow-scheduler",
  "checkoutError",
  "ecommerce-reminder",
  "getCart"
];

export const OBSERVED_TOPICS = ALL_TOPICS.filter((topic) => topic !== "workflow-resume");
