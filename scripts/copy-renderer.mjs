import fs from "node:fs";
import path from "node:path";

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

const ART_CREDIT =
  'Screenshots by <a href="https://bloogum.net/guildwars/">Snapshot Henchman</a>';

const src = path.resolve("src/renderer");
const dest = path.resolve("build/renderer");
fs.rmSync(dest, { recursive: true, force: true });
copyDir(src, dest);

const imagesDir = path.join(dest, "images");
if (fs.existsSync(imagesDir)) {
  const names = fs.readdirSync(imagesDir).filter((n) => !n.startsWith("."));
  fs.writeFileSync(
    path.join(imagesDir, "index.json"),
    JSON.stringify({
      logo: names.includes("logo.webp") ? "images/logo.webp" : null,
      backgrounds: names.filter((n) => n.startsWith("bg")).map((n) => `images/${n}`),
      credit: ART_CREDIT,
    }),
  );
}

// Sandboxed preload is CommonJS and is not emitted by tsc (package is ESM).
fs.mkdirSync(path.resolve("build/preload"), { recursive: true });
fs.copyFileSync(
  path.resolve("src/preload/preload.cjs"),
  path.resolve("build/preload/preload.cjs"),
);

console.log(`copied renderer -> ${dest}`);
console.log("copied preload.cjs -> build/preload/preload.cjs");
