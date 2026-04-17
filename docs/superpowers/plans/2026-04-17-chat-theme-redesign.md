# Chat Theme Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the near-black dark theme with deep slate-indigo, improve user/AI message differentiation with minimal contrast style, and clean up sidebar active states.

**Architecture:** Pure CSS variable and component styling changes across three files. No new files, no backend changes, no structural refactors. All changes are isolated to dark mode and the optimize chat page.

**Tech Stack:** Next.js 14, Tailwind CSS (oklch colour space), shadcn/ui, TypeScript

---

## File Map

| File | Change type | What changes |
|---|---|---|
| `frontend/src/app/globals.css` | Modify | 6 dark-mode CSS variable values |
| `frontend/src/components/optimize/chat-message.tsx` | Modify | UserBubble surface + labels; AssistantResult labels on all states |
| `frontend/src/components/layout/sidebar.tsx` | Modify | Nav active style, group label opacity, session padding, logo separator |

---

### Task 1: Update dark theme CSS variables

**Files:**
- Modify: `frontend/src/app/globals.css`

- [ ] **Step 1: Open globals.css and locate the `.dark` block (lines 52–84)**

The block starts with `.dark {` and ends at `}`. You will only edit values inside this block — the `:root` (light theme) block above it is untouched.

- [ ] **Step 2: Replace the 6 dark-mode tokens**

Find and replace each line exactly as shown:

```css
/* BEFORE → AFTER */
--background: oklch(0.115 0.008 285);  →  --background: oklch(0.14 0.02 270);
--card: oklch(0.16 0.008 285);          →  --card: oklch(0.18 0.025 270);
--muted: oklch(0.22 0.01 285);          →  --muted: oklch(0.22 0.025 270);
--accent: oklch(0.26 0.03 285);         →  --accent: oklch(0.25 0.04 270);
--border: oklch(1 0 0 / 8%);            →  --border: oklch(0.67 0.22 285 / 12%);
--sidebar: oklch(0.155 0.008 285);      →  --sidebar: oklch(0.165 0.022 270);
```

The resulting `.dark` block should look like this (only showing changed lines):

```css
.dark {
  --background: oklch(0.14 0.02 270);
  --foreground: oklch(0.95 0.005 285);
  --card: oklch(0.18 0.025 270);
  --card-foreground: oklch(0.95 0.005 285);
  --popover: oklch(0.16 0.008 285);
  --popover-foreground: oklch(0.95 0.005 285);
  --primary: oklch(0.67 0.22 285);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.22 0.01 285);
  --secondary-foreground: oklch(0.95 0.005 285);
  --muted: oklch(0.22 0.025 270);
  --muted-foreground: oklch(0.62 0.02 285);
  --accent: oklch(0.25 0.04 270);
  --accent-foreground: oklch(0.67 0.22 285);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(0.67 0.22 285 / 12%);
  --input: oklch(1 0 0 / 10%);
  --ring: oklch(0.67 0.22 285);
  --chart-1: oklch(0.67 0.22 285);
  --chart-2: oklch(0.6 0.18 220);
  --chart-3: oklch(0.65 0.18 160);
  --chart-4: oklch(0.7 0.18 60);
  --chart-5: oklch(0.65 0.22 20);
  --sidebar: oklch(0.165 0.022 270);
  --sidebar-foreground: oklch(0.95 0.005 285);
  --sidebar-primary: oklch(0.67 0.22 285);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.22 0.01 285);
  --sidebar-accent-foreground: oklch(0.67 0.22 285);
  --sidebar-border: oklch(1 0 0 / 8%);
  --sidebar-ring: oklch(0.67 0.22 285);
}
```

- [ ] **Step 3: Verify with lint**

```bash
cd frontend && npm run lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/globals.css
git commit -m "feat: replace near-black dark theme with deep slate-indigo palette"
```

---

### Task 2: Restyle UserBubble in chat-message.tsx

**Files:**
- Modify: `frontend/src/components/optimize/chat-message.tsx` (lines 13–35)

- [ ] **Step 1: Replace the entire `UserBubble` function**

