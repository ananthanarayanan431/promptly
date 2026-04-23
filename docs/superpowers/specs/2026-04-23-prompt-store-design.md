# Prompt Store — Design Spec

**Date:** 2026-04-23
**Status:** Approved, ready for implementation planning
**Scope:** New feature — let users "like" specific optimized prompts and browse them in a dedicated Prompt Store page.

---

## 1. Summary

Users can star (like) any optimized prompt in the chat interface. Liked prompts are individual `PromptVersion` rows (not whole families). The new **Prompt Store** page lists every liked prompt with rich, editable metadata: personal note, tags, category, pin state, and use count. Stars also appear on the Versions page (list and detail) for parity.

A new `favorite_prompts` table — with its own primary key (the `prompt_store_id`) — owns this data. An LLM auto-tag call on like-time seeds tags and category; the user edits both on the Store page.

---

## 2. Goals & Non-Goals

**Goals**
- One-click like from the chat's optimized-prompt output.
- Dedicated Prompt Store page with search, filter (category + tags), and sort.
- Per-card metadata: name + version, dates, token usage, note, tags, category, pin, use count.
- Stars on the Versions page (list and detail) reflect the same state.
- Auto-suggested tags + category via a free (no-credit) LLM call at like-time.

**Non-goals (this iteration)**
- Sharing favorites between users.
- Exporting the Store (JSON/CSV).
- Folders/collections (tags cover grouping).
- Favoriting anything other than `PromptVersion` rows.

---

## 3. Data Model

### New table: `favorite_prompts`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID, PK | This is the `prompt_store_id`. |
| `user_id` | UUID, FK → `users.id`, indexed | |
| `prompt_version_id` | UUID, FK → `prompt_versions.id`, `ON DELETE CASCADE`, indexed | |
| `note` | Text, nullable | User's "why I liked it". |
| `tags` | JSON (array of strings), default `[]` | Seeded by LLM; edited on Store page. Max 10. |
| `category` | String(20), default `"Other"` | One of: `Writing`, `Coding`, `Analysis`, `Other`. |
| `is_pinned` | Boolean, default `false` | Pinned cards sort first. |
| `use_count` | Integer, default `0` | Incremented on Copy/Use. |
| `last_used_at` | Timestamp, nullable | |
| `liked_at` | Timestamp, `DEFAULT now()` | Immutable. |
| `created_at`, `updated_at` | Timestamps | From `TimestampMixin`. |

**Constraints & indexes**
- `UNIQUE (user_id, prompt_version_id)` — makes like a DB-level boolean; re-like is idempotent, unlike is a row delete.
- Indexes: `user_id`, `prompt_version_id`, composite `(user_id, is_pinned, liked_at DESC)` for the default sort.

**New SQLAlchemy model:** `qa-chatbot/src/app/models/favorite_prompt.py`. Relationships:
- `FavoritePrompt.user` (User `favorite_prompts` back-ref)
- `FavoritePrompt.prompt_version` (no back-ref needed)

**Alembic migration:** `add_favorite_prompts_table`.

**No separate `favorite_tags` table.** User's distinct tag set is derived with a `SELECT DISTINCT jsonb_array_elements_text(tags)` query. Revisit only if measurably slow.

---

## 4. Backend API

