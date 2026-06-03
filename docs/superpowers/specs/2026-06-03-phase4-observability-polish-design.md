# Phase 4 — Observability Polish Design

**Date:** 2026-06-03
**Branch:** `changes-implementation` (off `main`)
**Status:** Design approved (depth = polish, no OpenTelemetry); proceeding to implement
**Roadmap:** Phase 4 of 7. Phases 1-3 complete.

---

## 1. Context (audit)

Observability is already strong: structlog (JSON in prod, `contextvars` merge, request timing), `CorrelationIdMiddleware` (X-Correlation-ID generate/propagate + log binding), `/health` (liveness) + `/ready` (Postgres + Redis checks), and Sentry wired (FastAPI/SQLAlchemy/Celery, env-gated, no PII). **Decision: polish the gaps; do NOT add OpenTelemetry** (Sentry already provides perf tracing; OTel is overkill for a single service).

## 2. Gaps to fix (scope)

### 2.1 Remove the divergent dead error branch
`CorrelationIdMiddleware.dispatch` has `except ResponseError: return JSONResponse({"detail": ...})`. The app-level `ResponseError` handler in `main.py` already catches it first and returns the structured `{success, data, error}` shape, so the middleware branch is **dead code with a divergent shape**. Remove the `try/except`; keep the correlation-ID binding + response-header set.

### 2.2 Make `CorrelationIdMiddleware` outermost
Currently it sits *inside* `RateLimitMiddleware`/`RequestLimitMiddleware`, so 429/413/504 responses lack the `X-Correlation-ID` header and those middlewares' logs lack the bound `correlation_id`. Reorder `main.py` so `CorrelationIdMiddleware` is added **last** (outermost, after CORS/logging/rate/request-limit), so it binds context first and its header-set wraps all responses.

### 2.3 Cross-link logs ↔ Sentry
- In `CorrelationIdMiddleware`: when Sentry is enabled, `sentry_sdk.set_tag("correlation_id", correlation_id)` so events are findable by the same ID that appears in logs.
- In `dependencies.py get_current_user`: after resolving the user, `sentry_sdk.set_user({"id": str(user.id)})` (no email/PII) and bind `user_id` to structlog contextvars (already done for some paths — ensure both JWT + API-key paths bind it). Guard all Sentry calls so they're no-ops when Sentry is disabled (sentry_sdk is safe to call uninitialised, but gate on settings for clarity).

### 2.4 Build/version visibility on `/health`
Add a single source of truth for the app version (`APP_VERSION` constant in `config/app.py`, default `"0.1.0"`, overridable via env `APP_VERSION` for build SHA) and surface it in `HealthResponse` (`version` field) and the FastAPI `version=` in `main.py`. Lets ops confirm which build is live.

### Out of scope
OpenTelemetry/OTLP; new dashboards; changing the JSON log schema; CORS middleware-ordering (separate concern, not observability).

## 3. Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Removing the middleware `except` changes an error response shape a test asserts | The app-level handler already produces the canonical shape; full `make test` gates it. |
| Middleware reorder changes behavior (e.g. rate-limit now inside correlation) | Functionally identical except correlation now wraps them; tests + a manual 429/ready check confirm. |
| Sentry calls when disabled | Gate on `settings.SENTRY_DSN`; `sentry_sdk` no-ops if uninitialised anyway. |

## 4. Success Criteria
- No dead `except ResponseError` in `CorrelationIdMiddleware`; error responses keep the canonical `{success, data, error}` shape.
- `X-Correlation-ID` present on success **and** 429/413/504/handled-error responses.
- Sentry events (when enabled) carry `correlation_id` tag + `user.id`; logs carry `correlation_id` + `user_id`.
- `/health` returns `version`; `make test` passes; ruff + mypy green.
- No new dependencies.

## 5. Next Step
writing-plans → implement (controller-side, small) → green gate (`make test`) → final review.
