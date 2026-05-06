'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

// ─── Design tokens (matches home page) ───────────────────────────────────────
const violet  = '#7c5cff';
const ink     = '#141414';
const paper   = '#fafaf7';
const line    = '#e5e5e1';
const muted   = '#555';
const subtle  = '#888';
const mono    = 'var(--font-geist-mono, monospace)';
const serif   = 'var(--font-instrument-serif, Georgia, serif)';
const sans    = 'var(--font-geist, ui-sans-serif)';

// ─── Nav structure ────────────────────────────────────────────────────────────
const SECTIONS = [
  { id: 'getting-started',  label: 'Getting started' },
  { id: 'optimize',         label: 'Optimize' },
  { id: 'health-score',     label: 'Health Score' },
  { id: 'advisory',         label: 'Advisory Review' },
  { id: 'versions',         label: 'Versions' },
  { id: 'prompt-library',   label: 'Prompt Library' },
  { id: 'history',          label: 'History' },
  { id: 'dashboard',        label: 'Dashboard' },
  { id: 'credits',          label: 'Credits' },
  { id: 'api-key',          label: 'API Key' },
];

// ─── Shared primitives ────────────────────────────────────────────────────────

function SectionAnchor({ id }: { id: string }) {
  return <div id={id} style={{ position: 'relative', top: -88 }} />;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: mono, fontSize: 11, color: violet,
      textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 10 }}>
      {children}
    </div>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontFamily: serif, fontWeight: 400, fontSize: 'clamp(28px, 3vw, 40px)',
      letterSpacing: '-0.02em', lineHeight: 1.1, margin: '0 0 16px', color: ink }}>
      {children}
    </h2>
  );
}

function Lead({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 16, lineHeight: 1.7, color: muted, margin: '0 0 32px',
      maxWidth: 680 }}>
      {children}
    </p>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ fontFamily: serif, fontWeight: 400, fontSize: 22,
      letterSpacing: '-0.01em', margin: '36px 0 10px', color: ink }}>
      {children}
    </h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 14.5, lineHeight: 1.75, color: muted, margin: '0 0 16px' }}>
      {children}
    </p>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code style={{ fontFamily: mono, fontSize: 12.5, background: paper,
      border: `1px solid ${line}`, borderRadius: 4,
      padding: '1px 6px', color: ink }}>
      {children}
    </code>
  );
}

