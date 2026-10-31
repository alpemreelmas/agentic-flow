// Dev-only sample data and a fake Tauri backend, so every screen can be viewed in a plain browser. Never bundled in production.
// Open /#overview, /#queue, /#chat, /#registry, /#settings. Add ?empty for first-run screens, ?error for failing backends.
import { mockIPC } from "@tauri-apps/api/mocks";
import { applyEvent, type RunEvent } from "./runModel.ts";
import { runs, schedule, ui, type Page } from "./state.ts";

const now = Date.now() / 1000;
const ev = (run: string, startedAgo: number, i: number, type: string, data: Record<string, unknown> = {}): [string, RunEvent] => [run, { ts: now - startedAgo + i * (startedAgo > 400 ? 90 : 8), type, ...data }];

const A = "20260101T090000-LIN-4021", B = "20260101T083000-LIN-4019", C = "20260101T080000-LIN-4018", D = "20260101T073000-LIN-4012", E = "20260101T070000-LIN-4007";
export const DEMO: [string, RunEvent][] = [
  ev(E, 7200, 0, "run_start", { title: "LIN-4007 Add retry budget to the webhook worker", role: "implementer" }),
  ev(E, 7200, 1, "attempt_start", { attempt: 1, role: "implementer", cli: "claude" }),
  ev(E, 7200, 2, "verify", { ok: true, command: "pnpm test", output: "31 passed" }),
  ev(E, 7200, 3, "review_start", { reviewer: "tech-reviewer", cli: "claude" }),
  ev(E, 7200, 4, "review_result", { reviewer: "tech-reviewer", parsed: true, findings: [] }),
  ev(E, 7200, 5, "deliver", { ok: true, url: "https://github.com/arda-tor/pawsync/pull/1287", note: "", draft: true }),
  ev(E, 7200, 6, "run_end", { status: "review" }),
  ev(D, 5400, 0, "run_start", { title: "LIN-4012 Fix CSS overflow in Billing modal", role: "implementer" }),
  ev(D, 5400, 1, "attempt_start", { attempt: 1, role: "implementer", cli: "claude" }),
  ev(D, 5400, 2, "agent_error", { error: "timeout waiting for locator .billing-modal" }),
  ev(D, 5400, 3, "run_end", { status: "needs_human" }),
  ev(C, 3600, 0, "run_start", { title: "LIN-4018 Synthesize realtime telemetry protocol", role: "implementer" }),
  ev(C, 3600, 1, "attempt_start", { attempt: 1, role: "implementer", cli: "claude" }),
  ev(C, 3600, 2, "verify", { ok: true, command: "pnpm test", output: "18 passed" }),
  ev(C, 3600, 3, "deliver", { ok: true, url: "https://github.com/arda-tor/pawsync/pull/1292", note: "", draft: false }),
  ev(C, 3600, 4, "run_end", { status: "review" }),
  ev(B, 1800, 0, "run_start", { title: "LIN-4019 Apply DB schema migration for permission tiers", role: "implementer" }),
  ev(B, 1800, 1, "triage_result", { decision: "needs_approval", size: "big", summary: "Yıkıcı DDL içeriyor, üretim verisine dokunuyor.", plan: ["Migrate"], questions: [] }),
  ev(B, 1800, 2, "run_end", { status: "needs_human" }),
  ev(A, 400, 0, "run_start", { title: "LIN-4021 Refactor Auth Token Cache with Redis fallback", role: "implementer" }),
  ev(A, 400, 1, "triage_start", { role: "product-manager", cli: "claude" }),
  ev(A, 400, 2, "triage_result", { decision: "proceed", size: "small", summary: "Redis önüne bellek içi LRU eklenecek.", plan: ["LRU ekle", "Iskalamada Redis'e düş"], acceptance_criteria: ["Redis failover <300ms"], risks: ["Eski token"], questions: [], proposed_verify: "pnpm test" }),
  ev(A, 400, 3, "attempt_start", { attempt: 1, role: "implementer", cli: "claude" }),
  ev(A, 400, 4, "agent_thought", { text: "Replica geride kaldığında süresi dolmuş JWT'ler doğrulanmaya devam ediyor. Önce yerel LRU kullanılmalı." }),
  ev(A, 400, 5, "tool_call", { id: "t1", title: "Read tokenCache.ts", status: "completed", tool_kind: "read", raw_input: { path: "src/tokenCache.ts" }, content: [{ type: "content", content: { type: "text", text: "export class TokenCacheManager {}" } }] }),
  ev(A, 400, 6, "tool_call", { id: "t2", title: "Edit tokenCache.ts", status: "completed", tool_kind: "edit", content: [{ type: "diff", path: "src/tokenCache.ts", old_text: "return await this.redis.get(key);", new_text: "const hit = this.lru.get(key);\nif (hit) return hit;\nreturn await this.redis.get(key);" }] }),
  ev(A, 400, 7, "agent_message", { text: "Redis önüne bir LRU ekledim.\n\n- `get()` önce önbelleğe bakıyor\n- ıskalamada Redis'e düşüyor" }),
  ev(A, 400, 8, "verify", { ok: true, command: "pnpm test", output: "6 passed" }),
  ev(A, 400, 9, "review_start", { reviewer: "tech-reviewer", cli: "claude" }),
  ev(A, 400, 10, "review_result", { reviewer: "tech-reviewer", parsed: true, findings: [{ severity: "minor", file: "src/tokenCache.ts", line: 12, text: "LRU'ya bir TTL ekleyin." }] }),
];

