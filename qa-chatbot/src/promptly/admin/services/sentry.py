from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from fastapi import HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from promptly.config.app import get_app_settings
from promptly.llm.settings import get_llm_settings

# ── Stats cache (5-minute TTL, keyed by days) ─────────────────────────────────

_sentry_stats_cache: dict[int, dict[str, Any]] = {}
_sentry_stats_cache_ts: dict[int, float] = {}
_SENTRY_STATS_TTL = 300.0


async def fetch_sentry_stats(days: int) -> dict[str, Any]:  # noqa: PLR0912, PLR0915
    """Return Sentry error stats for the last `days` days, cached for 5 minutes.

    Returns an empty dict when Sentry API credentials are not configured.
    Fires 4 concurrent Sentry API calls: stats, issues, stats_v2 outcomes, sessions.
    """
    global _sentry_stats_cache, _sentry_stats_cache_ts  # noqa: PLW0603

    now = time.monotonic()
    cached_at = _sentry_stats_cache_ts.get(days, 0.0)
    if days in _sentry_stats_cache and now - cached_at < _SENTRY_STATS_TTL:
        return _sentry_stats_cache[days]

    app = get_app_settings()
    if not (app.SENTRY_AUTH_TOKEN and app.SENTRY_ORG_SLUG and app.SENTRY_PROJECT_SLUG):
        return {}

    token = app.SENTRY_AUTH_TOKEN.get_secret_value()
    org = app.SENTRY_ORG_SLUG
    project = app.SENTRY_PROJECT_SLUG
    headers = {"Authorization": f"Bearer {token}"}
    stats_period = f"{days}d"
    issues_period = "14d"

    try:
        since = int((datetime.now(UTC) - timedelta(days=days)).timestamp())
        until = int(datetime.now(UTC).timestamp())

        async with httpx.AsyncClient(timeout=15.0) as client:
            (
                stats_resp,
                issues_resp,
                outcomes_resp,
                sessions_resp,
                releases_resp,
            ) = await asyncio.gather(
                client.get(
                    f"https://sentry.io/api/0/projects/{org}/{project}/stats/",
                    params={"stat": "received", "resolution": "1d", "since": since, "until": until},
                    headers=headers,
                ),
                client.get(
                    f"https://sentry.io/api/0/projects/{org}/{project}/issues/",
                    params={
                        "query": "is:unresolved",
                        "limit": "100",
                        "sort": "freq",
                        "statsPeriod": issues_period,
                    },
                    headers=headers,
                ),
                client.get(
                    f"https://sentry.io/api/0/organizations/{org}/stats_v2/",
                    params={
                        "project": project,
                        "field": "sum(times_seen)",
                        "groupBy": "outcome",
                        "interval": "1d",
                        "statsPeriod": stats_period,
                        "category": "error",
                    },
                    headers=headers,
                ),
                client.get(
                    f"https://sentry.io/api/0/organizations/{org}/sessions/",
                    params={
                        "project": project,
                        "field": "sum(session)",
                        "groupBy": "session.status",
                        "interval": "1d",
                        "statsPeriod": stats_period,
                    },
                    headers=headers,
                ),
                client.get(
                    f"https://sentry.io/api/0/projects/{org}/{project}/releases/",
                    params={"limit": "20"},
                    headers=headers,
                ),
            )

        result: dict[str, Any] = {}

        if stats_resp.status_code == 200:
            raw_stats = stats_resp.json()
            if isinstance(raw_stats, list):
                daily: list[dict[str, Any]] = []
                for row in raw_stats:
                    if isinstance(row, list | tuple) and len(row) >= 2:  # noqa: PLR2004
                        daily.append({"ts": int(row[0]), "count": int(row[1])})
                result["error_events_daily"] = daily
                result["total_errors"] = sum(r["count"] for r in daily)

        if issues_resp.status_code == 200:
            raw_issues = issues_resp.json()
            if isinstance(raw_issues, list):
                valid_issues = [i for i in raw_issues if isinstance(i, dict)]
                result["unresolved_issue_count"] = len(valid_issues)
                level_breakdown: dict[str, int] = {}
                for issue in valid_issues:
                    lvl = str(issue.get("level", "error"))
                    level_breakdown[lvl] = level_breakdown.get(lvl, 0) + 1
                result["issue_level_breakdown"] = level_breakdown
                result["top_issues"] = [
                    {
                        "title": str(issue.get("title", "Unknown"))[:60],
                        "count": int(issue.get("count", 0)),
                        "level": str(issue.get("level", "error")),
                        "user_count": int(issue.get("userCount", 0)),
                    }
                    for issue in valid_issues[:10]
                ]
                result["rich_issues"] = [
                    {
                        "id": str(iss.get("id", "")),
                        "short_id": str(iss.get("shortId", "")),
                        "title": str(iss.get("title", "Unknown")),
                        "level": str(iss.get("level", "error")),
                        "count": int(iss.get("count", 0)),
                        "user_count": int(iss.get("userCount", 0)),
                        "first_seen": str(iss.get("firstSeen", "")),
                        "last_seen": str(iss.get("lastSeen", "")),
                        "permalink": str(iss.get("permalink", "")),
                        "culprit": str(iss.get("culprit", "")),
                        "is_unhandled": bool(iss.get("isUnhandled", False)),
                        "priority": iss.get("priority"),
                        "filename": str((iss.get("metadata") or {}).get("filename", "")),
                    }
                    for iss in valid_issues
                ]

        if outcomes_resp.status_code == 200:
            od = outcomes_resp.json()
            start_str = od.get("start", "")
            if start_str:
                start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                for g in od.get("groups", []):
                    outcome = g["by"].get("outcome", "")
                    series = g["series"].get("sum(times_seen)", [])
                    total_val = g["totals"].get("sum(times_seen)", 0)
                    day_map: dict[str, int] = {}
                    for idx, cnt in enumerate(series):
                        day_str = str((start_dt + timedelta(days=idx)).date())
                        day_map[day_str] = int(cnt)
                    if outcome == "accepted":
                        result["accepted_daily"] = day_map
                        result["accepted_total"] = int(total_val)
                    elif outcome == "client_discard":
                        result["discarded_daily"] = day_map
                        result["discarded_total"] = int(total_val)
                    elif outcome == "filtered":
                        result["filtered_daily"] = day_map
                        result["filtered_total"] = int(total_val)

        if sessions_resp.status_code == 200:
            sd = sessions_resp.json()
            sess_start = (datetime.now(UTC) - timedelta(days=days)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            sess_totals: dict[str, int] = {}
            sess_daily_by_status: dict[str, dict[str, int]] = {}

            for g in sd.get("groups", []):
                status = g["by"].get("session.status", "unknown")
                series = g["series"].get("sum(session)", [])
                sess_totals[status] = int(g["totals"].get("sum(session)", 0))
                day_map2: dict[str, int] = {}
                for idx, cnt in enumerate(series):
                    day_str = str((sess_start + timedelta(days=idx)).date())
                    day_map2[day_str] = int(cnt)
                sess_daily_by_status[status] = day_map2

            healthy = sess_totals.get("healthy", 0)
            crashed = sess_totals.get("crashed", 0)
            errored = sess_totals.get("errored", 0)
            abnormal = sess_totals.get("abnormal", 0)
            total_sessions = healthy + crashed + errored + abnormal

            result["session_totals"] = sess_totals
            result["healthy_sessions"] = healthy
            result["crashed_sessions"] = crashed
            result["errored_sessions"] = errored
            result["total_sessions"] = total_sessions
            result["crash_free_rate"] = round(100.0 * (1 - crashed / max(1, total_sessions)), 2)

            h_daily = sess_daily_by_status.get("healthy", {})
            c_daily = sess_daily_by_status.get("crashed", {})
            crash_free_map: dict[str, float] = {}
            for d_str in sorted(set(list(h_daily.keys()) + list(c_daily.keys()))):
                h = h_daily.get(d_str, 0)
                c = c_daily.get(d_str, 0)
                total_d = h + c
                if total_d > 0:
                    crash_free_map[d_str] = round(100.0 * (1 - c / total_d), 1)
            result["crash_free_daily"] = crash_free_map

        if releases_resp.status_code == 200:
            raw_releases = releases_resp.json()
            if isinstance(raw_releases, list):
                result["releases"] = [
                    {
                        "version": str(r.get("version", ""))[:12],
                        "date_created": str(r.get("dateCreated", "")),
                        "new_groups": int(r.get("newGroups", 0)),
                        "commit_count": int(r.get("commitCount", 0)),
                    }
                    for r in raw_releases
                    if isinstance(r, dict)
                ]

        if result:
            _sentry_stats_cache[days] = result
            _sentry_stats_cache_ts[days] = now

        return result

    except Exception:
        return _sentry_stats_cache.get(days, {})


# ── Issue detail ──────────────────────────────────────────────────────────────


async def fetch_issue_detail(issue_id: str) -> JSONResponse:
    app = get_app_settings()
    if not (app.SENTRY_AUTH_TOKEN and app.SENTRY_ORG_SLUG):
        raise HTTPException(status_code=503, detail="Sentry not configured")

    token = app.SENTRY_AUTH_TOKEN.get_secret_value()
    headers = {"Authorization": f"Bearer {token}"}

    async with httpx.AsyncClient(timeout=12.0) as client:
        issue_resp, event_resp = await asyncio.gather(
            client.get(f"https://sentry.io/api/0/issues/{issue_id}/", headers=headers),
            client.get(
                f"https://sentry.io/api/0/issues/{issue_id}/events/latest/",
                headers=headers,
            ),
        )

    if issue_resp.status_code != 200:
        sc = issue_resp.status_code
        if sc == 404:
            raise HTTPException(status_code=404, detail="Issue not found in Sentry")
        if sc in (401, 403):
            raise HTTPException(status_code=503, detail="Sentry auth failed — check token")
        raise HTTPException(status_code=502, detail=f"Sentry returned {sc}")

    issue = issue_resp.json()
    event_data: dict[str, Any] = {
        "event_id": "",
        "timestamp": "",
        "user": {
            "id": None,
            "email": None,
            "ip": None,
            "geo_city": None,
            "geo_country": None,
            "geo_region": None,
        },
        "tags": [],
        "exception": None,
        "request": None,
        "breadcrumbs": [],
        "release": None,
    }

    if event_resp.status_code == 200:
        event = event_resp.json()
        exception_info: dict[str, Any] | None = None
        request_info: dict[str, Any] | None = None
        breadcrumbs: list[dict[str, Any]] = []

        for entry in event.get("entries", []):
            etype = entry.get("type", "")

            if etype == "exception":
                values = entry["data"].get("values", [])
                if values:
                    exc = values[-1]
                    raw_frames = (exc.get("stacktrace") or {}).get("frames", [])
                    frames = [
                        {
                            "filename": f.get("filename", ""),
                            "lineno": f.get("lineno"),
                            "function": f.get("function", ""),
                            "context": f.get("context", []),
                            "in_app": bool(f.get("inApp", False)),
                            "vars": {k: str(v)[:120] for k, v in (f.get("vars") or {}).items()},
                        }
                        for f in raw_frames
                    ]
                    exception_info = {
                        "exc_type": exc.get("type", ""),
                        "exc_value": str(exc.get("value", ""))[:500],
                        "mechanism": (exc.get("mechanism") or {}).get("type", ""),
                        "frames": frames[-20:],
                    }

            elif etype == "request":
                req = entry["data"]
                raw_headers = req.get("headers") or []
                all_headers = (
                    raw_headers if isinstance(raw_headers, list) else list(raw_headers.items())
                )
                safe_header_names = frozenset(
                    {
                        "content-type",
                        "accept",
                        "user-agent",
                        "accept-encoding",
                        "accept-language",
                        "content-length",
                    }
                )
                safe_headers = [
                    (str(k), str(v)) for k, v in all_headers if str(k).lower() in safe_header_names
                ]
                request_info = {
                    "method": req.get("method", ""),
                    "url": req.get("url", ""),
                    "query_string": req.get("query", "") or "",
                    "headers": safe_headers,
                }

            elif etype == "breadcrumbs":
                crumbs = (entry["data"].get("values") or [])[-12:]
                breadcrumbs = [
                    {
                        "type": c.get("type", ""),
                        "category": c.get("category", ""),
                        "message": str(c.get("message") or "")[:120],
                        "level": c.get("level", ""),
                        "timestamp": c.get("timestamp", ""),
                    }
                    for c in crumbs
                ]

        user = event.get("user") or {}
        geo = user.get("geo") or {}
        tags = event.get("tags") or []

        event_data = {
            "event_id": event.get("eventID", ""),
            "timestamp": event.get("dateCreated", ""),
            "user": {
                "id": user.get("id"),
                "email": user.get("email"),
                "ip": user.get("ip_address"),
                "geo_city": geo.get("city"),
                "geo_country": geo.get("country_code"),
                "geo_region": geo.get("region"),
            },
            "tags": [
                {"key": str(t[0]), "value": str(t[1])}
                if isinstance(t, list | tuple)
                else {"key": str(t.get("key", "")), "value": str(t.get("value", ""))}
                for t in tags
            ],
            "exception": exception_info,
            "request": request_info,
            "breadcrumbs": breadcrumbs,
            "release": (
                event["release"].get("version")
                if isinstance(event.get("release"), dict)
                else str(event["release"])
                if event.get("release") is not None
                else None
            ),
        }

    return JSONResponse(
        content={
            "success": True,
            "data": {
                "issue": {
                    "id": str(issue.get("id", "")),
                    "short_id": issue.get("shortId", ""),
                    "title": issue.get("title", ""),
                    "level": issue.get("level", "error"),
                    "count": int(issue.get("count", 0) or 0),
                    "user_count": int(issue.get("userCount", 0) or 0),
                    "first_seen": issue.get("firstSeen", ""),
                    "last_seen": issue.get("lastSeen", ""),
                    "permalink": issue.get("permalink", ""),
                    "culprit": issue.get("culprit", ""),
                    "status": issue.get("status", ""),
                },
                "latest_event": event_data,
            },
        }
    )


# ── AI Fix ────────────────────────────────────────────────────────────────────


class AiFixFrame(BaseModel):
    filename: str = ""
    lineno: int | None = None
    function: str = ""
    context: list[list[Any]] = []
    in_app: bool = False
    vars: dict[str, str] = {}


class AiFixException(BaseModel):
    exc_type: str = ""
    exc_value: str = ""
    mechanism: str = ""
    frames: list[AiFixFrame] = []


class AiFixRequest(BaseModel):
    title: str
    level: str = "error"
    culprit: str = ""
    exception: AiFixException | None = None
    request_method: str = ""
    request_url: str = ""
    breadcrumbs: list[dict[str, Any]] = []


def _build_ai_fix_prompt(payload: AiFixRequest) -> str:
    parts: list[str] = []

    if payload.exception:
        exc = payload.exception
        parts.append(f"ERROR: {exc.exc_type}: {exc.exc_value[:400]}")
        if exc.mechanism:
            parts.append(f"Mechanism: {exc.mechanism}")
    else:
        parts.append(f"ERROR: {payload.title}")

    if payload.culprit:
        parts.append(f"Culprit: {payload.culprit}")

    if payload.exception and payload.exception.frames:
        in_app = [f for f in payload.exception.frames if f.in_app]
        frames_to_show = (in_app or payload.exception.frames)[-8:]
        parts.append("\nSTACK TRACE (in-app frames, newest first):")
        for frame in reversed(frames_to_show):
            parts.append(f"\n  File: {frame.filename}:{frame.lineno or '?'} in {frame.function}()")
            for lineno, line_text in (frame.context or [])[-7:]:
                marker = ">>>" if lineno == frame.lineno else "   "
                parts.append(f"    {marker} {lineno:4d} | {line_text}")

    if payload.request_method and payload.request_url:
        url_no_qs = payload.request_url.split("?")[0]
        parts.append(f"\nREQUEST: {payload.request_method} {url_no_qs}")

    if payload.breadcrumbs:
        parts.append("\nLAST BREADCRUMBS:")
        for crumb in payload.breadcrumbs[-3:]:
            ts = str(crumb.get("timestamp", ""))[:19]
            cat = crumb.get("category", "")
            msg = str(crumb.get("message", ""))[:100]
            parts.append(f"  [{ts}] {cat}: {msg}")

    return "\n".join(parts)


async def generate_ai_fix(payload: AiFixRequest) -> JSONResponse:
    llm = get_llm_settings()
    if not llm.OPENROUTER_API_KEY:
        raise HTTPException(status_code=503, detail="LLM not configured")

    issue_context = _build_ai_fix_prompt(payload)

    system_prompt = (
        "You are a senior backend engineer performing root-cause analysis on production errors "
        "from a FastAPI / Python application. Be concise, specific, and actionable. "
        "Always reference exact file paths and line numbers from the stack trace.\n\n"
        "Respond in this exact markdown format:\n\n"
        "## Root Cause\n"
        "[2-3 sentences explaining *why* the error occurs]\n\n"
        "## Location\n"
        "`filename.py:line_number` in `function_name()`\n"
        "[One sentence on what this code does and why it fails]\n\n"
        "## Fix\n"
        "```python\n"
        "[Corrected code snippet, 5-15 lines]\n"
        "```\n"
        "[1-2 sentences explaining the change]\n\n"
        "## Prevention\n"
        "[One concrete tip to prevent this class of error recurring]"
    )

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {llm.OPENROUTER_API_KEY.get_secret_value()}",
                "Content-Type": "application/json",
            },
            json={
                "model": "openai/gpt-4.1-mini",
                "max_tokens": 800,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": (
                            "Analyze this production error and provide a fix:\n\n" + issue_context
                        ),
                    },
                ],
            },
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=503, detail="AI service unavailable")

    content = resp.json()["choices"][0]["message"]["content"]
    return JSONResponse(content={"success": True, "data": {"analysis": content}})
