import eslint from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import tseslint from "typescript-eslint";
import vueParser from "vue-eslint-parser";

// Each boundary is one regular expression, so every spelling that
// resolves across it is rejected rather than only the shortest one:
// `../paths.js`, `../../main/paths.js` and `../../../src/main/paths.js` all
// name the same file. `no-restricted-imports` sees static imports and
// `export ... from`; `no-restricted-syntax` covers every other way to name a
// module, and it keys on the specifier rather than on the call shape.

// Leaving src/main/core: anything that climbs out of it, unless the leading
// `../` run lands in src/shared — plus any spelling that names src/main from
// further away. Enumerating the shapes of an upward specifier (a bare file, two
// levels up) missed `../services/registry.js`, which leaves core just as surely;
// "climbs out and is not src/shared" is the property, and it is shorter.
// The exemption is `../../shared/` and deeper: from anywhere in src/main/core
// the real src/shared is at least two levels up, so a single-level `../shared/`
// is src/main/shared — upward, and rejected. Two is the minimum true depth, not
// the exact one: a pattern sees the specifier and not the importing file, so
// from a hypothetical src/main/core/sub/ the same `../../shared/` would name
// src/main/shared and pass. src/main/core has no subdirectory today; expressing
// the exact depth needs a second config block per level, which is more
// structure than the hole is worth until one exists.
const OUT_OF_CORE = String.raw`^(?!(?:\.\./){2,}shared/)\.\./|(?:^|/)(?:\.\.|src)/main/`;
// Leaving src/main/certification: the same property as OUT_OF_CORE with one
// more exemption, because the chain reads the WASM codec that stayed behind in
// src/main/core. Both exemptions name one spelling — `../core/` and
// `../../shared/` — and every other spelling of the same targets is rejected,
// exactly as OUT_OF_CORE already rejects `../../../src/shared/`. One spelling
// per allowed target is what keeps the boundary a single regular expression.
const OUT_OF_CERTIFICATION = String.raw`^(?!(?:\.\./){2,}shared/)(?!\.\./core/)\.\./|(?:^|/)(?:\.\.|src)/main/`;
// The two Electron callers, named as siblings. They are exempt from the
// Electron ban because they are the outside of the chain; importing one from
// the inside would put Electron back on the utilityProcess graph, and the
// upward ban above cannot see a sibling.
const CERTIFICATION_ELECTRON_CALLERS = String.raw`(?:^|/)(?:enhancement-policy|local-client-verifier-host)(?:\.js)?$`;
const INTO_MAIN = String.raw`(?:^|/)(?:\.\.|src)/main/`;
// Leaving apps/website: any escape into the host application's src/ other than
// src/shared. Naming main/renderer/preload alone let src/tools/** through while
// the message claimed only src/shared was reachable. The first alternative is
// anchored to a `../` run so a package whose own path contains `/src/` is not
// caught; the second keeps the original spellings rejected.
const INTO_APP = String.raw`^(?:\.\./)+src/(?!shared/)|(?:^|/)(?:\.\.|src)/(?:main|renderer|preload)/`;
const ELECTRON = String.raw`^electron(/|$)`;

/**
 * esquery reads `/.../` inside an attribute value, so its slashes need escaping.
 * @param {string} pattern
 */
const selectorRegex = (pattern) => `/${pattern.replaceAll("/", "\\/")}/`;

// Every non-static way to name a module, keyed on the specifier rather than on
// the shape of the expression around it. Keying on the callee caught
// `require("electron")` and `createRequire(url)("electron")` but not
// `const load = createRequire(url); load("electron")`, and keying on
// `source.value` missed the template-literal spelling of `import()` entirely —
// one quote character defeated the boundary. An argument value cannot be
// renamed. Applied to every boundary, so the four are provably symmetric.
/**
 * @param {string} pattern
 * @param {string} message
 */
