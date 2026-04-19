export const ALL_TOPICS = [
  "workflow-resume",
  "workflow-result",
  "workflow-error",
  "workflow-scheduler",
  "temporal-mutex-lock-acquired",
  "temporal-mutex-lock-requested",
  "temporal-mutex-invalid-release",
  "temporal-mutex-state",
  "temporal-mutex-notify-locked",
  "temporal-mutex-critical-section",
  "temporal-mutex-notify-unlocked"
];

export const OBSERVED_TOPICS = ALL_TOPICS.filter(
  (topic) => topic !== "workflow-resume"
);
