# Phase 3b — Authz Audit & Org-Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the vestigial `org` concept (user-scope API keys via the existing `created_by` FK), delete the dead `/orgs` surface, lock in cross-user ownership with a test, and document the RLS model — no change to the live `/users/api-keys` contract.

**Architecture:** One atomic, test-gated refactor (deletions + `org_id` removal + api_key model/repo/endpoint rework + a schema migration + test updates), then a docs task. `created_by` (UUID FK to users) is already populated and indexed, so it becomes the scoping key.

**Tech Stack:** Python 3.12 / `uv` / `alembic` / `pytest` / `ruff` / `mypy`.

---

## Conventions
- Branch `changes-implementation`. Do NOT switch branches / commit to `main`.
- Stage only each task's files. Commit messages end with `-m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`.
- Gate: `make infra && make migrate && make test` (Docker up).

## Live schema facts (verified via introspection)
`api_keys` columns include `org_id varchar NOT NULL` and `created_by uuid NOT NULL`. Indexes: `ix_api_keys_created_by` (plain, keep), `ix_api_keys_org_id` (drop), `uq_api_keys_org_active_name` UNIQUE `(org_id, name) WHERE is_active` (drop). The historical `(user_id,name)` index from `2c00a7d1d563` no longer exists in the live DB. `ApiKeyResponse` schema does NOT expose `org_id` (safe).

---

## Task 1: Org-strip (ATOMIC — all edits, then green gate, then ONE commit)

**Files:**
- Delete: `src/app/api/v1/orgs.py`, `src/app/schemas/org.py`, `tests/integration/api/test_orgs.py`
- Modify: `src/app/api/router.py`, `src/app/core/user_context.py`, `src/app/dependencies.py`, `src/app/schemas/user.py`, `src/app/api/v1/users.py`, `src/app/models/api_key.py`, `src/app/repositories/api_key_repo.py`, `src/app/api/v1/api_keys.py`, `tests/unit/repositories/test_api_key_repo.py` (+ any other test referencing the renamed methods / `org_id`)
- Create: a new alembic migration under `src/app/migrations/versions/`
- Create/extend: a cross-user denial test in `tests/integration/api/test_api_keys.py`

- [ ] **Step 1: Delete the dead `/orgs` surface**
```bash
cd /Volumes/External/promptly
git rm qa-chatbot/src/app/api/v1/orgs.py qa-chatbot/src/app/schemas/org.py qa-chatbot/tests/integration/api/test_orgs.py
```
In `qa-chatbot/src/app/api/router.py`: remove `from app.api.v1.orgs import router as orgs_router` and the `api_router.include_router(orgs_router, tags=["orgs"])` line.

- [ ] **Step 2: Remove `org_id` from the user/auth surface**
- `src/app/core/user_context.py`: delete the `org_id: str` field.
- `src/app/dependencies.py`: in BOTH `UserContext(...)` constructions remove the `org_id=...` argument (the API-key path `org_id=api_key.org_id or ""` and the JWT path `org_id=""`).
- `src/app/schemas/user.py`: delete the `org_id` field.
- `src/app/api/v1/users.py`: remove `org_id=current_user.org_id` from the response construction (around line 33).

- [ ] **Step 3: Rework `models/api_key.py`** — drop `org_id`, switch the unique index to `(created_by, name)`:

Replace the `__table_args__` Index (currently `"uq_api_keys_org_active_name", "org_id", "name", ...`) and delete the `org_id` column so the relevant part reads:
```python
    __table_args__ = (
        Index(
            "uq_api_keys_user_active_name",
            "created_by",
            "name",
            unique=True,
            postgresql_where=text("is_active = true"),
        ),
    )

    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
```
(Delete the `org_id: Mapped[str] = ...` line entirely. Keep all other columns. `String` import may now be unused only if nothing else uses it — verify; `name`/`key_hash` still use `String`, so keep it.)

