import assert from "node:assert/strict";
import process from "node:process";

import {
  createHarness,
  waitForConsumerGroups
} from "../../workflow-trip-booking-saga/integration/kafka-test-lib.mjs";
import { OBSERVED_TOPICS } from "./topics.mjs";

const WAIT_TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || "10000");

function newThread(value) {
  return `new:${JSON.stringify(value)}`;
}

function resumeValue(ref, value) {
  return JSON.stringify({ ref, value });
}

function parseValue(record) {
  return JSON.parse(record.value);
}

async function runDirectApproval(harness) {
  const threadId = "expense-approve";
  await harness.send(
    "workflow-resume",
    threadId,
    newThread({
      amount: 4200,
      requester: "alice",
      approverEmail: "lead@example.com",
      description: "Conference travel",
      approvalTimeoutMS: 300,
      reminderTimeoutMS: 400
    })
  );

  const request = parseValue(
    await harness.next(
      "expense-approval-request",
      (record) => record.key === threadId,
      WAIT_TIMEOUT_MS
    )
  );
  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue(request.decisionRef, {
      type: "approve",
      decidedBy: "lead@example.com",
      comment: "Approved"
    })
  );

  const approved = parseValue(
    await harness.next(
      "expense-approval-approved",
      (record) => record.key === threadId,
      WAIT_TIMEOUT_MS
    )
  );
  assert.equal(approved.status, "approved");
  assert.equal(approved.stage, "requested");

  const result = await harness.next(
    "workflow-result",
    (record) => record.key === threadId,
    WAIT_TIMEOUT_MS
  );
  assert.equal(JSON.parse(result.value).status, "approved");
}

async function runReminderReject(harness) {
  const threadId = "expense-remind-reject";
  await harness.send(
    "workflow-resume",
    threadId,
    newThread({
      amount: 1800,
      requester: "bob",
      approverEmail: "manager@example.com",
      approvalTimeoutMS: 200,
      reminderTimeoutMS: 250
    })
  );

  await harness.next(
    "expense-approval-request",
    (record) => record.key === threadId,
    WAIT_TIMEOUT_MS
  );
  const reminder = parseValue(
    await harness.next(
      "expense-approval-reminder",
      (record) => record.key === threadId,
      WAIT_TIMEOUT_MS
    )
  );
  await harness.send(
    "workflow-resume",
    threadId,
    resumeValue(reminder.decisionRef, {
      type: "reject",
      decidedBy: "manager@example.com",
      comment: "Budget frozen"
    })
  );

  const rejected = parseValue(
    await harness.next(
      "expense-approval-rejected",
      (record) => record.key === threadId,
      WAIT_TIMEOUT_MS
    )
  );
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.stage, "reminded");
}

async function runEscalation(harness) {
  const threadId = "expense-escalated";
  await harness.send(
    "workflow-resume",
    threadId,
    newThread({
      amount: 15000,
      requester: "dana",
      approverEmail: "director@example.com",
      description: "Team offsite",
      approvalTimeoutMS: 200,
      reminderTimeoutMS: 250
    })
  );

  await harness.next(
    "expense-approval-request",
    (record) => record.key === threadId,
    WAIT_TIMEOUT_MS
  );
  await harness.next(
    "expense-approval-reminder",
    (record) => record.key === threadId,
    WAIT_TIMEOUT_MS
  );
  const escalated = parseValue(
    await harness.next(
      "expense-approval-escalated",
      (record) => record.key === threadId,
      WAIT_TIMEOUT_MS
    )
  );
  assert.equal(escalated.status, "escalated");
  assert.equal(escalated.stage, "reminded");

  const result = await harness.next(
    "workflow-result",
    (record) => record.key === threadId,
    WAIT_TIMEOUT_MS
  );
  assert.equal(JSON.parse(result.value).status, "escalated");
}

const harness = await createHarness(
  "workflow-expense-approval-integration-test",
  OBSERVED_TOPICS
);

try {
  await waitForConsumerGroups("workflow-expense-approval-ready", [
    "workflow-engine-expense-approval-it",
    "workflow-scheduler-expense-approval-it"
  ]);
  await runDirectApproval(harness);
  await runReminderReject(harness);
  await runEscalation(harness);
  console.log("workflow-expense-approval integration test passed");
} finally {
  await harness.stop();
}
