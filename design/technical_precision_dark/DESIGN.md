---
name: Technical Precision Dark
colors:
  surface: '#111317'
  surface-dim: '#111317'
  surface-bright: '#37393d'
  surface-container-lowest: '#0c0e11'
  surface-container-low: '#1a1c1f'
  surface-container: '#1e2023'
  surface-container-high: '#282a2d'
  surface-container-highest: '#333538'
  on-surface: '#e2e2e6'
  on-surface-variant: '#c6c5d5'
  inverse-surface: '#e2e2e6'
  inverse-on-surface: '#2f3034'
  outline: '#908f9e'
  outline-variant: '#454652'
  surface-tint: '#bdc2ff'
  primary: '#bdc2ff'
  on-primary: '#121f8b'
  primary-container: '#5e6ad2'
  on-primary-container: '#fdfaff'
  inverse-primary: '#4854bb'
  secondary: '#4cd7f6'
  on-secondary: '#003640'
  secondary-container: '#03b5d3'
  on-secondary-container: '#00424e'
  tertiary: '#ddb7ff'
  on-tertiary: '#490080'
  tertiary-container: '#9b47ea'
  on-tertiary-container: '#fffafb'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dfe0ff'
  primary-fixed-dim: '#bdc2ff'
  on-primary-fixed: '#000965'
  on-primary-fixed-variant: '#2e3aa2'
  secondary-fixed: '#acedff'
  secondary-fixed-dim: '#4cd7f6'
  on-secondary-fixed: '#001f26'
  on-secondary-fixed-variant: '#004e5c'
  tertiary-fixed: '#f0dbff'
  tertiary-fixed-dim: '#ddb7ff'
  on-tertiary-fixed: '#2c0051'
  on-tertiary-fixed-variant: '#6900b3'
  background: '#111317'
  on-background: '#e2e2e6'
  surface-variant: '#333538'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0em
  code-lg:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: -0.01em
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
    letterSpacing: 0.01em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.03em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 12px
    letterSpacing: 0.04em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.75rem
  margin: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style
The design system establishes a high-density, command-center environment tailored for engineers supervising concurrent autonomous software agents. Rooted in the visual precision of modern developer tools like Linear, Raycast, and GitHub, the aesthetic merges technical rigor with modern refinement. 

The emotional signature is low-noise, razor-sharp, and immediate: high information density without cognitive clutter, instantaneous semantic parsing, and tactile responsiveness. The style combines a dark-mode-first foundational architecture, low-contrast hairline borders, subtle glassy overlays for transient utility panels, and a decisive, vibrant status palette engineered for peripheral visibility during long monitoring sessions.

## Colors
The color architecture relies on a pitch-black and slate-tinted neutral base paired with focused functional accents:

- **Surface Foundations:**
  - Base canvas: `#08090a` (Deepest canvas)
  - Surface Tier 1 (Panels, Nav): `#0d0f12`
  - Surface Tier 2 (Cards, Timelines): `#14171c`
  - Surface Tier 3 (Hover, Nested modules): `#1d2127`
  - Borders & Dividers: Sub-perceptual `#ffffff0d` (5%), structural `#ffffff17` (9%), active/focus `#5e6ad280`

- **Core & Semantic Accents:**
  - **Primary (`#5e6ad2` - Linear Indigo):** Orchestration actions, selected tabs, primary triggers, and keyboard shortcut badges.
  - **Running (`#06b6d4` - Electric Cyan):** Active execution loops, dynamic telemetry pulses, streaming tokens.
  - **In Review (`#a855f7` - Vivid Purple):** Spec verification, automated PR checks, synthesis steps.
  - **Needs Human (`#f59e0b` - Amber/Orange):** Interrupted workflows, permission gates, approval required.
  - **Completed (`#10b981` - Emerald):** Green tests, applied patches, closed tasks.
  - **Failed (`#f43f5e` - Rose):** Stack traces, syntax rejections, crashed runtimes.

All status colors provide a 10% alpha fill for backdrops and solid hex for crisp borders and text.

## Typography
Typography is tuned specifically for data density, technical read-outs, and rapid scanning. 

- **UI & Interface Headings:** `Inter` handles operational titles, breadcrumbs, dialog frames, and natural-language model logs. It runs with negative tracking on medium-to-large weights to prevent optical splay.
- **Code & Status Tokens:** `JetBrains Mono` handles all executable contexts: tool definitions, function arguments, file paths, diff markers, git commit SHAs, latency durations, and telemetry counts.
- **Micro-labels:** Fixed-width tabular figures (`tnum`) must be forced across all numeric and timing outputs to eliminate horizontal layout jitter when agent execution loops tick in real-time.

## Layout & Spacing
The layout model follows a multi-pane split-screen desktop paradigm with collapsible utility docks, optimized for landscape viewports (1440px and higher).

- **Grid Architecture:** Multi-column flexible layout containing:
  1. *Left Navigation Dock (Fixed):* 56px collapsed to 240px expanded.
  2. *Orchestration Run List (Master):* 320px–380px panel with vertical task trees.
  3. *Execution Detail & Canvas (Detail):* Flex-fill (minimum 640px) housing the timeline loop and active diff visualizer.
  4. *Context Inspector Dock (Collapsible Drawer):* 360px contextual telemetry panel.