const WORKSPACES = [
  { id: "ws-sandbox", name: "sandbox", repo: "/home/arda/dev/sandbox", project_id: "p1", project_name: "Sandbox", enabled: true },
  { id: "ws-tailly", name: "tailly", repo: "/home/arda/dev/pawsync", project_id: "p2", project_name: "Tailly", enabled: true },
];
const STATES = { ready: "Todo", progress: "In Progress", review: "In Review", blocked: "Backlog" };
const issue = (identifier: string, title: string, state: string, minutes: number, labels: string[], project_name = "Tailly") =>
  ({ project_id: project_name === "Tailly" ? "p2" : "p1", project_name, id: identifier, identifier, title, url: `https://linear.app/issue/${identifier}`, state, updated_at: new Date(Date.now() - minutes * 60000).toISOString(), labels: ["agent", ...labels] });
const ISSUES = [
  issue("LIN-4021", "Refactor Auth Token Cache with Redis fallback", "In Progress", 6, ["backend"]),
  issue("LIN-4024", "Paginate the appointment history endpoint", "Todo", 22, ["backend"]),
  issue("LIN-4026", "Show vaccination due dates on the pet profile", "Todo", 48, ["frontend"]),
  issue("LIN-4028", "Replace moment with date-fns in the scheduler", "Todo", 95, ["chore"], "Sandbox"),
  issue("LIN-4018", "Synthesize realtime telemetry protocol", "In Review", 60, ["backend"]),
  issue("LIN-4007", "Add retry budget to the webhook worker", "In Review", 120, []),
  issue("LIN-4019", "Apply DB schema migration for permission tiers", "Backlog", 30, ["migration"]),
  issue("LIN-4012", "Fix CSS overflow in Billing modal", "Backlog", 90, ["frontend"]),
];
const ROLES: Record<string, string> = {
  implementer: "---\nname: implementer\ndescription: Görevi uygular ve doğrulamayı geçirir.\ncli: claude\npermissions: ask\nskills: []\n---\nGörevi en küçük doğru değişiklikle uygula.\n",
  "product-manager": "---\nname: product-manager\ndescription: Görevi triage eder.\ncli: claude\npermissions: ask\nskills: []\n---\nGörevin otonom yapılıp yapılamayacağına karar ver.\n",
  "product-reviewer": "---\nname: product-reviewer\ndescription: Değişikliği ürün açısından inceler.\ncli: claude\npermissions: ask\nskills: [review-output-contract]\n---\nİstenenle yapılanı karşılaştır.\n",
  "tech-reviewer": "---\nname: tech-reviewer\ndescription: Değişikliği teknik açıdan inceler.\ncli: claude\npermissions: ask\nskills: [review-checklist, review-output-contract]\n---\nDoğruluk ve bakım kolaylığına bak.\n",
};

interface Hooks { initRegistry: () => Promise<void>; loadSettings: () => Promise<void>; loadQueue: () => Promise<void>; handleChatEvent: (id: string, ev: RunEvent) => void }