const crossings = (pattern, message) => {
  const regex = selectorRegex(pattern);
  return [
    `ImportExpression[source.value=${regex}]`,
    `ImportExpression[source.type="TemplateLiteral"][source.quasis.0.value.raw=${regex}]`,
    `CallExpression[arguments.0.value=${regex}]`,
    `CallExpression[arguments.0.type="TemplateLiteral"][arguments.0.quasis.0.value.raw=${regex}]`,
  ].map((selector) => ({ selector, message }));
};

const NO_ELECTRON =
  "src/main/core/** must stay Electron-free. Keep Electron behind src/main/*.ts.";
const NO_ELECTRON_IN_CERTIFICATION =
  "src/main/certification/** must stay Electron-free apart from enhancement-policy.ts and local-client-verifier-host.ts. The proof runs in a utilityProcess, which has no Electron module.";
const NO_UPWARD_FROM_CERTIFICATION =
  "src/main/certification/** must not import upward out of src/main/certification, other than `../core/` and `../../shared/`. Invert the dependency.";
const NO_CERTIFICATION_ELECTRON_CALLERS =
  "src/main/certification/** must not import enhancement-policy.ts or local-client-verifier-host.ts; they are the chain's Electron callers, and the utilityProcess graph must not reach them.";
const NO_UPWARD =
  "src/main/core/** must not import upward out of src/main/core. Invert the dependency.";
const NO_MAIN_FROM_RENDERER =
  "src/renderer/** must not import from src/main/**. Cross the boundary through the preload bridge or src/shared/**.";
