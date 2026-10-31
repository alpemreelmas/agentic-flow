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

/** A <select> built through the DOM: the HTML parser drops the template's <slot> markers inside a select. */
export function selectEl(cls: string, opts: { value: string; label: string; title?: string }[], value: string, attrs: Record<string, string> = {}): HTMLSelectElement {
  const sel = document.createElement("select");
  sel.className = cls;
  for (const [k, v] of Object.entries(attrs)) sel.setAttribute(k, v);
  for (const o of opts) {
    const op = document.createElement("option");
    op.textContent = o.label;
    op.value = o.value;
    if (o.title) op.title = o.title;
    sel.append(op);
  }
  sel.value = value;
  return sel;
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
