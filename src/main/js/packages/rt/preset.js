module.exports = (_babel, opts) => ({
  presets: [
    {
      plugins: [[require.resolve("./transform"), opts]]
    }
  ],
  passPerPreset: true
});
