# Promptly — Complete Product Reference

This document covers every feature, page, user flow, API endpoint, data model, credit rule, and system behaviour in Promptly. Nothing is omitted. Read this to understand exactly what the product does and how every part connects.

---

## Table of Contents

1. [What Promptly Is](#1-what-promptly-is)
2. [Authentication](#2-authentication)
3. [Credit System](#3-credit-system)
4. [The Optimize Page](#4-the-optimize-page)
5. [The LangGraph Pipeline — How Optimization Works](#5-the-langgraph-pipeline--how-optimization-works)
6. [Prompt Versioning and the Prompt ID Concept](#6-prompt-versioning-and-the-prompt-id-concept)
7. [The Analyze Page — Health Score and Advisory](#7-the-analyze-page--health-score-and-advisory)
8. [The Versions Page](#8-the-versions-page)
9. [The Version Detail Page — Diff Viewer](#9-the-version-detail-page--diff-viewer)
10. [The History Page — Session Management](#10-the-history-page--session-management)
11. [The Prompt Library — Favorites](#11-the-prompt-library--favorites)
12. [Domain Prompts — PDO Optimization](#12-domain-prompts--pdo-optimization)
13. [Settings — API Key Management](#13-settings--api-key-management)
14. [Billing — Credits and Usage](#14-billing--credits-and-usage)
15. [The Sidebar and Navigation Shell](#15-the-sidebar-and-navigation-shell)
16. [Backend API Reference](#16-backend-api-reference)
17. [Data Models](#17-data-models)
18. [System Architecture](#18-system-architecture)

---

## 1. What Promptly Is

Promptly is a prompt engineering platform. It takes your existing system prompt and makes it substantially better — not by a human rewriting it, but by running it through a structured multi-model council that proposes, critiques, and synthesizes improvements automatically.

The product has two distinct optimization systems:

**The Council Optimizer** (the main `/optimize` flow): Runs your prompt through four AI models simultaneously, each using a different optimization strategy. A fifth model synthesizes the best result from all four proposals and their peer critiques. This is the general-purpose optimizer — it makes any prompt better regardless of domain.

**The Domain Prompt Optimizer (PDO)** (the `/domain-prompts` flow): You upload a PDF document that defines a specific knowledge domain. The system builds a Q&A dataset from it. Then it runs your prompt through a tournament of 40 head-to-head trials against real questions from your dataset, selecting the variant that actually produces the best answers. This is domain-grounded optimization — the winning prompt has been empirically tested, not just rewritten.

Both systems track everything in a versioning system so you can compare, roll back, diff, and save any prompt across time.

---

## 2. Authentication

### Registration

**Endpoint:** `POST /api/v1/auth/register`

**Request fields:**
- `email` — must be unique across all users
- `password` — stored hashed, never in plaintext
- `full_name` — optional; the frontend auto-derives it from the email local part (everything before the @) if not supplied explicitly

**What happens:**
- A new user record is created with `credits = 100` as the starting balance
- The account is immediately active (`is_active = true`)
- After registration, the frontend immediately calls the login endpoint with the same credentials to get a token, then redirects to `/optimize`

**Response:** `{ id, email, credits, created_at }`

---

### Login

**Endpoint:** `POST /api/v1/auth/login`

**Request fields:**
- `username` — this is the email address (the field is named `username` because it uses OAuth2PasswordRequestForm under the hood)
- `password`

**What happens:**
- Credentials are validated against the stored hash
- A JWT access token and a refresh token are returned
- The frontend stores the token in two places simultaneously:
  1. An httpOnly cookie (`auth_token`) — this is what the Next.js middleware reads to protect dashboard routes on the server side, before React even loads
  2. A Zustand in-memory store — this is what the axios instance reads to attach `Authorization: Bearer {token}` to every API call

**Response:** `{ access_token, refresh_token, token_type: "bearer" }`

---

### Token Refresh

**Endpoint:** `POST /api/v1/auth/refresh`

**Request:** `{ refresh_token }`

**What happens:** Validates the refresh token and issues a new access + refresh token pair.

---

### How Auth Is Enforced

- Every dashboard route is protected by Next.js middleware. If no `auth_token` cookie is present, the request is redirected to `/login` before any page component runs.
- Every API call from the frontend includes `Authorization: Bearer {token}` injected by the axios request interceptor.
- If any API call returns HTTP 401, the axios response interceptor immediately logs out — clears Zustand state, deletes the cookie via the `/api/auth` Next.js API route, and redirects to `/login`.
- The backend also accepts API keys (prefixed with `qac_`) as an alternative to JWT tokens. The `get_current_user()` dependency accepts either. This is for programmatic access.

---

### Session Hydration

When the user navigates to any dashboard page, a component called `AuthInitializer` runs. It reads the `auth_token` cookie server-side and passes the token as a prop to a client component, which uses it to hydrate the Zustand store. This ensures the axios interceptor always has a valid token even on initial page load, without requiring an extra API call.

---

## 3. Credit System

Credits are the unit of consumption in Promptly. Every user starts with 100 free credits on signup. There is no time expiry on credits.

### Credit Costs

| Action | Cost |
|--------|------|
| Optimize a prompt (Council) | 10 credits |
| Optimize a prompt (if already optimal — performance gate) | 5 credits |
| Health Score analysis | 5 credits |
| Advisory analysis | 5 credits |
| Create a domain knowledge base (PDF upload) | 10 credits |
| Domain prompt optimization (PDO) | 10 credits |
| Dataset augmentation (generate more Q&A pairs) | 0 credits — free |

### How Credits Are Deducted

Credit deduction is an atomic SQL operation:

```sql
UPDATE users SET credits = credits - amount
WHERE id = user_id AND credits >= amount
RETURNING id
```

The `AND credits >= amount` clause means the deduction only succeeds if the user has enough balance. If it returns no row, the API returns HTTP 402 Payment Required. This prevents any race condition where two simultaneous requests could overdraft an account.

Credits are deducted **before** the LLM work begins. If the job fails in the Celery worker, the credits are refunded. If the performance gate fires and determines the prompt is already optimal, only 5 credits are charged instead of 10 (5 are refunded).

### Refunds

On job failure, the Celery worker refunds the full 10 credits using:

```sql
UPDATE users SET credits = credits + amount WHERE id = user_id
```

Refunds only happen on terminal failures (not transient ones that will be retried). This prevents double-refunding when a job fails, retries, and then fails again.

### Checking Balance

**Endpoint:** `GET /api/v1/users/credits`

**Response:** `{ credits: int }`

The credit balance is also embedded in the dashboard header as a mini progress bar + number, updated after every action.

### Adding Credits

**Endpoint:** `POST /api/v1/users/credits/add`

**Request:** `{ amount: int }` — available preset amounts in the UI are 100, 250, 500, 1000

---

## 4. The Optimize Page

**Route:** `/optimize`

This is the primary interface. It is a conversation-style page — each optimization runs as a "session" and the full exchange is preserved.

### Starting a New Optimization

The user pastes their existing system prompt into the textarea at the bottom of the page. There are two buttons:

- **Health Score** — runs analysis only (5 credits). Does not optimize.
- **Advisory** — runs analysis only (5 credits). Does not optimize.

The main action — submitting for optimization — is done by pressing Enter or the send button. This costs 10 credits.

### What Gets Submitted

**Endpoint:** `POST /api/v1/chat/`

**Request fields:**
- `prompt` — the raw prompt text
- `session_id` — optional; if supplied, adds to an existing conversation; if omitted, creates a new session
- `prompt_id` — optional UUID; if supplied, the optimized result will be saved as a new version in this existing family
- `name` — optional string; if supplied, used to find or create a named prompt family for versioning
- `feedback` — optional; user's comment for a refinement turn ("make it shorter", "keep the expert persona")
- `category_slug` — optional; tags the optimization with a category context
- `force_optimize` — optional boolean; bypasses the performance gate even if the prompt scores as already optimal
- `category_slug` — optional; provides category context to the LLM pipeline

**Response (immediate, HTTP 202):**
```json
{
  "job_id": "uuid",
  "session_id": "uuid",
  "prompt_id": "uuid or null"
}
```

The API returns immediately with a `job_id`. The actual optimization runs asynchronously in a Celery worker. The frontend does not wait — it starts polling.

### Polling for the Result

**Endpoint:** `GET /api/v1/chat/jobs/{job_id}`

**Response:**
```json
{
  "job_id": "uuid",
  "status": "queued | started | completed | failed",
  "result": { ... },
  "error": "string or null"
}
```

The frontend polls this endpoint every 2 seconds until `status` is either `completed` or `failed`.

### Live Progress via SSE

**Endpoint:** `GET /api/v1/chat/jobs/{job_id}/stream`

This is a Server-Sent Events stream that delivers real-time progress events as the pipeline advances. Each event is a JSON object with a `step` field:

| Step | What it means |
|------|--------------|
| `intent` | The classifier has decided the input is a prompt to optimize |
| `performance_gate` | The prompt is being scored for whether it needs optimization |
| `council` | One of the four models has finished its proposal (`done: 1–4`, `total: 4`) |
| `critic` | Peer review phase is running |
| `synthesize` | The chairman model is producing the final result |
| `quality_gate` | The result is being checked for remaining weak spots (`decision`, `overall`, `weak_dimensions`) |
| `completed` | Pipeline finished — `result` field contains the full output |
| `failed` | Pipeline failed — `error` field contains the reason |

The stream has a 300-second timeout ceiling and uses 250ms polling intervals server-side against a Redis list.

### The Result

When `status` becomes `completed`, the result contains:

```json
{
  "session_id": "uuid",
  "original_prompt": "the exact prompt the user submitted",
  "optimized_prompt": "the final synthesized result",
  "council_proposals": [
    { "model": "openai/gpt-4o-mini", "optimized_prompt": "...", "usage": { "total_tokens": 800 } },
    { "model": "anthropic/claude-3.5-haiku", "optimized_prompt": "...", "usage": { ... } },
    { "model": "google/gemini-2.5-flash", "optimized_prompt": "...", "usage": { ... } },
    { "model": "x-ai/grok-4.1-fast", "optimized_prompt": "...", "usage": { ... } }
  ],
  "token_usage": { "total_tokens": 4200 },
  "prompt_id": "uuid",
  "version": 2,
  "prompt_version_id": "uuid",
  "already_optimized": false,
  "gate_dimension_scores": null,
  "gate_rationale": null
}
```

The `council_proposals` array always has exactly 4 entries — one per model. These are shown inline in the conversation so the user can see what each agent produced individually, in addition to the final synthesized result.

### The Performance Gate

Before running the full 3-round council, the system optionally runs a **performance gate** — a quick 8-dimension quality scoring pass on the submitted prompt. If the prompt already scores as high-quality across all 8 dimensions, the pipeline short-circuits: it marks `already_optimized: true`, refunds 5 credits (so the user pays only 5 instead of 10), and returns without running the full council.

This can be bypassed by passing `force_optimize: true`.

### The Quality Gate

After the chairman synthesizes the final result, the system optionally runs a **quality gate** — it re-scores the synthesized output. If weak dimensions remain and the current iteration count is below the maximum (3), the pipeline loops back and runs another full council round using the previous synthesis as additional context. This can run up to 3 times total.

When the quality gate loops, the SSE stream emits an event with `step: "quality_gate"`, `decision: "loop"`, and `weak_dimensions: ["clarity", "specificity"]` so the frontend can show users what is being refined.

### Continuation and Feedback

After receiving a result, the user can type a follow-up in the same session. For example: "Make it more formal" or "The expert persona is good but remove the step-by-step format." This follow-up is sent with the same `session_id`, which tells the pipeline to use the existing LangGraph checkpoint as starting state. The feedback is attached to the next pipeline run.

### Renaming a Session

**Endpoint:** `PATCH /api/v1/chat/sessions/{session_id}`

**Request:** `{ title: str }`

Sessions are automatically titled by the system using a GPT-4o-mini call (4–6 words, ALL-CAPS). The user can rename any session from the sidebar by clicking the three-dot menu and selecting Rename, then typing a new name inline.

### Deleting a Session

**Endpoint:** `DELETE /api/v1/chat/sessions/{session_id}`

Deletes the session and all its messages. The sidebar updates immediately.

---

## 5. The LangGraph Pipeline — How Optimization Works

The optimization pipeline is a stateful graph built with LangGraph. Every execution is tied to a `session_id` (the LangGraph thread ID), and state is checkpointed to Postgres after every node, making it resumable and inspectable.

### Graph State

The pipeline carries this state through every node:

| Field | Purpose |
|-------|---------|
| `raw_prompt` | The original prompt submitted by the user |
| `session_id` | Links to the ChatSession record and LangGraph checkpoint |
| `user_id` | The authenticated user |
| `feedback` | Optional user refinement instruction for follow-up turns |
| `category_slug` | Category context for the council models |
| `version_history_diff` | A diff of the last 5 versions in the prompt family, if any |
| `intent` | Set by intent_classifier: "optimize" or "irrelevant" |
| `force_optimize` | Bypasses performance gate when true |
| `already_optimized` | Set by performance gate if prompt scores as already optimal |
| `gate_dimension_scores` | 8-dimension scores from the performance gate |
| `gate_rationale` | Explanation from the performance gate |
| `council_responses` | List of 4 model proposals from the council_vote node |
| `critic_responses` | List of 4 peer reviews from the critic node |
| `final_response` | The synthesized prompt from the chairman |
| `iteration_count` | How many full council rounds have run (max 3) |
| `previous_synthesis` | The previous round's output, fed in if quality gate loops |
| `token_usage` | Accumulated token counts across all nodes |
| `error` | Any error message if a node fails |

### Node: intent_classifier

This node runs first on every submission. It classifies the input as either `OPTIMIZE` or `IRRELEVANT`.

`IRRELEVANT` cases include:
- Inputs that are not an existing prompt to be improved (e.g., "write me a prompt from scratch")
- Off-topic inputs (questions, conversation, etc.)
- Harmful content
- Prompt injection attempts

If `IRRELEVANT`, the graph exits immediately. The user is shown a message explaining why. No credits are consumed because the deduction happens in the Celery task only after the pipeline would complete, and the refund fires on the IRRELEVANT path.

### Node: council_vote

Four models run **in parallel** — each receives the same system prompt from `prompts/council_optimizer.md` and the user's raw prompt. Each independently produces an optimized version. The model diversity (OpenAI, Anthropic, Google, xAI) ensures architectural variation in the proposals, not just stylistic variation.

The four models used:
- `openai/gpt-4o-mini` — Analytical strategy
- `anthropic/claude-3.5-haiku` — Creative strategy
- `google/gemini-2.5-flash` — Concise strategy
- `x-ai/grok-4.1-fast` — Structured strategy

The SSE stream fires a `council` event each time one of the four finishes, so the frontend can show a "3/4 models done" style progress indicator.

### Node: critic

Each of the four council models receives the **other three proposals** (not its own), anonymized as Response A, Response B, Response C. It returns a JSON object:

```json
{
  "ranking": ["B", "A", "C"],
  "critiques": {
    "A": "Strong persona but the step-by-step format will break open-ended questions.",
    "B": "Best balance of authority and flexibility.",
    "C": "Too prescriptive about output format."
  },
  "ranking_rationale": "B dominates because..."
}
```

This cross-review creates genuine signal — each model finds weaknesses in the others that it might miss in its own output.

### Node: synthesize

The chairman model receives:
- All 4 original proposals
- All 4 critique reviews (with rankings)
- The original raw prompt

It synthesizes a single final prompt that incorporates the strongest elements from all four proposals, addresses the critiques, and preserves what the original prompt was trying to do. This is not a selection — it is a genuine synthesis.

### Node: quality_gate (optional)

After synthesis, the result is scored on 8 dimensions. If the score is below threshold on any dimension AND the iteration count is below the max (3), the graph loops back to `council_vote`. The previous synthesis is passed as additional context so the next round builds on it rather than starting fresh.

This loop is signalled to the frontend via the SSE stream. The `decision` field is one of:
- `loop` — running another refinement round
- `exit` — quality threshold met, done
- `exit_max` — hit the 3-iteration ceiling, done regardless of score
- `exit_converged` — score stopped improving between rounds, done

### Prompts Directory

All system prompts are `.md` files in `qa-chatbot/prompts/`. They are loaded once at startup and injected into the nodes. Changing optimization behaviour means editing these files — no code changes needed.

| File | Used by |
|------|---------|
| `intent_classifier.md` | `intent_classifier` node |
| `council_optimizer.md` | All four council models |
| `critic.md` | `critic` node |
| `synthesize_best.md` | `synthesize` node |
| `prompt_health_score.md` | Health score endpoint |
| `prompt_advisory.md` | Advisory endpoint |

### The Celery Worker

The pipeline does not run in the FastAPI process. `POST /api/v1/chat/` returns HTTP 202 immediately after enqueuing a Celery task. The task runs in a separate worker process with `max_retries=3` and a 5-second retry delay.

The worker lifecycle:
1. Sets `job status = started` in Redis
2. Resolves category metadata
3. Builds a version history diff from the last 5 versions (if any exist for this prompt family) and injects it as context
4. Runs `ChatService.process()` (the LangGraph pipeline) and an LLM-powered session title generator concurrently
5. Saves the optimized result as a new version in the prompt family
6. Sets `job status = completed` with full result in Redis
7. Fires a silent `score_prompt_async` task for telemetry (no credits charged)

On any exception: refunds 10 credits, sets `job status = failed`, retries up to 3 times. Only the third failure is terminal.

---

## 6. Prompt Versioning and the Prompt ID Concept

Every prompt that passes through Promptly is saved in a versioning system. Understanding this system is essential to understanding how the product works across sessions.

### The Prompt Family

A **prompt family** is identified by a `prompt_id` (UUID). It is a group of related prompt versions — the original, the first optimization, subsequent refinements. Think of a prompt family like a Git repository: same project, different commits over time.

A family has:
- A `prompt_id` — immutable UUID, never changes, identifies the family forever
- A `name` — a human-readable ALL-CAPS label (e.g., "FINANCE ASSISTANT SYSTEM PROMPT")
- One or more versions, each identified by a sequential integer starting at 1

### Version Numbering and Roles

Every version in a family has:
- `version_id` — unique UUID for this specific version
- `prompt_id` — the family it belongs to
- `version` — integer starting at 1, incrementing by 1 each time
- `content` — the full prompt text at this point
- `created_at` — when this version was saved
- `is_favorited` — whether the user has hearted this version
- `name` — the family name (same for all versions in the family)

Version roles are **derived from the version number**, not stored:
- Version 1 → `Original` — the raw prompt the user first submitted
- Version 2 → `Optimized` — the first optimization result
- Version 3+ → `Feedback #1`, `Feedback #2`, etc. — results from follow-up refinement turns

### How Versions Are Created

**On the first optimization of a new prompt:**
- The system creates v1 with `content = raw_prompt`
- The system creates v2 with `content = optimized_prompt`
- A new `prompt_id` is generated
- The family is named via LLM (4–6 ALL-CAPS words summarizing the prompt's purpose)

**On subsequent optimization of the same prompt family:**
- The system appends a new version with `version = max_version + 1`
- The raw prompt submitted is NOT saved again — only the optimized result is added

**On a follow-up refinement turn in the same session:**
- Same logic — another version is appended

**Explicit versioning:**
- The user can pass `prompt_id` when submitting to explicitly link to an existing family
- The user can pass `name` to find a family by name or create one if it doesn't exist
- If neither is passed, the system auto-creates a new family named after the session ID, then renames it with the LLM-generated title

### Retrieving a Prompt Family

**Endpoint:** `GET /api/v1/prompts/versions/{prompt_id}`

Returns all versions for that family, in ascending version order.

**Response:**
```json
{
  "prompt_id": "uuid",
  "name": "FINANCE ASSISTANT SYSTEM PROMPT",
  "versions": [
    { "version_id": "uuid", "prompt_id": "uuid", "name": "...", "version": 1, "content": "...", "created_at": "...", "is_favorited": false, "favorite_id": null },
    { "version_id": "uuid", "prompt_id": "uuid", "name": "...", "version": 2, "content": "...", "created_at": "...", "is_favorited": true, "favorite_id": "uuid" }
  ]
}
```

### Listing All Families

**Endpoint:** `GET /api/v1/prompts/versions`

**Query params:** `page` (1-indexed), `page_size` (1–100, default 20)

Returns all prompt families for the authenticated user, sorted by most recently updated first. Supports pagination.

### Creating a Manual Version

**Endpoint:** `POST /api/v1/prompts/versions`

**Request:** `{ name: str, prompt: str }`

Creates a new family with v1 set to the supplied prompt. This is used for manually saving a prompt without running optimization.

### Diffing Two Versions

**Endpoint:** `GET /api/v1/prompts/versions/{prompt_id}/diff?from=1&to=3`

Returns a character-level diff between any two version numbers in the same family.

**Response:**
```json
{
  "prompt_id": "uuid",
  "from_version": 1,
  "to_version": 3,
  "from_content": "...",
  "to_content": "...",
  "hunks": [
    { "type": "equal", "text": "You are a finance assistant." },
    { "type": "delete", "from_text": "Help users with finance questions." },
    { "type": "insert", "to_text": "You help users with complex financial planning, tax strategy, and investment analysis. Always cite relevant regulations when applicable." },
    { "type": "equal", "text": "Be professional." }
  ],
  "stats": { "added": 4, "removed": 1, "equal": 3 }
}
```

`hunk.type` values:
- `equal` — unchanged text (shown as-is)
- `insert` — added in the newer version (shown highlighted)
- `delete` — removed in the newer version (shown struck through)
- `replace` — text changed (has both `from_text` and `to_text`)

### Favorites

Any version in any family can be hearted (favorited). Favoriting a version does not change the version — it simply creates a `favorite` record linking the user to that version ID.

Favorited versions appear in `/prompt-library`.

---

## 7. The Analyze Page — Health Score and Advisory

**Route:** `/analyze`

This page has no optimization — it is purely diagnostic. The user pastes any prompt and runs either or both analyses independently.

### Health Score

**Endpoint:** `POST /api/v1/prompts/health-score`

**Cost:** 5 credits

**What it returns:**

```json
{
  "prompt": "the prompt that was scored",
  "meta": {
    "overall_score": 7.4,
    "grade": "B",
    "deploy_ready": true,
    "injection_risk": "LOW"
  },
  "scores": {
    "clarity": { "score": 8.0, "rationale": "The instruction is unambiguous." },
    "specificity": { "score": 6.0, "rationale": "Missing domain constraints." },
    "completeness": { "score": 7.0, "rationale": "Covers the main task but no edge cases." },
    "conciseness": { "score": 9.0, "rationale": "No filler." },
    "tone": { "score": 8.0, "rationale": "Appropriate for professional use." },
    "actionability": { "score": 7.0, "rationale": "Clear but lacks output format." },
    "context_richness": { "score": 6.0, "rationale": "No examples provided." },
    "goal_alignment": { "score": 8.0, "rationale": "The prompt matches its stated purpose." },
    "injection_robustness": { "score": 7.0, "rationale": "Some susceptibility to role-override attempts." },
    "reusability": { "score": 7.0, "rationale": "Generalisable across users." }
  },
  "critical_failures": ["No output format specified", "No guardrail for off-topic questions"],
  "top_improvements": ["Add a structured output format", "Add domain-specific constraints"],
  "deploy_verdict": "Suitable for production with minor improvements."
}
```

**Scoring dimensions (each 0–10):**
- **Clarity** — Is the instruction unambiguous? Would any capable model interpret it the same way?
- **Specificity** — Does it constrain the model to the right task and domain?
- **Completeness** — Does it cover edge cases, failure modes, what to do when uncertain?
- **Conciseness** — Is every sentence load-bearing? No filler?
- **Tone** — Does the register match the intended use case?
- **Actionability** — Can a model execute this without guessing what to do?
- **Context Richness** — Does it provide enough grounding (examples, definitions, background)?
- **Goal Alignment** — Does the prompt actually achieve the stated purpose?
- **Injection Robustness** — How resistant is it to prompt injection and role-override attempts?
- **Reusability** — Would this work across different users and inputs without modification?

**Grade mapping:**
- A: 9.0–10.0
- B: 7.0–8.9
- C: 5.0–6.9
- D: 3.0–4.9
- F: 0–2.9

**Injection risk levels:** NONE / LOW / MODERATE / HIGH — derived from the `injection_robustness` score plus structural analysis of the prompt.

**Deploy ready:** Boolean. True when overall_score ≥ 7.0 and injection_risk is not HIGH.

---

### Advisory

**Endpoint:** `POST /api/v1/prompts/advisory`

**Cost:** 5 credits

**What it returns:**

```json
{
  "prompt": "the prompt",
  "meta": { "overall_score": 7, "injection_risk": "LOW" },
  "overall_assessment": "A well-structured prompt with good specificity, but lacks explicit output constraints and edge case handling.",
  "strengths": [
    { "point": "Clear expert persona", "severity": "HIGH" },
    { "point": "Domain-appropriate tone", "severity": "MEDIUM" }
  ],
  "weaknesses": [
    { "point": "No output format specified", "severity": "HIGH" },
    { "point": "Silent on off-topic questions", "severity": "MEDIUM" }
  ],
  "improvements": [
    { "point": "Add a structured output format with headers", "severity": "HIGH" },
    { "point": "Add a fallback instruction for out-of-scope questions", "severity": "MEDIUM" },
    { "point": "Provide one example exchange", "severity": "LOW" }
  ],
  "dimension_scores": {
    "role_and_persona": 8,
    "task_clarity": 7,
    "output_format": 4,
    "constraints_and_guardrails": 5,
    "context_and_grounding": 6,
    "conciseness_and_signal_density": 8,
    "injection_robustness": 7
  }
}
```

The Advisory dimensions are **different** from the Health Score dimensions — they are grouped differently to give actionable, engineering-focused feedback rather than a numerical audit.

**Severity labels:** HIGH / MEDIUM / LOW — indicate how much impact addressing this point would have on prompt quality.

The advisory does not suggest rewrites. It identifies structural problems and explains them in plain language.

---

## 8. The Versions Page

**Route:** `/versions`

This is the library of all prompt families the user has created, across all sessions.

### What Is Shown

Families are listed in order of most recently updated first. They are grouped by date:
- Today
- Last 7 days
- Last 30 days
- Older

Each row shows:
- The family `name` (ALL-CAPS, auto-generated or user-set)
- A snippet preview (first ~100 characters of the latest version's content)
- The number of versions in the family, represented as small visual bars (the most recent bar is highlighted)
- The count of favorited versions in this family
- How long ago the family was last updated (relative time: "2 hours ago")

Clicking a row navigates to `/versions/{prompt_id}`.

### Pagination

The API returns 20 families per page. If there are more than 20, pagination controls appear at the bottom: "N families · page X of Y" with previous and next buttons.

**Endpoint:** `GET /api/v1/prompts/versions?page=1&page_size=20`

### Creating a New Family Manually

The header has a "New family" button that links to `/optimize`. Manual family creation (without optimization) is also supported via `POST /api/v1/prompts/versions`.

---

## 9. The Version Detail Page — Diff Viewer

**Route:** `/versions/{prompt_id}`

This is a two-panel layout. The left panel lists all versions of the family. The right panel shows the selected version's content and provides comparison tools.

### Left Panel — Version List

Each version is shown as a clickable button with:
- Version number (bold if it is the currently selected version)
- A heart icon if that version is favorited
- A "latest" badge on the most recent version
- A role label:
  - Version 1 → "Original" (gray)
  - Version 2 → "Optimized" (purple)
  - Version 3 → "Feedback #1" (orange)
  - Version 4 → "Feedback #2" (orange)
  - etc.
- A relative timestamp ("3 days ago")

Clicking any version updates the right panel.

### Right Panel — Content Viewer

The header shows:
- Version number and role badge
- The date this version was created
- A heart (like) button to toggle favorite status
- A "Diff from…" dropdown selector
- A copy button
- An "Optimize" button

The content area shows the full prompt text.

### Diff Mode

The "Diff from…" dropdown lists all other versions in the family. Selecting one activates diff mode.

In diff mode:
- The content area shows an inline diff between the selected version and the comparison version
- A stats bar at the top shows: `v1 → v3  +12 added  -3 removed  =41 unchanged`
- Added text is highlighted
- Removed text is struck through
- Unchanged text is shown normally

The diff is computed server-side:

**Endpoint:** `GET /api/v1/prompts/versions/{prompt_id}/diff?from=1&to=3`

A "Clear" button next to the dropdown exits diff mode.

### Favoriting a Version

The heart button toggles the favorite status of the currently displayed version. Favorited versions appear in `/prompt-library`.

### The Optimize Button

Clicking "Optimize" on any version pre-fills the `/optimize` textarea with that version's content. The page navigates to `/optimize` and the textarea is populated via `sessionStorage`. The user can then submit it as a continuation of that prompt family's history.

---

## 10. The History Page — Session Management

**Route:** `/history`

This page lists every optimization conversation session the user has ever started.

### What Is a Session

A session is created the first time a user submits a prompt on `/optimize`. Every subsequent turn in the same conversation (feedback, follow-ups) belongs to the same session. A session stores:
- Its `id` (UUID)
- Its `title` (auto-generated by LLM or manually renamed)
- All `messages` (each message is one prompt submission + one assistant response)
- `created_at` and `updated_at` timestamps

### What Is Shown

Sessions are grouped by recency (Today / Last 7 days / Last 30 days / Older). Each row shows:
- Session title (or "Untitled conversation" if it hasn't been named yet)
- Date created
- When it was last updated

Clicking a row navigates to `/optimize?session={session_id}`, which loads that session's full conversation history.

### Session Detail

**Endpoint:** `GET /api/v1/chat/sessions/{session_id}`

Returns the session with all its messages. Each message includes:
- `role` — "user" or "assistant"
- `raw_prompt` — what the user submitted
- `feedback` — any refinement instruction
- `response` — the final optimized prompt (assistant messages only)
- `council_votes` — the four council proposals as JSON (assistant messages only)
- `token_usage` — token counts
- `prompt_version_id` — which version record this message created
- `prompt_family_id` — which family this message belongs to
- `category_slug` — if a category was used
- `created_at`

---

## 11. The Prompt Library — Favorites

**Route:** `/prompt-library`

This page shows all prompt versions the user has favorited, across all sessions and families.

### What Is Shown

A grid of cards (3 columns). Each card shows:
- Whether the prompt is pinned (pin icon)
- The family name
- The version number badge
- A heart icon (always filled — everything here is favorited)
- The prompt content preview (first ~120 characters, clamped to 3 lines)
- Up to 3 tags
- The category badge (if any)
- How long ago the user liked this version ("liked 2 days ago")

### Filtering and Sorting

**Search:** A text input that filters by name or content. Debounced 300ms — search fires after the user stops typing.

**Category filter:** Dropdown with: All / Work / Personal / Research / Creative / Other

**Sort order:**
- Recently liked — ordered by when the favorite was created
- Recently used — ordered by when the version was last referenced in a session
- Most used — ordered by how many times the version has been referenced
- Name — alphabetical by family name

### Navigating from a Card

Clicking a card navigates to `/versions/{prompt_id}` with that specific version selected in the left panel.

---

## 12. Domain Prompts — PDO Optimization

**Route:** `/domain-prompts`

Domain Prompts is a premium feature that grounds prompt optimization in a specific knowledge domain derived from a real PDF document.

### Step 1 — Creating a Domain Knowledge Base

The user clicks "New Domain". A modal appears with:
- **Name** — a label for this domain (1–120 characters)
- **Description** — optional context (max 500 characters)
- **PDF file upload** — accepts files up to 100 MB; the frontend validates the file is under 100 MB before uploading; the backend validates the file starts with `%PDF` bytes to confirm it is a real PDF

**Endpoint:** `POST /api/v1/domain-prompts/` (multipart form data)

**Cost:** 10 credits, deducted immediately on submission.

**What happens after submission:**
1. The API returns HTTP 202 immediately with `{ job_id, domain_id }`
2. The PDF is stored in MinIO at `users/{user_id}/domains/{domain_id}/source.pdf`
3. A `DomainDataset` record is created pointing to the PDF location
4. The `prepare_domain_dataset` Celery task is enqueued
5. The domain's status is set to `pending` then transitions to `preparing_dataset`

**Inside the Celery task (`prepare_domain_dataset`):**
1. Downloads the PDF from MinIO
2. Extracts all text using `pypdf.PdfReader`. If the PDF is unreadable, raises `ValueError("Invalid or unreadable PDF")` which triggers a credit refund and marks the domain as `failed`
3. Splits the text into overlapping chunks of ~2000 characters (10% overlap between chunks to preserve context across boundaries)
4. If the PDF produces more than 15 chunks, only the first 15 are processed (a warning is logged). This caps cost and processing time.
5. For each chunk, calls `openai/gpt-4o-mini` via OpenRouter to generate 5–10 Q&A pairs that cover the key facts and concepts in that section
6. The Q&A pairs are deduplicated and stored as a JSONL file in MinIO at `users/{user_id}/domains/{domain_id}/dataset.jsonl`
7. The `DomainDataset` record is updated with `dataset_key` and `row_count`
8. The domain status is set to `completed`

**If the task fails:**
- Credits are refunded only on terminal failures (e.g., invalid PDF). Transient failures (network, LLM timeout) are retried up to 2 times before refunding.
- The domain status is set to `failed` with an error message stored (up to 500 characters)
- The error exposed to users is always `"Internal server error"` — the raw exception is not leaked

### Step 2 — Viewing the Domain Card

Once the domain status is `completed`, it appears in the grid on `/domain-prompts`. Each card shows:
- Domain name
- Status badge (Queued / Building Dataset / Optimizing / Ready / Failed) with a pulsing dot if in progress
- Number of data sources (Q&A pairs in the dataset)
- Tournament win rate (if the domain has been optimized at least once)

### Step 3 — Viewing Domain Details

Clicking a card opens a slide-over detail panel with two tabs.

#### Optimize Tab

The user submits a system prompt (10–10,000 characters) by typing in the textarea at the bottom and clicking "Run PDO" (10 credits).

**Endpoint:** `POST /api/v1/domain-prompts/{domain_id}/optimize`

**Request:** `{ prompt: str }`

**What happens:**
1. Validates the domain exists and belongs to the user
2. Validates the domain is not already running (status is not `preparing_dataset` or `optimizing`)
3. Validates the dataset is ready (`dataset_key` is not null) — if not ready, returns HTTP 409
4. Deducts 10 credits
5. Sets domain status to `optimizing`, saves `last_prompt`
6. Enqueues `run_domain_optimization` Celery task

**Inside `run_domain_optimization`:**

The PDO (Prompt Duel Optimizer) algorithm runs:

**1. Parse the dataset**

The JSONL file is downloaded from MinIO and parsed into a list of `{ question, answer }` pairs.

**2. Split the dataset**

The pairs are shuffled with a fixed random seed (42) for reproducibility. 85% goes to the `duel_pool` (used during the tournament). 15% goes to `val_split` (held out for final scoring — the tournament winner never sees these during training).

**3. Build domain context**

A `domain_summary` is derived from the first 3 questions in the duel pool (a one-sentence topic summary). A `sample_questions` block lists the first 5 questions. Both are injected into the variant generation prompt so the LLM knows what domain it is optimizing for.

**4. Score the baseline prompt**

The original submitted prompt is scored against up to 15 examples from `val_split`. For each example:
- The prompt is used to answer the question
- GPT-4o judges how well the answer matches the gold answer (0.0 to 1.0 scale)
- All scores are averaged

All 15 scoring calls run **concurrently** (via `asyncio.gather`).

This is `score_before`.

**5. Generate 5 initial candidate variants**

`claude-3.5-haiku` generates 5 rewrites of the base prompt, each using a different enhancement strategy:
- Variant 1: Expert persona with deep domain knowledge
- Variant 2: Step-by-step reasoning protocol
- Variant 3: Strict output format specification
- Variant 4: Safety and scope boundary definition
- Variant 5: Comprehensive combination of all strategies

Each variant is expected to be 150–400 words and to embed domain-specific terminology and rules drawn from the sample questions. The generation uses a 4,096 token budget.

If generation fails (JSON parse error, timeout), the system retries with `n=3` variants. If it fails completely, it falls back to just the base prompt.

The base prompt is always added to the candidate pool (so it competes in the tournament). Duplicates are removed. The pool is capped at 5 candidates.

**6. Run the tournament (40 rounds of Double Thompson Sampling)**

The tournament pits candidates against each other in head-to-head duels. Pair selection uses **Double Thompson Sampling (D-TS)** from the research paper "Dueling Optimization with a Monotone Adversary" (arXiv:2510.13907):

For every pair `(i, j)`, sample:
```
theta_ij ~ Beta(W[i,j] + 1, W[j,i] + 1)
```
Where `W[i,j]` is the number of times candidate `i` has beaten candidate `j`. The pair with the highest sampled `theta` is selected for the next duel.

This approach:
- Starts by exploring all pairs (since all `W` values are 0, Beta(1,1) = Uniform)
- Progressively focuses duels on the strongest candidates
- Never completely ignores any candidate (pure exploitation is avoided)

**Each duel:**
1. A random Q&A pair is drawn from `duel_pool`
2. **Both prompts answer the question concurrently** (via `asyncio.gather`)
3. The presentation order (which answer is shown as "A" vs "B") is randomised with a coin flip — this counteracts position bias in the judge (judges tend to prefer "A" slightly)
4. GPT-4o judges which answer is closer to the gold answer: `{"winner": "A"}` or `{"winner": "B"}`
5. The winner label is mapped back to the original candidate index (accounting for the A/B flip)
6. If the judge's response can't be parsed, a random tiebreak is used
7. `W[winner][loser] += 1`, `N[winner][loser] += 1`, `N[loser][winner] += 1`
8. Elo scores are also updated for both candidates

**Every 10 rounds — Top-performer mutation:**

The current leader is identified (via multi-ranker fusion, see below). A new mutation of the leader is generated using one of 5 rotation strategies:
- Round 10: Detailed step-by-step reasoning protocol
- Round 20: Deeper expert persona with specific domain expertise
- Round 30: Comprehensive output format and uncertainty flagging rules
- Round 40: Domain-specific safety and scope rules

Each mutation tip is detailed (multi-sentence), instructing the LLM to expand and enrich the leader rather than compress it. Mutations use a 2,048 token budget.

If the mutation is not a duplicate of any existing candidate, it is added to the pool. The win matrix is expanded to include the new candidate. Pool size can grow from 5 up to 8 candidates (4 mutations, 1 per interval).

**7. Multi-Ranker Fusion**

After 40 rounds, 5 independent ranking systems each produce a ranking of all candidates:

| System | Method |
|--------|--------|
| **Copeland** | Net wins: count opponents where UCB estimate of win probability > 0.5 |
| **Borda** | Average fractional win rate against each opponent |
| **Average Win Rate** | Total wins / total comparisons |
| **Elo** | Rating after all Elo updates |
| **TrueSkill** | Bayesian estimate: win rate shrunk toward 0.5 based on sample size |

Weights for combining these 5 rankings are sampled from a Dirichlet(1,1,1,1,1) distribution — this makes the fusion stochastic and avoids deterministic ties while still combining all five signals.

The candidate with the lowest weighted rank sum is the winner.

**8. Score the winning prompt**

The winner is scored against `val_split` (the held-out 15% it has never seen) using the same concurrent scoring method. This is `score_after`.

**9. Compute tournament statistics**

- `win_rate` — how many duels the winning candidate won, divided by total duels it participated in
- `candidates_tried` — total number of candidates tested (initial 5 + mutations added)
- `rounds_run` — always 40
- `dataset_size` — total number of Q&A pairs in the dataset

**10. Save results**

The winning prompt, scores, and tournament stats are saved to the `DomainPrompt` record. A `result.json` file is saved to MinIO at `users/{user_id}/domains/{domain_id}/result.json`.

**What the user sees after optimization:**

The Optimize tab shows a two-column layout:
- Left: the input prompt they submitted ("INPUT PROMPT")
- Right: the PDO-optimized result ("PDO OPTIMIZED") with a copy button

Above the columns, a stats bar shows:
- **Tournament win rate** — the winner's win rate (green if ≥60%, amber if lower)
- **Prompts tested** — total candidates tried
- **Head-to-head trials** — always 40
- **Knowledge sources** — number of Q&A pairs in the dataset

The user can submit another prompt at any time — the dataset is reused, only the optimization reruns.

#### Dataset Tab

This tab exposes the underlying Q&A dataset built from the PDF.

**View the dataset:**

**Endpoint:** `GET /api/v1/domain-prompts/{domain_id}/dataset`

**Response:** `{ rows: [{ question, answer }], row_count }`

**Edit rows:**

The user can click "Edit" to enter edit mode. In edit mode:
- Each Q&A pair has editable textareas for question and answer
- Rows can be deleted individually
- New empty rows can be added
- Clicking "Save" calls `PUT /api/v1/domain-prompts/{domain_id}/dataset` with the full updated row list

**Endpoint:** `PUT /api/v1/domain-prompts/{domain_id}/dataset`

**Request:** `{ rows: [{ question: str, answer: str }] }` — replaces the entire dataset

**Generate more Q&A pairs (Augment):**

A "Generate" control lets the user pick a count (1–50) and click "Go". This fires the augmentation job.

**Endpoint:** `POST /api/v1/domain-prompts/{domain_id}/dataset/augment`

**Request:** `{ count: int }` (default 10)

**Cost:** Free

**What happens:**
1. The existing JSONL is downloaded from MinIO
2. Up to 20 existing Q&A pairs are used as context to ensure the new pairs are topically consistent
3. The LLM generates new Q&A pairs
4. New pairs are deduplicated against existing questions (case-insensitive exact match)
5. Only `count` new pairs are added (even if more were generated)
6. The merged dataset is uploaded back to MinIO
7. `DomainDataset.row_count` is updated

The augmentation result is polled via the same job polling endpoint as domain optimization.

### Deleting a Domain

The trash icon in the detail panel header opens an inline confirmation ("Delete domain + dataset?"). Confirming calls:

**Endpoint:** `DELETE /api/v1/domain-prompts/{domain_id}`

**What happens:**
1. The `DomainPrompt` and its associated `DomainDataset` are deleted from Postgres (CASCADE)
2. All MinIO objects under `users/{user_id}/domains/{domain_id}/` are deleted (source PDF, dataset JSONL, result JSON)
3. The detail panel closes and the card disappears from the grid

---

## 13. Settings — API Key Management

**Route:** `/settings`

API keys let users call the Promptly API programmatically without logging in through the browser. The key format is `qac_{random}`.

### Creating a Key

The user types a name for the key (1–100 characters, must be unique among active keys) and clicks "Create key".

The newly created key is displayed **one time only** in a green banner with a copy button. After the user dismisses the banner or navigates away, the full key is never shown again — only the name and status remain visible. The key is stored as a hash in the database.

### Using the Key

Add the key to any API request as:

```
Authorization: Bearer qac_your_key_here
```

The backend's `get_current_user()` dependency accepts this in place of a JWT token.

### Listing Keys

Keys are shown in a list with:
- Status dot (active or revoked)
- Key name
- When it was created
- When it was revoked (if applicable)
- A "Revoke" button (for active keys)

The list has a filter tab: All / Active / Revoked.

If there are many keys, the list is paginated.

### Revoking a Key

Clicking "Revoke" shows an inline confirmation ("Revoke?" + Yes/Cancel). Confirming permanently disables the key. The key record remains visible in the "Revoked" tab with its revocation date. Revoked keys cannot be re-activated.

---

## 14. Billing — Credits and Usage

**Route:** `/billing`

### Three Stat Cards

**Balance card:**
- Shows current credit balance as a large number
- Shows an approximate count of optimizations remaining ("≈ X more optimizations")
- Highlighted with a warning border if balance is low

**This month card:**
- Credits spent in the current calendar month
- Number of API calls made

**Free plan card:**
- Plan name and price ($0/mo)
- Summary: "100 credits on signup · unlimited runs"
- A "Top up" shortcut button

### Topping Up Credits

The "Top up credits" button opens a dropdown with four preset amounts: 100, 250, 500, 1000. Clicking any amount calls:

**Endpoint:** `POST /api/v1/users/credits/add`

**Request:** `{ amount: int }`

Credits are added immediately and the balance updates.

### Usage Breakdown

A visual breakdown of how credits have been spent across all time, broken into three categories:

| Category | Cost per call | Display |
|----------|-------------|---------|
| Optimize | 10 credits | Purple bar |
| Health Score | 5 credits | Cyan bar |
| Advisory | 5 credits | Orange bar |

Each row shows a normalized bar (relative to the largest category), the number of calls, and the total credits spent.

### API Keys Preview

A small table at the bottom shows the user's "default" API key (name shown, key value masked as `qac_••••••••••••••••••`) with a note on how to use it in API calls.

---

## 15. The Sidebar and Navigation Shell

The sidebar is present on every dashboard page. It is persistent and cannot be closed — it can only be resized by dragging its right edge.

### Structure (top to bottom)

**1. Logo + New Chat button**
The Promptly logo sits at the top. Below it, a "New Chat" button navigates to `/optimize` with no session ID, starting a fresh conversation.

**2. Search bar**
A search input with a Cmd+K keyboard shortcut hint. (Searches across sessions and prompt families.)

**3. Navigation links**

| Label | Route | Keyboard shortcut |
|-------|-------|------------------|
| Dashboard | /dashboard (redirects to /optimize) | D |
| Optimize | /optimize | O |
| Analyze | /analyze | A |
| Versions | /versions | V |
| Prompt Library | /prompt-library | S |
| Domain Prompts | /domain-prompts | — |
| Prompts Media | /prompts-media | — |
| Prompt Project | /prompt-project | — |
| History | /history | — |
| Billing | /billing | — |
| Settings | /settings | — |

Domain Prompts has a "PREMIUM" badge.

**4. Recent sessions list**

Below the nav links, the sidebar shows the user's most recent chat sessions. Each session is a link. Hovering reveals a three-dot menu with two options:

- **Rename** — replaces the session title in the sidebar with an inline text input. Pressing Enter saves the new name (`PATCH /api/v1/chat/sessions/{session_id}`). Pressing Escape cancels.
- **Delete** — shows an inline confirmation dialog. Confirming calls `DELETE /api/v1/chat/sessions/{session_id}`.

Sessions show a pulsing purple dot while the LangGraph pipeline is actively generating output for them.

**5. User footer**

At the very bottom of the sidebar:
- Avatar circle (initials)
- Display name
- Credit balance (number)
- Logout button

### Header Bar

The header is a thin bar at the top of the main content area (to the right of the sidebar).

**Left side:** Breadcrumbs showing the current location (e.g., "Workspace / Versions / Detail")

**Right side:**
- Credits chip: current balance with a mini progress bar and the word "credits". Links to `/billing`.
- API keys button: links to `/settings`
- Share button: placeholder, non-functional

---

## 16. Backend API Reference

### Base URL

`/api/v1/`

### Authentication

All endpoints require `Authorization: Bearer {token}` — either a JWT from `/auth/login` or an API key starting with `qac_`.

### Rate Limits

| Tier | Limit | Applies to |
|------|-------|-----------|
| Standard | 60 req/60s | Most read endpoints |
| Write | 10 req/60s | Chat submit, domain create, domain optimize |
| Expensive | 20 req/60s | Health score, advisory, versions, session operations |

### Full Endpoint List

#### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | /auth/register | Create account (100 free credits) |
| POST | /auth/login | Get JWT + refresh token |
| POST | /auth/refresh | Rotate token pair |

#### Users
| Method | Path | Description |
|--------|------|-------------|
| GET | /users/me | Get authenticated user profile |
| GET | /users/credits | Get credit balance |
| POST | /users/credits/add | Add credits |

#### Chat
| Method | Path | Description |
|--------|------|-------------|
| POST | /chat/ | Submit prompt for optimization (10 cr) |
| GET | /chat/jobs/{job_id} | Poll job status |
| GET | /chat/jobs/{job_id}/stream | SSE progress stream |
| POST | /chat/suggest-name | Auto-name a prompt (LLM) |
| POST | /chat/save-version | Manually save a version |
| GET | /chat/sessions | List sessions grouped by date |
| GET | /chat/sessions/recent | Last N sessions with snippet |
| GET | /chat/sessions/{session_id} | Full session + all messages |
| PATCH | /chat/sessions/{session_id} | Rename session |
| DELETE | /chat/sessions/{session_id} | Delete session + messages |

#### Prompts
| Method | Path | Description |
|--------|------|-------------|
| POST | /prompts/health-score | Score prompt on 10 dimensions (5 cr) |
| POST | /prompts/advisory | Get qualitative feedback (5 cr) |
| GET | /prompts/versions | List all prompt families (paginated) |
| POST | /prompts/versions | Create family manually |
| GET | /prompts/versions/{prompt_id} | All versions of one family |
| GET | /prompts/versions/{prompt_id}/diff | Diff between two version numbers |

#### Domain Prompts
| Method | Path | Description |
|--------|------|-------------|
| GET | /domain-prompts/ | List all domains |
| POST | /domain-prompts/ | Create domain from PDF (10 cr) |
| GET | /domain-prompts/jobs/{job_id} | Poll domain job status |
| GET | /domain-prompts/{domain_id} | Get single domain |
| GET | /domain-prompts/{domain_id}/dataset | Get all Q&A rows |
| PUT | /domain-prompts/{domain_id}/dataset | Replace all Q&A rows |
| POST | /domain-prompts/{domain_id}/dataset/augment | Generate more Q&A rows (free) |
| POST | /domain-prompts/{domain_id}/optimize | Run PDO optimization (10 cr) |
| DELETE | /domain-prompts/{domain_id} | Delete domain + MinIO objects |

#### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Liveness check |
| GET | /ready | Readiness check (Postgres + Redis) |

---

## 17. Data Models

### User
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| email | str(255) | Unique, indexed |
| hashed_password | str(255) | Bcrypt hash |
| api_key_hash | str(255) | Nullable, indexed |
| full_name | str(255) | Nullable |
| is_active | bool | Default true |
| is_superuser | bool | Default false |
| last_login_at | datetime | Nullable |
| credits | int | Default 100 |
| created_at | datetime | Auto |
| updated_at | datetime | Auto |

### ChatSession
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| user_id | UUID | FK → users.id, indexed |
| title | str(255) | Nullable; set by LLM |
| graph_thread_id | str(255) | Unique; used as LangGraph thread key |
| created_at | datetime | Auto |
| updated_at | datetime | Auto |

### Message
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| session_id | UUID | FK → chat_sessions.id, indexed |
| role | str(20) | "user" or "assistant" |
| raw_prompt | text | Nullable; the user's submitted prompt |
| feedback | text | Nullable; refinement instruction |
| enhanced_prompt | text | Nullable |
| response | text | Nullable; final optimized prompt (assistant role) |
| council_votes | JSON | Nullable; array of 4 model proposals |
| model_used | str(100) | Nullable |
| token_usage | JSON | Nullable; `{ total_tokens, input_tokens, output_tokens }` |
| prompt_version_id | UUID | FK → prompt_versions.id, SET NULL on delete |
| prompt_family_id | UUID | Nullable; the prompt_id of the family |
| category_slug | str(40) | Nullable |
| created_at | datetime | Auto |
| updated_at | datetime | Auto |

### PromptVersion
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key (the `version_id`) |
| prompt_id | UUID | Groups versions into a family; indexed |
| user_id | UUID | FK → users.id, indexed |
| name | str(255) | Family name (same for all in group) |
| version | int | Sequential, 1-based within family |
| content | text | The prompt text |
| created_at | datetime | Auto |
| updated_at | datetime | Auto |

### DomainPrompt
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| user_id | UUID | FK → users.id CASCADE, indexed |
| name | str(120) | User-assigned domain name |
| description | text | Nullable |
| base_prompt | text | Nullable |
| last_prompt | text | Nullable; most recently submitted prompt |
| optimized_prompt | text | Nullable; PDO winner |
| status | enum | pending/preparing_dataset/optimizing/completed/failed |
| score_before | float | Nullable; baseline score on val split |
| score_after | float | Nullable; winner's score on val split |
| win_rate | float | Nullable; winner's win rate in tournament |
| candidates_tried | int | Nullable; total candidates tested |
| credits_charged | int | Default 10 |
| error_message | text | Nullable; up to 500 chars |
| created_at | datetime | Auto |
| updated_at | datetime | Auto |

### DomainDataset
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| domain_id | UUID | FK → domain_prompts.id CASCADE, unique, indexed |
| user_id | UUID | FK → users.id CASCADE, indexed |
| minio_bucket | str(120) | MinIO bucket name |
| pdf_key | str(500) | Path to source PDF in MinIO |
| dataset_key | str(500) | Nullable; path to JSONL in MinIO |
| row_count | int | Nullable; number of Q&A pairs |
| created_at | datetime | Auto |
| updated_at | datetime | Auto |

---

## 18. System Architecture

### Process Model

The system runs as three separate processes:

1. **FastAPI API server** (`make dev`) — handles HTTP requests; never runs LLM work directly for the main optimize flow
2. **Celery worker** (`make worker`) — runs all long LLM jobs; required for `/chat/` and domain optimization to work
3. **Infrastructure** (`make infra`) — Docker containers for Postgres, Redis, MinIO

Without the Celery worker running, all optimize requests will hang in `queued` state forever and never complete.

### Infrastructure

| Service | Purpose |
|---------|---------|
| PostgreSQL | User records, sessions, messages, prompt versions, domain records, LangGraph checkpoints |
| Redis | Celery broker + backend, job status cache, SSE event queue |
| MinIO | PDF files, JSONL datasets, result JSON for domain prompts |

### Storage Structure (MinIO)

```
promptly/                          ← bucket
  users/{user_id}/
    domains/{domain_id}/
      source.pdf                   ← uploaded PDF
      dataset.jsonl                ← Q&A dataset (one JSON per line)
      result.json                  ← PDO result (optimized prompt + scores)
```

### Job State (Redis)

All async jobs use the same Redis key pattern:

**Chat jobs:**
- `chat:job:{job_id}:status` → `queued | started | completed | failed`
- `chat:job:{job_id}:owner` → `{user_id}` (security check on poll)
- `chat:job:{job_id}` → full result JSON
- `chat:job:{job_id}:progress` → Redis LIST of SSE events

**Domain jobs:**
- `domain_prompt:job:{job_id}:status`
- `domain_prompt:job:{job_id}:owner`
- `domain_prompt:job:{job_id}` → result JSON

### Response Caching

Chat responses are cached in Redis keyed by SHA-256 of the lowercased, stripped prompt. If a user submits a prompt that is identical to one already processed, the cached result is returned without running the pipeline again. The cache key is `chat:response:{hash}`.

### LangGraph Checkpointing

Every LangGraph state transition is checkpointed to Postgres via `AsyncPostgresSaver`. The checkpoint is keyed by `graph_thread_id` (which equals `session_id`). This means:
- Conversations are resumable across server restarts
- Each node's input and output state is preserved
- The full execution history is queryable for debugging

### LLM Routing

All LLM calls go through **OpenRouter** (`https://openrouter.ai/api/v1`). OpenRouter is a unified API gateway that provides access to multiple model providers under a single API key. This means:
- Model switches require only a model slug change, not a new API integration
- The four council models span four different architectures (OpenAI, Anthropic, Google, xAI)
- Domain prompt optimization uses `claude-3.5-haiku` for answering and `gpt-4o` for judging — deliberately different architectures to avoid self-preference bias in the tournament judge

### Security Notes

- JWT tokens are stored in httpOnly cookies — JavaScript cannot access them, preventing XSS token theft
- The Zustand store holds a copy for the axios interceptor — this is in-memory only and cleared on logout
- Job ownership is verified on every poll request — a user cannot poll another user's job ID
- API keys are stored as hashes — the plaintext is shown exactly once at creation and never again
- Credit deductions use database-level `WHERE credits >= amount` to prevent race condition overdrafts
- All error messages returned to users are sanitized — internal exception details (`str(exc)`) are logged but never sent to the client

---

*Last updated: May 2026. This document reflects the codebase as it stands on the `domain-specific-prompts` branch.*
