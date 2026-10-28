// Renders agent output as markdown. That text is untrusted, and this webview can call Tauri
// commands (e.g. write_entry edits role files), so an HTML injection here would be a real hole:
//  1. markdown-it runs with html:false, so raw HTML in the text is escaped, not interpreted;
//  2. DOMPurify then enforces a tag/attribute/URL allowlist on what markdown-it produced;
//  3. the result is appended as a DOM fragment, never assigned through innerHTML.
import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: true, breaks: true }); // breaks: agents use single newlines

const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "del", "code", "pre", "blockquote", "hr", "a",
  "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tr", "th", "td",
];

export function markdownEl(text: string, cls = ""): HTMLElement {
  const box = document.createElement("div");
  box.className = `md ${cls}`.trim();
  box.append(
    DOMPurify.sanitize(md.render(text), {
      ALLOWED_TAGS,
      ALLOWED_ATTR: ["href"],
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
      RETURN_DOM_FRAGMENT: true,
    }),
  );
  for (const a of box.querySelectorAll("a")) {
    a.title = a.getAttribute("href") ?? "";
    a.addEventListener("click", (e) => e.preventDefault()); // a click must never navigate the app window
  }
  return box;
}
