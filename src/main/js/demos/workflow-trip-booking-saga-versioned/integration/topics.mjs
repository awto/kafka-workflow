export const ALL_TOPICS = [
  "workflow-resume",
  "workflow-result",
  "workflow-error",
  "workflow-scheduler",
  "versioned-reserve-car",
  "versioned-reserve-hotel",
  "versioned-reserve-flight",
  "versioned-reserve-taxi",
  "versioned-cancel-car",
  "versioned-cancel-hotel",
  "versioned-cancel-flight",
  "versioned-cancel-taxi",
  "versioning-await-upgrade",
  "versioning-await-retain",
  "versioning-upgrade-dispatch",
  "versioning-handoff",
  "versioning-release-start",
  "versioning-release-cancel",
  "versioning-release-fired",
  "versioning-release-retained"
];

export const OBSERVED_TOPICS = ALL_TOPICS.filter(
  (topic) => topic !== "workflow-resume"
);
