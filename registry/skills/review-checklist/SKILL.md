---
name: review-checklist
description: "Technical review checklist: what to look for in a diff, by area, with concrete red flags."
---
Use this as a lens, not a form. Walk the diff hunk by hunk and ask which areas below can be wrong there. Raise only what you can tie to a concrete failure scenario (see the severity rules). Read the `-` lines as carefully as the `+` lines: the most expensive bugs are guarantees the old code gave and the new code silently drops.

## 1. Correctness

- Conditions: inverted comparison, `<` vs `<=`, off-by-one at slice, range and pagination boundaries, `and`/`or` precedence, a copy-pasted line that still names the sibling variable.
- Null, empty, zero: unchecked `None`/`null`/`undefined`, empty list, string or map, division by zero, first/last element access, optional chaining that hides a real error.
- State and ordering: mutated default arguments, mutation while iterating, stale closures captured in loops, ordering assumed from unordered sources (dicts, sets, database rows without `ORDER BY`).
- Types and units: floats for money, naive vs timezone-aware datetimes, seconds vs milliseconds, bytes vs characters, string vs number comparison, integer overflow.
- Error paths: swallowed exceptions (`except: pass`, empty `catch`), errors turned into success values, partial failure that leaves inconsistent state, missing cleanup, returning before a lock, file or connection is released.
- Concurrency: check-then-act races, unsynchronised shared state, a missing `await`, fire-and-forget tasks that drop errors, retries of non-idempotent operations, lock-ordering deadlocks.
- Contracts: a changed signature, return shape, error type, default, ordering, serialization format or event payload whose callers were not updated; a schema change with no compatibility path.
- Regressions: validation, auth checks, logging or rollback that the old code performed and the new code no longer does.

## 2. Security

- Injection: SQL built by concatenation or f-strings; shell commands built from input (`shell=True`, backticks, `exec`); `eval`, template injection; path traversal (`../`, user-controlled paths into open, send_file, archive extraction); SSRF (user-controlled URLs fetched server-side); XSS (`innerHTML`, `dangerouslySetInnerHTML`, unescaped templates); header or log injection; catastrophic regexes.
- Authentication and authorization: a new endpoint, handler or command without the check its siblings have; authorization enforced only on the client; object access by id with no ownership check (IDOR); the permission check moved after the action.
- Secrets: keys, tokens, passwords or connection strings in code, config, fixtures, tests or logs; a committed `.env`; secrets placed in URLs.
- Data exposure: sensitive fields in logs, errors, responses or analytics; overly broad CORS; error messages that leak internals.
- Cryptography: home-made crypto, MD5 or SHA1 for security, ECB mode, static IV or salt, non-cryptographic randomness for tokens, disabled TLS verification, comparing secrets with `==`.
- Deserialization and uploads: `pickle`, `yaml.load` or object deserialization of untrusted data; uploads with no type, size or path restriction.
- Dependencies and supply chain: a new or bumped dependency (needed? maintained? a typo-squat name?), install scripts, `curl | sh`, versions pinned to a branch or `latest`.
- Platform: mobile secrets or tokens in plain storage, exported components, cleartext traffic, a WebView JavaScript bridge on untrusted content; web state-changing requests without CSRF protection.

## 3. Performance (report only with a concrete mechanism)

- Queries inside loops (N+1), no limit or pagination on user-controlled sizes, whole tables or files loaded into memory, unbounded caches, queues or retries, a new filter or sort with no index on a large table.
- Blocking I/O or heavy CPU on a request path, the main thread or the UI thread; synchronous calls inside async code; work repeated that could be computed once; O(n²) over input that can be large.
- UI and mobile: work on the main thread, re-render storms (new object or function props on every render, missing keys), images decoded at full size, listeners, observers or timers that are never removed.
- Not findings: micro-optimisations, theoretical complexity on small fixed inputs, "could be cached".

## 4. Reliability and operability

- Network or I/O calls with no timeout; retries with no backoff or limit, or on non-idempotent operations; partial failure not handled; resource leaks.
- Migrations that are irreversible, take long locks, or must run before the code that needs them; backfills that are not batched.
- Configuration and flags: an unsafe default, or no off-switch for a risky change.
- Logging and metrics: errors swallowed silently, noisy logging in hot loops, personal data in logs.

## 5. Tests and verification integrity

- Tampering (blocking): deleted, skipped or `xfail`ed tests; loosened or removed assertions; `assert True`; tests that now mock the very thing they test; expected values copied from the new output; production code that special-cases test inputs; edits to the verification command, CI or lint configuration that make a failing check pass.
- Tests that cannot fail: no assertion, an assertion on a mock, catching and ignoring the exception the test should expect.
- Flakiness introduced: sleeps, real clock, network or randomness without control, order dependence.
- Missing coverage for a changed or new path is minor, unless the change is risky or the project clearly requires tests.

## 6. Maintainability (almost always minor)

- Logic duplicated so that it must now change in two places; a function that does several unrelated things; a name or comment that contradicts the code; dead code left behind; magic numbers that encode business rules; an internal detail leaked into a public API.
- Not findings: personal style, formatting, naming taste, "I would have structured it differently".

## 7. Language and framework traps

- Python: mutable default arguments; bare `except`; `is` for value comparison; late-binding closures in loops; `datetime.utcnow()` and naive datetimes; blocking calls inside `async def`; `subprocess` with `shell=True` and input; f-string SQL; a forgotten `await`; `open()` without a context manager.
- JavaScript and TypeScript: missing `await` and unhandled rejections; `==` coercion; `any` and `as` casts hiding errors; array index used as a React key for reorderable lists; stale closures and wrong dependency arrays in hooks; effects with no cleanup; `JSON.parse` of untrusted data without handling failure; mutation of props or state.
- SQL and ORMs: string-built queries; multi-step writes outside a transaction; `SELECT *` into code that assumes column order; N+1 through lazy loading; migrations that drop columns still read by deployed code.
- Shell: unquoted variables; no `set -euo pipefail` where failure matters; `rm -rf` on a variable path that may be empty; parsing `ls`.
- Go: ignored `err`, goroutine leaks, range-variable capture before Go 1.22, unsynchronised map access, `defer` inside loops.
- Rust: `unwrap` or `expect` on fallible input paths, `unsafe` with no safety argument, a lock held across `.await`, silent integer casts.
- Swift, Kotlin and mobile: force-unwraps and `!!` on external data, retain cycles in closures, main-thread violations, lifecycle leaks, permission or entitlement changes, reading old storage formats with no migration.
- Infrastructure, Docker and CI: running as root, secrets passed as build arguments, `latest` tags, unpinned actions, wildcard IAM permissions, public buckets or ports.

## Before you write a finding

You should be able to complete: "When ___ happens, ___ goes wrong, because line ___ ___." If you cannot, drop it or make it minor.
