# Light Theme + Expandable Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove dark mode entirely, fix light-theme message differentiation with a lavender-white palette, and add a split-panel right view that shows the full optimized prompt when expanded.

**Architecture:** Pure styling changes for Tasks 1–3 (CSS variables, UserBubble surface, sidebar cleanup). Task 4 adds a new `ResultPanel` component and wires `expandedContent` state into `OptimizeChat`, changing its layout from a single column to a flex-row split when the panel is open. No backend changes.

**Tech Stack:** Next.js 14, Tailwind CSS (oklch), TypeScript, lucide-react, shadcn/ui

---

## File Map

| File | Change |
|---|---|
| `frontend/src/app/globals.css` | Remove `.dark` block; update 2 `:root` tokens |
| `frontend/src/components/layout/sidebar.tsx` | Remove ThemeToggle import + footer row |
| `frontend/src/components/optimize/chat-message.tsx` | UserBubble surface; add `onExpand` prop to `ChatMessage` and `AssistantResult` |
| `frontend/src/components/optimize/optimize-chat.tsx` | Add `expandedContent` state; flex-row layout; render `ResultPanel`; pass `onExpand` |
| `frontend/src/components/optimize/result-panel.tsx` | New component — panel header, scrollable body, copy footer |

---

### Task 1: Remove dark mode and update light theme tokens

**Files:**
- Modify: `frontend/src/app/globals.css`
- Modify: `frontend/src/components/layout/sidebar.tsx`

- [ ] **Step 1: Delete the `.dark` block from globals.css**

Open `frontend/src/app/globals.css`. Delete lines 52–84 — the entire `.dark { ... }` block. After deletion the file should end with the `:root` block closing `}` followed by the `* { border-color: ... }`, `body`, and `html` rules. The result:

```css
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer utilities {
  .text-balance {
    text-wrap: balance;
  }
}

@layer base {
  .theme {
    --font-heading: var(--font-sans);
    --font-sans: var(--font-sans);
  }
  :root {
    --background: oklch(0.97 0.008 285);
    --foreground: oklch(0.13 0.01 285);
    --card: oklch(0.995 0.003 285);
    --card-foreground: oklch(0.13 0.01 285);
    --popover: oklch(0.99 0 0);
    --popover-foreground: oklch(0.13 0.01 285);
    --primary: oklch(0.5 0.22 285);
    --primary-foreground: oklch(0.985 0 0);
    --secondary: oklch(0.96 0.01 285);
    --secondary-foreground: oklch(0.13 0.01 285);
    --muted: oklch(0.96 0.005 285);
    --muted-foreground: oklch(0.52 0.02 285);
    --accent: oklch(0.94 0.03 285);
    --accent-foreground: oklch(0.5 0.22 285);
    --destructive: oklch(0.577 0.245 27.325);
    --border: oklch(0.91 0.01 285);
    --input: oklch(0.91 0.01 285);
    --ring: oklch(0.5 0.22 285);
    --chart-1: oklch(0.65 0.22 285);
    --chart-2: oklch(0.55 0.18 220);
    --chart-3: oklch(0.65 0.18 160);
    --chart-4: oklch(0.65 0.18 60);
    --chart-5: oklch(0.65 0.22 20);
    --radius: 0.75rem;
    --sidebar: oklch(0.97 0.005 285);
    --sidebar-foreground: oklch(0.13 0.01 285);
    --sidebar-primary: oklch(0.5 0.22 285);
    --sidebar-primary-foreground: oklch(0.985 0 0);
    --sidebar-accent: oklch(0.94 0.03 285);
    --sidebar-accent-foreground: oklch(0.5 0.22 285);
    --sidebar-border: oklch(0.91 0.01 285);
    --sidebar-ring: oklch(0.5 0.22 285);
  }
  * {
    border-color: var(--border);
  }
  body {
    @apply bg-background text-foreground;
  }
  html {
    @apply font-sans;
  }
}
```

Key token changes in `:root`:
- `--background`: `oklch(0.99 0 0)` → `oklch(0.97 0.008 285)` (faint lavender page tint)
- `--card`: `oklch(0.99 0 0)` → `oklch(0.995 0.003 285)` (nearly white, faintest lavender tint)

- [ ] **Step 2: Remove ThemeToggle from sidebar footer**

Open `frontend/src/components/layout/sidebar.tsx`.

Remove the `ThemeToggle` import at the top of the file:
```tsx
import { ThemeToggle } from '@/components/landing/theme-toggle';
```

Remove the Theme row inside the footer `<div>` (currently lines 194–197):
```tsx
<div className="flex items-center justify-between px-1 mb-1">
  <span className="text-xs text-muted-foreground">Theme</span>
  <ThemeToggle />
</div>
```

The footer should now only contain the Logout button:
```tsx
{/* Footer */}
<div className="shrink-0 border-t p-4">
  <Button
    variant="ghost"
    className="w-full justify-start text-muted-foreground hover:text-foreground"
    onClick={handleLogout}
  >
    <LogOut className="mr-2 h-4 w-4" />
    Logout
  </Button>
</div>
```