export async function startDemo(h: Hooks) {
  const q = new URLSearchParams(location.search);
  const empty = q.has("empty"), failing = q.has("error");
  const service = { running: !empty, phase: "idle", detail: empty ? "" : "sonraki poll 120 sn", pid: empty ? 0 : 41802, started_at: now - 4000 };
  const config = { workspaces: empty ? [] : WORKSPACES, active_workspace: "", label: "agent", ...STATES, deliver: "github", reviewers: "tech-reviewer,product-reviewer", triage: "product-manager", agent: "", max_attempts: 3, timeout: 1800, interval: 300 };
  const chatEvents = (id: string) => {
    const at = Date.now() / 1000;
    const send = (type: string, data: Record<string, unknown> = {}) => h.handleChatEvent(id, { ts: at, type, ...data });
    send("ready", { modes: { current: "plan", available: [{ id: "plan", name: "Plan" }, { id: "default", name: "Varsayılan" }] }, config_options: [{ id: "model", name: "Model", category: "model", type: "select", value: "opus", choices: [{ value: "opus", name: "Opus" }, { value: "sonnet", name: "Sonnet" }] }] });
    send("user_message", { text: "Token önbelleğini Redis'e taşımadan önce neye dikkat etmeliyim?" });
    send("agent_thought", { text: "Önce mevcut önbellek kullanımına bakmam gerekiyor." });
    send("tool_call", { id: "c1", title: "Read tokenCache.ts", status: "completed", tool_kind: "read", raw_input: { path: "src/tokenCache.ts" } });
    send("agent_message", { text: "Üç şeye bakardım:\n\n1. Süresi dolan token'lar için TTL\n2. Redis düştüğünde davranış\n3. Çoklu instance'ta tutarlılık\n\n`TokenCacheManager` şu an yalnızca bellek içi çalışıyor." });
  };
  mockIPC((cmd, args) => {
    const a = (args ?? {}) as Record<string, string>;
    if (failing && ["list_queue", "check_connection", "list_projects"].includes(cmd)) throw "Linear'a ulaşılamadı (HTTP 503)";
    switch (cmd) {
      case "service_status": return service;
      case "start_service": service.running = true; service.pid = 41802; service.started_at = Date.now() / 1000; return service;
      case "stop_service": service.running = false; service.pid = 0; return null;
      case "get_config": return config;
      case "set_config": return null;
      case "key_status": return !empty;
      case "list_projects": return JSON.stringify([{ id: "p1", name: "Sandbox", state: "started" }, { id: "p2", name: "Tailly", state: "started" }]);
      case "list_queue": return JSON.stringify(empty ? [] : ISSUES);
      case "check_connection": return "Linear: bağlandı (arda-tor)\nEtiket 'agent': 8 görev\nDurumlar: Todo, In Progress, In Review, Backlog bulundu";
      case "default_registry_dir": return "/home/arda/.local/share/linear-looper/registry";
      case "list_registry": return [...Object.keys(ROLES).map((name) => ({ kind: "role", name })), { kind: "skill", name: "review-checklist" }, { kind: "skill", name: "review-output-contract" }];
      case "read_entry": return ROLES[a.name] ?? `---\nname: ${a.name}\ndescription: İnceleme kuralları.\n---\nBulguları dosya ve satırla yaz.\n`;
      case "chat_start": setTimeout(() => chatEvents("chat-1"), 30); return "chat-1";
      case "list_files": return ["src/tokenCache.ts", "src/auth.ts", "package.json"];
      default: return null;
    }
  });
  if (!empty) for (const [id, e] of DEMO) applyEvent(runs, id, e);
  ui.service = service;
  ui.paths = { runs: "/home/arda/.local/share/linear-looper/runs", registry: "/home/arda/.local/share/linear-looper/registry" };
  ui.lastEventAt = empty ? 0 : now;
  const fromHash = () => {
    const page = location.hash.slice(1) as Page;
    if (["overview", "runs", "queue", "chat", "registry", "settings"].includes(page)) ui.page = page;
    schedule();
  };
  window.addEventListener("hashchange", fromHash);
  fromHash();
  await h.initRegistry();
  await h.loadSettings();
  await h.loadQueue();
  // Land on a populated editor and conversation, as a real session would look.
  setTimeout(() => {
    if (empty) return;
    if (ui.page === "registry") document.querySelector<HTMLElement>('[data-act="reg-open"]')?.click();
    if (ui.page === "chat") document.querySelector<HTMLElement>('[data-act="chat-new"]')?.click();
  }, 60);
}
