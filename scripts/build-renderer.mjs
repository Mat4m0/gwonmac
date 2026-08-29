import { existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { rollup } from "rollup";

const inputs = [
  "diagnostics",
  "commands",
  "loading",
  "harness",
  "settings",
  "launcher",
].map((name) => path.resolve(`src/renderer/${name}.ts`));

/** @type {import("rollup").Plugin} */
const rendererTypescript = {
  name: "renderer-typescript",
  resolveId(source, importer) {
    if (importer === undefined || !source.startsWith(".")) return null;
    const resolved = path.resolve(path.dirname(importer), source);
    const typescriptSource = resolved.replace(/\.js$/u, ".ts");
    return existsSync(typescriptSource) ? typescriptSource : null;
  },
  transform(code, id) {
    if (!id.endsWith(".ts")) return null;
    const result = ts.transpileModule(code, {
      fileName: id,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        sourceMap: true,
      },
    });
    return { code: result.outputText, map: result.sourceMapText };
  },
};

const bundle = await rollup({ input: inputs, plugins: [rendererTypescript] });
try {
  await bundle.write({
    dir: path.resolve("build/renderer"),
    format: "es",
    preserveModules: true,
    preserveModulesRoot: path.resolve("src/renderer"),
    entryFileNames: "[name].js",
    sourcemap: true,
  });
} finally {
  await bundle.close();
}