The current `UserBubble` (lines 13–35) uses a hard gradient bubble for non-feedback messages. Replace the whole function with:

```tsx
function UserBubble({ text, isFeedback }: { text: string; isFeedback: boolean }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] space-y-1">
        <p className={cn(
          'text-right text-[10px] font-semibold uppercase tracking-widest pr-1',
          isFeedback ? 'text-primary/70' : 'text-muted-foreground/60'
        )}>
          {isFeedback ? 'Feedback' : 'You'}
        </p>
        <div className="rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap bg-accent/40 border border-border/50 text-foreground">
          {text}
        </div>
      </div>
    </div>
  );
}
```

Key changes:
- Both feedback and non-feedback use the same `bg-accent/40 border border-border/50` surface (no more gradient bubble)
- A `You` / `Feedback` label always appears above the message
- Label colour: `text-muted-foreground/60` for `You`, `text-primary/70` for `Feedback`

- [ ] **Step 2: Verify lint**

```bash
cd frontend && npm run lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/optimize/chat-message.tsx
git commit -m "feat: replace gradient user bubble with minimal tint + You/Feedback label"
```

---

### Task 3: Add Promptly labels to AssistantResult states

**Files:**
- Modify: `frontend/src/components/optimize/chat-message.tsx` (lines 45–177)

The `AssistantResult` function has three render paths: `loading`, `failed`, and the success result. All three need a `Promptly` label added above them.

- [ ] **Step 1: Add label to the loading state**

Find the loading return (currently lines 50–59):

```tsx
if (turn.status === 'loading') {
  return (
    <div className="flex gap-3">
      <PromptlyIcon />
      <div className="flex-1 pt-1">
        <LoadingWords />
      </div>
    </div>
  );
}
```

Replace with:

