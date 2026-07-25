import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

// P0.2 — each boundary is one regular expression, so every spelling that
// resolves across it is rejected rather than only the shortest one:
// `../paths.js`, `../../main/paths.js` and `../../../src/main/paths.js` all
// name the same file. `no-restricted-imports` sees static imports and
// `export ... from`; `no-restricted-syntax` covers dynamic `import()` and
// `require()`, which that rule does not see.

// Leaving src/main/core: a bare upward file, two or more levels up unless the
// target is src/shared, or any spelling that names src/main. src/main/core has
// no subdirectories today; if one is added, `../sibling.js` inside it trips the
// first alternative. Widen this deliberately then — never disable it.
const OUT_OF_CORE = String.raw`^\.\./[^/]+$|^(?!(?:\.\./)+shared/)(?:\.\./){2,}|(?:^|/)(?:\.\.|src)/main/`;
const INTO_MAIN = String.raw`(?:^|/)(?:\.\.|src)/main/`;
const INTO_APP = String.raw`(?:^|/)(?:\.\.|src)/(?:main|renderer|preload)/`;
const ELECTRON = String.raw`^electron(/|$)`;

/** esquery reads `/.../` inside an attribute value, so its slashes need escaping. */
const selectorRegex = (pattern) => `/${pattern.replaceAll("/", "\\/")}/`;
const dynamicImport = (pattern) => `ImportExpression[source.value=${selectorRegex(pattern)}]`;

const NO_ELECTRON =
  "src/main/core/** must stay Electron-free. Keep Electron behind src/main/*.ts.";
const NO_UPWARD =
  "src/main/core/** must not import upward out of src/main/core. Invert the dependency.";
const NO_MAIN_FROM_RENDERER =
  "src/renderer/** must not import from src/main/**. Cross the boundary through the preload bridge or src/shared/**.";
const WEBSITE_SHARED_ONLY = "apps/website/** may only reach into src/shared/**.";

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
            { regex: ELECTRON, message: NO_ELECTRON },
            { regex: OUT_OF_CORE, message: NO_UPWARD },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: dynamicImport(ELECTRON), message: NO_ELECTRON },
        {
          selector: `CallExpression[callee.name="require"][arguments.0.value=${selectorRegex(ELECTRON)}]`,
          message: NO_ELECTRON,
        },
        {
          selector: `CallExpression[callee.callee.name="createRequire"][arguments.0.value=${selectorRegex(ELECTRON)}]`,
          message: NO_ELECTRON,
        },
        { selector: dynamicImport(OUT_OF_CORE), message: NO_UPWARD },
      ],
    },
  },
  {
    // P0.2 — the renderer owns presentation and the game host; it never reaches
    // into the main process. Every renderer source extension, not only .js:
    // src/renderer/gw-native.d.ts is a real tracked file.
    files: ["src/renderer/**/*.{js,mjs,cjs,ts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ regex: INTO_MAIN, message: NO_MAIN_FROM_RENDERER }] },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: dynamicImport(INTO_MAIN), message: NO_MAIN_FROM_RENDERER },
      ],
    },
  },
  {
    // P0.2 — the website may read canonical contracts, never main-process code.
    // The nine .vue SFCs are outside every ESLint config (P0.3 deferred the Vue
    // parser); tests/policy/import-boundaries.test.mjs scans them instead.
    files: ["apps/website/**/*.{js,mjs,ts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ regex: INTO_APP, message: WEBSITE_SHARED_ONLY }] },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: dynamicImport(INTO_APP), message: WEBSITE_SHARED_ONLY },
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
