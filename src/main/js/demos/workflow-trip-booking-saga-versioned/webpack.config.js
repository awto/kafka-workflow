const createDemoWebpackConfig = require("../_build/webpack.config");

module.exports = createDemoWebpackConfig({
  demoDir: __dirname,
  outputName: "trip-booking-saga-versioned",
  include: [
    "../workflow-versioning-demo/src",
    "../workflow-trip-booking-saga-v1_0/src",
    "../workflow-trip-booking-saga-v1_1/src",
    "../workflow-trip-booking-saga-v2_0/src"
  ]
});
