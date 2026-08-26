/**
 * Owns the optional Tools stylesheet for a Tools-capable renderer. Core never
 * imports this module and therefore never requests or parses the stylesheet.
 */
let stylesheet: HTMLLinkElement | null = null;

export function ensureToolsStylesheet(document: Document): void {
  if (stylesheet?.isConnected) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "tools/tools-app.css";
  link.dataset.gwonmacToolsStylesheet = "true";
  document.head.append(link);
  stylesheet = link;
}