- **Density Rhythms:**
  - Compact vertical rhythm: standard table/list rows are strictly 32px or 36px in height.
  - Component padding operates on base-4 modular increments (4px, 8px, 12px, 16px).
  - Borders enforce structural containment; negative space serves as an operational grouping mechanism rather than decorative padding.

## Elevation & Depth
Depth avoids heavy soft drop shadows, instead using crisp layered surfaces punctuated by hairline outlines and selective frosted glass.

- **Level 0 (Basebed):** `#08090a` canvas. Completely opaque.
- **Level 1 (Dock & Main Panels):** `#0d0f12` with a 1px border of `rgba(255, 255, 255, 0.07)`.
- **Level 2 (In-Canvas Cards & Accordions):** `#14171c` with hairline border `rgba(255, 255, 255, 0.08)`.
- **Level 3 (Command Menu & Modals):** Translucent backdrop `#0d0f12cc` with `backdrop-filter: blur(16px)` and an ambient elevation shadow of `0 16px 36px -8px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.12)`.
- **Hover Transitions:** Hover states never displace the element physically; they tint the inner surface (`rgba(255, 255, 255, 0.04)`) and sharpen the border luminosity (`rgba(255, 255, 255, 0.18)`).

## Shapes
The shape language relies on precision-milled corners (Soft / `roundedness: 1`):
- Inputs, badges, status chips, tool invocation pills: `4px` (`space-xs`) radius.
- Standard structural panels, diff containers, logs, and modal viewports: `8px` (`rounded-lg` base) radius.
- Large floating overlays: `10px` radius maximum.
- Status indicator dots: Fully circular (`9999px`).

Avoid large rounded geometries or pill-shaped buttons; they conflict with the sharp, terminal-adjacent developer aesthetic.

## Components

### Buttons
- **Primary:** Solid `#5e6ad2` background, white text, 1px border `#707ce6`, 30px height, font: `Inter` 12px Medium. Focus ring: `0 0 0 2px #5e6ad240`.
- **Secondary / Ghost:** Transparent background, text `#cbd5e1`, 1px border `rgba(255, 255, 255, 0.08)`. Hover: `#1d2127`, border `rgba(255, 255, 255, 0.16)`.
- **Icon / Action:** 28px × 28px square, subtle hover fill `rgba(255, 255, 255, 0.06)`, radius 4px.

### Semantic Status Chips
- Rendered in `JetBrains Mono` 10px uppercase with `0.04em` letter-spacing.
- Structure: 4px border-radius, 2px 6px padding.
- Color matrix:
  - *Running:* Background `rgba(6, 182, 212, 0.1)`, text `#22d3ee`, border `1px solid rgba(6, 182, 212, 0.25)`. Accompanied by a pulsing 6px dot.
  - *In Review:* Background `rgba(168, 85, 247, 0.1)`, text `#c084fc`, border `1px solid rgba(168, 85, 247, 0.25)`.
  - *Needs Human:* Background `rgba(245, 158, 11, 0.1)`, text `#fbbf24`, border `1px solid rgba(245, 158, 11, 0.3)`.
  - *Completed:* Background `rgba(16, 185, 129, 0.1)`, text `#34d399`, border `1px solid rgba(16, 185, 129, 0.25)`.
  - *Failed:* Background `rgba(244, 63, 94, 0.1)`, text `#fb7185`, border `1px solid rgba(244, 63, 94, 0.3)`.

### Collapsible Tool Invocations
- Collapsed: Monospace header bar containing chevron icon, tool name (e.g., `bash`, `read_file`), argument preview truncated to one line, execution duration (e.g., `412ms`), and status icon.
- Expanded: Reveals raw JSON input parameters and standard output block. Background: `#090a0d`, border: hairline divider, font: `JetBrains Mono` 11px.

### Git Diff Visualizer
- Split or unified view using full-bleed container styling.
- Gutter: Fixed 48px line-number column, text color `#475569`, right-aligned.
- Addition rows: Background `rgba(16, 185, 129, 0.08)`, line number text `#10b981`, sign indicator `+`.
- Deletion rows: Background `rgba(244, 63, 94, 0.08)`, line number text `#f43f5e`, sign indicator `-`.
- Intra-line token diffs: Higher opacity overlay (`rgba(16, 185, 129, 0.2)` / `rgba(244, 63, 94, 0.2)`).

### Structured Execution Timeline
- Left-aligned continuous vertical tracking rail (1px solid `rgba(255, 255, 255, 0.08)`).
- Loop steps anchored via node glyphs (tool icon, model inference, git checkpoint).
- Active execution node features a glowing cyan perimeter ring with subtle radar ping animation.

### Input Fields & Command Palettes
- Surface: `#0d0f12`, text: `#f8fafc`, placeholder: `#64748b`.
- Border: `1px solid rgba(255, 255, 255, 0.12)`, transition to `#5e6ad2` on focus with no outline offset.
- Integrated keyboard shortcut markers: 18px height badges in `JetBrains Mono` 10px, background `#ffffff0f`, radius 3px.