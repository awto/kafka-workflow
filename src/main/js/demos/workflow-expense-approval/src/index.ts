const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

export interface ExpenseApprovalInput {
  amount: number;
  requester: string;
  approverEmail: string;
  description?: string;
  approvalTimeoutMS?: number;
  reminderTimeoutMS?: number;
}

export type ApprovalDecision =
  | { type: "approve"; decidedBy: string; comment?: string }
  | { type: "reject"; decidedBy: string; comment?: string };

type ApprovalStage = "requested" | "reminded";

type TimeoutSignal = {
  type: "timeout";
  stage: ApprovalStage;
};

type ApprovalNotice = {
  expenseId: string;
  amount: number;
  requester: string;
  approverEmail: string;
  description?: string;
  decisionRef: string;
  stage: ApprovalStage;
  timeoutMS: number;
};

type ApprovalResult =
  | {
      status: "approved" | "rejected";
      expenseId: string;
      amount: number;
      requester: string;
      approverEmail: string;
      description?: string;
      stage: ApprovalStage;
      decidedBy: string;
      comment?: string;
    }
  | {
      status: "escalated";
      expenseId: string;
      amount: number;
      requester: string;
      approverEmail: string;
      description?: string;
      stage: ApprovalStage;
    };

const DEFAULT_APPROVAL_TIMEOUT_MS = 300;
const DEFAULT_REMINDER_TIMEOUT_MS = 300;

function buildNotice(
  input: ExpenseApprovalInput,
  stage: ApprovalStage,
  timeoutMS: number,
  decisionRef: string
): ApprovalNotice {
  return {
    expenseId: W.threadId,
    amount: input.amount,
    requester: input.requester,
    approverEmail: input.approverEmail,
    description: input.description,
    decisionRef,
    stage,
    timeoutMS
  };
}

function isTimeoutSignal(
  value: ApprovalDecision | TimeoutSignal
): value is TimeoutSignal {
  return (value as TimeoutSignal).type === "timeout";
}

async function waitForDecision(
  input: ExpenseApprovalInput,
  stage: ApprovalStage,
  timeoutMS: number
): Promise<ApprovalDecision> {
  const decision = W.ref<ApprovalDecision>(`approval-${stage}`);
  W.outputJSON(
    buildNotice(input, stage, timeoutMS, decision.id),
    stage === "requested"
      ? "expense-approval-request"
      : "expense-approval-reminder"
  );
  return await decision;
}

async function timeout(stage: ApprovalStage, ms: number): Promise<TimeoutSignal> {
  const resume = W.ref(`scheduler-${stage}`);
  W.output(`${ms}`, "workflow-scheduler", resume.key);
  try {
    await resume;
  } catch (error) {
    if (error instanceof W.CancelToken) {
      W.output("0", "workflow-scheduler", resume.key);
    }
    throw error;
  }
  return { type: "timeout", stage };
}

function finishDecision(
  input: ExpenseApprovalInput,
  stage: ApprovalStage,
  decision: ApprovalDecision
): ApprovalResult {
  const result: ApprovalResult = {
    status: decision.type === "approve" ? "approved" : "rejected",
    expenseId: W.threadId,
    amount: input.amount,
    requester: input.requester,
    approverEmail: input.approverEmail,
    description: input.description,
    stage,
    decidedBy: decision.decidedBy,
    comment: decision.comment
  };
  W.outputJSON(
    result,
    decision.type === "approve"
      ? "expense-approval-approved"
      : "expense-approval-rejected"
  );
  return result;
}

export default async function entry(
  input: ExpenseApprovalInput
): Promise<ApprovalResult> {
  const approvalTimeoutMS =
    input.approvalTimeoutMS ?? DEFAULT_APPROVAL_TIMEOUT_MS;
  const reminderTimeoutMS =
    input.reminderTimeoutMS ?? DEFAULT_REMINDER_TIMEOUT_MS;

  const first = await Promise.race([
    waitForDecision(input, "requested", approvalTimeoutMS),
    timeout("requested", approvalTimeoutMS)
  ]);
  if (!isTimeoutSignal(first)) {
    return finishDecision(input, "requested", first);
  }

  const second = await Promise.race([
    waitForDecision(input, "reminded", reminderTimeoutMS),
    timeout("reminded", reminderTimeoutMS)
  ]);
  if (!isTimeoutSignal(second)) {
    return finishDecision(input, "reminded", second);
  }

  const result: ApprovalResult = {
    status: "escalated",
    expenseId: W.threadId,
    amount: input.amount,
    requester: input.requester,
    approverEmail: input.approverEmail,
    description: input.description,
    stage: "reminded"
  };
  W.outputJSON(result, "expense-approval-escalated");
  return result;
}

export const manifest = {
  outputTopics: [
    "workflow-scheduler",
    "expense-approval-request",
    "expense-approval-reminder",
    "expense-approval-approved",
    "expense-approval-rejected",
    "expense-approval-escalated"
  ]
};
