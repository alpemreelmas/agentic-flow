import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./style.css";
import { initResources } from "./resources.ts";
import { initUpdates } from "./updates.ts";
import { getVersion } from "@tauri-apps/api/app";
import { loadHealth, showFatal } from "./health.ts";
import { html } from "./tpl.ts";
import { header, refreshService, sidebar, tryStartOnce } from "./shell.ts";
import { initRegistry, registryPage } from "./registry.ts";
import { applyEvent, type RunEvent } from "./runModel.ts";
import { runs, schedule, setRenderer, sortedRuns, ui } from "./state.ts";
import { overviewPage } from "./pages/overview.ts";
import { loadQueue, queuePage } from "./pages/queue.ts";
import { chatPage, handleChatEvent } from "./pages/chat.ts";
import { runsPage } from "./pages/runs.ts";
import { loadSettings, settingsPage } from "./pages/settings.ts";

const PAGES = { overview: overviewPage, runs: runsPage, queue: queuePage, chat: chatPage, registry: registryPage, settings: settingsPage };

function render() {
  if (ui.following) ui.selected = sortedRuns()[0]?.id ?? null;
  const root = document.getElementById("root")!;
  if (ui.page === "chat" && document.getElementById("chat-page")) {
    const old = document.getElementById("chat-page")!;
    const next = chatPage();
    if (old !== next) old.replaceWith(next);
    root.querySelector(":scope > header")?.replaceWith(header());
    return;
  }
  // Keep typing intact in the inputs a re-render would otherwise recreate.
  const active = document.activeElement as HTMLInputElement | null;
  const focus = active?.id ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
  const page = html`<main class="app-main"></main>`;
  page.append(PAGES[ui.page]());
  root.replaceChildren(header(), sidebar(), page);
  if (focus) {
    const el = document.getElementById(focus.id) as HTMLInputElement | null;
    if (el) {
      el.focus();
      if (focus.start != null) el.setSelectionRange(focus.start, focus.end);
    }
  }
}

async function demo() {
  const { startDemo } = await import("./demo.ts");
  await startDemo({ initRegistry: () => initRegistry(schedule), loadSettings, loadQueue, handleChatEvent });
}

async function main() {
  setRenderer(render);
  if ("__TAURI_INTERNALS__" in window) initResources();
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) return demo();
  await listen<{ run_id: string; event: RunEvent }>("run-event", ({ payload }) => {
    applyEvent(runs, payload.run_id, payload.event);
    ui.lastEventAt = Date.now() / 1000;
    schedule();
  });
  await listen<{ chat_id: string; event: RunEvent }>("chat-event", ({ payload }) => handleChatEvent(payload.chat_id, payload.event));
  // Register the listener first, then start the stream, or the replay would be missed.
  ui.paths.runs = await invoke<string>("default_runs_dir");
  await invoke("start_watch", { runsDir: ui.paths.runs });
  ui.paths.registry = await invoke<string>("default_registry_dir");
  schedule();
  await initRegistry(schedule);
  await loadSettings();
  await tryStartOnce();
  void getVersion().then((v) => { ui.version = v; schedule(); }).catch(() => {});
  void loadHealth();
  if (!import.meta.env.DEV) void initUpdates();
  setInterval(refreshService, 3000);
}

window.addEventListener("unhandledrejection", (e) => console.error("unhandled rejection", e.reason));
main().catch(showFatal);