**New router:** `qa-chatbot/src/app/api/v1/favorites.py`, mounted at `/api/v1/favorites`.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/favorites` | Body: `{ prompt_version_id }`. Creates (201) or returns existing (200). Triggers sync LLM auto-tag; on failure, saves with empty tags + `"Other"` category. |
| `DELETE` | `/favorites/{prompt_store_id}` | 204 on success; 404 if not owned. |
| `DELETE` | `/favorites/by-version/{prompt_version_id}` | Convenience unlike for the chat UI (knows only the version id). |
| `GET` | `/favorites` | Query: `q`, `category`, `tag` (repeatable), `sort` (`recently_liked` \| `recently_used` \| `most_used` \| `name`), `limit`, `offset`. Returns joined version/family data. |
| `GET` | `/favorites/{prompt_store_id}` | Single favorite with full joined data. |
| `PATCH` | `/favorites/{prompt_store_id}` | Partial update of `note`, `tags`, `category`, `is_pinned`. |
| `POST` | `/favorites/{prompt_store_id}/use` | Increments `use_count`; sets `last_used_at = now()`. Returns 204. |
| `GET` | `/favorites/tags` | Distinct tag set for current user. |
| `GET` | `/favorites/status?prompt_version_id=<id>` | `{ is_favorited: bool, prompt_store_id: uuid \| null }`. Used by chat + Versions pages. |

All endpoints require auth via the existing `get_current_user` dependency. All queries filter by `user_id`. Cross-user access returns 404 (never leaks existence).

### Layers

- **Schemas:** `qa-chatbot/src/app/schemas/favorite.py` — `FavoriteCreateRequest`, `FavoriteUpdateRequest`, `FavoriteResponse` (includes nested version/family fields), `FavoriteListResponse`, `FavoriteStatusResponse`.
- **Repository:** `qa-chatbot/src/app/repositories/favorite_repo.py` — extends `BaseRepository[FavoritePrompt]`. Methods: `get_by_version(user_id, version_id)`, `list_for_user(user_id, filters, sort, pagination)`, `distinct_tags(user_id)`, `increment_use(favorite_id)`.
- **Service:** `qa-chatbot/src/app/services/favorite_service.py` — orchestrates repo + LLM tag suggestion.
- **Exceptions:** `qa-chatbot/src/app/api/v1/exceptions/favorites.py` — `FavoriteNotFoundException`, following existing patterns.

### LLM auto-tag

- **Prompt:** `qa-chatbot/prompts/favorite_auto_tag.md` — returns strict JSON: `{ "tags": [...], "category": "Writing" }`.
- **Caller:** `FavoriteService._generate_tags(content)` — OpenRouter call using the first `COUNCIL_MODELS` slot (cheap model). Wrapped in try/except with 2s timeout; JSON parse errors or network failures fall back to `{ tags: [], category: "Other" }` so the like still succeeds.
- **Cost:** free — not charged against user credits.
- **Latency note:** synchronous for MVP. If p50 > 1s in practice, push to a Celery task in a follow-up — data model already supports async tag backfill.

### Backend changes to existing endpoints

- `PromptVersion` list/detail responses (`GET /api/v1/prompts/versions`, `GET /api/v1/prompts/versions/{id}`) gain `is_favorited: bool` and `favorite_id: uuid | null` per version.
- `JobResult` (chat job polling response) must expose `prompt_version_id` so the like button on `ResultPanel` has the id to POST. Audit current shape; add if missing.

---

## 5. Frontend

### 5.1 Shared

- **Types** in `frontend/src/types/api.ts`: `FavoritePrompt`, `FavoriteStatus`, `FavoriteListItem`, `FavoriteCategory` union.
- **API helpers** in `frontend/src/lib/favorites.ts`.
- **Query keys:** `['favorites']`, `['favorites', 'status', versionId]`, `['favorites', 'tags']`. Shared cache means toggling a star anywhere updates everywhere instantly.
- **Optimistic updates** on like/unlike/pin with rollback on error; toast on success/failure.

### 5.2 Chat like button

- **Component:** `frontend/src/components/optimize/like-button.tsx` — 16px star, filled when liked, purple accent (`#7c5cff`).
- **Placement:** action row on the assistant message (`ResultPanel` / `ChatMessage`), next to the existing Copy button.
- **Click:** `POST /favorites` with `prompt_version_id`. No modal — instant like. Tags + category generated in background; user edits later on the Store page.
- **Edge case:** if `prompt_version_id` is missing from the job result, the button is hidden (not disabled with an error).

### 5.3 Versions page

- **List (`versions/page.tsx`):** small star + count on each family row (`⭐ 2`), only when count > 0.
- **Detail (`versions/[id]/page.tsx`):** star on every version in the left list and a larger star button in the right-hand toolbar between Diff and Copy. Both mirror the same state via shared query cache.
- **Data:** server-bundled `is_favorited` + `favorite_id` on each version (Section 4), avoiding a second round-trip.

### 5.4 Prompt Store page

**Route:** `frontend/src/app/(dashboard)/prompt-store/page.tsx` + `[id]/page.tsx`. Sidebar entry between **Versions** and **Prompt Project** (keybind `S`).

**Header**
- Title "Prompt Store" + count chip.
- Debounced search (300ms) → `?q=` (matches name, note, tags, content).
- Sort dropdown: Recently liked (default) / Recently used / Most used / Name.