- [ ] **Step 4: Rework `repositories/api_key_repo.py`** — rename the four org methods to user-scoped on `created_by`:
- `list_by_org(self, org_id: str, ...)` → `list_by_user(self, user_id: uuid.UUID, ...)`; filter `ApiKey.created_by == user_id`.
- `count_by_org(self, org_id: str, ...)` → `count_by_user(self, user_id: uuid.UUID, ...)`; filter `ApiKey.created_by == user_id`.
- `get_by_id_and_org(self, key_id, org_id: str)` → `get_by_id_and_user(self, key_id: uuid.UUID, user_id: uuid.UUID)`; `where(ApiKey.id == key_id, ApiKey.created_by == user_id)`.
- `has_active_org_name(self, org_id: str, name)` → `has_active_user_name(self, user_id: uuid.UUID, name: str)`; `where(ApiKey.created_by == user_id, ApiKey.name == name, ApiKey.is_active == True)`.
Leave `get_active_by_hash`, `deactivate`, `update_last_used`, `revoke`, `_status_filter` unchanged.

- [ ] **Step 5: Rework `api/v1/api_keys.py`** — scope by `current_user.user_id`:
- `create_api_key`: delete `org_id = current_user.supabase_user_id`; change the conflict check to `await repo.has_active_user_name(current_user.user_id, request.name)`; in `repo.create(...)` remove the `org_id=org_id` kwarg (keep `created_by=current_user.user_id`).
- `list_api_keys`: delete `org_id = current_user.supabase_user_id`; `total = await repo.count_by_user(current_user.user_id, status=status)`; `keys = await repo.list_by_user(current_user.user_id, status=status, limit=page_size, offset=offset)`. Update the docstring "for the current user's org" → "for the current user".
- `get_api_key` and `revoke_api_key`: `key = await repo.get_by_id_and_user(key_id, current_user.user_id)`.

- [ ] **Step 6: Create the migration** (change-the-model-then-autogenerate, then verify body)
```bash
cd /Volumes/External/promptly/qa-chatbot
make migration name="drop api_keys org_id, user-scope keys"
```
Open the generated file and ensure its `upgrade()`/`downgrade()` match exactly (fix if autogenerate differs — partial indexes often need manual `postgresql_where`):
```python
def upgrade() -> None:
    op.drop_index("uq_api_keys_org_active_name", table_name="api_keys")
    op.drop_index("ix_api_keys_org_id", table_name="api_keys")
    op.drop_column("api_keys", "org_id")
    op.create_index(
        "uq_api_keys_user_active_name",
        "api_keys",
        ["created_by", "name"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
    )

def downgrade() -> None:
    op.drop_index("uq_api_keys_user_active_name", table_name="api_keys")
    op.add_column("api_keys", sa.Column("org_id", sa.String(length=255), nullable=True))
    op.execute("UPDATE api_keys SET org_id = created_by::text WHERE org_id IS NULL")
    op.alter_column("api_keys", "org_id", nullable=False)
    op.create_index("ix_api_keys_org_id", "api_keys", ["org_id"], unique=False)
    op.create_index(
        "uq_api_keys_org_active_name",
        "api_keys",
        ["org_id", "name"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
    )
```
Ensure `import sqlalchemy as sa` is present in the migration.

- [ ] **Step 7: Update tests referencing the renamed methods / `org_id`**
- `tests/unit/repositories/test_api_key_repo.py`: replace calls to `list_by_org`/`count_by_org`/`get_by_id_and_org`/`has_active_org_name` (and any `org_id=` kwargs / `ApiKey(org_id=...)` construction) with the user-scoped equivalents passing a user UUID (`created_by`). Remove `org_id` from any `ApiKey(...)`/`repo.create(...)` in the test.
- Grep for any other test still referencing `org_id` / the old method names and update them.

- [ ] **Step 8: Add a cross-user denial test** in `tests/integration/api/test_api_keys.py`:
```python
async def test_cannot_access_another_users_api_key(client, headers, headers_b):
    # User A creates a key
    create = await client.post("/api/v1/users/api-keys", json={"name": "a-key"}, headers=headers)
    key_id = create.json()["data"]["id"]
    # User B cannot GET it
    got = await client.get(f"/api/v1/users/api-keys/{key_id}", headers=headers_b)
    assert got.status_code == 404
    # User B cannot revoke it
    revoked = await client.delete(f"/api/v1/users/api-keys/{key_id}", headers=headers_b)
    assert revoked.status_code == 404
```
(Use the same fixtures the file already uses for two distinct users — mirror `headers`/`headers_b` as in `test_chat_sessions.py`. If a two-user fixture isn't present, add one following that file's pattern.)

