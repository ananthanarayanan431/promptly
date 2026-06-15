# Phase 3a — Security Quick Wins Design

**Date:** 2026-06-03
**Branch:** `changes-implementation` (off `main`)
**Status:** Design approved; proceeding to plan + implementation
**Roadmap:** Phase 3 of 7, sub-phase **3a** (quick wins). Phase 1 & 2 complete. Phase 3b (authz audit, org-strip, RLS audit, input validation) follows.

---

## 1. Context (from the Phase 3 security audit)

- **Dependency CVEs.** Backend (`pip-audit`): `pyjwt 2.12.1` has 4 advisories (auth-critical — it verifies Supabase tokens), plus `starlette`, `python-multipart`, `urllib3`, `idna`, `mako`, `langchain-core/openai`, `langsmith`, `pytest`. Frontend (`npm audit`): 10 vulns (3 high, 7 moderate), mostly auto-fixable.
- **CORS.** `config/app.py` defaults `CORS_ORIGIN = ["http://localhost:3000", "*"]` — the `"*"` allows any origin.
- **Secrets.** `SecretStr` covers Supabase/MinIO/Sentry and no secret logging was found, but some secrets (e.g. `OPENROUTER_API_KEY`, DB password) are plain `str`.

**Decisions (user-approved):** security-CVE-only upgrades; quick-wins-first sizing (this is 3a); RLS stays defense-in-depth (audited in 3b); org stripped in 3b.

---

## 2. Scope (Phase 3a)

### 2.1 Backend dependency CVE bumps
Target the fixed versions reported by `pip-audit`:
`pyjwt 2.13.0`, `starlette 1.0.1`, `python-multipart 0.0.27`, `urllib3 2.7.0`, `idna 3.15`, `mako 1.3.12`, `langchain-core 1.3.3`, `langchain-openai 1.1.14`, `langsmith 0.8.0`, `pytest 9.0.3` (dev).
Approach: raise direct-dependency lower bounds in `pyproject.toml` for direct deps (`pyjwt`, `langchain-openai`, `pytest`); use `uv lock --upgrade-package <name>` for transitive ones (`starlette`, `python-multipart`, `urllib3`, `idna`, `mako`, `langchain-core`, `langsmith`). Re-run `pip-audit` to confirm the listed CVEs clear.

### 2.2 Frontend dependency fixes
`npm audit fix` (NOT `--force` — no breaking majors). Re-run `lint`/`tsc`/`build`. Resolve all High; resolve Moderate where non-breaking.

### 2.3 CORS tightening
- Remove `"*"` from the `CORS_ORIGIN` default in `config/app.py`; default dev = `["http://localhost:3000"]`.
- Keep it env-overridable (already a settings field) so production sets explicit origins via env at deploy.
- Update `.env.example` to document `CORS_ORIGIN` with a production note.

### 2.4 Secrets verification (correction: already largely done)
Re-audit showed app secrets are **already** wrapped: `OPENROUTER_API_KEY`, `MINIO_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `SENTRY_DSN` are all `SecretStr` with `.get_secret_value()` at use sites. The only non-`SecretStr` secret-bearing field is `DATABASE_URL` (pydantic `PostgresDsn` — idiomatic; password embedded).
Scope here is **verification, not rewrapping**: confirm no secret (incl. `DATABASE_URL`/`effective_url`) is logged; leave `DATABASE_URL` as `PostgresDsn` (rewrapping a DSN breaks its connection-string use). No code change expected unless a logging leak is found.

### Out of scope (→ Phase 3b)
App-level authz/ownership audit and fixes; org-strip; RLS per-request decision (already decided: keep defense-in-depth) and policy correctness audit; input-validation review.

---

## 3. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `langchain-core 1.3.x` / `langchain-openai` bumps break the graph pipeline | Full `make test` (585 tests, incl. graph node tests) is the gate; if broken, pin to the minimal version that both fixes the CVE and passes, and note any residual advisory. |
| `pyjwt 2.13.0` changes break Supabase token verification | `tests/unit/core/test_supabase_auth.py` + the auth-path tests gate this. |
| `npm audit fix` changes a transitive that breaks build | `tsc` + `next build` gate; never use `--force`. |
| Wrapping a secret in `SecretStr` misses a `.get_secret_value()` call site | `mypy` flags `SecretStr` used where `str` expected; full test boot catches runtime use. |

## 4. Success Criteria
- `pip-audit` no longer reports the listed CVEs (or residuals are explicitly documented as un-fixable-without-major-bump).
- `npm audit` reports 0 High; Moderates resolved or documented.
- `CORS_ORIGIN` default contains no `"*"`; production origins are env-driven; `.env.example` documents it.
- All app secrets confirmed `SecretStr` (already true); no secret logging (incl. `DATABASE_URL`).
- ruff + mypy + eslint + tsc green; backend `make test` passes; `next build` succeeds.
- No behavior/API changes.

## 5. Next Step
writing-plans → subagent-driven implementation. Then Phase 3b gets its own spec.
