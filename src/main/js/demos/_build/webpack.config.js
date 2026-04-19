const path = require("path");
const webpack = require("webpack");

function resolveInclude(demoDir, item) {
  return path.isAbsolute(item) ? item : path.join(demoDir, item);
}

function createDemoWebpackConfig({ demoDir, outputName, include = [] }) {
  return {
    entry: path.join(__dirname, "bootstrap.ts"),
    mode: "development",
    devtool: false,
    output: {
      path: path.join(__dirname, "../../../resources/static/built", outputName),
      filename: "index.js",
      chunkFormat: "array-push"
    },
    resolve: {
      alias: {
        "@effectful/kafka-workflow-demo-entry": path.join(
          demoDir,
          "src/index.ts"
        )
      },
      extensions: [".ts", ".js"],
      fallback: {
        domain: false,
        path: require.resolve("path-browserify")
      }
    },
    target: "es6",
    module: {
      rules: [
        {
          test: /\.[tj]s$/,
          include: [
            __dirname,
            path.join(demoDir, "src"),
            ...include.map((item) => resolveInclude(demoDir, item))
          ],
          loader: "babel-loader",
          options: {
            presets: [
              [
                require.resolve("@effectful/debugger/config/babel/preset-zero-config"),
                {
                  preInstrumentedLibs: true,
                  react: false,
                  rt: "@effectful/debugger/main"
                }
              ]
            ]
          }
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
}

module.exports = createDemoWebpackConfig;
