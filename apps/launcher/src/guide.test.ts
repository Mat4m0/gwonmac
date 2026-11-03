import { describe, expect, it } from "vitest";
import { parseMarkdown } from "@shared/launcher-markdown";
import { GUIDE_PAGE_IDS, GUIDE_PAGES, guideLink, guideSource } from "./guide";

const images = import.meta.glob<string>("../../website/public/docs/**/*.{webp,png,jpg}", { query: "?url", import: "default", eager: true });

describe("guide", () => {
  it("bundles every Guide page, and each of its links and images resolves", () => {
    expect(GUIDE_PAGES.map((page) => page.id)).toEqual([...GUIDE_PAGE_IDS]);
    const broken: string[] = [];
    for (const id of GUIDE_PAGE_IDS) {
      const source = guideSource(id);
      const anchors = new Set(GUIDE_PAGES.find((page) => page.id === id)!.blocks.flatMap((block) => block.type === "heading" && block.anchor ? [block.anchor] : []));
      parseMarkdown(source.replace(/^---[\s\S]*?\n---\n/u, ""), {
        link: (href) => {
          const action = guideLink(href, id);
          const anchor = action?.startsWith(`guide:${id}#`) ? action.split("#")[1]! : null;
          if (!action || (anchor && !anchors.has(anchor))) broken.push(`${id}: ${href}`);
          return action;
        },
        image: (src) => {
          if (!images[`../../website/public${src}`]) broken.push(`${id}: ${src}`);
          return null;
        },
      }, 200);
    }
    expect(broken).toEqual([]);
  });
});
