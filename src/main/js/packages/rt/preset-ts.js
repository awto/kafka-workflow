module.exports = (_babel, opts) => ({
  presets: [
    {
      plugins: [require.resolve("@babel/plugin-transform-typescript")]
    },
    {
      plugins: [[require.resolve("./transform"),opts]]
    }
  ],
  passPerPreset: true
});
