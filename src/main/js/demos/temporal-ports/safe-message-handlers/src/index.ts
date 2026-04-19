const W =
  require("@effectful/kafka-workflow-rt") as typeof import("@effectful/kafka-workflow-rt");

type ClusterState = "NOT_STARTED" | "STARTED" | "SHUTTING_DOWN";

type ClusterManagerState = {
  clusterState: ClusterState;
  nodes: Record<string, string | null>;
  maxAssignedNodes: number;
};

type ClusterManagerStateSummary = {
  maxAssignedNodes: number;
  assignedNodes: number;
};

type Command =
  | { type: "startCluster" }
  | { type: "shutdownCluster" }
  | { type: "allocateNodesToJob"; jobName: string; numNodes: number }
  | { type: "deleteJob"; jobName: string }
  | { type: "getClusterStatus" };

type RpcAck = { ok: true };

export interface ClusterManagerInput {
  nodeCount?: number;
}

function getAssignedNodes(state: ClusterManagerState, jobName?: string): string[] {
  return Object.entries(state.nodes)
    .filter(([_, value]) =>
      jobName === undefined ? value !== null : value === jobName
    )
    .map(([name]) => name)
    .sort((left, right) => Number(left) - Number(right));
}

function getUnassignedNodes(state: ClusterManagerState): string[] {
  return Object.entries(state.nodes)
    .filter(([_, value]) => value === null)
    .map(([name]) => name)
    .sort((left, right) => Number(left) - Number(right));
}

function getStateSummary(state: ClusterManagerState): ClusterManagerStateSummary {
  return {
    maxAssignedNodes: state.maxAssignedNodes,
    assignedNodes: getAssignedNodes(state).length
  };
}

async function awaitRpc(
  topic: string,
  payload: Record<string, unknown>
): Promise<void> {
  const reply = W.ref<RpcAck>();
  W.outputJSON({ ...payload, ref: reply.id }, topic);
  await reply;
}

async function startCluster(
  state: ClusterManagerState,
  nodeCount: number
): Promise<void> {
  if (state.clusterState !== "NOT_STARTED") {
    throw new Error(`Cannot start cluster in state ${state.clusterState}`);
  }
  await awaitRpc("temporal-safe-message-handlers-start-cluster", {});
  for (let index = 0; index < nodeCount; index += 1) {
    state.nodes[index.toString()] = null;
  }
  state.clusterState = "STARTED";
}

async function shutdownCluster(state: ClusterManagerState): Promise<true> {
  if (state.clusterState !== "STARTED") {
    throw new Error(`Cannot shutdown cluster in state ${state.clusterState}`);
  }
  await awaitRpc("temporal-safe-message-handlers-shutdown-cluster", {});
  state.clusterState = "SHUTTING_DOWN";
  return true;
}

async function assignNodesToJob(
  state: ClusterManagerState,
  command: Extract<Command, { type: "allocateNodesToJob" }>
): Promise<ClusterManagerStateSummary> {
  if (command.numNodes <= 0) {
    throw new Error(`numNodes must be positive (got ${command.numNodes})`);
  }
  if (command.jobName === "") {
    throw new Error("jobName cannot be empty");
  }
  if (state.clusterState === "NOT_STARTED") {
    throw new Error("Cannot assign nodes to a job: Cluster is not started");
  }
  if (state.clusterState === "SHUTTING_DOWN") {
    throw new Error("Cannot assign nodes to a job: Cluster is shutting down");
  }

  const alreadyAssigned = getAssignedNodes(state, command.jobName);
  if (alreadyAssigned.length === 0) {
    const available = getUnassignedNodes(state);
    if (command.numNodes > available.length) {
      throw new Error(
        `Cannot assign ${command.numNodes} nodes; have only ${available.length} available`
      );
    }
    const nodes = available.slice(0, command.numNodes);
    await awaitRpc("temporal-safe-message-handlers-assign-nodes", {
      jobName: command.jobName,
      nodes
    });
    for (const node of nodes) {
      state.nodes[node] = command.jobName;
    }
    state.maxAssignedNodes = Math.max(
      state.maxAssignedNodes,
      getAssignedNodes(state).length
    );
  }

  const summary = getStateSummary(state);
  W.outputJSON(summary, "temporal-safe-message-handlers-status");
  return summary;
}

async function deleteJob(
  state: ClusterManagerState,
  command: Extract<Command, { type: "deleteJob" }>
): Promise<void> {
  if (state.clusterState === "NOT_STARTED") {
    throw new Error("Cannot delete job: Cluster is not started");
  }
  const nodes = getAssignedNodes(state, command.jobName);
  await awaitRpc("temporal-safe-message-handlers-unassign-nodes", {
    jobName: command.jobName,
    nodes
  });
  for (const node of nodes) {
    state.nodes[node] = null;
  }
  W.outputJSON(getStateSummary(state), "temporal-safe-message-handlers-status");
}

function publishStatus(state: ClusterManagerState): ClusterManagerStateSummary {
  const summary = getStateSummary(state);
  W.outputJSON(summary, "temporal-safe-message-handlers-status");
  return summary;
}

export default async function entry(
  input: ClusterManagerInput = {}
): Promise<ClusterManagerStateSummary> {
  const state: ClusterManagerState = {
    clusterState: "NOT_STARTED",
    nodes: {},
    maxAssignedNodes: 0
  };
  const nodeCount = input.nodeCount ?? 25;

  for (;;) {
    const command = await W.refId<Command>("main");
    switch (command.type) {
      case "startCluster":
        await startCluster(state, nodeCount);
        publishStatus(state);
        break;
      case "allocateNodesToJob":
        await assignNodesToJob(state, command);
        break;
      case "deleteJob":
        await deleteJob(state, command);
        break;
      case "getClusterStatus":
        publishStatus(state);
        break;
      case "shutdownCluster":
        await shutdownCluster(state);
        return publishStatus(state);
    }
  }
}

export const manifest = {
  outputTopics: [
    "temporal-safe-message-handlers-start-cluster",
    "temporal-safe-message-handlers-shutdown-cluster",
    "temporal-safe-message-handlers-assign-nodes",
    "temporal-safe-message-handlers-unassign-nodes",
    "temporal-safe-message-handlers-status"
  ]
};
