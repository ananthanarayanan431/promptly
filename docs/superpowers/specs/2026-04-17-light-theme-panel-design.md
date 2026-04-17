# Light Theme + Expandable Panel — Design Spec

**Date:** 2026-04-17
**Branch:** color-change
**Scope:**
- `frontend/src/app/globals.css`
- `frontend/src/components/optimize/chat-message.tsx`
- `frontend/src/components/optimize/optimize-chat.tsx`
- `frontend/src/components/optimize/result-panel.tsx` (new)
- `frontend/src/components/layout/sidebar.tsx`
- `frontend/src/components/providers.tsx`

---

## Goal

Make the app light-only (remove dark mode entirely), fix message differentiation so user and AI messages are clearly distinct, and add an expandable right panel that shows the full optimized prompt in a split-panel view.

---

## 1. Remove Dark Mode

**`frontend/src/app/globals.css`**
- Delete the entire `.dark { ... }` block (lines 52–84). It is dead code — the app no longer uses it.
- Light theme `:root` block is the only theme.

**`frontend/src/components/providers.tsx`**
- Already set to `defaultTheme="light" enableSystem={false}`. No further changes needed.

**`frontend/src/components/layout/sidebar.tsx`**
- Remove the `ThemeToggle` import.
- Remove the "Theme" footer row:
  ```tsx
  <div className="flex items-center justify-between px-1 mb-1">
    <span className="text-xs text-muted-foreground">Theme</span>
    <ThemeToggle />
  </div>
  ```
- The `ThemeToggle` component file (`frontend/src/components/landing/theme-toggle.tsx`) is left in place — it may be used elsewhere (landing page nav).

---

## 2. Light Theme Color Fixes

**`frontend/src/app/globals.css` — `:root` block**

Two token changes to replace pure white with a subtle lavender-white palette:

| Token | Current | New |
|---|---|---|
| `--background` | `oklch(0.99 0 0)` | `oklch(0.97 0.008 285)` |
| `--card` | `oklch(0.99 0 0)` | `oklch(0.995 0.003 285)` |

- `--background` gets a faint lavender page tint — no longer pure white
- `--card` is nearly white with the faintest lavender tint — sits above the background
- All other `:root` tokens unchanged

---

## 3. Message Differentiation

**`frontend/src/components/optimize/chat-message.tsx` — `UserBubble`**

Change the bubble surface from `bg-accent/40 border border-border/50` to `bg-secondary border border-border`.

- `--secondary` is `oklch(0.96 0.01 285)` — a distinct light gray-lavender, clearly different from the near-white card
- Result: user messages = gray-lavender bubble (right), AI response = near-white card (left)

No other changes to `UserBubble`.

---

## 4. Expandable Right Panel

### State

**`frontend/src/components/optimize/optimize-chat.tsx`**

Add state:
```tsx
const [expandedContent, setExpandedContent] = useState<string | null>(null);
```

Change the outer container layout from `flex flex-col h-full` to `flex flex-row h-full`.

The chat column wraps the existing `flex flex-col` content:
```tsx
<div className="flex flex-col flex-1 min-w-0 overflow-hidden">
  {/* existing messages area + sticky input */}
</div>
```

The panel column appears conditionally:
```tsx
{expandedContent && (
  <ResultPanel
    content={expandedContent}
    onClose={() => setExpandedContent(null)}
  />
)}
```

Pass `onExpand` down the tree:
```tsx
<ChatMessage
  ...
  onExpand={(text) => setExpandedContent(text)}
/>
```

### Prop threading

**`ChatMessage`** receives `onExpand: (text: string) => void` and passes it to `AssistantResult`.

**`AssistantResult`** receives `onExpand: (text: string) => void`. In the success result state, an `Expand` button is added to the action row:
```tsx
<button
  onClick={() => onExpand(result.optimized_prompt)}
  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
>
  <PanelRight className="h-3.5 w-3.5" /> Expand
</button>
```

`PanelRight` is imported from `lucide-react`.

### New component: `ResultPanel`

**File:** `frontend/src/components/optimize/result-panel.tsx`

```
Props: { content: string; onClose: () => void }
```

Layout: `w-[420px] shrink-0 border-l bg-card flex flex-col h-full`

- **Header** (`shrink-0 flex items-center justify-between px-5 py-4 border-b`):
  - Left: "Optimized Prompt" in `text-sm font-semibold`
  - Right: `X` close button (`X` icon from lucide-react)
- **Body** (`flex-1 overflow-y-auto px-5 py-4`):
  - `<p className="text-sm leading-7 whitespace-pre-wrap text-foreground">{content}</p>`
- **Footer** (`shrink-0 border-t px-5 py-3`):
  - Copy button — copies `content` to clipboard, shows "Copied" confirmation for 2 seconds

No animation. Panel snaps in/out instantly.

---

## Out of Scope

- Dark mode improvements or maintenance
- Resizable panel divider
- Panel showing council proposals or token usage
- Animation/transition on panel open/close
- Changes to any page other than `/optimize`

---

## Files Changed / Created

1. `frontend/src/app/globals.css` — remove `.dark` block, update 2 `:root` tokens
2. `frontend/src/components/layout/sidebar.tsx` — remove ThemeToggle row
3. `frontend/src/components/optimize/chat-message.tsx` — UserBubble surface, add onExpand prop threading
4. `frontend/src/components/optimize/optimize-chat.tsx` — expandedContent state, flex-row layout, panel rendering
5. `frontend/src/components/optimize/result-panel.tsx` — new component
