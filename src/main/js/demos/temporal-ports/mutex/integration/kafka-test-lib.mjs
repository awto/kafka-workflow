import assert from "node:assert/strict";
import process from "node:process";

import { Kafka, logLevel } from "kafkajs";

const DEFAULT_TIMEOUT_MS = Number(process.env.KAFKA_TIMEOUT_MS || "30000");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function takeMatching(queue, predicate) {
  const index = queue.findIndex(predicate);
  if (index === -1) {
    return undefined;
  }
  return queue.splice(index, 1)[0];
}

export async function waitForBroker(admin, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      await admin.connect();
      await admin.fetchTopicMetadata();
      return;
    } catch (error) {
      lastError = error;
      await admin.disconnect().catch(() => {});
      await sleep(500);
    }
  }
  throw lastError ?? new Error("Kafka broker did not become ready in time");
}

export async function createTopics(clientId, topics) {
  const kafka = new Kafka({
    clientId,
    brokers: (process.env.KAFKA_BROKERS || "kafka:9092").split(","),
    logLevel: logLevel.NOTHING
  });
  const admin = kafka.admin();
  try {
    await waitForBroker(admin);
    await admin.createTopics({
      waitForLeaders: true,
      topics: topics.map((topic) => ({
        topic,
        numPartitions: 1,
        replicationFactor: 1
      }))
    });
  } finally {
    await admin.disconnect().catch(() => {});
  }
}

export async function waitForConsumerGroups(
  clientId,
  groupIds,
  timeoutMs = DEFAULT_TIMEOUT_MS
) {
  const kafka = new Kafka({
    clientId,
    brokers: (process.env.KAFKA_BROKERS || "kafka:9092").split(","),
    logLevel: logLevel.NOTHING
  });
  const admin = kafka.admin();
  const started = Date.now();
  try {
    await waitForBroker(admin, timeoutMs);
    while (Date.now() - started < timeoutMs) {
      const { groups } = await admin.listGroups();
      const found = new Set(groups.map((group) => group.groupId));
      if (groupIds.every((groupId) => found.has(groupId))) {
        return;
      }
      await sleep(500);
    }
    throw new Error(
      `Timed out waiting for consumer groups: ${groupIds.join(", ")}`
    );
  } finally {
    await admin.disconnect().catch(() => {});
  }
}

export async function waitForConsumerGroupsStable(
  clientId,
  groupIds,
  timeoutMs = DEFAULT_TIMEOUT_MS
) {
  const kafka = new Kafka({
    clientId,
    brokers: (process.env.KAFKA_BROKERS || "kafka:9092").split(","),
    logLevel: logLevel.NOTHING
  });
  const admin = kafka.admin();
  const started = Date.now();
  try {
    await waitForBroker(admin, timeoutMs);
    while (Date.now() - started < timeoutMs) {
      const { groups } = await admin.describeGroups(groupIds);
      if (
        groups.length === groupIds.length &&
        groups.every(
          (group) =>
            group.state === "Stable" &&
            Array.isArray(group.members) &&
            group.members.length > 0
        )
      ) {
        return;
      }
      await sleep(500);
    }
    throw new Error(
      `Timed out waiting for stable consumer groups: ${groupIds.join(", ")}`
    );
  } finally {
    await admin.disconnect().catch(() => {});
  }
}

export async function createHarness(clientId, topics) {
  const kafka = new Kafka({
    clientId,
    brokers: (process.env.KAFKA_BROKERS || "kafka:9092").split(","),
    logLevel: logLevel.NOTHING
  });
  const producer = kafka.producer();
  const consumer = kafka.consumer({
    groupId: `${clientId}-${Date.now()}`
  });
  const queues = new Map();
  const waiters = new Map();

  function enqueue(record) {
    const topicWaiters = waiters.get(record.topic);
    if (topicWaiters) {
      const index = topicWaiters.findIndex((waiter) => waiter.predicate(record));
      if (index !== -1) {
        const [waiter] = topicWaiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(record);
        return;
      }
    }
    const queue = queues.get(record.topic) || [];
    queue.push(record);
    queues.set(record.topic, queue);
  }

  await producer.connect();
  await consumer.connect();
  for (const topic of topics) {
    await consumer.subscribe({ topic, fromBeginning: true });
  }
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      enqueue({
        topic,
        partition,
        key: message.key?.toString() ?? "",
        value: message.value?.toString() ?? "",
        timestamp: Number(message.timestamp)
      });
    }
  });

  return {
    async send(topic, key, value) {
      await producer.send({
        topic,
        messages: [{ key, value }]
      });
    },
    async next(topic, predicate = () => true, timeoutMs = DEFAULT_TIMEOUT_MS) {
      const queue = queues.get(topic);
      if (queue) {
        const matched = takeMatching(queue, predicate);
        if (matched) {
          return matched;
        }
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const topicWaiters = waiters.get(topic) || [];
          waiters.set(
            topic,
            topicWaiters.filter((waiter) => waiter.timer !== timer)
          );
          reject(new Error(`Timed out waiting for ${topic}`));
        }, timeoutMs);
        const topicWaiters = waiters.get(topic) || [];
        topicWaiters.push({ predicate, resolve, reject, timer });
        waiters.set(topic, topicWaiters);
      });
    },
    async expectNone(topic, predicate = () => true, quietMs = 750) {
      await sleep(quietMs);
      const queue = queues.get(topic) || [];
      const matched = queue.find(predicate);
      assert.equal(
        matched,
        undefined,
        `Unexpected ${topic} message: ${JSON.stringify(matched)}`
      );
    },
    async stop() {
      await consumer.stop().catch(() => {});
      await Promise.allSettled([consumer.disconnect(), producer.disconnect()]);
    }
  };
}
