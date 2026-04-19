const createDemoWebpackConfig = require("../_build/webpack.config");

module.exports = createDemoWebpackConfig({
  demoDir: __dirname,
  outputName: "ecommerce-versioned",
  include: [
    "../workflow-versioning-demo/src",
    "../workflow-ecommerce-v1_0/src",
    "../workflow-ecommerce-v1_1/src",
    "../workflow-ecommerce-v2_0/src"
  ]
});
