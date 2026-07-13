export default [
  {
    ignores: ["dist", "node_modules"],
  },
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
    },
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // Add more specific rules if using a full flat config,
      // but keeping it simple for the foundation setup.
    },
  },
];
