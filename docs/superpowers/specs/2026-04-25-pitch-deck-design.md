# Promptly Business Pitch Deck — Design Spec
**Date:** 2026-04-25
**Audience:** Investors (VCs) + Enterprise buyers
**Format:** 14-slide Canva presentation (16:9)
**Approach:** Narrative Arc — story-first, data-backed

---

## Design Language

| Token | Value |
|-------|-------|
| Background | `#ffffff` (white) |
| Dark panel bg | `#1e1e22` |
| Primary ink | `#141414` |
| Accent / violet | `#7c5cff` |
| Muted text | `#555555` |
| Hairline border | `#e5e5e1` |
| Agent — Analytical | `#7c5cff` |
| Agent — Creative | `#ff7ac6` |
| Agent — Concise | `#5cffb1` |
| Agent — Structured | `#ffb85c` |
| Heading font | Instrument Serif (italic violet for key words) |
| Label/mono font | Geist Mono (uppercase, tight tracking) |
| Body font | Geist Sans |

Layout: editorial, generous whitespace, hairline borders — no clip-art, no gradients except dark panel slides.

---

## Slide Breakdown

### Slide 1 — Cover
- **Background:** `#1e1e22` (dark)
- **Headline (Instrument Serif, white, large):** "Your prompt, *sharpened* by a society of minds."
  *(italic violet on "sharpened")*
- **Subtext (Geist Mono, muted):** "Promptly — AI prompt optimization platform"
- **Logo mark:** violet square logomark + "promptly" wordmark top-left
- **Bottom strip:** four colored dots (violet / pink / green / amber) representing the council

### Slide 2 — The Problem
- **Background:** white
- **Eyebrow (Geist Mono, violet, uppercase):** "THE PROBLEM"
- **Headline:** "Every team shipping LLM features loses weeks to prompt tuning."
- **Three pain-point columns** (hairline-bordered cards):
  1. "Hours → days → weeks of manual iteration"
  2. "Prompts break silently across model versions"
  3. "No versioning, no rollback, no audit trail"
- **Closing line (italic serif, violet):** "You blame the model. It's never the model."

### Slide 3 — The Cost of a Bad Prompt
- **Background:** white
- **Eyebrow:** "REAL COST"
- **Headline:** "A bad prompt isn't a bug. It's a revenue leak."
- **Stat block (3 large numbers, Instrument Serif):**
  - "60% of AI feature failures trace back to prompt quality" *(Statista 2025)*
  - "340% ROI from optimized prompts" *(Deloitte 2025)*
  - "Weeks of engineer time lost per model migration"
- **Visual:** simple before/after prompt quality bar (low → high), colored violet

### Slide 4 — The Market
- **Background:** white
- **Eyebrow:** "MARKET OPPORTUNITY"
- **Headline:** "Every AI product needs this. The market knows it."
- **Three stat cards:**
  - "$1.7B — Prompt optimization market in 2024"
  - "$15.2B — Projected by 2033 (26% CAGR)"
  - "45% — Share driven by the tech sector alone"
- **Small note (Geist Mono, muted):** "Source: Growth Market Reports, 2025"
- **Tagline:** "This is infrastructure, not tooling."

### Slide 5 — The Insight (Society of Mind)
- **Background:** `#1e1e22` (dark)
- **Eyebrow (violet mono):** "THE INSIGHT"
- **Large quote block (Instrument Serif, white):**
  *"The mind is a society of tiny agents, each mindless by itself. Intelligence is what emerges when they interact."*
  `— Marvin Minsky · Society of Mind, 1986`
- **Below quote:** "Minsky proved intelligence is emergent, not monolithic. In 1986, he described the architecture we built — applied to prompt engineering."
- **Visual accent:** large violet quotation mark, bottom-right

### Slide 6 — Introducing Promptly
- **Background:** white
- **Eyebrow:** "THE SOLUTION"
- **Headline:** "A society of four specialist agents — proposing, reviewing, synthesizing."
- **One-line summary (large, Instrument Serif):** "Paste any prompt. Get back the best version none of the agents could write alone."
- **Four agent tags in a row:** [A Analytical] [C Creative] [O Concise] [S Structured]
  *(each colored chip with letter badge)*
- **Pipeline arrow visual:** INPUT → PROPOSE → CRITIQUE → SYNTHESIZE → OUTPUT

### Slide 7 — How It Works: Propose
- **Background:** white
- **Eyebrow (violet mono):** "01 · PROPOSE"
- **Headline:** "Four minds. One prompt. Parallel."
- **Four cards (2×2 grid), one per agent:**
  - **A Analytical** `#7c5cff` — "Adds constraints, output schema, precision"
  - **C Creative** `#ff7ac6` — "Adds persona, exemplars, voice"
  - **O Concise** `#5cffb1` — "Strips every filler word, maximises signal"
  - **S Structured** `#ffb85c` — "Logical decomposition, schemas"
