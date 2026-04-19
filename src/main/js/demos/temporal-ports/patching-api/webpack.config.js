const createDemoWebpackConfig = require("../../_build/webpack.config");

module.exports = createDemoWebpackConfig({
  demoDir: __dirname,
  outputName: "temporal-patching-api",
  include: [
    "../../workflow-versioning-demo/src"
  ]
});
