# Admin Analytics "View" Tab — Design Spec

**Date:** 2026-06-23
**Status:** Approved

---

## Overview

Add a **"View"** tab to the existing admin panel (admin-only). It provides a full analytics
dashboard modelled after the reference screenshots, with two top-level toggles — **Platform**
and **Agents** — each containing a sidebar of sub-views. Every sub-view is a grid of metric
cards: a big aggregate number, a time-range label, an optional static summary row, and a
Recharts line/bar chart with a Line/Bar toggle. All data is static (standard request/response,
no polling or WebSocket).

---

## 1. Navigation Structure

The "View" tab is appended to the existing admin tab list:

```
Overview | Users | Rate Limits | Errors | Health | Jobs | Audit Log | API Keys | OpenRouter | View
```

Inside the View tab:

```
Top toggle:  [ Platform ]  [ Agents ]

Platform sidebar:            Agents sidebar:
  ● Feature Engagement         ● Prompt Optimizer
  ○ Login Activity             ○ Skill Builder
                               ○ Domain PDO/GEPA
                               ○ Bridge
```

Clicking the toggle switches the sidebar list. Clicking a sidebar item loads that sub-view.
Default on open: Platform → Feature Engagement.

---

## 2. Shared UI Components

### `MetricCard`
Props: `title`, `value` (aggregate number), `label` (e.g. "Last 30 Days"), `data` (array of
`{date, value}`), `chartType` ("line" | "bar"), `color`.

Renders: title, big number, label, Line/Bar toggle buttons, Recharts `LineChart` or
`BarChart` inside a `ResponsiveContainer`, tooltip on hover.

### `StaticCard`
Props: `title`, `value`, `subtitle`.
Renders: title, big number, subtitle. No chart. Used for all-time aggregates and ratios.

### `SectionHeader`
Props: `title`, `description`.
Renders: page heading + subtitle (same style as existing admin views).

### Chart styling
- Dark background `#1a1a1a`, grid lines `#2a2a2a`
- Accent color: green `#4ade80` (matching existing admin theme)
- Tooltip: dark card, white text

---

## 3. Backend — Single Analytics Endpoint

```
GET /api/v1/admin/analytics?view=<view_name>&days=<n>
```

Protected by `require_admin` (router-level).

### View names

| `view` param | Sub-view |
|---|---|
| `platform_engagement` | Platform → Feature Engagement |
| `platform_logins` | Platform → Login Activity |
| `agent_optimizer` | Agents → Prompt Optimizer |
| `agent_skillopt` | Agents → Skill Builder |
| `agent_domain` | Agents → Domain PDO/GEPA |
| `agent_bridge` | Agents → Bridge |

### Response shape

```json
{
  "view": "platform_engagement",
  "generated_at": "2026-06-23T10:00:00Z",
  "statics": { "total_users": 1240, "..." : "..." },
  "series": [
    {
      "key": "dau",
      "label": "Daily Active Users",
      "total": 8,
      "time_range": "Last 30 Days",
      "data": [{ "date": "2026-05-24", "value": 3 }, "..."]
    }
  ]
}
```

One endpoint, one DB round-trip per sub-view. All aggregations done server-side.

### File: `src/promptly/admin/api/router.py`
Add the new route to the existing admin router (no new file needed).

### File: `src/promptly/admin/api/schemas.py`
Add: `AnalyticsSeries`, `AnalyticsResponse` Pydantic models.

---

## 4. Platform › Feature Engagement

**Time range:** last 30 days (daily buckets). `days` param defaults to 30.

### Static summary cards (top row, 5 cards)
| Key | Label | Source |
|---|---|---|
| `total_users` | Total Users | `COUNT(users)` |
| `total_optimizations` | Total Optimizations | `COUNT(usage_events WHERE action='optimize')` |
| `total_tokens` | Total Tokens Consumed | `SUM(messages.token_usage['total_tokens'])` |
| `total_credits` | Total Credits Charged | `SUM(skill_opt_projects.credits_charged)` + fixed per optimize/health/advisory |
| `budget_used_pct` | Token Budget Used % | `(3M×total_users − SUM(token_balance)) / (3M×total_users) × 100` |

