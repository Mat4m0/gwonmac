// Fails when a Markdown link points at a repository path that does not exist.
//
// Scope is deliberately narrow: local file targets only. External URLs are not
// fetched, and in-document anchors are not resolved. Only files git knows about
// are read, so gitignored scratch (plans/, build output, worktrees) is skipped
// without maintaining a second ignore list.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Markdown files tracked by git, plus new ones that are not gitignored.
 * A file deleted but not yet staged is still cached, so existence is checked
 * here: without it the whole run dies on ENOENT and reports nothing, exactly
 * when a deletion has just broken links elsewhere.
 */
export function listMarkdownFiles(root = repoRoot) {
  return listRepositoryFiles(root)
    .filter((file) => file.endsWith(".md"))
    .filter((file) => existsSync(join(root, file)))
    .sort();
}

/** Every path that will exist after this working tree is committed. */
export function listRepositoryFiles(root = repoRoot) {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return [...new Set(out.split("\0").filter(Boolean))].sort();
}

/** True for targets we do not resolve on disk: URLs, mailto:, bare anchors. */
function isExternal(target) {
  return (
    target === "" ||
    target.startsWith("#") ||
    target.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(target)
  );
}

function stripCodeSpans(line) {
  return line.replace(/`[^`]*`/g, (span) => " ".repeat(span.length));
}

// A CommonMark inline destination is either angle-bracketed or space-free, and
// is followed by an optional title and the closing paren. Anchoring on that
// paren keeps prose like `[b](my doc.md)` — not a link — out of the results.
// Matching the destination alone rather than label-and-destination is what
// makes a badge, `[![alt](img.svg)](doc.md)`, yield both targets: consuming the
// label would swallow the inner image and hide the outer link.
const INLINE_DESTINATION = /\]\(\s*(<[^>]*>|[^\s()]+)\s*(?:"[^"]*"|'[^']*')?\s*\)/g;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/;
const HTML_ATTRIBUTE = /\b(?:href|src)\s*=\s*("[^"]*"|'[^']*')/gi;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * Every local link target in one Markdown document.
 * @returns {{ line: number, target: string }[]}
 */
export function extractLocalTargets(source) {
  const found = [];
  let fence = null;

  source.split(/\r?\n/).forEach((rawLine, index) => {
    const fenceMatch = FENCE.exec(rawLine);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) {
        fence = marker[0];
        return;
      }
      if (marker[0] === fence) fence = null;
      return;
    }
    if (fence !== null) return;

    const line = stripCodeSpans(rawLine);
    const raw = [];

    const definition = REFERENCE_DEFINITION.exec(line);
    if (definition) raw.push(definition[1]);

    for (const match of line.matchAll(INLINE_DESTINATION)) raw.push(match[1]);
    for (const match of line.matchAll(HTML_ATTRIBUTE)) raw.push(match[1].slice(1, -1));

    for (const candidate of raw) {
      const target = candidate.startsWith("<") ? candidate.slice(1, -1).trim() : candidate;
      const path = target.split("#")[0].split("?")[0].trim();
      if (isExternal(path)) continue;
      found.push({ line: index + 1, target: path });
    }
  });

  return found;
}

function decode(target) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

/**
 * @returns {{ file: string, line: number, target: string }[]} broken links
 */
export function findBrokenLinks(root = repoRoot, files = listMarkdownFiles(root)) {
  const broken = [];
  let repositoryFiles = null;
  try {
    repositoryFiles = new Set(listRepositoryFiles(root));
  } catch {
    // Parser-focused fixtures may not be Git repositories. The production
    // entry point always is; those fixtures still get containment/existence
    // checks, while repository-membership behavior has Git-backed tests below.
  }
  const absoluteRoot = resolve(root);
  const canonicalRoot = realpathSync(absoluteRoot);
  const containedBy = (owner, candidate) => {
    const path = relative(owner, candidate);
    return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
  };
  for (const file of files) {
    const source = readFileSync(join(root, file), "utf8");
    for (const { line, target } of extractLocalTargets(source)) {
      const decoded = decode(target);
      // A leading slash means the repository root, not the filesystem root.
      const resolved = decoded.startsWith("/")
        ? join(root, decoded)
        : resolve(root, dirname(file), decoded);
      let valid = containedBy(absoluteRoot, resolved) && existsSync(resolved);
      if (valid) {
        const canonicalTarget = realpathSync(resolved);
        valid = containedBy(canonicalRoot, canonicalTarget);
      }
      if (valid && repositoryFiles) {
        const repositoryPath = relative(root, resolved).split(sep).join("/");
        const targetStat = statSync(resolved);
        valid = targetStat.isDirectory()
          ? repositoryPath === ""
            || [...repositoryFiles].some((known) =>
              known.startsWith(`${repositoryPath}/`))
          : repositoryFiles.has(repositoryPath);
      }
      if (!valid) broken.push({ file, line, target });
    }
  }
  return broken;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // The optional argument exists so the policy test can run this exact entry
  // point against a fixture repository instead of the working tree.
  const broken = findBrokenLinks(process.argv[2] ? resolve(process.argv[2]) : repoRoot);
  for (const { file, line, target } of broken) {
    process.stderr.write(`${file}:${line}: missing link target ${target}\n`);
  }
  if (broken.length > 0) {
    process.stderr.write(`\n${broken.length} broken markdown link(s).\n`);
    process.exit(1);
  }
}