```tsx
if (turn.status === 'loading') {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 pl-10">
        Promptly
      </p>
      <div className="flex gap-3">
        <PromptlyIcon />
        <div className="flex-1 pt-1">
          <LoadingWords />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add label to the failed state**

Find the failed return (currently lines 61–76):

```tsx
if (turn.status === 'failed') {
  return (
    <div className="flex gap-3">
      <PromptlyIcon />
      <div className="flex items-start gap-2 pt-1 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
        <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-destructive">Optimization failed</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {turn.error || 'Something went wrong. Please try again.'}
          </p>
        </div>
      </div>
    </div>
  );
}
```

Replace with:

```tsx
if (turn.status === 'failed') {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 pl-10">
        Promptly
      </p>
      <div className="flex gap-3">
        <PromptlyIcon />
        <div className="flex items-start gap-2 pt-1 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-destructive">Optimization failed</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {turn.error || 'Something went wrong. Please try again.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add label to the success result state**

Find the success return (starts at line 114 with `return (` inside `AssistantResult`):

```tsx
return (
  <div className="flex gap-3">
    <PromptlyIcon />
    <div className="flex-1 min-w-0">
      {/* Result card */}
      ...
    </div>
  </div>
);
```

Replace the outer wrapper to add the label:

```tsx
return (
  <div className="space-y-1">
    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 pl-10">
      Promptly
    </p>
    <div className="flex gap-3">
      <PromptlyIcon />
      <div className="flex-1 min-w-0">
        {/* Result card */}
        <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3 shadow-sm">
          {/* Version pill */}
          {(isVersioned || isVersioningActive) && versionNum && (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-xs font-medium text-primary">
              <GitBranch className="h-3 w-3" />
              v{versionNum} saved
            </div>
          )}

          {/* Optimized prompt text */}
          <p className="text-sm leading-7 whitespace-pre-wrap text-foreground">
            {result.optimized_prompt}
          </p>

          {/* Divider + action row */}
          <div className="flex items-center gap-1 pt-1 border-t border-border/40 -mx-4 px-4 mt-3">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              {copied ? (
                <><CheckCheck className="h-3.5 w-3.5 text-green-500" /> Copied</>
              ) : (
                <><Copy className="h-3.5 w-3.5" /> Copy</>
              )}
            </button>

            {canSaveVersion && (
              <button
                onClick={handleSaveVersion}
                disabled={versionLoading}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
              >
                {versionLoading ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
                ) : (
                  <><GitBranch className="h-3.5 w-3.5" /> Version</>
                )}
              </button>
            )}

            {isVersioningActive && !versionNum && (
              <span className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-primary/70">
                <GitBranch className="h-3.5 w-3.5" /> Versioning active
              </span>
            )}

            {result.token_usage?.total_tokens ? (
              <span className="ml-auto text-[11px] text-muted-foreground/50">
                {result.token_usage.total_tokens.toLocaleString()} tokens
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  </div>
);
```

- [ ] **Step 4: Verify lint**

```bash
cd frontend && npm run lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/optimize/chat-message.tsx
git commit -m "feat: add Promptly label to all AI message states for clear differentiation"
```

---

### Task 4: Sidebar cleanup

**Files:**
- Modify: `frontend/src/components/layout/sidebar.tsx`

- [ ] **Step 1: Update nav link active state**

Find the nav link `className` inside the `navigation.map(...)` call (around line 169):

```tsx
className={cn(
  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
  isActive
    ? 'bg-primary/10 text-primary'
    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
)}
```

Replace with:

```tsx
className={cn(
  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
  isActive
    ? 'border-l-2 border-primary text-primary pl-[10px]'
    : 'border-l-2 border-transparent text-muted-foreground hover:bg-muted hover:text-foreground pl-[10px]'
)}
```

Note: `pl-[10px]` keeps the text visually aligned (compensates for the 2px border on the active item).

- [ ] **Step 2: Update session group label opacity**

Find the `SessionGroup` component's label paragraph (around line 63):

```tsx
<p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
```

Replace with:

```tsx
<p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
```

- [ ] **Step 3: Update session item vertical padding**

Find the `SessionItem` link `className` (around line 38):

```tsx
className={cn(
  'flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors truncate',
  isActive
    ? 'bg-primary/10 text-primary'
    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
)}
```

Replace with:

```tsx
className={cn(
  'flex items-center gap-2 px-3 py-2 rounded-md text-xs transition-colors truncate',
  isActive
    ? 'bg-primary/10 text-primary'
    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
)}
```

- [ ] **Step 4: Replace logo area hard border with gradient separator**

Find the Logo section in `Sidebar` (around line 152):

```tsx
<div className="flex h-14 items-center border-b px-4 shrink-0">
  <Link href="/" className="flex items-center gap-2 font-bold text-lg text-primary">
    <Lightbulb className="h-6 w-6" />
    <span>Promptly</span>
  </Link>
</div>
```

Replace with:

```tsx
<div className="flex h-14 items-center px-4 shrink-0 relative">
  <Link href="/" className="flex items-center gap-2 font-bold text-lg text-primary">
    <Lightbulb className="h-6 w-6" />
    <span>Promptly</span>
  </Link>
  <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-border/60 via-border/30 to-transparent" />
</div>
```

- [ ] **Step 5: Verify lint**

```bash
cd frontend && npm run lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/layout/sidebar.tsx
git commit -m "feat: clean up sidebar active state, label opacity, and logo separator"
```

---

### Task 5: Build verification

- [ ] **Step 1: Run production build**

```bash
cd frontend && npm run build
```

Expected: `✓ Compiled successfully` with no TypeScript or build errors.

- [ ] **Step 2: Start dev server and manually verify dark mode**

```bash
cd frontend && npm run dev
```

Open `http://localhost:3000` in a browser. Switch to dark mode using the theme toggle in the sidebar footer. Verify:

- Background is a rich dark indigo-slate (not flat black)
- Sidebar is slightly darker than the main content area
- Nav active item shows a left purple border, not a filled pill
- Open `/optimize` and send a message
- User message shows `You` label + tinted surface on the right
- AI response shows `Promptly` label + card surface on the left
- Loading and error states also show `Promptly` label

- [ ] **Step 3: Verify light mode is unchanged**

Switch to light mode using the theme toggle. Confirm the UI looks identical to before — no colour changes in light mode.
