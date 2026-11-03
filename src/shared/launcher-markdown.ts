/**
 * Projects the small Markdown subset the website writes for players into
 * presentation blocks, for the launcher's news articles and its bundled Guide.
 *
 * It renders nothing and trusts no address: every link and image goes through
 * the caller's resolver, which returns an opaque action ID or a safe image
 * source, or null to show plain text instead. Anything outside the subset stays
 * readable text, never markup.
 */
export type MarkdownInline = Readonly<{
  text: string;
  emphasis?: "strong" | "code" | "kbd";
  actionId?: string;
}>;
export type MarkdownBlock =
  | Readonly<{ type: "paragraph"; content: readonly MarkdownInline[] }>
  | Readonly<{ type: "heading"; text: string; level?: 3; anchor?: string }>
  | Readonly<{ type: "list"; items: readonly (readonly MarkdownInline[])[]; ordered?: true }>
  | Readonly<{ type: "image"; src: string; alt: string }>
  | Readonly<{ type: "table"; head: readonly (readonly MarkdownInline[])[]; rows: readonly (readonly (readonly MarkdownInline[])[])[] }>
  | Readonly<{ type: "note"; content: readonly MarkdownInline[] }>
  /** A screenshot or video still to be made; the text says what it should show. */
  | Readonly<{ type: "placeholder"; media: "image" | "video"; content: readonly MarkdownInline[] }>;

export interface MarkdownResolvers {
  /** An action ID for the link's target, or null to show its text only. */
  readonly link: (href: string) => string | null;
  /** A displayable image source, or null to drop the image. */
  readonly image: (src: string) => string | null;
}

const BLOCK_START = /^(#{2,3} |- |\d+\. |!\[|\||::)/u;

/** The anchor the website gives a heading, so `#reporting-a-problem` links keep working. */
export function headingAnchor(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/gu, "-");
}

export function markdownInline(source: string, resolvers: MarkdownResolvers): readonly MarkdownInline[] {
  const parts: MarkdownInline[] = [];
  // `:setting[Label]{to="section/control"}` is the website's inline component for a
  // setting; it reaches the resolver as a `settings:` link.
  const expression = /(!?\[([^\]]*)\]\(([^)]+)\)(?:\{[^}]*\})?|:setting\[([^\]]+)\]\{to="([^"]+)"\}|\*\*([^*]+)\*\*|`([^`]+)`|<kbd>([^<]+)<\/kbd>)/gu;
  let cursor = 0;
  for (const match of source.matchAll(expression)) {
    const start = match.index ?? 0;
    if (start > cursor) parts.push({ text: source.slice(cursor, start) });
    const link = (text: string, href: string) => {
      const actionId = resolvers.link(href);
      parts.push(actionId ? { text, actionId } : { text });
    };
    if (match[1]?.startsWith("!")) parts.push({ text: match[2] || "Image" });
    else if (match[2] !== undefined) link(match[2], match[3]!);
    else if (match[4] !== undefined) link(match[4], `settings:${match[5]}`);
    else if (match[6] !== undefined) parts.push({ text: match[6], emphasis: "strong" });
    else if (match[7] !== undefined) parts.push({ text: match[7], emphasis: "code" });
    else if (match[8] !== undefined) parts.push({ text: match[8], emphasis: "kbd" });
    cursor = start + match[0].length;
  }
  if (cursor < source.length) parts.push({ text: source.slice(cursor) });
  return parts;
}

const cells = (line: string): string[] => line.replace(/^\||\|$/gu, "").split("|").map((cell) => cell.trim());

export function parseMarkdown(body: string, resolvers: MarkdownResolvers, maxBlocks = 80): readonly MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = body.replace(/\r/gu, "").split("\n");
  const at = (index: number) => lines[index]?.trim() ?? "";
  const inline = (source: string) => markdownInline(source, resolvers);
  for (let index = 0; index < lines.length;) {
    const line = at(index);
    if (!line) { index += 1; continue; }
    const image = /^!\[([^\]]*)\]\(([^)]+)\)$/u.exec(line);
    if (image) {
      const src = resolvers.image(image[2]!);
      if (src) blocks.push({ type: "image", src, alt: image[1]! });
      index += 1;
      continue;
    }
    const heading = /^(#{2,3}) (.+)$/u.exec(line);
    if (heading) {
      const text = heading[2]!;
      blocks.push(heading[1] === "###" ? { type: "heading", text, level: 3, anchor: headingAnchor(text) } : { type: "heading", text, anchor: headingAnchor(text) });
      index += 1;
      continue;
    }
    const list = /^(- |\d+\. )/u.exec(line);
    if (list) {
      const ordered = list[1] !== "- ";
      const marker = ordered ? /^\d+\. / : /^- /;
      const items: (readonly MarkdownInline[])[] = [];
      while (marker.test(at(index))) {
        items.push(inline(at(index).replace(marker, "")));
        index += 1;
      }
      blocks.push(ordered ? { type: "list", items, ordered: true } : { type: "list", items });
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (at(index).startsWith("|")) {
        if (!/^\|[\s|:-]+\|$/u.test(at(index))) rows.push(cells(at(index)));
        index += 1;
      }
      const [head = [], ...rest] = rows;
      blocks.push({ type: "table", head: head.map(inline), rows: rest.map((row) => row.map(inline)) });
      continue;
    }
    if (line.startsWith("::")) {
      // A website block (`::note … ::`, `::media-placeholder{type="video"} … ::`): its text becomes one block.
      const placeholder = /^::media-placeholder(?:\{[^}]*type="(image|video)"[^}]*\})?/u.exec(line);
      const content: string[] = [];
      index += 1;
      while (index < lines.length && at(index) !== "::") {
        if (at(index)) content.push(at(index));
        index += 1;
      }
      index += 1;
      if (!content.length) continue;
      blocks.push(placeholder
        ? { type: "placeholder", media: placeholder[1] === "video" ? "video" : "image", content: inline(content.join(" ")) }
        : { type: "note", content: inline(content.join(" ")) });
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && at(index) && !BLOCK_START.test(at(index))) {
      paragraph.push(at(index));
      index += 1;
    }
    blocks.push({ type: "paragraph", content: inline(paragraph.join(" ")) });
  }
  return blocks.slice(0, maxBlocks);
}
