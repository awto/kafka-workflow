export const ALL_TOPICS = [
  "workflow-resume",
  "workflow-result",
  "workflow-error",
  "workflow-scheduler",
  "saga-reserve-car",
  "saga-reserve-hotel",
  "saga-reserve-flight",
  "saga-cancel-car",
  "saga-cancel-hotel",
  "saga-cancel-flight"
];

export const OBSERVED_TOPICS = ALL_TOPICS.filter((topic) => topic !== "workflow-resume");