### Chart cards (2-column grid, 10 cards)
| Key | Label | SQL source | Default chart |
|---|---|---|---|
| `dau` | Daily Active Users | `COUNT DISTINCT user_id FROM usage_events GROUP BY date` | Line |
| `wau` | Weekly Active Users | `COUNT DISTINCT user_id FROM usage_events GROUP BY week` (90d) | Line |
| `optimizations_per_day` | Optimizations per Day | `COUNT usage_events WHERE action='optimize' GROUP BY date` | Line |
| `feature_calls_per_day` | Total Feature Calls per Day | `COUNT usage_events GROUP BY date` | Bar |
| `sessions_per_day` | Sessions Created per Day | `COUNT chat_sessions GROUP BY date` | Bar |
| `logins_per_day` | Unique Logins per Day | `COUNT DISTINCT user_id FROM usage_events GROUP BY date` (proxy) | Line |
| `tokens_per_day` | Tokens Consumed per Day | `SUM(token_usage['total_tokens']) FROM messages GROUP BY date` | Line |
| `signups_per_day` | New Signups per Day | `COUNT users GROUP BY DATE(created_at)` | Bar |
| `credits_per_day` | Credits Consumed per Day | `UsageEvent` action × known cost (optimize=10, health_score=5, advisory=5) + `skill_opt_projects.credits_charged` per day | Line |
| `feature_adoption` | Feature Adoption Breakdown | Stacked bar: % of active users who used each feature per day. 4 series: optimizer / skill_builder / domain / bridge | Stacked Bar |

---

## 5. Platform › Login Activity

**Static KPI cards (top row, 3 cards)**
- DAU — distinct users with `UsageEvent` in last 7 days
- WAU — distinct users with `UsageEvent` in last 7 days (weekly window)
- MAU — distinct users with `UsageEvent` in last 30 days

**Trend chart cards (3 cards)**
| Key | Label | Buckets | Time range |
|---|---|---|---|
| `wau_trend` | WAU Trend | Weekly | Last 90 days |
| `mau_trend` | MAU Trend | Monthly | Last 90 days |
| `qau_trend` | QAU Trend | Quarterly | Last 365 days |

**Additional static cards (3 cards)**
| Key | Label | Calculation |
|---|---|---|
| `d7_retention` | D7 Retention | % users created ≥7d ago who had a `UsageEvent` within their first 7 days |
| `d30_retention` | D30 Retention | % users created ≥30d ago who had a `UsageEvent` within their first 30 days |
| `avg_sessions_per_user` | Avg Sessions per Active User | `COUNT(chat_sessions) / COUNT DISTINCT active users` (last 30d) |

---

## 6. Agents › Prompt Optimizer

**Static cards (2 cards)**
| Key | Label | Calculation |
|---|---|---|
| `avg_tokens_per_opt` | Avg Tokens per Optimization | `SUM(token_usage) / COUNT(chat_sessions)` |
| `calls_per_active_user` | Optimizations per Active User | `total_optimize_events / dau` (last 30d avg) |

**Chart cards (6 cards)**
| Key | Label | Source | Default |
|---|---|---|---|
| `optimizer_runs_per_day` | Runs per Day | `COUNT usage_events action='optimize' GROUP BY date` | Line |
| `optimizer_tokens_per_day` | Tokens per Day | `SUM token_usage FROM messages GROUP BY date` | Line |
| `optimizer_unique_users` | Unique Users per Day | `COUNT DISTINCT user_id FROM usage_events action='optimize'` | Line |
| `optimizer_status_per_day` | Completed vs Failed per Day | Stacked: `COUNT chat_sessions by status per day` | Stacked Bar |
| `optimizer_credits_per_day` | Credits Charged per Day | 10 credits × runs per day | Bar |
| `council_model_distribution` | Council Model Distribution | `COUNT votes per model FROM messages.council_votes` (all time) | Bar |

---

## 7. Agents › Skill Builder

**Static cards (3 cards)**
| Key | Label | Calculation |
|---|---|---|
| `avg_epochs` | Avg Epochs Run | `AVG(epochs_run) FROM skill_opt_projects` |
| `total_examples` | Total Examples Processed | `SUM(example_count) FROM skill_opt_projects` |
| `overall_avg_improvement` | Overall Avg Score Improvement | `AVG(score_after - score_before) FROM skill_opt_projects` |

