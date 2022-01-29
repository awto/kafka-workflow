module.exports = require("@effectful/kafka-workflow/webpack-config-ts")(
  __dirname + "/src/index.ts",
  __dirname + "../../../../resources/static/built/ecommerce"
);
