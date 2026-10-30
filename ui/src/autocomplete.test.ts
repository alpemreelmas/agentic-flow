import assert from "node:assert/strict";
import { test } from "node:test";
import { accept, mentionedFiles, mentionedSkills, rank, triggerAt, type Candidate } from "./autocomplete.ts";

test("triggerAt finds the token under the caret", () => {
  assert.deepEqual(triggerAt("see @src/ma", 11), { sigil: "@", query: "src/ma", start: 4, end: 11 });
  assert.equal(triggerAt("hello world", 5), null);
  assert.equal(triggerAt("a @", 3)?.query, "");
});

test("slash commands only trigger at the start of a line", () => {
  assert.equal(triggerAt("/he", 3)?.sigil, "/");
  assert.equal(triggerAt("x\n/he", 5)?.sigil, "/");
  assert.equal(triggerAt("path a/b", 8), null);
  assert.equal(triggerAt("use /he", 7), null);
});

test("rank: basename prefix first, then substring, then letters in order", () => {
  const f = (p: string): Candidate => ({ kind: "file", label: p, insert: "@" + p });
  const items = [f("docs/main-notes.md"), f("src/main.ts"), f("src/domain.ts"), f("README.md"), f("x/m_a_i_n.txt")];
  const r = rank(items, "main").map((c) => c.label);
  assert.deepEqual(r.slice(0, 2), ["src/main.ts", "docs/main-notes.md"]);
  assert.ok(r.includes("src/domain.ts") && r.includes("x/m_a_i_n.txt"));
  assert.ok(!r.includes("README.md"));
  assert.equal(rank(items, "", 3).length, 3);
});

test("accept swaps the token for the choice and puts the caret after it", () => {
  const t = triggerAt("look at @sr", 11)!;
  const out = accept("look at @sr", t, { kind: "file", label: "src/a.ts", insert: "@src/a.ts" });
  assert.deepEqual(out, { text: "look at @src/a.ts ", caret: 18 });
});

test("only real files and known skills count as mentions", () => {
  assert.deepEqual(mentionedFiles("a @src/a.ts b @nope.ts @src/a.ts", new Set(["src/a.ts"])), ["src/a.ts"]);
  assert.deepEqual(mentionedSkills("#review-checklist and #ghost", new Set(["review-checklist"])), ["review-checklist"]);
});


test("source-qualified and nested skill mentions retain their full IDs", () => {
  assert.deepEqual(mentionedSkills("Use #agents:design and #project:system/workflow", new Set(["agents:design", "project:system/workflow"])), ["agents:design", "project:system/workflow"]);
});
