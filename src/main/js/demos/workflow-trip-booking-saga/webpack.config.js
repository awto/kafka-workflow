const createDemoWebpackConfig = require("../_build/webpack.config");

module.exports = createDemoWebpackConfig({
  demoDir: __dirname,
  outputName: "trip-booking-saga"
});