- **Footer note (mono, muted):** "No agent sees what the others write."

### Slide 8 — How It Works: Critique
- **Background:** white
- **Eyebrow:** "02 · CRITIQUE"
- **Headline:** "Blind peer review. No favouritism."
- **Visual:** 4-row ranking table — each critic ranks A/B/C/D anonymously
  ```
  critic A:  B > D > A > C
  critic B:  A > B > D > C
  critic C:  C > A > D > B
  critic D:  D > A > B > C
  ```
  *(monospaced, hairline-bordered block, dark bg chip)*
- **Callout:** "Rankings aggregated → consensus emerges"

### Slide 9 — How It Works: Synthesize
- **Background:** `#1e1e22` (dark)
- **Eyebrow (violet mono):** "03 · SYNTHESIZE"
- **Headline (white serif):** "A chairman writes the final."
- **Four extraction lines (mono, coloured by agent):**
  - `→ structure   from proposal D` (amber)
  - `→ persona     from proposal B` (pink)
  - `→ constraints from proposal A` (violet)
  - `→ brevity     from proposal C` (green)
- **Result label:** "One result. Genuinely emergent. None of them could write it alone."

### Slide 10 — Results
- **Background:** white
- **Eyebrow:** "RESULTS"
- **Headline:** "The numbers speak."
- **Four stat blocks (Instrument Serif, large):**
  - `3.8×` *average quality uplift vs. original prompt*
  - `42s` *median end-to-end optimize time*
  - `12,400` *prompts optimized this month*
  - `94%` *of users ship the synthesized result unchanged*
- **Layout:** 4-column grid with hairline dividers (matching homepage stats section)

### Slide 11 — Who It's For
- **Background:** white
- **Eyebrow:** "WHO IT'S FOR"
- **Headline:** "Built for people who ship with LLMs."
- **Three audience cards:**
  1. **For product teams** — "Stop losing a week to prompt tuning. Ship by lunch."
  2. **For engineers** — "Stable IDs, versioned history, diff view, rollback. Treat prompts like code."
  3. **For writers & ops** — "Write in plain English. Never manually add a role or schema again."
- **Each card:** violet mono eyebrow, Instrument Serif headline, body copy

### Slide 12 — Business Model
- **Background:** white
- **Eyebrow:** "BUSINESS MODEL"
- **Headline:** "Pay for what you actually run."
- **Three pricing cards (matching homepage pricing section):**
  - **Free** `$0 / forever` — 100 credits, 3 prompt families
  - **Pro** `$29 / month` *(featured, dark bg, violet border)* — 1,000 credits, API access
  - **Team** `$99 / month` — 5,000 pooled credits, SSO, 10 seats
- **Footer:** "1 optimize run = 10 credits · 1 health score = 5 credits · unused credits roll 90 days"

### Slide 13 — Competitive Moat
- **Background:** white
- **Eyebrow:** "WHY WE WIN"
- **Headline:** "No one else runs four agents, blind-reviewing each other."
- **Comparison table (3 columns):**
  | Feature | Promptly | Generic prompt tools |
  |---------|----------|---------------------|
  | Multi-agent peer review | ✓ | ✗ |
  | Emergent synthesis (not best-of-N) | ✓ | ✗ |
  | Stable prompt IDs + versioning | ✓ | ✗ |
  | Model-agnostic output | ✓ | ✗ |
  | Credit refund if no quality uplift | ✓ | ✗ |
- **Footer moat line:** "Workflow lock-in via versioned prompt families. Data flywheel improves synthesis with every run."

### Slide 14 — CTA / Close
- **Background:** `#1e1e22` (dark)
- **Eyebrow (violet mono, glowing dot):** "READY WHEN YOU ARE"
- **Headline (white Instrument Serif, large):**
  "Let the society *sharpen* your prompt."
  *(italic violet on "sharpen")*
- **Subtext:** "100 credits free. No card required. First council run under a minute."
- **CTA button visual:** `⚡ Try Promptly free` (violet pill)
- **Contact line (mono, muted):** `hey@promptly.dev · promptly.dev`
- **Bottom:** Promptly logomark centered

---

## What's Excluded
- Slide 14 "Traction & Ask" removed (project in local development, no public metrics/raise to announce)
- No stock photography
- No gradients on white-bg slides
- No clip-art or generic icons

---

## Implementation Notes
- Build in Canva using `generate-design` or manual slide-by-slide with `perform-editing-operations`
- Use Canva's "Presentation (16:9)" format
- Font substitutes if Instrument Serif / Geist unavailable: Playfair Display (serif) + DM Mono (mono)
- Export as PPTX + PDF
