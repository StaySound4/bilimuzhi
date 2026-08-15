import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      ".agents/**",
      ".codex/**",
      ".scratch/**",
      ".trellis/**",
      ".workflow/**",
      "coverage/**",
      "dist/**",
      "docs/**",
      "legacy/**",
      "node_modules/**",
      "release/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        document: "readonly",
        Event: "readonly",
        location: "readonly",
        process: "readonly",
        URL: "readonly",
        window: "readonly",
      },
    },
    rules: {
      // Playwright 脚本的 page.evaluate 回调在浏览器上下文运行，
      // 「先赋值再读取」的模式会被静态分析误判为无用赋值。
      "no-useless-assignment": "off",
    },
  },
];
