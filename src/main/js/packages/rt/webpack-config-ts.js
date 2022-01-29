const path = require("path");
const webpack = require("webpack");
module.exports = function (entry = "./src/index.ts", output = "dist") {
  const ext = path.extname(entry);
  return {
    entry,
    mode: "development",
    devtool: false,
    output: {
      path: output,
      filename: `${path.basename(entry, ext)}.js`,
      chunkFormat: "array-push",
      library: {
        name: "efwf$module",
        type: "assign"
      }
    },
    target: "es6",
    module: {
      rules: [
        {
          test: /\.[tj]s$/, // Check for all js files
          loader: "babel-loader",
          options: {
            presets: [
              {
                plugins: [require.resolve("@babel/plugin-transform-typescript")]
              },
              {
                plugins: [require.resolve("./transform")]
              }
            ],
            passPerPreset: true
          },
          include: /src/
        }
      ]
    },
    plugins: [
      new webpack.DefinePlugin({
        "process.env.EFFECTFUL_KAFKA_WORKFLOW_MOCK": JSON.stringify(
          process.env.EFFECTFUL_KAFKA_WORKFLOW_MOCK
        )
      })
    ]
  };
};