function CalloutBox({ icon, label, children, tone = 'neutral' }: {
  icon: string; label: string; children: React.ReactNode; tone?: 'neutral' | 'tip' | 'cost' | 'warn';
}) {
  const colors: Record<string, { bg: string; border: string; labelColor: string }> = {
    neutral: { bg: paper,          border: line,     labelColor: subtle },
    tip:     { bg: '#f0fdf4',      border: '#bbf7d0', labelColor: '#16a34a' },
    cost:    { bg: '#faf5ff',      border: '#e9d5ff', labelColor: violet },
    warn:    { bg: '#fffbeb',      border: '#fde68a', labelColor: '#b45309' },
  };
  const c = colors[tone];
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`,
      borderRadius: 10, padding: '16px 20px', margin: '20px 0',
      display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div>
        <div style={{ fontFamily: mono, fontSize: 10.5, textTransform: 'uppercase',
          letterSpacing: '0.12em', color: c.labelColor, marginBottom: 6 }}>
          {label}
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.65, color: muted }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function StepList({ steps }: { steps: { title: string; body: React.ReactNode }[] }) {
  return (
    <ol style={{ listStyle: 'none', padding: 0, margin: '0 0 28px',
      display: 'flex', flexDirection: 'column', gap: 0 }}>
      {steps.map((s, i) => (
        <li key={i} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
            width: 28, flexShrink: 0 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%',
              background: violet, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 12, fontWeight: 700,
              color: '#fff', flexShrink: 0 }}>
              {i + 1}
            </div>
            {i < steps.length - 1 && (
              <div style={{ width: 1, flex: 1, minHeight: 16,
                background: line, margin: '4px 0' }} />
            )}
          </div>
          <div style={{ paddingBottom: i < steps.length - 1 ? 20 : 0, paddingTop: 4, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: ink, marginBottom: 4 }}>
              {s.title}
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.7, color: muted }}>
              {s.body}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function OutputBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ border: `1px solid ${line}`, borderRadius: 10, overflow: 'hidden',
      margin: '20px 0' }}>
      <div style={{ background: paper, borderBottom: `1px solid ${line}`,
        padding: '8px 16px', fontFamily: mono, fontSize: 10.5,
        color: subtle, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        {label}
      </div>
      <div style={{ padding: '16px 20px', background: '#fff', fontSize: 13.5,
        lineHeight: 1.7, color: muted }}>
        {children}
      </div>
    </div>
  );
}

function FieldTable({ rows }: { rows: { field: string; what: string }[] }) {
  return (
    <div style={{ border: `1px solid ${line}`, borderRadius: 10,
      overflow: 'hidden', margin: '20px 0' }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '200px 1fr',
          padding: '12px 18px', borderBottom: i < rows.length - 1 ? `1px solid ${line}` : 'none',
          background: i % 2 === 0 ? '#fff' : paper, gap: 16 }}>
          <div style={{ fontFamily: mono, fontSize: 12, color: violet }}>{r.field}</div>
          <div style={{ fontSize: 13.5, color: muted, lineHeight: 1.6 }}>{r.what}</div>
        </div>
      ))}
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: `1px solid ${line}`, margin: '64px 0' }} />;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState('getting-started');
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const headings = SECTIONS.map(s => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) setActiveSection(visible[0].target.id);
      },
      { rootMargin: '-56px 0px -60% 0px', threshold: 0 }
    );

    headings.forEach(el => observerRef.current!.observe(el));
    return () => observerRef.current?.disconnect();
  }, []);

  return (
    <div style={{ background: '#fff', color: ink, fontFamily: sans, minHeight: '100vh',
      WebkitFontSmoothing: 'antialiased' }}>

      {/* ── Top nav ── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(255,255,255,0.9)',
        backdropFilter: 'blur(12px)', borderBottom: `1px solid ${line}` }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 40px',
          display: 'flex', alignItems: 'center', gap: 24, height: 56 }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 9,
            textDecoration: 'none', fontSize: 14, fontWeight: 600, color: ink }}>
            <LogoMark />
            promptly
          </Link>
          <span style={{ fontFamily: mono, fontSize: 11, color: subtle,
            padding: '2px 8px', background: paper, border: `1px solid ${line}`,
            borderRadius: 4 }}>
            docs
          </span>
          <span style={{ flex: 1 }} />
          <Link href="/register"
            style={{ height: 32, padding: '0 14px', borderRadius: 6, background: violet,
              display: 'inline-flex', alignItems: 'center', fontSize: 13,
              color: '#fff', textDecoration: 'none', fontWeight: 500 }}>
            Start free →
          </Link>
        </div>
      </div>

      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 40px',
        display: 'grid', gridTemplateColumns: '220px 1fr', gap: 64,
        alignItems: 'start' }}>

        {/* ── Left sidebar ── */}
        <nav style={{ position: 'sticky', top: 72, paddingTop: 48,
          paddingBottom: 48, maxHeight: 'calc(100vh - 72px)', overflowY: 'auto' }}>
          <div style={{ fontFamily: mono, fontSize: 10.5, color: subtle,
            textTransform: 'uppercase', letterSpacing: '0.14em',
            marginBottom: 16 }}>
            Contents
          </div>
          {SECTIONS.map(s => (
            <a key={s.id} href={`#${s.id}`}
              onClick={() => setActiveSection(s.id)}
              style={{ display: 'block', padding: '6px 10px', borderRadius: 6,
                fontSize: 13.5, textDecoration: 'none', marginBottom: 2,
                color: activeSection === s.id ? violet : muted,
                background: activeSection === s.id ? `${violet}10` : 'transparent',
                fontWeight: activeSection === s.id ? 500 : 400,
                borderLeft: `2px solid ${activeSection === s.id ? violet : 'transparent'}`,
                transition: 'all 100ms' }}>
              {s.label}
            </a>
          ))}

          <div style={{ marginTop: 32, paddingTop: 24, borderTop: `1px solid ${line}` }}>
            <div style={{ fontFamily: mono, fontSize: 10.5, color: subtle,
              textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 12 }}>
              Quick links
            </div>
            {[
              { l: '← Home',      href: '/' },
              { l: 'Dashboard',   href: '/dashboard' },
              { l: 'Optimize',    href: '/optimize' },
              { l: 'Analyze',     href: '/analyze' },
            ].map(({ l, href }) => (
              <Link key={l} href={href}
                style={{ display: 'block', padding: '5px 10px', fontSize: 13,
                  color: subtle, textDecoration: 'none', marginBottom: 2 }}>
                {l}
              </Link>
            ))}
          </div>
        </nav>

        {/* ── Main content ── */}
        <main style={{ paddingTop: 48, paddingBottom: 120, minWidth: 0 }}>

          {/* Hero */}
          <div style={{ marginBottom: 64 }}>
            <div style={{ fontFamily: mono, fontSize: 11, color: violet,
              textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 14 }}>
              / user guide
            </div>
            <h1 style={{ fontFamily: serif, fontWeight: 400,
              fontSize: 'clamp(40px, 5vw, 64px)',
              letterSpacing: '-0.03em', lineHeight: 1.05,
              margin: '0 0 20px', color: ink }}>
              Everything Promptly<br />
              can do for <em style={{ color: violet, fontStyle: 'italic' }}>you</em>.
            </h1>
            <p style={{ fontSize: 17, lineHeight: 1.65, color: muted,
              maxWidth: 640, margin: 0 }}>
              A plain-English guide to every feature — what to give it,
              what you get back, and how to get the most out of it.
              No jargon, no architecture diagrams.
            </p>
          </div>

          {/* ══════════════════════════════════════════════════════════
              GETTING STARTED
          ══════════════════════════════════════════════════════════ */}
          <SectionAnchor id="getting-started" />
          <Eyebrow>Getting started</Eyebrow>
          <H2>Set up in under two minutes.</H2>
          <Lead>
            You don&apos;t need to configure anything, learn a new language, or read a
            tutorial before your first result. Here&apos;s how to go from zero to your
            first optimized prompt.
          </Lead>

          <StepList steps={[
            {
              title: 'Create a free account',
              body: <>Go to <InlineCode>promptly.dev/register</InlineCode>. Enter your email and
                a password. No credit card required. You get <strong>100 credits</strong> the
                moment your account is created.</>,
            },
            {
              title: 'Open Optimize',
              body: 'Click Optimize in the left sidebar. This is the main workspace — where you paste a prompt and get an improved one back.',
            },
            {
              title: 'Paste any prompt you already have',
              body: 'It can be one sentence or a page of instructions. The only requirement is that it\'s an existing prompt — something you\'re already using or planning to use. Don\'t write a new one from scratch here.',
            },
            {
              title: 'Click Optimize (10 credits)',
              body: 'Promptly runs the council. This takes roughly 40–60 seconds. You\'ll see a progress indicator while it works.',
            },
            {
              title: 'Read the result and decide what to do with it',
              body: 'You\'ll get a single optimized prompt. Copy it, save it to a family for version tracking, or run it through Health Score and Advisory to understand exactly what changed and why.',
            },
          ]} />

          <CalloutBox icon="💡" label="Tip" tone="tip">
            Your first prompt is the most important one. Pick something real — a prompt
            from a product you&apos;re building, not a toy example. You&apos;ll see
            a bigger improvement and understand the output better.
          </CalloutBox>

          <Divider />

          {/* ══════════════════════════════════════════════════════════
              OPTIMIZE
          ══════════════════════════════════════════════════════════ */}
          <SectionAnchor id="optimize" />
          <Eyebrow>Optimize</Eyebrow>
          <H2>Turn a rough prompt into a production-ready one.</H2>
          <Lead>
            Optimize is the core feature. You give it a prompt. It gives back a
            sharper, more specific, better-structured version — one that gets you
            closer to the result you actually want from the model.
          </Lead>

          <H3>What to give it</H3>
          <P>
            Paste the prompt as you would normally write it. It can be anything:
            a system prompt for a chatbot, a one-liner for a content tool, a long
            structured instruction set, a prompt with placeholders like{' '}
            <InlineCode>{'{{user_input}}'}</InlineCode> or{' '}
            <InlineCode>[INSERT TEXT HERE]</InlineCode>.
            Promptly will preserve your placeholders exactly where they are and
            optimize around them.
          </P>
          <P>
            You can optionally give your prompt a <strong>name</strong> before running.
            Named prompts are tracked as version families — so every future
            optimization on the same prompt stacks as v1, v2, v3 rather than
            creating separate unrelated entries.
          </P>

          <H3>What you get back</H3>
          <P>
            One optimized prompt — plain text you can copy and use immediately.
            The result typically improves on some or all of the following:
          </P>

          <FieldTable rows={[
            { field: 'Role & persona',        what: 'Adds or sharpens a clear expert identity so the model knows exactly what mode to operate in.' },
            { field: 'Task precision',         what: 'Replaces vague instructions ("handle this", "be helpful") with specific, executable ones.' },
            { field: 'Output format',          what: 'Adds structure, length targets, or format requirements when the original left them undefined.' },
            { field: 'Constraints',            what: 'Adds guardrails for the most likely failure mode — wrong format, off-topic responses, missing information.' },
            { field: 'Tone & audience',        what: 'Aligns the register to the actual audience — formal, technical, conversational — based on the task.' },
            { field: 'Conciseness',            what: 'Strips filler words, redundant restatements, and polite padding that reduce signal density.' },
            { field: 'Placeholders',           what: 'Preserved exactly as written. Promptly optimizes the instructions around them, never inside them.' },
          ]} />

          <CalloutBox icon="⚡" label="Credit cost" tone="cost">
            <strong>10 credits</strong> per optimize run. Deducted when you submit — not
            when the result arrives. If the result doesn&apos;t beat your original on
            the health score, credits are refunded automatically.
          </CalloutBox>

          <H3>Saving and naming results</H3>
          <P>
            After the result appears, you can save it in two ways:
          </P>
          <StepList steps={[
            {
              title: 'Save to an existing family',
              body: 'If you ran a named prompt, the result is automatically saved as the next version (v2, v3, …). You can view the full history in Versions.',
            },
            {
              title: 'Save as a new family',
              body: 'Type a name in the name field before or after running. First time gives you v1 (original) and v2 (optimized). Every future run on the same name appends a new version.',
            },
            {
              title: 'Heart the result',
              body: 'Click the heart icon on any result to add it to your Prompt Library — your personal collection of saved prompts, sortable by category and tags.',
            },
          ]} />

          <H3>Continuing a conversation</H3>
          <P>
            Each optimize session supports follow-up messages. After the initial result,
            you can type feedback like <InlineCode>make it shorter</InlineCode> or{' '}
            <InlineCode>add a constraint about avoiding marketing language</InlineCode> —
            and Promptly will re-run the council with your feedback incorporated.
            Each follow-up costs another 10 credits.
          </P>

          <Divider />

          {/* ══════════════════════════════════════════════════════════
              HEALTH SCORE
          ══════════════════════════════════════════════════════════ */}
          <SectionAnchor id="health-score" />
          <Eyebrow>Analyze → Health Score</Eyebrow>
          <H2>A scorecard across ten quality dimensions.</H2>
          <Lead>
            Health Score evaluates any prompt you paste and gives you a detailed
            quality report — a number for each of ten dimensions, with a plain-English
            explanation of exactly what&apos;s weak and why it matters.
          </Lead>

          <H3>What to give it</H3>
          <P>
            Go to <strong>Analyze</strong> in the sidebar, paste a prompt in the input
            at the bottom, and click <strong>Health Score</strong>. That&apos;s it.
            You can paste any prompt — yours, one you just optimized, or one from
            a third-party tool you&apos;re evaluating.
          </P>

          <H3>What you get back</H3>
          <P>
            A structured report with the following sections:
          </P>

          <FieldTable rows={[
            { field: 'Overall score',         what: 'A single weighted number (1–10) representing the overall quality of the prompt. Weighted — injection robustness counts more than tone.' },
            { field: 'Grade',                 what: 'A letter grade derived from the overall score: A (8.5+), B (7.0–8.4), C (5.5–6.9), D (4.0–5.4), F (below 4.0).' },
            { field: 'Deploy ready',          what: 'A yes/no verdict. True only if no dimension scores below 4, injection robustness is adequate, and goal alignment is strong.' },
            { field: 'Injection risk',        what: 'NONE / LOW / MODERATE / HIGH — how vulnerable the prompt is to hostile inputs if it processes user-controlled content.' },
            { field: '10 dimension scores',   what: 'Clarity, Specificity, Completeness, Conciseness, Tone, Actionability, Context Richness, Goal Alignment, Injection Robustness, Reusability. Each scored 1–10 with a one-sentence rationale quoting your actual prompt.' },
            { field: 'Critical failures',     what: 'Any dimension scoring 1–3 is flagged here with the specific consequence for output quality — not just the score.' },
            { field: 'Top 3 improvements',    what: 'Exactly three actionable fixes, ranked by impact. Each one tells you precisely what to add, remove, or rewrite.' },
            { field: 'Deploy verdict',        what: '2–3 sentences summarizing whether the prompt is safe and ready to use as-is, and the single most important change to make first.' },
          ]} />

          <OutputBlock label="Example — what a dimension score looks like">
            <strong style={{ color: ink }}>Injection Robustness — 4/10</strong>
            <br /><br />
            <em style={{ color: '#666' }}>
              &ldquo;The instruction 'summarize {'{user_message}'} honestly' has no trust
              boundary — a hostile input could instruct the model to ignore the rest of
              the prompt and produce unintended output.&rdquo;
            </em>
            <br /><br />
            The rationale always quotes your prompt directly and names the specific
            consequence — not just &ldquo;this is weak.&rdquo;
          </OutputBlock>

          <CalloutBox icon="⚡" label="Credit cost" tone="cost">
            <strong>5 credits</strong> per Health Score run.
          </CalloutBox>

          <CalloutBox icon="💡" label="How to use it best" tone="tip">
            Run Health Score <em>before and after</em> Optimize to see exactly what
            improved. The score gives you an objective before/after comparison so you
            know whether the result is actually better — not just different.
          </CalloutBox>

          <Divider />

          {/* ══════════════════════════════════════════════════════════
              ADVISORY
          ══════════════════════════════════════════════════════════ */}
          <SectionAnchor id="advisory" />
          <Eyebrow>Analyze → Advisory Review</Eyebrow>
          <H2>A senior prompt engineer&apos;s honest review of your prompt.</H2>
          <Lead>
            Advisory gives you a qualitative review — written feedback with
            specific strengths, specific weaknesses with severity labels,
            and actionable improvements you can apply immediately.
            Think of it as a code review for your prompt.
          </Lead>

          <H3>What to give it</H3>
          <P>
            Same as Health Score — go to <strong>Analyze</strong>, paste your prompt,
            and click <strong>Advisory</strong>. You can run both Health Score and
            Advisory on the same prompt to get complementary views: numbers from
            Health Score, written diagnosis from Advisory.
          </P>

          <H3>What you get back</H3>

          <FieldTable rows={[
            { field: 'Overall score',         what: 'LOW / MODERATE / HIGH — an aggregate judgment based on severity of issues found.' },
            { field: 'Injection risk',         what: 'Same NONE/LOW/MODERATE/HIGH scale as Health Score.' },
            { field: 'Overall assessment',     what: '3–4 sentences: current effectiveness, the single biggest blocker, the one fix with the most impact, and a safety verdict.' },
            { field: '7 dimension scores',     what: 'Role & Persona, Task Clarity, Output Format, Constraints & Guardrails, Context & Grounding, Conciseness & Signal Density, Injection Robustness. Each rated STRONG / ADEQUATE / WEAK / MISSING with a one-sentence explanation.' },
            { field: 'Strengths (1–5)',        what: 'Specific things that are working. Each references actual text from your prompt and explains why it works — no generic praise.' },
            { field: 'Weaknesses (1–7)',       what: 'Each tagged [CRITICAL], [MAJOR], or [MINOR]. Names the dimension, describes the concrete failure the weakness causes — not just what\'s missing.' },
            { field: 'Improvements (1–7)',     what: 'One-to-one with weaknesses, same severity tag. Each is a direct executable instruction: exactly what to add, remove, or rewrite, with an example.' },
          ]} />

          <OutputBlock label="Example — what a weakness + improvement looks like">
            <strong style={{ color: '#dc2626' }}>[CRITICAL] Output Format</strong> — The
            prompt says &ldquo;return the result&rdquo; with no schema defined; the model
            will invent a structure on every call, producing inconsistent output that
            breaks any downstream parsing.
            <br /><br />
            <strong style={{ color: '#d97706' }}>Improvement [CRITICAL]</strong> — Add an
            explicit JSON schema: <InlineCode>{`{ "summary": string, "score": 1–10, "flags": string[] }`}</InlineCode>.
            Replace &ldquo;return the result&rdquo; with &ldquo;Return only a valid JSON
            object matching this schema.&rdquo;
          </OutputBlock>

          <CalloutBox icon="⚡" label="Credit cost" tone="cost">
            <strong>5 credits</strong> per Advisory run.
          </CalloutBox>

          <CalloutBox icon="💡" label="Advisory vs Health Score" tone="tip">
            Use <strong>Health Score</strong> when you want numbers — for tracking
            improvement over time or comparing two versions side-by-side.
            Use <strong>Advisory</strong> when you want to understand <em>why</em>
            something is weak and get precise instructions for fixing it.
            They complement each other.
          </CalloutBox>

          <Divider />

          {/* ══════════════════════════════════════════════════════════
              VERSIONS
          ══════════════════════════════════════════════════════════ */}
          <SectionAnchor id="versions" />
          <Eyebrow>Versions</Eyebrow>
          <H2>Every version of every prompt, in one place.</H2>
          <Lead>
            Versions tracks the full history of any named prompt — every iteration
            you&apos;ve created through optimization, with diff view, rollback,
            and a stable ID you can reference in code.
          </Lead>

          <H3>Prompt families</H3>
          <P>
            A <strong>prompt family</strong> is a named group of related prompt versions.
            When you name a prompt in Optimize and run it, Promptly saves:
          </P>
          <StepList steps={[
            { title: 'v1 — your original', body: 'The prompt exactly as you pasted it.' },
            { title: 'v2 — optimized result', body: 'The council\'s output saved automatically.' },
            { title: 'v3, v4, … — each future run', body: 'Every subsequent optimization on the same family adds a new version. The original is never overwritten.' },
          ]} />

          <H3>What you can see on the Versions page</H3>
          <FieldTable rows={[
            { field: 'Family name',      what: 'The name you gave the prompt. Click any row to open the full version history.' },
            { field: 'Stable ID',        what: 'An 8-character prefix of the full UUID. Use the full ID in the API to always pull the latest approved version.' },
            { field: 'Version bar',      what: 'A row of small blocks — one per version. The most recent is filled in violet, earlier ones are dimmed.' },
            { field: 'vN label',         what: 'How many versions exist. A family at v4 has been optimized three times after the original was saved.' },
            { field: 'Last updated',     what: 'Relative time since the most recent version was created.' },
            { field: 'Heart count',      what: 'Number of versions in this family you\'ve saved to Prompt Library.' },
          ]} />

          <H3>Inside a version family</H3>
          <P>
            Click any family row to open its detail page. From there you can:
          </P>
          <FieldTable rows={[
            { field: 'Read each version',    what: 'Full content of every version, displayed in order from oldest to newest.' },
            { field: 'Diff any two versions', what: 'Select two versions to see a word-level diff — added words in green, removed words in red. Useful for understanding exactly what changed between runs.' },
            { field: 'Heart a version',      what: 'Save any specific version to Prompt Library with one click.' },
          ]} />

          <CalloutBox icon="💡" label="Tip" tone="tip">
            Use the stable family ID in your code or CI pipeline to always pull the
            latest approved prompt via the API — so your production agent
            automatically gets the best version without any manual copy-pasting.
          </CalloutBox>

          <Divider />

          {/* ══════════════════════════════════════════════════════════
              PROMPT LIBRARY
          ══════════════════════════════════════════════════════════ */}
          <SectionAnchor id="prompt-library" />
          <Eyebrow>Prompt Library</Eyebrow>
          <H2>Your personal collection of saved prompts.</H2>
          <Lead>
            Prompt Library is where you keep the prompts you want to reuse — hearted
            from optimize results, organized by category and tags, and sortable
            by how recently or frequently you&apos;ve used them.
          </Lead>

          <H3>How to add prompts to your library</H3>
          <P>
            Click the <strong>heart icon</strong> on any optimize result.
            That specific version is saved to your library with its family name,
            version number, and the timestamp it was liked.
          </P>
          <P>
            You can also heart a specific version from inside a version
            family&apos;s detail page — useful when you want to save v2 but not v4,
            or when you come back to an old result and decide it was actually the best one.
          </P>

          <H3>What each card shows</H3>
          <FieldTable rows={[
            { field: 'Family name + version', what: 'The name of the prompt and which version you saved (e.g. "Customer onboarding email · v3").' },
            { field: 'Content preview',       what: 'The first 120 characters of the prompt, so you can identify it at a glance without opening it.' },
            { field: 'Tags',                  what: 'Up to 3 tags visible on the card. You can add tags from the detail view to organize prompts by topic, use-case, or model.' },
            { field: 'Category',              what: 'Work, Personal, Research, Creative, or Other. Set when you save or from the detail view.' },
            { field: 'Pin',                   what: 'Pinned prompts appear at the top of the grid regardless of sort order. Use this for prompts you reach for every day.' },
            { field: 'Liked ago',             what: 'When you hearted this prompt.' },
          ]} />

          <H3>Finding what you need</H3>
          <P>
            The toolbar above the grid gives you three controls:
          </P>
          <FieldTable rows={[
            { field: 'Search',      what: 'Searches prompt content and family names. Results update as you type (300ms debounce — no need to press Enter).' },
            { field: 'Category',    what: 'Filter to Work / Personal / Research / Creative / Other. Combine with search for precise filtering.' },
            { field: 'Sort',        what: 'Recently liked (default), Recently used, Most used, or Name A–Z.' },
          ]} />

          <CalloutBox icon="💡" label="Tip" tone="tip">
            Use <strong>Most used</strong> sort to find your highest-value prompts — the
            ones you copy into products most often. These are the best candidates for
            another optimization run when you want to push quality further.
          </CalloutBox>

          <Divider />

          {/* ══════════════════════════════════════════════════════════
              HISTORY
          ══════════════════════════════════════════════════════════ */}
          <SectionAnchor id="history" />
          <Eyebrow>History</Eyebrow>
          <H2>Every session you&apos;ve ever run.</H2>
          <Lead>
            History shows a chronological list of all your optimize sessions —
            every time you submitted a prompt for optimization, the result, and
            the conversation if you continued with follow-up messages.
          </Lead>

          <H3>What you see</H3>
          <FieldTable rows={[
            { field: 'Session title',    what: 'Auto-generated from the first prompt you submitted in that session — the first few words, truncated.' },
            { field: 'Time groups',      what: 'Sessions are grouped by Today, Last 7 days, Last 30 days, and Older so you can scan by recency.' },
            { field: 'Session link',     what: 'Click any session to reopen it in the Optimize view — you\'ll see the original prompt, the result, and any follow-up turns in the same conversation.' },
          ]} />

          <H3>Re-opening an old session</H3>
          <P>
            When you reopen a session, it loads as a read-only conversation by default.
            You can continue from there — submit a new follow-up message and Promptly will
            run another round of optimization picking up from the context of that session.
            Each follow-up costs 10 credits.
          </P>

          <CalloutBox icon="⚠️" label="Retention" tone="warn">
            Sessions that were not saved to a named prompt family are kept for
            <strong> 7 days</strong> and then deleted. If you want to keep a result
            permanently, save it to a family (give it a name in Optimize) or heart
            it to Prompt Library before the 7-day window closes.
          </CalloutBox>

          <Divider />

          {/* ══════════════════════════════════════════════════════════
              DASHBOARD
          ══════════════════════════════════════════════════════════ */}
          <SectionAnchor id="dashboard" />
          <Eyebrow>Dashboard</Eyebrow>
          <H2>A quick view of your activity and usage.</H2>
          <Lead>
            The dashboard gives you a snapshot of how you&apos;ve been using Promptly —
            prompts optimized, credits spent, quality trends, and model distribution
            across your runs.
          </Lead>

          <FieldTable rows={[
            { field: 'Prompts optimized',  what: 'Total optimize runs since your account was created.' },
            { field: 'Credits remaining',  what: 'Your current credit balance. Click through to Billing to top up.' },
            { field: 'Avg health score',   what: 'The average overall score across all Health Score runs you\'ve done. Useful for tracking whether your prompts are improving over time.' },
            { field: 'Active families',    what: 'Number of named prompt families you\'re maintaining in Versions.' },
            { field: 'Daily activity',     what: 'A bar chart of optimize runs per day over the past 30 days.' },
            { field: 'Quality trend',      what: 'Average health score per day — a rising line means your prompts are consistently getting better.' },
            { field: 'Model distribution', what: 'Which council models produced results you used or saved most often. Useful context for understanding which approaches are working for your use cases.' },
            { field: 'Recent sessions',    what: 'Your last five optimize sessions with links to reopen them.' },
          ]} />

          <Divider />

          {/* ══════════════════════════════════════════════════════════
              CREDITS
          ══════════════════════════════════════════════════════════ */}
          <SectionAnchor id="credits" />
          <Eyebrow>Credits</Eyebrow>
          <H2>What credits are and how they work.</H2>
          <Lead>
            Credits are the unit of usage in Promptly. Each action that runs
            a model costs a fixed number of credits. You start with 100 for free —
            no card required.
          </Lead>

          <FieldTable rows={[
            { field: 'Optimize',      what: '10 credits — one full council run: four proposals, four critiques, one synthesis.' },
            { field: 'Health Score',  what: '5 credits — a full ten-dimension quality evaluation with rationale.' },
            { field: 'Advisory',      what: '5 credits — a full qualitative review with dimension scores, strengths, weaknesses, and improvements.' },
          ]} />

          <H3>When credits are deducted</H3>
          <P>
            Credits are deducted when you <em>submit</em> the request — not when the
            result arrives. If a request fails due to a server error on our side,
            credits are refunded automatically. If the optimized prompt&apos;s health
            score doesn&apos;t beat the original, credits are also refunded — no
            ticket required.
          </P>

          <H3>Topping up</H3>
          <P>
            Go to <strong>Billing</strong> in the sidebar. You can add credits in
            fixed bundles — 100, 250, 500, or 1,000 credits. Credit top-ups
            never expire. Unused subscription credits roll over for 90 days.
          </P>

          <CalloutBox icon="⚠️" label="Insufficient credits" tone="warn">
            If you have fewer credits than the cost of an action, the request will
            be rejected with a <InlineCode>402</InlineCode> error before anything
            runs. Top up from the Billing page and retry.
          </CalloutBox>

          <Divider />

          {/* ══════════════════════════════════════════════════════════
              API KEY
          ══════════════════════════════════════════════════════════ */}
          <SectionAnchor id="api-key" />
          <Eyebrow>API Key</Eyebrow>
          <H2>Use Promptly from code.</H2>
          <Lead>
            Every account has an API key that lets you call Promptly&apos;s endpoints
            programmatically — from a CI pipeline, a build script, or your own
            application.
          </Lead>

          <H3>Finding your API key</H3>
          <P>
            Your API key starts with <InlineCode>qac_</InlineCode> and is visible
            in your account settings. Treat it like a password — don&apos;t commit
            it to source control. Use an environment variable:
          </P>

          <div style={{ background: ink, borderRadius: 10, padding: '16px 20px',
            margin: '16px 0', fontFamily: mono, fontSize: 13,
            lineHeight: 1.65, color: '#b5b5ba' }}>
            <div style={{ color: '#5a5a60' }}># .env</div>
            <div style={{ color: '#ededed' }}>PROMPTLY_API_KEY=qac_your_key_here</div>
          </div>

          <H3>Making API calls</H3>
          <P>
            Pass the key as a Bearer token in the <InlineCode>Authorization</InlineCode> header:
          </P>

          <div style={{ background: ink, borderRadius: 10, padding: '16px 20px',
            margin: '16px 0', fontFamily: mono, fontSize: 12.5,
            lineHeight: 1.7, color: '#b5b5ba' }}>
            <div style={{ color: '#5a5a60' }}># Optimize a prompt</div>
            <div>curl -X POST https://api.promptly.dev/api/v1/chat/ \</div>
            <div style={{ paddingLeft: 16 }}>-H <span style={{ color: '#5cffb1' }}>&quot;Authorization: Bearer {'$PROMPTLY_API_KEY'}&quot;</span> \</div>
            <div style={{ paddingLeft: 16 }}>-H <span style={{ color: '#5cffb1' }}>&quot;Content-Type: application/json&quot;</span> \</div>
            <div style={{ paddingLeft: 16 }}>-d <span style={{ color: '#ffb85c' }}>&apos;{'{"prompt": "your prompt here", "name": "my-prompt"}'}&apos;</span></div>
            <div style={{ marginTop: 14, color: '#5a5a60' }}># Returns immediately with a job_id</div>
            <div style={{ color: '#5a5a60' }}># Poll for result:</div>
            <div>curl https://api.promptly.dev/api/v1/chat/jobs/{'$JOB_ID'} \</div>
            <div style={{ paddingLeft: 16 }}>-H <span style={{ color: '#5cffb1' }}>&quot;Authorization: Bearer {'$PROMPTLY_API_KEY'}&quot;</span></div>
          </div>

          <H3>Available endpoints</H3>
          <FieldTable rows={[
            { field: 'POST /api/v1/chat/',                   what: 'Submit a prompt for optimization. Returns a job_id immediately. Poll for the result.' },
            { field: 'GET /api/v1/chat/jobs/{id}',           what: 'Poll for job status. Returns status (queued / started / completed / failed) and the result when ready.' },
            { field: 'POST /api/v1/prompts/health-score',    what: 'Run a Health Score evaluation synchronously. Returns the full report.' },
            { field: 'POST /api/v1/prompts/advisory',        what: 'Run an Advisory review synchronously. Returns the full review.' },
            { field: 'GET /api/v1/prompts/versions',         what: 'List all your prompt families with their version history.' },
            { field: 'GET /api/v1/prompts/versions/{id}',    what: 'Get all versions of a specific prompt family.' },
            { field: 'GET /api/v1/prompts/versions/{id}/diff', what: 'Get a word-level diff between two versions. Pass ?from=1&to=3 as query params.' },
            { field: 'GET /api/v1/users/me',                 what: 'Get your account info including current credit balance.' },
          ]} />

          <CalloutBox icon="💡" label="Polling pattern" tone="tip">
            The optimize endpoint is asynchronous — it returns a <InlineCode>job_id</InlineCode>{' '}
            immediately and runs in the background. Poll{' '}
            <InlineCode>GET /chat/jobs/{'{id}'}</InlineCode> every 2–3 seconds until
            status is <InlineCode>completed</InlineCode> or <InlineCode>failed</InlineCode>.
            Typical completion time is 40–60 seconds.
          </CalloutBox>

          {/* Bottom CTA */}
          <Divider />
          <div style={{ textAlign: 'center', padding: '16px 0 32px' }}>
            <div style={{ fontFamily: serif, fontWeight: 400,
              fontSize: 'clamp(28px, 3vw, 40px)',
              letterSpacing: '-0.02em', lineHeight: 1.1,
              margin: '0 0 16px', color: ink }}>
              Ready to try it?
            </div>
            <p style={{ fontSize: 15, color: muted, margin: '0 0 28px' }}>
              100 credits free. No card required. Start with any prompt you already have.
            </p>
            <Link href="/register"
              style={{ height: 46, padding: '0 28px', borderRadius: 8,
                background: violet, color: '#fff', textDecoration: 'none',
                fontWeight: 500, fontSize: 15, display: 'inline-flex',
                alignItems: 'center', gap: 8,
                boxShadow: `0 4px 24px ${violet}44` }}>
              ⚡ Start free
            </Link>
          </div>

        </main>
      </div>
    </div>
  );
}

function LogoMark() {
  return (
    <div style={{ width: 22, height: 22, borderRadius: 6, background: violet,
      position: 'relative', display: 'inline-flex', alignItems: 'center',
      justifyContent: 'center', flexShrink: 0,
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3), 0 1px 0 rgba(0,0,0,0.15)' }}>
      <div style={{ position: 'absolute', inset: 5, border: '1.5px solid #fff',
        borderRight: '1.5px solid transparent', borderBottom: '1.5px solid transparent',
        borderRadius: 2, transform: 'rotate(45deg)' }} />
    </div>
  );
}
