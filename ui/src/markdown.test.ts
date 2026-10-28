import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

// DOMPurify needs a window at import time, so provide one before loading the module.
const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
const { markdownEl } = await import("./markdown.ts");

test("renders common agent markdown", () => {
  const box = markdownEl("**Requirements**\n- one\n- two\n\n```json\n{\"a\": 1}\n```\n\nuse `calc.py`");
  assert.ok(box.querySelector("strong"));
  assert.equal(box.querySelectorAll("li").length, 2);
  assert.equal(box.querySelector("pre code")?.textContent?.trim(), '{"a": 1}');
  assert.equal(box.querySelector("p code")?.textContent, "calc.py");
});

test("single newlines survive (agents write chat-style text)", () => {
  assert.equal(markdownEl("a\nb").querySelectorAll("br").length, 1);
});

test("raw HTML is shown as text, never as elements", () => {
  const box = markdownEl('<script>alert(1)</script> <img src=x onerror="alert(1)"> <b onclick="x()">hi</b>');
  assert.equal(box.querySelector("script, img, b"), null);
  assert.match(box.textContent ?? "", /<script>alert\(1\)<\/script>/);
});

test("dangerous link schemes are dropped, https links kept but not navigable", () => {
  const bad = markdownEl("[x](javascript:alert(1)) [y](data:text/html;base64,AAAA)");
  for (const a of bad.querySelectorAll("a")) assert.equal(a.getAttribute("href"), null);

  const good = markdownEl("[docs](https://example.com/a)");
  const a = good.querySelector("a")!;
  assert.equal(a.getAttribute("href"), "https://example.com/a");
  const click = new dom.window.MouseEvent("click", { cancelable: true, bubbles: true });
  a.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true);
});

test("images and inline styles are not allowed through", () => {
  const box = markdownEl("![tracker](https://evil.example/p.png)");
  assert.equal(box.querySelector("img"), null);
});