- [ ] **Step 9: Verify no `org` references remain (except the historical migration)**
```bash
cd /Volumes/External/promptly/qa-chatbot
grep -rniE "org_id|orgs_router|schemas\.org|/orgs|has_active_org_name|list_by_org|count_by_org|get_by_id_and_org" src tests | grep -v "migrations/versions/d8ade696985f"
```
Expected: NO output (the new migration uses `org_id` only inside its own `downgrade()` — that's acceptable; if it appears, confirm it's only in the new migration file).

- [ ] **Step 10: GREEN GATE**
```bash
cd /Volumes/External/promptly/qa-chatbot
uv run ruff check src/ && uv run mypy src/
make infra && make migrate && make test
```
Expected: ruff/mypy green; `alembic upgrade head` applies the new migration; full suite passes (the new cross-user test passes; previously ~585 + new test). If `make migrate` fails on the unique index due to pre-existing duplicate `(created_by, name)` active rows, that's a real data issue — report it (do not drop the uniqueness).

- [ ] **Step 11: ATOMIC COMMIT**
```bash
cd /Volumes/External/promptly
git add qa-chatbot/src/app/api/router.py qa-chatbot/src/app/core/user_context.py qa-chatbot/src/app/dependencies.py qa-chatbot/src/app/schemas/user.py qa-chatbot/src/app/api/v1/users.py qa-chatbot/src/app/models/api_key.py qa-chatbot/src/app/repositories/api_key_repo.py qa-chatbot/src/app/api/v1/api_keys.py qa-chatbot/src/app/migrations/versions/ qa-chatbot/tests/unit/repositories/test_api_key_repo.py qa-chatbot/tests/integration/api/test_api_keys.py qa-chatbot/src/app/api/v1/orgs.py qa-chatbot/src/app/schemas/org.py qa-chatbot/tests/integration/api/test_orgs.py
git commit -m "refactor(security): strip vestigial org concept; user-scope API keys via created_by" -m "Delete dead /orgs surface; drop api_keys.org_id (migration); add cross-user denial test." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git show --stat --oneline HEAD | head -30
```

---

## Task 2: Document the RLS / authz model

**Files:** Modify `qa-chatbot/CLAUDE.md` (Auth section)

- [ ] **Step 1: Add an RLS-defense-in-depth note** to the `### Auth` section of `qa-chatbot/CLAUDE.md`:
```markdown
**Authorization model:** the backend connects to Postgres with a role that bypasses Row-Level
Security, so **app-level ownership checks are the primary guard** (every endpoint requires
`get_current_user`; user-data queries filter by the owner). RLS policies (migration
`b2c3d4e5f6a7`) are retained as **defense-in-depth** for any direct Supabase access. API keys
are user-scoped via `api_keys.created_by`.
```

- [ ] **Step 2: Commit**
```bash
cd /Volumes/External/promptly
git add qa-chatbot/CLAUDE.md
git commit -m "docs: document RLS defense-in-depth + app-level authz model" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (plan author)
- **Spec coverage:** delete org surface (T1 S1), remove org_id from user/auth (T1 S2), api_key user-scoping + migration (T1 S3-6), test updates + cross-user test (T1 S7-8), RLS doc (T2). RLS per-request and input-validation correctly out of scope. ✅
- **Placeholder scan:** exact migration body, exact method renames/signatures, exact endpoint edits, concrete test code; no vague steps. ✅
- **Consistency:** method names (`list_by_user`/`count_by_user`/`get_by_id_and_user`/`has_active_user_name`), index name (`uq_api_keys_user_active_name`), scoping column (`created_by`) used consistently across model, repo, endpoint, migration. ✅
- **Atomicity:** the org-strip is one commit after a green gate incl. `alembic upgrade head` — the only safe unit for a schema + cross-cutting change. ✅
