// Tokens live in src/style.css as CSS variables; this only names them for the markup.
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.ts"],
  theme: {
    extend: {
      colors: {
        ground: "var(--ground)",
        surface: "var(--surface)",
        raised: "var(--raised)",
        hover: "var(--hover)",
        border: "var(--border)",
        rule: "var(--rule)",
        control: "var(--control)",
        ink: "var(--text)",
        soft: "var(--soft)",
        muted: "var(--muted)",
        accent: "var(--accent)",
        positive: "var(--positive)",
        negative: "var(--negative)",
        warning: "var(--warning)",
      },
      borderRadius: { card: "6px", chip: "4px", control: "999px" },
      fontFamily: {
        sans: ["Public Sans", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "Menlo", "monospace"],
      },
      fontSize: {
        small: ["12px", { lineHeight: "16px" }],
        body: ["13px", { lineHeight: "20px" }],
        card: ["16px", { lineHeight: "24px", fontWeight: "600" }],
        section: ["20px", { lineHeight: "28px", fontWeight: "600", letterSpacing: "-0.01em" }],
        title: ["26px", { lineHeight: "32px", fontWeight: "600", letterSpacing: "-0.02em" }],
      },
    },
  },
};
