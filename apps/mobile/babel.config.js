module.exports = function (api) {
  api.cache(true);
  return {
    // unstable_transformImportMeta: some of NativeWind/react-native-css-interop's
    // dependency graph ships ESM `import.meta` references that Hermes/Metro's
    // web output can't evaluate directly ("Cannot use 'import.meta' outside a
    // module") -- this tells babel-preset-expo to transform them away.
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind", unstable_transformImportMeta: true }],
      "nativewind/babel",
    ],
  };
};
