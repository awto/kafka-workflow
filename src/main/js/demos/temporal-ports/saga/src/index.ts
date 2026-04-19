const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

export interface PostalAddress {
  address1: string;
  address2?: string;
  postalCode: string;
}

export interface Owner {
  firstName: string;
  lastName: string;
}

export interface BankDetails {
  accountNumber: string;
  accountType: string;
  nickname?: string;
  personalOwner: Owner;
  routingNumber: string;
}

export interface OpenAccount {
  accountId: string;
  bankId: string;
  clientEmail: string;
  address: PostalAddress;
  bankDetails: BankDetails;
}

type ActivityAck = {
  ok?: true;
  error?: string;
};

async function requestActivity(
  topic: string,
  payload: Record<string, unknown>
): Promise<ActivityAck> {
  const reply = W.ref<ActivityAck>(topic);
  W.outputJSON({ ...payload, ref: reply.id }, topic);
  return await reply;
}

async function createAccount(accountId: string): Promise<ActivityAck> {
  return await requestActivity("temporal-saga-create-account", { accountId });
}

async function addAddress(
  accountId: string,
  address: PostalAddress
): Promise<ActivityAck> {
  return await requestActivity("temporal-saga-add-address", { accountId, address });
}

async function clearPostalAddresses(accountId: string): Promise<ActivityAck> {
  return await requestActivity("temporal-saga-clear-postal-addresses", { accountId });
}

async function addClient(
  accountId: string,
  clientEmail: string
): Promise<ActivityAck> {
  return await requestActivity("temporal-saga-add-client", { accountId, clientEmail });
}

async function removeClient(accountId: string): Promise<ActivityAck> {
  return await requestActivity("temporal-saga-remove-client", { accountId });
}

async function addBankAccount(
  accountId: string,
  details: BankDetails
): Promise<ActivityAck> {
  return await requestActivity("temporal-saga-add-bank-account", { accountId, details });
}

async function disconnectBankAccounts(accountId: string): Promise<ActivityAck> {
  return await requestActivity("temporal-saga-disconnect-bank-accounts", { accountId });
}

async function compensate(
  compensations: Array<() => Promise<void>>
): Promise<void> {
  if (compensations.length === 0) {
    return;
  }
  W.outputJSON(
    { message: "failures encountered during account opening - compensating" },
    "temporal-saga-log"
  );
  for (const compensation of compensations) {
    await compensation();
  }
}

export default async function openAccount(params: OpenAccount): Promise<void> {
  const compensations: Array<() => Promise<void>> = [];
  let failureMessage: string | undefined;

  {
    const create = await createAccount(params.accountId);
    if (create.error) {
      throw new Error(create.error);
    }
  }

  {
    const addedAddress = await addAddress(params.accountId, params.address);
    if (addedAddress.error) {
      failureMessage = addedAddress.error;
    } else {
      compensations.unshift(async () => {
        W.outputJSON({ message: "reversing add address" }, "temporal-saga-log");
        const result = await clearPostalAddresses(params.accountId);
        if (result.error) {
          W.outputJSON(
            {
              message: `failed to compensate: ${result.error}`
            },
            "temporal-saga-log"
          );
        }
      });
    }
  }

  if (failureMessage === undefined) {
    const addedClient = await addClient(params.accountId, params.clientEmail);
    if (addedClient.error) {
      failureMessage = addedClient.error;
    } else {
      compensations.unshift(async () => {
        W.outputJSON({ message: "reversing add client" }, "temporal-saga-log");
        const result = await removeClient(params.accountId);
        if (result.error) {
          W.outputJSON(
            {
              message: `failed to compensate: ${result.error}`
            },
            "temporal-saga-log"
          );
        }
      });
    }
  }

  if (failureMessage === undefined) {
    const addedBankAccount = await addBankAccount(
      params.accountId,
      params.bankDetails
    );
    if (addedBankAccount.error) {
      failureMessage = addedBankAccount.error;
    } else {
      compensations.unshift(async () => {
        W.outputJSON(
          { message: "reversing add bank account" },
          "temporal-saga-log"
        );
        const result = await disconnectBankAccounts(params.accountId);
        if (result.error) {
          W.outputJSON(
            {
              message: `failed to compensate: ${result.error}`
            },
            "temporal-saga-log"
          );
        }
      });
    }
  }

  if (failureMessage !== undefined) {
    W.outputJSON({ message: failureMessage }, "temporal-saga-log");
    await compensate(compensations);
    throw new Error(failureMessage);
  }
}

export const manifest = {
  outputTopics: [
    "temporal-saga-create-account",
    "temporal-saga-add-address",
    "temporal-saga-clear-postal-addresses",
    "temporal-saga-add-client",
    "temporal-saga-remove-client",
    "temporal-saga-add-bank-account",
    "temporal-saga-disconnect-bank-accounts",
    "temporal-saga-log"
  ]
};
