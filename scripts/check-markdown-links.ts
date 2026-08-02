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

// Documents under the website's content directory link in site-route terms:
// absolute asset paths are served from the site's public/ directory.
const WEBSITE_CONTENT = "apps/website/content/";
const WEBSITE_PUBLIC = "apps/website/public";

/** One local link target, and the line of its document that carries it. */
export type LocalTarget = { line: number; target: string };

/** A `LocalTarget` that resolved to nothing, named by the document holding it. */
export type BrokenLink = LocalTarget & { file: string };

/**
 * Markdown files tracked by git, plus new ones that are not gitignored.
 * A file deleted but not yet staged is still cached, so existence is checked
 * here: without it the whole run dies on ENOENT and reports nothing, exactly
 * when a deletion has just broken links elsewhere.
 */
export function listMarkdownFiles(root = repoRoot): string[] {
  return listRepositoryFiles(root)
    .filter((file) => file.endsWith(".md"))
    .filter((file) => existsSync(join(root, file)))
    .sort();
}

/** Every path that will exist after this working tree is committed. */
export function listRepositoryFiles(root = repoRoot): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return [...new Set(out.split("\0").filter(Boolean))].sort();
}

/** True for targets we do not resolve on disk: URLs, mailto:, bare anchors. */
function isExternal(target: string): boolean {
  return (
    target === "" ||
    target.startsWith("#") ||
    target.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(target)
  );
}

function stripCodeSpans(line: string): string {
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

/** Every local link target in one Markdown document. */
export function extractLocalTargets(source: string): LocalTarget[] {
  const found: LocalTarget[] = [];
  /** The fence character an open fence was opened with. */
  let fence: string | null = null;

  source.split(/\r?\n/).forEach((rawLine, index) => {
    // The character this line opens or closes a fence with, when it is a fence
    // line at all. Every capture group in the patterns here is mandatory, so a
    // match always carries one; reading them through optional chaining states
    // that as a check the reader can follow rather than as an assertion.
    const marker = FENCE.exec(rawLine)?.[1]?.charAt(0);
    if (marker !== undefined) {
      if (fence === null) {
        fence = marker;
        return;
      }
      if (marker === fence) fence = null;
      return;
    }
    if (fence !== null) return;

    const line = stripCodeSpans(rawLine);
    const raw: string[] = [];

    const definition = REFERENCE_DEFINITION.exec(line)?.[1];
    if (definition !== undefined) raw.push(definition);

    for (const match of line.matchAll(INLINE_DESTINATION)) {
      if (match[1] !== undefined) raw.push(match[1]);
    }
    for (const match of line.matchAll(HTML_ATTRIBUTE)) {
      if (match[1] !== undefined) raw.push(match[1].slice(1, -1));
    }

    for (const candidate of raw) {
      const target = candidate.startsWith("<") ? candidate.slice(1, -1).trim() : candidate;
      // `split` always yields a first element; the defaults are what the index
      // signature needs, and an empty destination is external either way.
      const [beforeAnchor = ""] = target.split("#");
      const [beforeQuery = ""] = beforeAnchor.split("?");
      const path = beforeQuery.trim();
      if (isExternal(path)) continue;
      found.push({ line: index + 1, target: path });
    }
  });

  return found;
}

function decode(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

/** Every link in `files` that resolves to nothing this repository will keep. */
export function findBrokenLinks(
  root = repoRoot,
  files: readonly string[] = listMarkdownFiles(root),
): BrokenLink[] {
  const broken: BrokenLink[] = [];
  let repositoryFiles: ReadonlySet<string> | null = null;
  try {
    repositoryFiles = new Set(listRepositoryFiles(root));
  } catch {
    // Parser-focused fixtures may not be Git repositories. The production
    // entry point always is; those fixtures still get containment/existence
    // checks, while repository-membership behavior has Git-backed tests below.
  }
  const absoluteRoot = resolve(root);
  const canonicalRoot = realpathSync(absoluteRoot);
  const containedBy = (owner: string, candidate: string): boolean => {
    const path = relative(owner, candidate);
    return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
  };
  for (const file of files) {
    const source = readFileSync(join(root, file), "utf8");
    const websiteContent = file.startsWith(WEBSITE_CONTENT);
    for (const { line, target } of extractLocalTargets(source)) {
      const decoded = decode(target);
      if (websiteContent) {
        // Website content links use site-route semantics, not repository
        // paths: `$docs/...` aliases and extensionless routes (`/blog`) are
        // resolved by the site's router. Asset links stay checkable — the
        // site serves absolute paths from its public/ directory.
        if (decoded.startsWith("$")) continue;
        if (decoded.startsWith("/") && !/\.[a-z0-9]+$/i.test(decoded)) continue;
      }
      // A leading slash means the repository root, not the filesystem root.
      const resolved = decoded.startsWith("/")
        ? join(root, websiteContent ? WEBSITE_PUBLIC : ".", decoded)
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