**Filter bar**
- Category pills: All / Writing / Coding / Analysis / Other (single-select).
- Tag chips from `GET /favorites/tags`, multi-select (AND).

**Card grid** (1/2/3 cols responsive)

Each card:
- Family name + version badge → links to Versions detail.
- Pin toggle (top-right).
- 4-line content preview, mono, fade-out.
- Up to 4 tag chips + "+N" overflow; tag click filters the page.
- Meta row: category · `Liked 3d ago` · `🪙 1.2k tokens` · `Used 7×`.
- Actions: Copy, Use in chat, Edit, Unlike.

**Empty state:** "No saved prompts yet. Tap the star ⭐ on any optimized result to save it here." + CTA to `/optimize`.

**Detail view (`/prompt-store/[id]`)** — drawer on desktop, full page on mobile.
1. Header: family + version + "Open in Versions →".
2. Full content (read-only, copy button).
3. Note editor — multi-line textarea, auto-save on blur via `PATCH`, character counter.
4. Tag editor — chip input, autocomplete from `GET /favorites/tags`, Enter/comma to add, max 10.
5. Category segmented control.
6. Metadata (read-only): dates, token breakdown, use count, last used.
7. Danger zone: "Remove from Prompt Store".

**State**
- List: `useQuery(['favorites', filters, sort])` — server-side filtering.
- Detail: `useQuery(['favorites', id])`.
- Mutations: PATCH (debounced on blur), DELETE, `POST /use` on Copy and Use. Optimistic updates, invalidate `['favorites']` on success.

**Polish**
- `/` focuses search; `Esc` clears filters.
- Pinned cards: subtle purple left-border accent, sorted first.
- Hover animation: lift 1px, border brightens.

---

## 6. Testing

### Backend

**Unit** (`tests/unit/services/test_favorite_service.py`, `tests/unit/repositories/test_favorite_repo.py`):
- Repo: CRUD; unique constraint rejects duplicates; ownership filter returns `None` for cross-user; search/filter/sort permutations; `distinct_tags` per-user; `increment_use` updates both fields.
- Service: LLM success; LLM failure falls back to empty tags + `"Other"`; malformed JSON recovered; idempotent re-like does not re-invoke LLM.

**Integration** (`tests/integration/api/test_favorites.py`):
- `POST /favorites` — 201 new, 200 duplicate, auth required, unknown version 404, cross-user version 404.
- `GET /favorites` — q, category, tag filters; all four sorts; pagination; returns joined data.
- `PATCH /favorites/{id}` — partial updates, category enum validation, tag validation (max 10, strings).
- `POST /favorites/{id}/use` — increments; subsequent `GET` reflects values.
- `DELETE /favorites/{id}` and `DELETE /favorites/by-version/{id}` — both paths; cross-user 404.
- `GET /favorites/status` — both favorited and non-favorited paths.
- `GET /favorites/tags` — distinct, per-user.

**LLM mocking:** patch the OpenRouter client in the service layer for determinism.

### Frontend

No test infrastructure currently present. Manual verification checklist in the plan covers the end-to-end loop: optimize → like → appears in Store → edit note/tags → use (count increments) → unlike.

---

## 7. Migration & Rollout

- **Migration:** `make migration name=add_favorite_prompts_table`. Creates table, unique constraint, indexes.
- **Additive-only** schema; no backfill. Existing users have zero favorites.
- **No feature flag** — additive, low-risk. Latency concerns on the LLM call are addressed by the 2s timeout + graceful fallback.

**Rollout order**
1. Backend: model + migration + repo + service + routes + tests.
2. Backend: enrich `PromptVersion` responses with `is_favorited` + `favorite_id`.
3. Backend: ensure `JobResult` exposes `prompt_version_id` (audit and add if missing).
4. Frontend: types + API helpers + shared query hooks.
5. Frontend: like button on chat + Versions stars.
6. Frontend: `/prompt-store` list + detail + sidebar entry.
7. Manual smoke test of the full loop.

---

## 8. Risks

- **LLM latency on `POST /favorites`** — 2s timeout + graceful fallback mitigates. Revisit async (Celery) if p50 > 1s.
- **Orphaned favorites** if a `PromptVersion` is deleted — FK is `ON DELETE CASCADE`.
- **Tag sprawl** — 10-tag cap per favorite; revisit if it becomes real.
