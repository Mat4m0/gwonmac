import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMarkdown } from "../../src/shared/launcher-markdown.js";

const resolvers = {
  link: (href: string) => href.startsWith("https://") || href.startsWith("settings:") ? `link:${href}` : null,
  image: (src: string) => src.startsWith("/docs/") ? `bundle${src}` : null,
};

describe("launcher markdown", () => {
  it("projects the website's guide syntax into blocks and keeps unknown links as text", () => {
    const blocks = parseMarkdown([
      "## Report a problem",
      "Press <kbd>⌘</kbd> and **Reload**, see [Discord](https://discord.gg/x) or [here]($docs/x){target=\"_blank\"}.",
      "Raise :setting[Render quality]{to=\"game/renderScale\"} first.",
      "1. First",
      "2. Second",
      "| Login | Works |",
      "| ----- | ----- |",
      "| **Steam** | Yes |",
      "::note{icon=\"lucide:info\"}",
      "Linking needs an account.",
      "::",
      "![A window](/docs/a.webp)",
      "![Remote](https://example.com/a.png)",
    ].join("\n"), resolvers);

    assert.deepEqual(blocks, [
      { type: "heading", text: "Report a problem", anchor: "report-a-problem" },
      { type: "paragraph", content: [
        { text: "Press " }, { text: "⌘", emphasis: "kbd" }, { text: " and " }, { text: "Reload", emphasis: "strong" },
        { text: ", see " }, { text: "Discord", actionId: "link:https://discord.gg/x" }, { text: " or " }, { text: "here" }, { text: ". Raise " },
        { text: "Render quality", actionId: "link:settings:game/renderScale" }, { text: " first." },
      ] },
      { type: "list", ordered: true, items: [[{ text: "First" }], [{ text: "Second" }]] },
      { type: "table", head: [[{ text: "Login" }], [{ text: "Works" }]], rows: [[[{ text: "Steam", emphasis: "strong" }], [{ text: "Yes" }]]] },
      { type: "note", content: [{ text: "Linking needs an account." }] },
      { type: "image", src: "bundle/docs/a.webp", alt: "A window" },
    ]);
  });
});
