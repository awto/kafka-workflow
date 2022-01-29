module.exports = process.env.EFFECTFUL_KAFKA_WORKFLOW_MOCK ? require("./lib/mocks") : require("./lib/main")

