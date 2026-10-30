// One outline icon set, drawn inline so nothing depends on an icon font having loaded.
const PATHS = {
  overview: "M3 3h4v6H3zM9 3h4v3H9zM9 8h4v5H9zM3 11h4v2H3z",
  runs: "M4.5 3v10l8-5z",
  queue: "M3 4h10M3 8h10M3 12h6",
  chat: "M3 3.5h10v7.5H7l-3 2.5V11H3z",
  registry: "M5 2.5h6.5v11H5a1.5 1.5 0 0 1-1.5-1.5V4A1.5 1.5 0 0 1 5 2.5zM3.5 11.5A1.5 1.5 0 0 1 5 10.5h6.5M6.5 5.5h3",
  settings: "M3 5h6M12 5h1M3 11h1M7 11h6M9 3.5h3v3H9zM4 9.5h3v3H4z",
  search: "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM14 14l-3.5-3.5",
  chevron: "m4 6 4 4 4-4",
  close: "m4 4 8 8M12 4l-8 8",
  add: "M8 3v10M3 8h10",
  refresh: "M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5",
  external: "M6.5 3H3v10h10V9.5M9 3h4v4M13 3 7.5 8.5",
  play: "M5 3.5v9l7-4.5z",
  stop: "M4.5 4.5h7v7h-7z",
  restart: "M3 8a5 5 0 1 0 1.5-3.5M3 2.5V5h2.5",
  down: "M8 3v9M4 8.5l4 4 4-4",
  trash: "M3 4.5h10M6.5 4.5v-2h3v2M4.5 4.5l.5 9h6l.5-9",
  folder: "M2.5 4h4l1.5 1.5h5.5v7.5h-11z",
  check: "m3.5 8.5 3 3 6-7",
  cross: "m4.5 4.5 7 7M11.5 4.5l-7 7",
  dot: "M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  terminal: "m3.5 5 3 3-3 3M8.5 11.5h4",
  thought: "M8 2.5a4 4 0 0 0-2 7.5V12h4v-2a4 4 0 0 0-2-7.5zM6.5 14h3",
  agent: "M3.5 5.5h9v7h-9zM8 5.5v-3M6 9h.01M10 9h.01",
  list: "M6 4h7M6 8h7M6 12h7M3 4h.01M3 8h.01M3 12h.01",
  note: "M3.5 2.5h9v11h-9zM6 6h4M6 9h4",
  shield: "M8 2.5 3.5 4v4c0 3 2 4.5 4.5 5.5 2.5-1 4.5-2.5 4.5-5.5V4z",
  review: "M2.5 3.5h11v7.5H8l-2.5 2.5V11h-3zM5.5 6.5h5",
  deliver: "M5 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM5 6.5v3M5 9.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM11 9.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM11 9.5V6.5a2 2 0 0 0-2-2H8",
  warn: "M8 2.5 14 13H2zM8 6.5v3.5M8 11.5h.01",
  key: "M10 6a3 3 0 1 1-1 2.2L3 14H2v-2l6-6",
  merge: "M5 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM5 6.5v6M11 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM5 7c0 2 2 3 4.5 3",
} as const;

export type IconName = keyof typeof PATHS;
const NS = "http://www.w3.org/2000/svg";

export function icon(name: IconName, size = 16, cls = ""): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.25");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `flex-none ${cls}`);
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", PATHS[name]);
  svg.append(p);
  return svg;
}

/** The product's mark: the loop's five stages as a ring, with the current one in the accent. */
export function mark(size = 22): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 22 22");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  const c = 2 * Math.PI * 8;
  const seg = c / 5;
  for (let i = 0; i < 5; i++) {
    const a = document.createElementNS(NS, "circle");
    a.setAttribute("cx", "11");
    a.setAttribute("cy", "11");
    a.setAttribute("r", "8");
    a.setAttribute("fill", "none");
    a.setAttribute("stroke-width", "2.5");
    a.setAttribute("stroke", i === 4 ? "var(--accent)" : "var(--text)");
    a.setAttribute("stroke-dasharray", `${seg - 2.4} ${c - seg + 2.4}`);
    a.setAttribute("transform", `rotate(${i * 72 - 90 + 5} 11 11)`);
    svg.append(a);
  }
  return svg;
}
