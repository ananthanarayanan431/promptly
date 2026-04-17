# Chat Theme Redesign — Design Spec

**Date:** 2026-04-17
**Branch:** color-change
**Scope:** `frontend/src/app/globals.css`, `frontend/src/components/optimize/chat-message.tsx`, `frontend/src/components/layout/sidebar.tsx`

---

## Goal

Replace the near-black dark theme with a deep slate-indigo palette, improve visual differentiation between user and AI messages using minimal contrast (alignment + surface tone, no bubble shapes), and clean up the sidebar to match a cleaner left-panel aesthetic.

---

## 1. Dark Theme Color Palette

File: `frontend/src/app/globals.css` — `.dark` block only. Light theme is unchanged.

| CSS Token | Current value | New value | Reason |
|---|---|---|---|
| `--background` | `oklch(0.115 0.008 285)` | `oklch(0.14 0.02 270)` | Deep indigo-slate, not flat black |
| `--card` | `oklch(0.16 0.008 285)` | `oklch(0.18 0.025 270)` | Slightly lifted card surface |
| `--sidebar` | `oklch(0.155 0.008 285)` | `oklch(0.165 0.022 270)` | Slightly darker than card for depth |
| `--muted` | `oklch(0.22 0.01 285)` | `oklch(0.22 0.025 270)` | Warmer muted surface |
| `--accent` | `oklch(0.26 0.03 285)` | `oklch(0.25 0.04 270)` | Richer accent for hover states |
| `--border` | `oklch(1 0 0 / 8%)` | `oklch(0.67 0.22 285 / 12%)` | Purple-tinted borders that complement primary |

All other dark tokens (primary, foreground, destructive, chart colours) remain unchanged.

---

## 2. Chat Message Differentiation

File: `frontend/src/components/optimize/chat-message.tsx`

### User message (`UserBubble`)

**Before:** Right-aligned hard gradient bubble (`bg-gradient-to-br from-primary to-primary/80 text-primary-foreground`).

**After:**
- Wrapper: `flex justify-end`
- Inner div: `bg-accent/40 border border-border/50 rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-foreground`
- Label above bubble: `You` — right-aligned, `text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 pr-1`
- Feedback variant: same surface, label reads `Feedback` in `text-primary/70`

### AI result (`AssistantResult`)

**Before:** No label; card has `bg-card` surface.

**After:**
- Add `Promptly` label above the card: `text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 pl-10 mb-1` (indented to align with card, past the avatar)
- Card surface unchanged (`bg-card`) — naturally distinct from user's `bg-accent/40` tint given the new palette
- Loading state: add `Promptly` label above the spinner row
- Error state: add `Promptly` label above the error card

---

## 3. Sidebar Cleanup

File: `frontend/src/components/layout/sidebar.tsx`

- **Nav active state:** Replace `bg-primary/10` fill with `border-l-2 border-primary bg-transparent text-primary` — left border accent, no background blob
- **Section group labels** (`Today`, `Last 7 days`, etc.): bump opacity from `/60` to `/80` for better readability
- **Session items:** increase vertical padding from `py-1.5` to `py-2` for breathing room
- **Logo area border:** replace `border-b` with a subtle gradient separator: `bg-gradient-to-b from-border/60 to-transparent h-px w-full`

No structural changes — width, sections, and component tree unchanged.

---

## Out of Scope

- Light theme changes
- Sidebar collapse / icon-only mode
- Any backend or API changes
- Other pages (dashboard, analyze, versions)

---

## Files Changed

1. `frontend/src/app/globals.css` — dark CSS variable updates
2. `frontend/src/components/optimize/chat-message.tsx` — UserBubble + AssistantResult label + surface changes
3. `frontend/src/components/layout/sidebar.tsx` — active state, label opacity, session padding, logo separator
