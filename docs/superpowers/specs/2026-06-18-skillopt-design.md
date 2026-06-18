# SkillOpt: Executive Strategy for Self-Evolving Agent Skills

**Date**: 2026-06-18
**Paper**: arXiv:2605.23904
**GitHub**: https://github.com/microsoft/SkillOpt
**Status**: Approved for implementation

---

## Overview

SkillOpt treats a compact natural-language **skill document** (300–2,000 token markdown) as the
trainable state of a frozen LLM agent. Given a task domain and Q&A examples, it evolves a
companion guidance document via scored rollouts → optimizer reflection → bounded edits →
validation gating. The deployed artifact is `best_skill.md` — a system-prompt guide the user
can apply to any frozen model.

**Deep-learning analogy (from paper §3)**:
- Rollout batch = forward pass
- Optimizer reflection = language-level backward pass
- Edit budget = learning rate (cosine decay)
- Held-out validation gate = accept only strictly-improving edits
- Rejected-edit buffer = negative momentum
- Epoch-wise slow/meta update = momentum term

---

## User Flow

1. Create a **Skill Project** (name, task description)
2. Upload a PDF **or** enter Q&A examples manually
3. Choose a budget tier (Low / Medium / High)
4. Hit **Run SkillOpt** → Celery task dispatched
5. Watch live: epoch counter, accepted/rejected edits, current skill document evolving
6. Export `best_skill.md` and use it as a system prompt

---

## Algorithm (adapted for web cost)

```pseudocode
Input : task_description, examples (D), seed_skill Φ₀
Output: best_skill.md

Split D → D_train (60%), D_sel (40%)
current_skill = Φ₀ ;  best_skill = Φ₀
current_score = score(Φ₀, D_sel)
best_score    = current_score
rejected_edits = []
meta_notes     = []

for epoch in 1..EPOCHS:
    lr = cosine_lr_decay(LR_BUDGET, epoch, EPOCHS)
    rollout_results = []

    for batch in chunked(D_train, ROLLOUT_BATCH):
        for example in batch:
            output = run_with_skill(current_skill, example.input)
            score  = judge(output, example.expected)
            rollout_results.append(Trace(example, output, score))

    successes = [t for t in rollout_results if t.score >= 0.5]
    failures  = [t for t in rollout_results if t.score <  0.5]
    all_edits = []

    for (s_mb, f_mb) in zip(
            chunked(successes, REFLECT_MINIBATCH),
            chunked(failures,  REFLECT_MINIBATCH)):
        edits = reflect(current_skill, s_mb, f_mb,
                        rejected_edits, meta_notes, lr)
        all_edits.extend(edits)

    ranked_edits   = rank_and_merge(all_edits, budget=lr)
    candidate      = apply_edits(current_skill, ranked_edits)
    cand_score     = score(candidate, D_sel)

    if cand_score > current_score:           # hard gate
        current_skill  = candidate
        current_score  = cand_score
        if cand_score > best_score:
            best_skill = candidate
            best_score = cand_score
    else:
        rejected_edits.extend(ranked_edits)   # negative buffer

    meta_notes = slow_meta_update(
        current_skill, rollout_results,
        accepted_edits, rejected_edits)

return best_skill, best_score
```

### Budget Tiers

| Parameter | Low | Medium | High |
|---|---|---|---|
| Epochs | 2 | 3 | 4 |
| Rollout batch | 10 | 20 | 30 |
| Reflection minibatch | 4 | 4 | 6 |
| Edit budget (lr) | 3 | 4 | 5 |
| Credits | 5 | 10 | 16 |

### LLM Roles

| Role | Model | Purpose |
|---|---|---|
| Executor | `anthropic/claude-3.5-haiku` | Runs skill + example → generates answer |
| Scorer | `openai/gpt-4o-mini` | Judges answer quality (0–1) |
| Optimizer | `openai/gpt-4o-mini` | Proposes ADD/DELETE/REPLACE edits |
| Seed generator | `openai/gpt-4o-mini` | Writes initial skill from task description |

---

## Backend Architecture

```text
qa-chatbot/src/promptly/skill_opt/
├── __init__.py                   # exports router
├── api/
│   ├── __init__.py
│   ├── exceptions.py             # SkillOptException subclasses
│   ├── router.py                 # FastAPI endpoints
│   └── schemas.py                # Pydantic I/O schemas
├── core/
│   ├── __init__.py
│   └── skillopt.py               # full algorithm: seed/rollout/reflect/gate/meta
├── data/
│   ├── __init__.py
│   ├── models.py                 # SQLAlchemy ORM
│   └── repository.py             # async DB access
├── infrastructure/
│   ├── __init__.py
│   ├── cache.py                  # Redis live-state (epoch, edits, skill content)
│   └── storage.py                # MinIO (skill docs, example JSONL)
├── prompts/
│   ├── __init__.py
│   └── system.py                 # all LLM prompt strings
└── workers/
    ├── __init__.py
    └── tasks.py                  # Celery task: run_skillopt
```

### DB Tables

**`skill_opt_projects`**
id, user_id, name, description, task_description, status, seed_skill, best_skill,
score_before, score_after, epochs_run, edits_accepted, edits_rejected,
credits_charged, error_message, created_at, updated_at

**`skill_opt_runs`**
id, project_id, epoch, score_before, score_after, edits_proposed, edits_accepted,
edits_rejected, rollout_count, status, created_at

### API Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/skill-opt/` | Create project + start if examples provided |
| GET | `/api/v1/skill-opt/` | List user's projects |
| GET | `/api/v1/skill-opt/{id}` | Get project details |
| DELETE | `/api/v1/skill-opt/{id}` | Delete project |
| POST | `/api/v1/skill-opt/{id}/examples` | Upload/replace Q&A examples |
| GET | `/api/v1/skill-opt/{id}/examples` | Get examples |
| POST | `/api/v1/skill-opt/{id}/optimize` | Start optimization job |
| GET | `/api/v1/skill-opt/jobs/{job_id}` | Poll job status |
| GET | `/api/v1/skill-opt/{id}/state` | Get live optimization state |
| GET | `/api/v1/skill-opt/{id}/runs` | Get run history |

### Live State (Redis)

```json
{
  "phase": "rollout|reflect|gate|slow_update|completed",
  "epoch": 2,
  "total_epochs": 3,
  "epoch_pct": 0.45,
  "current_score": 0.72,
  "best_score": 0.78,
  "edits_accepted": 7,
  "edits_rejected": 3,
  "last_edit": { "op": "ADD", "text": "Always verify calculation steps." },
  "current_skill_preview": "## Task Guide\n...",
  "rollout_done": 15,
  "rollout_total": 20
}
```

---

## Frontend Architecture

```text
frontend/src/
├── app/(dashboard)/skill-opt/
│   └── page.tsx                  # main Skill Opt page
├── components/skill-opt/
│   ├── skill-workspace.tsx       # project detail + run + live view
│   ├── skill-live-view.tsx       # epoch progress + edit log + skill preview
│   └── skill-result.tsx          # best_skill.md display + copy/export
└── types/
    └── skill-opt.ts              # TypeScript types
```

---

## Credits & Cost

| Tier | Credits | Use case |
|---|---|---|
| Low | 5 | Quick iteration, small datasets |
| Medium | 10 | Balanced quality/cost |
| High | 16 | Best quality, larger datasets |

---

## Out of Scope

- Multi-agent / tool-calling harness (paper's Codex/Claude Code loops) — we use direct chat only
- Sleep mode / offline evolution — future feature
- Custom benchmark environments — user provides Q&A examples directly