**Chart cards (6 cards)**
| Key | Label | Source | Default |
|---|---|---|---|
| `skillopt_runs_per_day` | Runs per Day | `COUNT skill_opt_projects WHERE status='completed' GROUP BY date` | Line |
| `skillopt_avg_improvement` | Avg Score Improvement per Day | `AVG(score_after−score_before) GROUP BY date` | Line |
| `skillopt_score_test` | Avg Test Score per Day | `AVG(score_test) GROUP BY date` | Line |
| `skillopt_edits_accepted` | Edits Accepted per Day | `SUM(edits_accepted) GROUP BY date` | Bar |
| `skillopt_acceptance_ratio` | Edit Acceptance Ratio per Day | `SUM(accepted) / SUM(proposed) GROUP BY date` | Line |
| `skillopt_tier_breakdown` | Runs by Tier per Day | Stacked: infer tier from `credits_charged` (5=low, 10=medium, 16=high), `GROUP BY inferred_tier per day` | Stacked Bar |
| `skillopt_unique_users` | Unique Users per Day | `COUNT DISTINCT user_id GROUP BY date` | Line |

---

## 8. Agents › Domain PDO/GEPA

**Chart cards (6 cards)**
| Key | Label | Source | Default |
|---|---|---|---|
| `domain_runs_per_day` | Runs per Day | `COUNT usage_events WHERE action IN ('domain_pdo','domain_gepa') GROUP BY date` | Line |
| `domain_augment_per_day` | Augmentation Runs per Day | `COUNT usage_events WHERE action='domain_gepa_augment' GROUP BY date` | Bar |
| `domain_pdo_vs_gepa` | PDO vs GEPA Split | Two-series bar: `COUNT by action per day` | Stacked Bar |
| `domain_tokens_per_day` | Tokens per Day | Token usage from domain jobs | Line |
| `domain_unique_users` | Unique Users per Day | Distinct users | Line |
| `domain_completion_rate` | Completion Rate per Day | Completed ÷ total per day | Line |

---

## 9. Agents › Bridge

**Static cards (1 card)**
| Key | Label | Calculation |
|---|---|---|
| `bridge_success_rate` | All-time Success Rate | Completed ÷ total bridge runs |

**Chart cards (3 cards)**
| Key | Label | Source | Default |
|---|---|---|---|
| `bridge_per_day` | Bridges per Day | `COUNT usage_events WHERE action='bridge' GROUP BY date` | Line |
| `bridge_tokens_per_day` | Tokens per Day | Token usage | Line |
| `bridge_unique_users` | Unique Users per Day | Distinct users | Line |

---

## 10. Files Changed / Created

### Backend (`qa-chatbot/`)
| File | Change |
|---|---|
| `src/promptly/admin/api/router.py` | Add `GET /analytics` endpoint |
| `src/promptly/admin/api/schemas.py` | Add `AnalyticsSeries`, `AnalyticsResponse` models |

### Frontend (`frontend/`)
| File | Change |
|---|---|
| `src/app/(dashboard)/admin/page.tsx` | Add "View" tab to tab list |
| `src/components/admin/view-tab.tsx` | Top-level View tab: Platform/Agent toggle + sidebar |
| `src/components/admin/analytics/metric-card.tsx` | Shared: number + Recharts chart + Line/Bar toggle |
| `src/components/admin/analytics/static-card.tsx` | Shared: big number + subtitle, no chart |
| `src/components/admin/analytics/platform-engagement.tsx` | Platform → Feature Engagement grid |
| `src/components/admin/analytics/platform-logins.tsx` | Platform → Login Activity grid |
| `src/components/admin/analytics/agent-optimizer.tsx` | Agents → Prompt Optimizer grid |
| `src/components/admin/analytics/agent-skillopt.tsx` | Agents → Skill Builder grid |
| `src/components/admin/analytics/agent-domain.tsx` | Agents → Domain PDO/GEPA grid |
| `src/components/admin/analytics/agent-bridge.tsx` | Agents → Bridge grid |
| `src/types/analytics.ts` | TypeScript types for analytics API response |

---

## 11. Security

- `require_admin` on the entire admin router already covers this endpoint.
- No new auth logic needed.
- All data is aggregate — no individual user prompt content exposed.

---

## 12. Out of Scope

- Real-time / live-updating charts (no polling, no WebSocket)
- CSV export
- Date range picker (time range is fixed per sub-view)
- Email/Slack alerts based on metric thresholds
