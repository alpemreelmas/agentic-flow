// Tiny template layer for the design's Tailwind markup. Every interpolated string is escaped;
// DOM nodes (e.g. sanitized markdown from markdown.ts) are spliced in through slots, never as HTML text.
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

type Val = string | number | boolean | null | undefined | Node | Val[];

export function html(strings: TemplateStringsArray, ...vals: Val[]): HTMLElement {
  const nodes: Node[] = [];
  const part = (v: Val): string => {
    if (v == null || v === false || v === true) return "";
    if (Array.isArray(v)) return v.map(part).join("");
    if (v instanceof Node) {
      nodes.push(v);
      // Unlike <slot>, <template> survives the HTML parser inside <select> and tables.
      return `<template data-n="${nodes.length - 1}"></template>`;
    }
    return esc(String(v));
  };
  const src = strings.reduce((acc, s, i) => acc + s + (i < vals.length ? part(vals[i]) : ""), "");
  const t = document.createElement("template");
  t.innerHTML = src.trim();
  for (const slot of [...t.content.querySelectorAll("template[data-n]")]) {
    slot.replaceWith(nodes[Number((slot as HTMLElement).dataset.n)]);
  }
  return t.content.firstElementChild as HTMLElement;
}

// Click actions: markup says data-act="name", pages register handlers once.
const actions = new Map<string, (el: HTMLElement) => void>();
export function act(name: string, fn: (el: HTMLElement) => void) { actions.set(name, fn); }
document.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (t) {
    e.preventDefault();
    actions.get(t.dataset.act!)?.(t);
  }
});
