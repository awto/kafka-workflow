const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

export interface ExpenseInput {
  amount: number;
  reason: string;
  requester: string;
  approvalTimeoutMS?: number;
}

type ExpenseDecision =
  | { type: "approve"; approvedBy: string }
  | { type: "reject"; rejectedBy: string };

type ExpenseResult =
  | { status: "COMPLETED"; expenseId: string; amount: number }
  | { status: "REJECTED"; expenseId: string; amount: number }
  | { status: "TIMED_OUT"; expenseId: string; amount: number };

const DEFAULT_TIMEOUT_MS = 500;

async function waitForDecision(): Promise<ExpenseDecision> {
  return await W.refId<ExpenseDecision>("approval");
}

async function timeout(ms: number): Promise<"timeout"> {
  const resume = W.ref("scheduler");
  W.output(`${ms}`, "workflow-scheduler", resume.key);
  try {
    await resume;
  } catch (error) {
    if (error instanceof W.CancelToken) {
      W.output("0", "workflow-scheduler", resume.key);
    }
    throw error;
  }
  return "timeout";
}

export default async function entry(input: ExpenseInput): Promise<ExpenseResult> {
  const approvalTimeoutMS = input.approvalTimeoutMS ?? DEFAULT_TIMEOUT_MS;
  W.outputJSON(
    {
      expenseId: W.threadId,
      amount: input.amount,
      reason: input.reason,
      requester: input.requester
    },
    "temporal-expense-create"
  );
  const decision = await Promise.race([
    waitForDecision(),
    timeout(approvalTimeoutMS)
  ]);
  if (decision === "timeout") {
    return {
      status: "TIMED_OUT",
      expenseId: W.threadId,
      amount: input.amount
    };
  }
  if (decision.type === "approve") {
    W.outputJSON(
      {
        expenseId: W.threadId,
        amount: input.amount,
        approvedBy: decision.approvedBy
      },
      "temporal-expense-pay"
    );
    return {
      status: "COMPLETED",
      expenseId: W.threadId,
      amount: input.amount
    };
  }
  return {
    status: "REJECTED",
    expenseId: W.threadId,
    amount: input.amount
  };
}

export const manifest = {
  outputTopics: [
    "workflow-scheduler",
    "temporal-expense-create",
    "temporal-expense-pay"
  ]
};