- [ ] **Step 3: Verify lint**

```bash
cd /Volumes/External/promptly/frontend && npm run lint
```

Expected: `✔ No ESLint warnings or errors`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/globals.css frontend/src/components/layout/sidebar.tsx
git commit -m "feat: remove dark mode, apply lavender-white light theme palette"
```

---

### Task 2: Fix UserBubble message differentiation

**Files:**
- Modify: `frontend/src/components/optimize/chat-message.tsx` (lines 13–29)

- [ ] **Step 1: Update the bubble surface class**

Open `frontend/src/components/optimize/chat-message.tsx`. Find the `UserBubble` function (lines 13–29). The message div currently uses `bg-accent/40 border border-border/50`. Change it to `bg-secondary border border-border`:

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
        <div className="rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap bg-secondary border border-border text-foreground">
          {text}
        </div>
      </div>
    </div>
  );
}
```

Only the bubble div's className changes (`bg-accent/40 border border-border/50` → `bg-secondary border border-border`). Everything else stays the same.

- [ ] **Step 2: Verify lint**

```bash
cd /Volumes/External/promptly/frontend && npm run lint
```

Expected: `✔ No ESLint warnings or errors`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/optimize/chat-message.tsx
git commit -m "feat: use bg-secondary for user bubble — clear light-theme differentiation"
```

---

### Task 3: Create ResultPanel component

**Files:**
- Create: `frontend/src/components/optimize/result-panel.tsx`

- [ ] **Step 1: Create the file**

Create `frontend/src/components/optimize/result-panel.tsx` with this exact content:

```tsx
'use client';

