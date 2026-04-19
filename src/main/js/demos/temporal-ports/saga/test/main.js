const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkflowHarness,
  collectOutputs,
  findOutput,
  parseOutput
} = require("../../../_test/workflow-harness");

function createHarness() {
  return createWorkflowHarness(__dirname, {
    bundle: "temporal-saga",
    defaultThreadId: "temporal-saga-thread",
    stepMode: "state"
  });
}

function replyTo(output, value) {
  return {
    ref: parseOutput(output).ref,
    value
  };
}

const input = {
  accountId: "acct-1",
  bankId: "bank-1",
  clientEmail: "bart@simpson.io",
  address: { address1: "123 Temporal Street", postalCode: "98006" },
  bankDetails: {
    accountNumber: "1234567",
    accountType: "checking",
    personalOwner: { firstName: "Bart", lastName: "Simpson" },
    routingNumber: "7654321"
  }
};

test("saga completes when all activity calls succeed", async () => {
  const workflow = createHarness();
  assert.deepEqual(workflow.topics(), [
    "temporal-saga-add-address",
    "temporal-saga-add-bank-account",
    "temporal-saga-add-client",
    "temporal-saga-clear-postal-addresses",
    "temporal-saga-create-account",
    "temporal-saga-disconnect-bank-accounts",
    "temporal-saga-log",
    "temporal-saga-remove-client",
    "workflow-error",
    "workflow-result"
  ]);

  const first = await workflow.step(input);
  const create = findOutput(first.outputs, "temporal-saga-create-account");
  assert.deepEqual(parseOutput(create), {
    accountId: "acct-1",
    ref: parseOutput(create).ref
  });

  const second = await workflow.step(replyTo(create, { ok: true }), first.state);
  const addAddress = findOutput(second.outputs, "temporal-saga-add-address");
  assert.deepEqual(parseOutput(addAddress), {
    accountId: "acct-1",
    address: input.address,
    ref: parseOutput(addAddress).ref
  });

  const third = await workflow.step(replyTo(addAddress, { ok: true }), second.state);
  const addClient = findOutput(third.outputs, "temporal-saga-add-client");
  assert.deepEqual(parseOutput(addClient), {
    accountId: "acct-1",
    clientEmail: "bart@simpson.io",
    ref: parseOutput(addClient).ref
  });

  const fourth = await workflow.step(replyTo(addClient, { ok: true }), third.state);
  const addBankAccount = findOutput(fourth.outputs, "temporal-saga-add-bank-account");
  assert.deepEqual(parseOutput(addBankAccount), {
    accountId: "acct-1",
    details: input.bankDetails,
    ref: parseOutput(addBankAccount).ref
  });

  const finished = await workflow.step(
    replyTo(addBankAccount, { ok: true }),
    fourth.state
  );
  assert.equal(finished.state, "");
  assert.deepEqual(finished.outputs, []);
});

test("saga compensates in reverse order after a later failure", async () => {
  const workflow = createHarness();

  const first = await workflow.step(input);
  const create = findOutput(first.outputs, "temporal-saga-create-account");
  const second = await workflow.step(replyTo(create, { ok: true }), first.state);
  const addAddress = findOutput(second.outputs, "temporal-saga-add-address");
  const third = await workflow.step(replyTo(addAddress, { ok: true }), second.state);
  const addClient = findOutput(third.outputs, "temporal-saga-add-client");
  const fourth = await workflow.step(replyTo(addClient, { ok: true }), third.state);
  const addBankAccount = findOutput(fourth.outputs, "temporal-saga-add-bank-account");

  const failed = await workflow.step(
    replyTo(addBankAccount, { error: "add bank account failed:" }),
    fourth.state
  );
  const logs = collectOutputs(failed.outputs, "temporal-saga-log").map((output) =>
    parseOutput(output).message
  );
  assert.deepEqual(logs, [
    "add bank account failed:",
    "failures encountered during account opening - compensating",
    "reversing add client"
  ]);
  const removeClient = findOutput(failed.outputs, "temporal-saga-remove-client");
  assert.deepEqual(parseOutput(removeClient), {
    accountId: "acct-1",
    ref: parseOutput(removeClient).ref
  });

  const compensatedClient = await workflow.step(
    replyTo(removeClient, { ok: true }),
    failed.state
  );
  const addressLogs = collectOutputs(compensatedClient.outputs, "temporal-saga-log").map(
    (output) => parseOutput(output).message
  );
  assert.deepEqual(addressLogs, ["reversing add address"]);
  const clearAddresses = findOutput(
    compensatedClient.outputs,
    "temporal-saga-clear-postal-addresses"
  );
  assert.deepEqual(parseOutput(clearAddresses), {
    accountId: "acct-1",
    ref: parseOutput(clearAddresses).ref
  });

  const finished = await workflow.step(
    replyTo(clearAddresses, { ok: true }),
    compensatedClient.state
  );
  assert.equal(finished.state, "");
  assert.deepEqual(parseOutput(findOutput(finished.outputs, "workflow-error")), "Error: add bank account failed:");
});
