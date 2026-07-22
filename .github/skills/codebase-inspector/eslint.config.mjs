import js from "@eslint/js";

export default [
  { ignores: ["node_modules/**", "tests/tmp/**"] },
  js.configs.recommended,
  {
    files: ["**/*.mjs", "**/*.cjs"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { console: "readonly", process: "readonly", Buffer: "readonly" } },
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_" }] }
  }
];