import { useState } from 'react';
import { X, Copy, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';

interface ResultPanelProps {
  content: string;
  onClose: () => void;
}

export function ResultPanel({ content, onClose }: ResultPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    toast.success('Copied');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-[420px] shrink-0 border-l bg-card flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b">
        <span className="text-sm font-semibold text-foreground">Optimized Prompt</span>
        <button
          onClick={onClose}
          className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <p className="text-sm leading-7 whitespace-pre-wrap text-foreground">{content}</p>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t px-5 py-3">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border border-border"
        >
          {copied ? (
            <><CheckCheck className="h-3.5 w-3.5 text-green-500" /> Copied</>
          ) : (
            <><Copy className="h-3.5 w-3.5" /> Copy</>
          )}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify lint**

```bash
cd /Volumes/External/promptly/frontend && npm run lint
```

Expected: `✔ No ESLint warnings or errors`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/optimize/result-panel.tsx
git commit -m "feat: add ResultPanel component for expanded prompt view"
```

---

### Task 4: Wire expand state and split layout into OptimizeChat

**Files:**
- Modify: `frontend/src/components/optimize/optimize-chat.tsx`
- Modify: `frontend/src/components/optimize/chat-message.tsx`

This task has two parts: (A) add `onExpand` prop threading through `ChatMessage` and `AssistantResult`, then (B) wire the state and layout in `OptimizeChat`.

#### Part A — Add onExpand prop to chat-message.tsx

- [ ] **Step 1: Update ChatMessageProps and ChatMessage**

Open `frontend/src/components/optimize/chat-message.tsx`.

Add `PanelRight` to the lucide-react import at line 5:
```tsx
import { Copy, CheckCheck, AlertCircle, Sparkles, GitBranch, Loader2, PanelRight } from 'lucide-react';
```

Update `AssistantResultProps` interface (currently lines 33–37) to add `onExpand`:
```tsx
interface AssistantResultProps {
  turn: ChatTurn;
  isVersioningActive: boolean;
  onVersionSaved: (promptId: string) => void;
  onExpand: (text: string) => void;
}
```

Update the `AssistantResult` function signature (line 39) to destructure `onExpand`:
```tsx
function AssistantResult({ turn, isVersioningActive, onVersionSaved, onExpand }: AssistantResultProps) {
```

- [ ] **Step 2: Add Expand button to the success result action row**

In `AssistantResult`, find the action row div (the `flex items-center gap-1` div after the `border-t`). Add the Expand button as the first button, before the Copy button:

```tsx
{/* Divider + action row */}
<div className="flex items-center gap-1 pt-1 border-t border-border/40 -mx-4 px-4 mt-3">
  <button
    onClick={() => onExpand(result.optimized_prompt)}
    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
  >
    <PanelRight className="h-3.5 w-3.5" /> Expand
  </button>

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
```

- [ ] **Step 3: Update ChatMessageProps and ChatMessage to pass onExpand**

Update `ChatMessageProps` interface (currently lines 200–204):
```tsx
interface ChatMessageProps {
  turn: ChatTurn;
  isVersioningActive: boolean;
  onVersionSaved: (promptId: string) => void;
  onExpand: (text: string) => void;
}
```

Update the `ChatMessage` function to destructure and forward `onExpand`:
```tsx
export function ChatMessage({ turn, isVersioningActive, onVersionSaved, onExpand }: ChatMessageProps) {
  return (
    <div className="space-y-4">
      <UserBubble text={turn.userText} isFeedback={turn.isFeedback} />
      <AssistantResult
        turn={turn}
        isVersioningActive={isVersioningActive}
        onVersionSaved={onVersionSaved}
        onExpand={onExpand}
      />
    </div>
  );
}
```

#### Part B — Wire state and layout in optimize-chat.tsx

- [ ] **Step 4: Update imports in optimize-chat.tsx**

Open `frontend/src/components/optimize/optimize-chat.tsx`. Add `ResultPanel` to the imports:
```tsx
import { ChatMessage } from './chat-message';
import { ChatInput } from './chat-input';
import { ResultPanel } from './result-panel';
```

- [ ] **Step 5: Add expandedContent state**

Inside `OptimizeChat`, add the state after the existing `versionPromptId` state (line 26):
```tsx
const [expandedContent, setExpandedContent] = useState<string | null>(null);
```

- [ ] **Step 6: Change layout and wire panel**

Replace the outer return JSX. The current return (line 169) is:
```tsx
return (
  <div className="flex flex-col h-full">
    {/* ── Messages area ── */}
    <div className="flex-1 overflow-y-auto">
      ...
    </div>
    {/* ── Sticky bottom input ── */}
    ...
  </div>
);
```

Replace with a flex-row outer wrapper that conditionally shows the panel:

```tsx
return (
  <div className="flex flex-row h-full">
    {/* ── Chat column ── */}
    <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
      {/* ── Messages area ── */}
      <div className="flex-1 overflow-y-auto">
        {isLoadingSession ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Loading conversation…
          </div>
        ) : !hasMessages ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full px-4 pb-16">
            <div className="w-full max-w-2xl space-y-6">
              <div className="text-center space-y-3">
                <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-gradient-to-br from-primary to-primary/60 shadow-lg shadow-primary/20 mb-2">
                  <Sparkles className="h-6 w-6 text-primary-foreground" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-br from-foreground to-foreground/60 bg-clip-text text-transparent">
                  What prompt can I optimize?
                </h1>
              </div>

              <ChatInput
                onSubmit={handleSubmit}
                isLoading={isAnyLoading}
                hasPreviousTurns={false}
                defaultValue={prefillText}
                defaultName={prefillName}
                autoFocus
              />

              <div className="grid grid-cols-3 gap-3 pt-1">
                {[
                  { label: '4 AI models', desc: 'Optimize in parallel' },
                  { label: 'Peer critique', desc: 'Models review each other' },
                  { label: 'Best result', desc: 'Synthesized by a chairman' },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-border/50 bg-card/50 px-3 py-2.5 text-center">
                    <p className="text-xs font-semibold text-foreground">{item.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Conversation */
          <div className="max-w-2xl mx-auto px-4 py-8 space-y-10">
            {turns.map((turn) => (
              <ChatMessage
                key={turn.tempId}
                turn={turn}
                isVersioningActive={!!versionPromptId}
                onVersionSaved={(pid) => setVersionPromptId(pid)}
                onExpand={(text) => setExpandedContent(text)}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── Sticky bottom input ── */}
      {hasMessages && (
        <div className="shrink-0 px-4 py-4 bg-gradient-to-t from-background via-background to-transparent">
          <div className="max-w-2xl mx-auto">
            <ChatInput
              onSubmit={handleSubmit}
              isLoading={isAnyLoading}
              hasPreviousTurns
            />
          </div>
        </div>
      )}
    </div>

    {/* ── Right panel ── */}
    {expandedContent && (
      <ResultPanel
        content={expandedContent}
        onClose={() => setExpandedContent(null)}
      />
    )}
  </div>
);
```

- [ ] **Step 7: Verify lint**

```bash
cd /Volumes/External/promptly/frontend && npm run lint
```

Expected: `✔ No ESLint warnings or errors`

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/optimize/chat-message.tsx frontend/src/components/optimize/optimize-chat.tsx
git commit -m "feat: wire expandable right panel with split layout in OptimizeChat"
```

---

### Task 5: Build verification

**Files:** None modified

- [ ] **Step 1: Run production build**

```bash
cd /Volumes/External/promptly/frontend && npm run build
```

Expected: `✓ Compiled successfully` with no TypeScript or build errors.

- [ ] **Step 2: Start dev server and manually verify**

```bash
cd /Volumes/External/promptly/frontend && npm run dev
```

Open `http://localhost:3000/optimize`. Verify:

1. Page background is a faint lavender-white (not pure white)
2. The theme toggle is gone from the sidebar footer — only Logout remains
3. Send a prompt — user message shows a gray-lavender bubble (`bg-secondary`) on the right
4. AI response shows a near-white card on the left — visually distinct from the user bubble
5. Click "Expand" on an AI response — a 420px panel appears on the right, chat column shrinks
6. Panel shows the full optimized prompt text in a scrollable view
7. Panel "Copy" button copies to clipboard and shows "Copied" toast
8. Panel "X" button closes the panel — layout returns to full-width chat
