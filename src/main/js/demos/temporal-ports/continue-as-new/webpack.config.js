const createDemoWebpackConfig = require("../../_build/webpack.config");

module.exports = createDemoWebpackConfig({
  demoDir: __dirname,
  outputName: "temporal-continue-as-new"
});
