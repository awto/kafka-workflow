export const ALL_TOPICS = [
  "workflow-resume",
  "workflow-result",
  "workflow-error",
  "workflow-scheduler",
  "expense-approval-request",
  "expense-approval-reminder",
  "expense-approval-approved",
  "expense-approval-rejected",
  "expense-approval-escalated"
];

export const OBSERVED_TOPICS = ALL_TOPICS.filter(
  (topic) => topic !== "workflow-resume"
);
