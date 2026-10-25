import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "src/bindings"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // Browser globals that look like ordinary variables (e.g. the store's `status`).
      "no-restricted-globals": [
        "error",
        { name: "status", message: "Use the store's status (useStore), not window.status." },
        { name: "name", message: "This is window.name; use a local variable." },
        { name: "event", message: "Use the handler's event parameter." },
      ],
    },
  },
);