const APP_SHARED_ONLY = "apps/** may only reach into src/shared/**.";

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
      "**/dist/**",
      "dist-release/**",
      ".vite/**",
      "**/.nuxt/**",
      "**/.output/**",
      "playwright-report/**",
      "test-results/**",
      "tools/**",
      "*.py",
    ],
  },
  {
    // Architectural boundaries that already hold are pinned so they keep
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
        ...crossings(ELECTRON, NO_ELECTRON),
        ...crossings(OUT_OF_CORE, NO_UPWARD),
      ],
    },
  },
  {
    // The certification chain moved out of src/main/core/**, where being
    // Electron-free was a property of the directory. The verifier is forked
    // with `utilityProcess`, which runs plain Node and resolves no `electron`
    // module, so the whole graph its entry point reaches has to stay free of
    // one — and that graph is every file here but the two named below, which
    // are the Electron callers the chain is driven from.
    //
    // Banning the `electron` specifier alone would only ban the shortest route:
    // src/main/*.ts is full of Electron, so the upward ban core enforced by
    // being a directory has to be spelled out here, and the two exempt siblings
    // have to be unreachable from the inside. Those three together are what
    // makes "Electron-free" a property of the graph rather than of one line.
    files: ["src/main/certification/**/*.ts"],
    ignores: [
      "src/main/certification/enhancement-policy.ts",
      "src/main/certification/local-client-verifier-host.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { regex: ELECTRON, message: NO_ELECTRON_IN_CERTIFICATION },
            { regex: OUT_OF_CERTIFICATION, message: NO_UPWARD_FROM_CERTIFICATION },
            {
              regex: CERTIFICATION_ELECTRON_CALLERS,
              message: NO_CERTIFICATION_ELECTRON_CALLERS,
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...crossings(ELECTRON, NO_ELECTRON_IN_CERTIFICATION),
        ...crossings(OUT_OF_CERTIFICATION, NO_UPWARD_FROM_CERTIFICATION),
        ...crossings(
          CERTIFICATION_ELECTRON_CALLERS,
          NO_CERTIFICATION_ELECTRON_CALLERS,
        ),
      ],
    },
  },
  {
    // The renderer owns presentation and the game host; it never reaches
    // into the main process. Every renderer source extension, not only .js:
    // src/renderer/gw-native.d.ts is a real tracked file.
    files: ["src/renderer/**/*.{js,mjs,cjs,ts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ regex: INTO_MAIN, message: NO_MAIN_FROM_RENDERER }] },
      ],
      "no-restricted-syntax": ["error", ...crossings(INTO_MAIN, NO_MAIN_FROM_RENDERER)],
    },
  },
  // Use `flat/essential` only: the rules that catch errors. `flat/recommended`
  // adds 96 attribute-line-break opinions, and nothing else in this repository
  // enforces formatting, so adopting them would be churn rather than coverage.
  ...pluginVue.configs["flat/essential"],
  {
    // The .vue SFCs are most of the website (9 files against 4 .ts), so
    // leaving them unparsed left the website boundary below unenforced exactly
    // where the code is. vue-eslint-parser reads the SFC; its inner parser
    // reads `<script setup lang="ts">`.
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tseslint.parser, ecmaVersion: "latest", sourceType: "module" },
    },
    rules: {
      // Nuxt auto-imports (`useSeoMeta`, `useHead`, …) have no import statement,
      // so ESLint sees every one as undefined. `pnpm test:website` runs
      // `nuxt typecheck`, which resolves them properly and is the real oracle —
      // this would be a second, worse one. Same reasoning typescript-eslint
      // gives for disabling no-undef on TypeScript sources.
      "no-undef": "off",
      // Pages and layouts are named by their route, which is a Nuxt convention.
      "vue/multi-word-component-names": "off",
    },
  },
  {
    // The website may read canonical contracts, never main-process code.
    files: ["apps/{website,tools,launcher-prototype}/**/*.{js,mjs,ts,vue}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ regex: INTO_APP, message: APP_SHARED_ONLY }] },
      ],
      "no-restricted-syntax": ["error", ...crossings(INTO_APP, APP_SHARED_ONLY)],
    },
  },
  {
    // forge.config.ts used to be excluded from linting entirely.
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
    // The converted renderer, held to the same two rules as src/main,
    // src/shared and src/tools — `consistent-type-imports` most of all, since a
    // renderer module that imports a contract for its type alone must emit no
    // runtime import: build/renderer is served over gw://app and nothing there
    // resolves src/shared. No `projectService` here: the renderer's program is
    // tsconfig.renderer.json, which the service does not reach from the root
    // tsconfig.json, and neither rule needs type information.
    files: ["src/renderer/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    // This one shared behavior is intentionally browser-only: both the native
    // Settings surface and the Tools Vue app import it. The main-process
    // project excludes it because that program has no DOM library, and these
    // rules do not need type information.
    files: ["src/shared/ui/resize.ts"],
    languageOptions: {
      parserOptions: { projectService: false },
    },
  },
  {
    // The five page singletons index.html loads with a `<script>` tag, listed
    // rather than globbed because being a classic script is a property of these
    // files and not of a directory. A classic script is exactly a file with no
    // top-level `import` or `export`: one of either makes it an ES module, and
    // `harness.ts`'s `var Module` then stops being the global binding the
    // generated glue redeclares (AGENTS.md, "Load-bearing constraints"). So the
    // two rules that would forbid what that costs are relaxed here, and only
    // here:
    //   - `no-var`, which typescript-eslint turns on for every `.ts`, is what
    //     the redeclaration needs;
    //   - `import()` type annotations are the only way left to name a contract,
    //     since `import type` is still a top-level import statement. `prefer`
    //     stays on, so a *value* import is still required to be a type import
    //     where one belongs.
    files: [
      "src/renderer/commands.ts",
      "src/renderer/diagnostics.ts",
      "src/renderer/harness.ts",
      "src/renderer/loading.ts",
      "src/renderer/settings.ts",
    ],
    rules: {
      "no-var": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { disallowTypeAnnotations: false },
      ],
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
    files: ["tests/**/*.{js,mjs}", "scripts/**/*.mjs", "apps/website/scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        TextEncoder: "readonly",
        // Browser globals: these files write `page.evaluate` bodies, whose
        // source lives here but whose execution is in the page.
        window: "readonly",
        document: "readonly",
        getComputedStyle: "readonly",
        performance: "readonly",
        WebAssembly: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
);
