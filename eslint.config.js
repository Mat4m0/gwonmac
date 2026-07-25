import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "build/**",
      "out/**",
      "node_modules/**",
      "**/node_modules/**",
      ".claude/**",
      ".pnpm-store/**",
      "dist/**",
      "dist-release/**",
      ".vite/**",
      "**/.nuxt/**",
      "**/.output/**",
      "playwright-report/**",
      "test-results/**",
      "tools/**",
      "plans/**",
      "*.py",
    ],
  },
  {
    // P0.2 — architectural boundaries that already hold, pinned so they keep
    // holding. src/main/core/** has no Electron dependency and no upward
    // imports into src/main/*.ts.
    files: ["src/main/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["electron", "electron/*"],
              message:
                "src/main/core/** must stay Electron-free. Keep Electron behind src/main/*.ts.",
            },
            {
              group: ["../*.js"],
              message:
                "src/main/core/** must not import upward from src/main/*.ts. Invert the dependency.",
            },
          ],
        },
      ],
      // no-restricted-imports does not see dynamic import().
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression[source.value=/^electron(\\/|$)/]",
          message:
            "src/main/core/** must stay Electron-free. Keep Electron behind src/main/*.ts.",
        },
        {
          selector: "ImportExpression[source.value=/^\\.\\.\\/[^/]+\\.js$/]",
          message:
            "src/main/core/** must not import upward from src/main/*.ts. Invert the dependency.",
        },
      ],
    },
  },
  {
    // P0.2 — the renderer owns presentation and the game host; it never reaches
    // into the main process.
    files: ["src/renderer/**/*.js"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../main/**", "**/src/main/**"],
              message:
                "src/renderer/** must not import from src/main/**. Cross the boundary through the preload bridge or src/shared/**.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportExpression[source.value=/(^\\.\\.\\/main\\/|src\\/main\\/)/]",
          message:
            "src/renderer/** must not import from src/main/**. Cross the boundary through the preload bridge or src/shared/**.",
        },
      ],
    },
  },
  {
    // P0.2 — the website may read canonical contracts, never main-process code.
    files: ["apps/website/**/*.{js,mjs,ts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/src/main/**", "**/src/renderer/**", "**/src/preload/**"],
              message:
                "apps/website/** may only reach into src/shared/**.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportExpression[source.value=/src\\/(main|renderer|preload)\\//]",
          message: "apps/website/** may only reach into src/shared/**.",
        },
      ],
    },
  },
  {
    // P0.3 — forge.config.ts was excluded from linting entirely.
    files: ["forge.config.ts"],
    languageOptions: {
      globals: { process: "readonly" },
    },
  },
  {
    files: ["src/main/**/*.ts", "src/shared/**/*.ts", "src/tools/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["src/renderer/**/*.js"],
    languageOptions: {
      globals: {
        window: "readonly",
        performance: "readonly",
        WebAssembly: "readonly",
        document: "readonly",
        navigator: "readonly",
        location: "readonly",
        console: "readonly",
        WebGL2RenderingContext: "readonly",
        XMLHttpRequest: "readonly",
        OffscreenCanvas: "readonly",
        Image: "readonly",
        Touch: "readonly",
        TouchEvent: "readonly",
        MouseEvent: "readonly",
        Uint8Array: "readonly",
        Uint32Array: "readonly",
        ArrayBuffer: "readonly",
        DataView: "readonly",
        TextDecoder: "readonly",
        Event: "readonly",
        URL: "readonly",
        crypto: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        addEventListener: "readonly",
        fetch: "readonly",
        Module: "writable",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/preload/**/*.cjs"],
    languageOptions: {
      globals: {
        require: "readonly",
        Uint8Array: "readonly",
        atob: "readonly",
      },
      sourceType: "commonjs",
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["tests/**/*.{js,mjs}", "scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        TextEncoder: "readonly",
        window: "readonly",
        performance: "readonly",
        WebAssembly: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
);
