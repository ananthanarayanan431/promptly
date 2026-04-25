'use client';

import { useState } from 'react';
import Link from 'next/link';

// ─── Data ────────────────────────────────────────────────────────────────────

const COUNCIL = [
  { letter: 'A', name: 'Analytical',  color: '#7c5cff', role: 'Precision, constraints, output schema.' },
  { letter: 'C', name: 'Creative',    color: '#ff7ac6', role: 'Persona, exemplars, voice.' },
  { letter: 'O', name: 'Concise',     color: '#5cffb1', role: 'Radical brevity, signal density.' },
  { letter: 'S', name: 'Structured',  color: '#ffb85c', role: 'Logical decomposition, schemas.' },
];

const MARQUEE = ['Notion', 'Linear', 'Vercel', 'Anthropic', 'Mistral', 'Hugging Face',
                 'Ramp', 'Retool', 'Supabase', 'Cursor', 'Arc', 'Raycast'];

const STATS = [
  { n: '3.8×',   em: true, l: 'average quality uplift vs. original prompt' },
  { n: '42s',             l: 'median end-to-end optimize time' },
  { n: '12,400',          l: 'prompts optimized this month' },
  { n: '94%',             l: 'of users ship the synthesized result unchanged' },
];

const PHASES = [
  {
    n: '01 · propose',
    t: 'Four minds. One prompt. Parallel.',
    d: 'Four specialist agents — Analytical, Creative, Concise, Structured — each independently rewrites your prompt using a different cognitive philosophy. No agent sees what the others wrote.',
    mini: '→ Analytical: adds constraints + output schema\n→ Creative:    adds persona + worked example\n→ Concise:     strips every filler word\n→ Structured:  adds logical decomposition',
  },
  {
    n: '02 · critique',
    t: 'Blind peer review.',
    d: 'Each agent reviews the other three proposals — shown anonymously as A/B/C/D so no model favours its own work. Rankings are independently derived, then aggregated.',
    mini: 'critic A: B > D > A > C\ncritic B: A > B > D > C\ncritic C: C > A > D > B\ncritic D: D > A > B > C',
  },
  {
    n: '03 · synthesize',
    t: 'A chairman writes the final.',
    d: 'A separate synthesis model reads all four proposals and all four critique reports, then extracts the strongest elements from each to produce one result none of the individual agents could write alone.',
    mini: '→ structure  from proposal D\n→ persona    from proposal B\n→ constraints from proposal A\n→ brevity    from proposal C',
  },
];

const AUDIENCE = [
  {
    r: 'for product teams',
    h: 'Stop losing a week to prompt tuning.',
    d: 'Paste the prompt from your PRD. Ship the optimized one to staging by lunch. The council handles role, format, constraints, and edge cases automatically.',
  },
  {
    r: 'for engineers',
    h: 'Treat prompts like code.',
    d: 'Stable IDs, versioned history, diff view, rollback. Wire the API into your CI so every merge runs the health score against all ten quality dimensions.',
  },
  {
    r: 'for writers & ops',
    h: 'Write in plain English.',
    d: "No prompt-engineering jargon. Say what you want; the society handles the rest. You'll never manually add a role, output schema, or injection guardrail again.",
  },
];

const TESTIMONIALS = [
  {
    quote: '"We had a 600-word prompt that worked on Claude but fell apart on GPT. Promptly rewrote it in forty seconds. It works on both now, and our eval scores went up eleven points."',
    name: 'Kiran Menon', role: 'Staff Eng · Fintech unicorn', initials: 'KM',
    grad: 'linear-gradient(135deg, #7c5cff, #3a1eff)', featured: true,
  },
  {
    quote: '"The health score told us the tone was the problem — we\'d been blaming the model for six weeks."',
    name: 'Aditi Sharma', role: 'Head of AI · Retail SaaS', initials: 'AS',
    grad: 'linear-gradient(135deg, #5cffb1, #2fd589)',
  },
  {
    quote: '"Every prompt in our repo now has a stable ID and a version. Onboarding new engineers got twice as fast."',
    name: 'Jamie Liu', role: 'Founding Engineer · Seed-stage', initials: 'JL',
    grad: 'linear-gradient(135deg, #ffb85c, #d68a2b)',
  },
];

const PRICING = [
  {
    plan: 'Free', price: '$0', per: '/ forever',
    desc: 'Kick the tires. Good for side projects and one-off runs.',
    features: ['100 credits on signup', '10 credits / month refill', '3 saved prompt families', 'Community support'],
    cta: 'Start free', href: '/register', featured: false,
  },
  {
    plan: 'Pro', price: '$29', per: '/ month',
    desc: 'For people shipping LLM features at work. Most teams start here.',
    features: ['1,000 credits / month', 'Unlimited prompt families', 'API access + CLI', 'Priority email support'],
    cta: 'Go Pro', href: '/register', featured: true,
  },
  {
    plan: 'Team', price: '$99', per: '/ month',
    desc: 'Shared workspaces, roles, and billing. Built for crews of 3–20.',
    features: ['5,000 credits pooled', 'Up to 10 seats', 'SSO + audit log', 'Dedicated Slack channel'],
    cta: 'Start team trial', href: '/register', featured: false,
  },
];

const FAQS = [
  { q: 'What exactly is "Society of Mind" architecture?', a: 'Inspired by Marvin Minsky\'s 1986 theory that intelligence emerges from cooperation between many simple agents — not one unified brain. Promptly runs four specialist agents in parallel, has them blind-review each other\'s work, then a separate synthesis model produces a result that none of the individual agents could write alone. The output is genuinely emergent.' },
  { q: 'Does Promptly store my prompts?', a: 'Only the ones you save to a family. Ad-hoc optimize runs are kept for 7 days for debugging and then deleted. Prompts are never used to train any model.' },
  { q: 'Which models do you use internally?', a: 'A rotating council drawn from frontier models across major providers. We benchmark weekly and swap in whatever performs best on our eval set. You can pin specific models on the Team plan.' },
  { q: 'Can I use the optimized prompts anywhere?', a: 'Yes. The output is plain text — copy it into any SDK, API, or product. No lock-in, no runtime dependency on Promptly.' },
  { q: 'What counts as one optimize run?', a: "One full pipeline — four proposals, four critiques, one synthesis. That's 10 credits. Health score and advisory are 5 credits each." },
  { q: 'Is there a refund policy?', a: "If the synthesized prompt doesn't beat your original on our health score, we refund the credits automatically. No ticket required." },
];

const INTEGRATIONS = [
  { g: 'A',  n: 'Anthropic' }, { g: 'O',  n: 'OpenAI' },   { g: 'G',  n: 'Google' },
  { g: 'M',  n: 'Mistral' },   { g: 'H',  n: 'Hugging Face' }, { g: 'L', n: 'Ollama' },
  { g: 'Ln', n: 'LangChain' }, { g: 'Ll', n: 'LlamaIndex' }, { g: 'Vc', n: 'Vercel AI' },
  { g: 'Py', n: 'Python SDK' }, { g: 'Ts', n: 'TypeScript' }, { g: 'cli', n: 'CLI' },
];

// ─── Style tokens ─────────────────────────────────────────────────────────────

const paper   = '#fafaf7';
const line    = '#e5e5e1';
const violet  = '#7c5cff';
const ink     = '#141414';
const ink2    = '#1e1e22';
const muted   = '#555';
const mono    = 'var(--font-geist-mono, monospace)';
const serif   = 'var(--font-instrument-serif, Georgia, serif)';
const sans    = 'var(--font-geist, ui-sans-serif)';

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState(-1);

  return (
    <div style={{ background: '#fff', color: ink, fontFamily: sans, minHeight: '100vh',
      WebkitFontSmoothing: 'antialiased' }}>

      {/* ── Nav ── */}
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 40px' }}>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '18px 0',
          fontSize: 13, color: '#555' }}>
          <LogoMark />
          <span style={{ flex: 1 }} />
          {[
            { l: 'Product',      href: '#product' },
            { l: 'How it works', href: '#how' },
            { l: 'Pricing',      href: '#pricing' },
            { l: 'Customers',    href: '#customers' },
            { l: 'Docs',         href: '/docs' },
            { l: 'Contact',      href: '#contact' },
          ].map(({ l, href }) => (
            <a key={l} href={href} style={{ color: '#555', textDecoration: 'none' }}>{l}</a>
          ))}
          <Link href="/login"
            style={{ height: 32, padding: '0 14px', borderRadius: 6,
              border: `1px solid ${line}`, display: 'inline-flex', alignItems: 'center',
              fontSize: 13, color: ink, textDecoration: 'none' }}>
            Sign in
          </Link>
          <Link href="/register"
            style={{ height: 32, padding: '0 14px', borderRadius: 6, background: violet,
              display: 'inline-flex', alignItems: 'center', fontSize: 13, color: '#fff',
              textDecoration: 'none', fontWeight: 500 }}>
            Start free
          </Link>
        </nav>
      </div>

      {/* ── Hero ── */}
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '40px 40px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 72, alignItems: 'center' }}>
          <div>
            {/* Eyebrow */}
            <div style={{ fontFamily: mono, fontSize: 11.5, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: '#888', marginBottom: 28,
              display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: violet,
                display: 'inline-block', boxShadow: `0 0 8px ${violet}` }} />
              Now in public beta · 100 credits free
            </div>

            {/* Headline */}
            <h1 style={{ fontFamily: serif, fontWeight: 400,
              fontSize: 'clamp(48px, 6.5vw, 96px)',
              letterSpacing: '-0.03em', lineHeight: 1.04, margin: '0 0 28px', color: ink }}>
              Your prompt,<br />
              <em style={{ fontStyle: 'italic', color: violet }}>sharpened</em><br />
              by a society<br />
              of minds.
            </h1>

            {/* Sub */}
            <p style={{ fontSize: 17, lineHeight: 1.55, color: '#444',
              maxWidth: 480, margin: '0 0 36px' }}>
              Paste the prompt you have. A council of four specialist agents proposes,
              peer-reviews, and synthesizes — returning one result none of them
              could write alone.
            </p>

            {/* CTAs */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
              <Link href="/register"
                style={{ height: 46, padding: '0 22px', borderRadius: 8, background: violet,
                  color: '#fff', textDecoration: 'none', fontWeight: 500, fontSize: 14,
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  boxShadow: `0 4px 24px ${violet}44` }}>
                ⚡ Try it with your prompt
              </Link>
              <a href="#how"
                style={{ height: 46, padding: '0 22px', borderRadius: 8,
                  border: `1px solid ${line}`, color: ink, textDecoration: 'none',
                  fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                See how it works →
              </a>
            </div>
            <div style={{ fontFamily: mono, fontSize: 11.5, color: '#999' }}>
              100 credits free · no card · cancel with a button, not an email
            </div>
          </div>

          {/* Hero terminal card */}
          <div style={{ background: ink2, color: '#ededed', borderRadius: 16,
            overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.18)' }}>
            {/* Terminal bar */}
            <div style={{ padding: '12px 18px', borderBottom: '1px solid #1f1f23',
              display: 'flex', gap: 7, alignItems: 'center' }}>
              {['#ff5f57','#febc2e','#28c840'].map(c => (
                <span key={c} style={{ width: 10, height: 10, borderRadius: '50%',
                  background: c, display: 'inline-block' }} />
              ))}
              <span style={{ fontFamily: mono, fontSize: 11, color: '#5a5a60', marginLeft: 10 }}>
                promptly — society optimize
              </span>
            </div>

            <div style={{ padding: '20px 22px', fontFamily: mono, fontSize: 12, lineHeight: 1.65 }}>
              {/* Input */}
              <div style={{ color: '#5a5a60' }}># your prompt</div>
              <div style={{ color: '#b5b5ba', marginBottom: 16 }}>
                write a blog post about remote work
              </div>

              {/* Society assembling */}
              <div style={{ color: violet, marginBottom: 12 }}>
                → assembling society of minds…
              </div>

              {/* Council grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 18 }}>
                {COUNCIL.map(a => (
                  <div key={a.letter} style={{ padding: '8px 10px', background: '#1a1a20',
                    borderRadius: 8, border: '1px solid #2a2a32' }}>
                    <div style={{ width: 20, height: 20, borderRadius: 5, background: a.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700, color: '#fff', marginBottom: 5 }}>
                      {a.letter}
                    </div>
                    <div style={{ fontSize: 10, color: '#8a8a90', marginBottom: 4 }}>{a.name}</div>
                    {/* Progress bar */}
                    <div style={{ height: 2, background: '#2a2a2e', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: '100%', background: a.color,
                        opacity: 0.85 }} />
                    </div>
                    <div style={{ fontSize: 9, color: '#5a5a60', marginTop: 4 }}>✓ done</div>
                  </div>
                ))}
              </div>

              {/* Peer review */}
              <div style={{ fontSize: 11, color: '#5a5a60', marginBottom: 4 }}>
                # blind peer review complete
              </div>
              <div style={{ fontSize: 11, color: '#8a8a90', marginBottom: 16 }}>
                consensus: B &gt; A &gt; D &gt; C
              </div>

              {/* Output */}
              <div style={{ color: '#5a5a60', marginBottom: 4 }}># synthesized result</div>
              <div style={{ color: '#ededed' }}>
                You are Maya, a distributed-work researcher…
              </div>
              <div style={{ color: '#b5b5ba' }}>Write 800 words (±5%). Open on a scene.</div>
              <div style={{ color: '#b5b5ba' }}>Weave in 3 cited stats. No "in conclusion."</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Marquee ── */}
      <div style={{ borderTop: `1px solid ${line}`, borderBottom: `1px solid ${line}`,
        padding: '22px 0', marginTop: 64, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 60,
          animation: 'marquee 40s linear infinite', whiteSpace: 'nowrap' }}>
          {[...MARQUEE, ...MARQUEE].map((m, i) => (
            <span key={i} style={{ fontFamily: serif, fontSize: 22, letterSpacing: '-0.01em',
              color: '#aaa', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 5, height: 5, background: violet,
                borderRadius: '50%', display: 'inline-block' }} />
              {m}
            </span>
          ))}
        </div>
      </div>

      {/* ── Stats ── */}
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 40px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          borderTop: `1px solid ${line}`, borderBottom: `1px solid ${line}`, marginTop: 80 }}>
          {STATS.map((s, i) => (
            <div key={i} style={{ padding: '36px 24px',
              borderRight: i < 3 ? `1px solid ${line}` : 'none' }}>
              <div style={{ fontFamily: serif, fontSize: 56,
                letterSpacing: '-0.03em', lineHeight: 1 }}>
                {s.em
                  ? <em style={{ fontStyle: 'italic', color: violet }}>{s.n}</em>
                  : s.n}
              </div>
              <div style={{ fontSize: 13, color: muted, marginTop: 10 }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* ── Society of Mind section ── */}
        <div id="how" style={{ paddingTop: 96, marginTop: 40, borderTop: `1px solid ${line}` }}>
          {/* Section header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr',
            gap: 60, alignItems: 'end', marginBottom: 56 }}>
            <div>
              <div style={{ fontFamily: mono, fontSize: 11, color: '#888',
                textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 12 }}>
                How it works
              </div>
              <h2 style={{ fontFamily: serif, fontWeight: 400,
                fontSize: 'clamp(38px, 5vw, 66px)',
                letterSpacing: '-0.025em', lineHeight: 1.0, margin: 0, color: ink }}>
                A society of minds,<br />
                not a single <em style={{ fontStyle: 'italic', color: violet }}>brain</em>.
              </h2>
            </div>
            <div>
              <p style={{ fontSize: 15.5, lineHeight: 1.65, color: muted, maxWidth: 380, margin: 0 }}>
                Marvin Minsky argued in 1986 that intelligence doesn&apos;t come
                from one giant brain — it emerges from a patchwork society of
                interacting agents, each mindless alone, collectively
                brilliant together.
              </p>
              <p style={{ fontSize: 15.5, lineHeight: 1.65, color: muted,
                maxWidth: 380, margin: '14px 0 0' }}>
                Promptly is that architecture applied to prompt engineering.
                Four specialists propose. All four peer-review. One
                chairman synthesizes. The result is genuinely emergent —
                no single agent could produce it.
              </p>
            </div>
          </div>

          {/* Minsky quote callout */}
          <div style={{ background: ink2, borderRadius: 14, padding: '28px 36px',
            marginBottom: 32, display: 'flex', gap: 24, alignItems: 'flex-start' }}>
            <div style={{ fontFamily: serif, fontSize: 48, color: violet,
              lineHeight: 1, flexShrink: 0, marginTop: -4 }}>&ldquo;</div>
            <div>
              <p style={{ fontFamily: serif, fontSize: 20, lineHeight: 1.5,
                color: '#ededed', margin: '0 0 12px', letterSpacing: '-0.01em' }}>
                The mind is a society of tiny agents, each mindless by itself.
                Intelligence is what emerges when they interact.
              </p>
              <div style={{ fontFamily: mono, fontSize: 11, color: '#5a5a60',
                textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                Marvin Minsky · Society of Mind, 1986
              </div>
            </div>
          </div>

          {/* 3 phases */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
            border: `1px solid ${line}`, borderRadius: 14, overflow: 'hidden' }}>
            {PHASES.map((s, i) => (
              <div key={i} style={{ padding: '28px 26px 32px',
                borderRight: i < 2 ? `1px solid ${line}` : 'none',
                background: '#fff' }}>
                <div style={{ fontFamily: mono, fontSize: 11, color: violet,
                  letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                  {s.n}
                </div>
                <div style={{ fontFamily: serif, fontSize: 27,
                  letterSpacing: '-0.02em', lineHeight: 1.1,
                  margin: '18px 0 10px', color: ink }}>
                  {s.t}
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.6, color: muted }}>
                  {s.d}
                </div>
                <pre style={{ marginTop: 18, borderRadius: 8, border: `1px solid ${line}`,
                  background: paper, padding: '12px 14px', fontFamily: mono,
                  fontSize: 10.5, color: '#666', lineHeight: 1.55,
                  overflow: 'hidden', whiteSpace: 'pre-wrap', margin: '18px 0 0',
                  minHeight: 80 }}>
                  {s.mini}
                </pre>
              </div>
            ))}
          </div>

          {/* Council members grid */}
          <div style={{ marginTop: 16, display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {COUNCIL.map(a => (
              <div key={a.letter} style={{ border: `1px solid ${line}`,
                borderRadius: 12, padding: '20px 20px',
                display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8,
                  background: a.color, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 14, fontWeight: 700,
                  color: '#fff', flexShrink: 0 }}>
                  {a.letter}
                </div>
                <div>
                  <div style={{ fontFamily: mono, fontSize: 10.5, fontWeight: 600,
                    color: ink, textTransform: 'uppercase', letterSpacing: '0.1em',
                    marginBottom: 4 }}>
                    {a.name}
                  </div>
                  <div style={{ fontSize: 12.5, color: muted, lineHeight: 1.5 }}>
                    {a.role}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Who it's for ── */}
        <div id="product" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: 60, alignItems: 'end', marginBottom: 48, paddingTop: 96,
          marginTop: 40, borderTop: `1px solid ${line}` }}>
          <div>
            <div style={{ fontFamily: mono, fontSize: 11, color: '#888',
              textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 12 }}>
              Who it&apos;s for
            </div>
            <h2 style={{ fontFamily: serif, fontWeight: 400,
              fontSize: 'clamp(38px, 5vw, 66px)',
              letterSpacing: '-0.025em', lineHeight: 1.0, margin: 0, color: ink }}>
              Built for people<br />
              who ship with <em style={{ fontStyle: 'italic', color: violet }}>LLMs</em>.
            </h2>
          </div>
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: muted, maxWidth: 360, margin: 0 }}>
            If your product depends on a prompt that has to keep working across
            models, users, and versions — Promptly is for you.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {AUDIENCE.map((a, i) => (
            <div key={i} style={{ border: `1px solid ${line}`,
              borderRadius: 14, padding: 26, background: '#fff' }}>
              <div style={{ fontFamily: mono, fontSize: 10.5, color: violet,
                textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 16 }}>
                {a.r}
              </div>
              <h3 style={{ fontFamily: serif, fontSize: 25, fontWeight: 400,
                letterSpacing: '-0.015em', margin: '0 0 10px',
                lineHeight: 1.15, color: ink }}>
                {a.h}
              </h3>
              <p style={{ fontSize: 13.5, lineHeight: 1.6, color: muted, margin: 0 }}>
                {a.d}
              </p>
            </div>
          ))}
        </div>

        {/* ── Testimonials ── */}
        <div id="customers" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: 60, alignItems: 'end', marginBottom: 48, paddingTop: 96,
          marginTop: 40, borderTop: `1px solid ${line}` }}>
          <div>
            <div style={{ fontFamily: mono, fontSize: 11, color: '#888',
              textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 12 }}>
              What people say
            </div>
            <h2 style={{ fontFamily: serif, fontWeight: 400,
              fontSize: 'clamp(38px, 5vw, 66px)',
              letterSpacing: '-0.025em', lineHeight: 1.0, margin: 0, color: ink }}>
              Stronger prompts<br />
              in <em style={{ fontStyle: 'italic', color: violet }}>hours</em>,
              not sprints.
            </h2>
          </div>
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: muted, maxWidth: 360, margin: 0 }}>
            Early users say the biggest surprise isn&apos;t the quality —
            it&apos;s how fast the rewrite happens.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.8fr', gap: 16 }}>
          {TESTIMONIALS.map((t, i) => (
            <div key={i} style={{ border: `1px solid ${t.featured ? 'transparent' : line}`,
              borderRadius: 14, padding: 26,
              background: t.featured ? ink : '#fff',
              color: t.featured ? '#ededed' : ink,
              display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontFamily: serif, fontSize: 21, lineHeight: 1.35,
                letterSpacing: '-0.01em', flex: 1 }}>
                {t.quote}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12,
                marginTop: 24, paddingTop: 20,
                borderTop: `1px solid ${t.featured ? '#1f1f23' : line}` }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%',
                  background: t.grad, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 13, fontWeight: 600,
                  color: '#fff', flexShrink: 0 }}>
                  {t.initials}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: t.featured ? '#8a8a90' : '#777',
                    marginTop: 1 }}>
                    {t.role}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Integrations ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: 60, alignItems: 'end', marginBottom: 48, paddingTop: 96,
          marginTop: 40, borderTop: `1px solid ${line}` }}>
          <div>
            <div style={{ fontFamily: mono, fontSize: 11, color: '#888',
              textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 12 }}>
              Works with
            </div>
            <h2 style={{ fontFamily: serif, fontWeight: 400,
              fontSize: 'clamp(38px, 5vw, 66px)',
              letterSpacing: '-0.025em', lineHeight: 1.0, margin: 0, color: ink }}>
              Every model,<br />
              every stack.
            </h2>
          </div>
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: muted, maxWidth: 360, margin: 0 }}>
            Use Promptly with any provider. Optimized prompts are plain text —
            no lock-in, no SDK required at runtime.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)',
          gap: 1, background: line, border: `1px solid ${line}`,
          borderRadius: 14, overflow: 'hidden' }}>
          {INTEGRATIONS.map((item, i) => (
            <div key={i} style={{ background: '#fff', padding: '28px 18px',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 10, fontSize: 12.5,
              color: muted, textAlign: 'center' }}>
              <div style={{ width: 28, height: 28, borderRadius: 7,
                background: 'linear-gradient(135deg, #1a1a1a, #444)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontFamily: mono, fontSize: 11, fontWeight: 600 }}>
                {item.g}
              </div>
              <span>{item.n}</span>
            </div>
          ))}
        </div>

        {/* ── Pricing ── */}
        <div id="pricing" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: 60, alignItems: 'end', marginBottom: 48, paddingTop: 96,
          marginTop: 40, borderTop: `1px solid ${line}` }}>
          <div>
            <div style={{ fontFamily: mono, fontSize: 11, color: '#888',
              textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 12 }}>
              Pricing
            </div>
            <h2 style={{ fontFamily: serif, fontWeight: 400,
              fontSize: 'clamp(38px, 5vw, 66px)',
              letterSpacing: '-0.025em', lineHeight: 1.0, margin: 0, color: ink }}>
              Pay for what<br />
              you <em style={{ fontStyle: 'italic', color: violet }}>actually</em> run.
            </h2>
          </div>
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: muted, maxWidth: 360, margin: 0 }}>
            Credits, not seats. One optimize run is 10 credits.
            One health score is 5. Unused credits roll over for 90 days.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {PRICING.map((p, i) => (
            <div key={i} style={{ border: `1px solid ${p.featured ? 'transparent' : line}`,
              borderRadius: 16, padding: 28, background: p.featured ? ink : '#fff',
              color: p.featured ? '#ededed' : ink,
              display: 'flex', flexDirection: 'column', position: 'relative',
              overflow: 'hidden' }}>
              {p.featured && (
                <div style={{ position: 'absolute', top: 20, right: 20,
                  fontFamily: mono, fontSize: 10, letterSpacing: '0.12em',
                  textTransform: 'uppercase', color: violet,
                  background: 'rgba(124,92,255,0.14)',
                  padding: '4px 8px', borderRadius: 999 }}>
                  Most popular
                </div>
              )}
              <div style={{ fontFamily: mono, fontSize: 11, textTransform: 'uppercase',
                letterSpacing: '0.14em', color: p.featured ? '#8a8a90' : '#888',
                marginBottom: 12 }}>
                {p.plan}
              </div>
              <div style={{ fontFamily: serif, fontSize: 54,
                letterSpacing: '-0.03em', lineHeight: 1 }}>
                {p.price}
                <span style={{ fontFamily: sans, fontSize: 15,
                  color: p.featured ? '#8a8a90' : '#999', marginLeft: 4 }}>
                  {p.per}
                </span>
              </div>
              <div style={{ fontSize: 13.5, color: p.featured ? '#b5b5ba' : muted,
                lineHeight: 1.55, margin: '14px 0 22px' }}>
                {p.desc}
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px',
                display: 'flex', flexDirection: 'column', gap: 10 }}>
                {p.features.map((f, j) => (
                  <li key={j} style={{ display: 'flex', gap: 10,
                    alignItems: 'flex-start', fontSize: 13.5, lineHeight: 1.4,
                    color: p.featured ? '#b5b5ba' : '#333' }}>
                    <span style={{ color: violet, flexShrink: 0, marginTop: 2 }}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link href={p.href}
                style={{ marginTop: 'auto', height: 44, borderRadius: 8,
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', padding: '0 16px',
                  background: p.featured ? violet : 'transparent',
                  border: `1px solid ${p.featured ? violet : line}`,
                  color: p.featured ? '#fff' : ink, fontSize: 14,
                  fontWeight: p.featured ? 500 : 400, textDecoration: 'none' }}>
                {p.cta}
                <span>→</span>
              </Link>
            </div>
          ))}
        </div>

        {/* ── FAQ ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: 60, alignItems: 'end', marginBottom: 48, paddingTop: 96,
          marginTop: 40, borderTop: `1px solid ${line}` }}>
          <div>
            <div style={{ fontFamily: mono, fontSize: 11, color: '#888',
              textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 12 }}>
              FAQ
            </div>
            <h2 style={{ fontFamily: serif, fontWeight: 400,
              fontSize: 'clamp(38px, 5vw, 66px)',
              letterSpacing: '-0.025em', lineHeight: 1.0, margin: 0, color: ink }}>
              Questions,<br />answered.
            </h2>
          </div>
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: muted, maxWidth: 360, margin: 0 }}>
            Something we didn&apos;t cover?{' '}
            <a href="#contact" style={{ color: violet, fontWeight: 500,
              textDecoration: 'none' }}>
              Ask in chat
            </a>{' '}
            — we answer within an hour on weekdays.
          </p>
        </div>
        <div style={{ borderTop: `1px solid ${line}` }}>
          {FAQS.map((f, i) => (
            <div key={i} style={{ borderBottom: `1px solid ${line}`, padding: '22px 4px' }}>
              <button onClick={() => setOpenFaq(openFaq === i ? -1 : i)}
                style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%',
                  background: 'none', border: 'none', cursor: 'pointer',
                  textAlign: 'left', padding: 0 }}>
                <span style={{ fontFamily: mono, fontSize: 11, color: violet,
                  letterSpacing: '0.14em', minWidth: 40 }}>0{i + 1}</span>
                <span style={{ fontFamily: serif, fontSize: 21,
                  letterSpacing: '-0.015em', flex: 1, color: ink }}>
                  {f.q}
                </span>
                <span style={{ width: 28, height: 28, borderRadius: '50%',
                  border: `1px solid ${openFaq === i ? ink : line}`,
                  background: openFaq === i ? ink : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: openFaq === i ? '#fff' : muted, fontSize: 16, flexShrink: 0 }}>
                  {openFaq === i ? '−' : '+'}
                </span>
              </button>
              {openFaq === i && (
                <div style={{ padding: '16px 60px 4px', fontSize: 14,
                  lineHeight: 1.7, color: muted, maxWidth: 780 }}>
                  {f.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Final CTA band ── */}
      <div style={{ background: ink2, marginTop: 100, padding: '96px 0' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 40px', textAlign: 'center' }}>
          <div style={{ fontFamily: mono, fontSize: 11, color: violet,
            textTransform: 'uppercase', letterSpacing: '0.14em',
            marginBottom: 20, display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%',
              background: violet, display: 'inline-block',
              boxShadow: `0 0 8px ${violet}` }} />
            Ready when you are
          </div>
          <h2 style={{ fontFamily: serif, fontWeight: 400,
            fontSize: 'clamp(38px, 5vw, 68px)',
            letterSpacing: '-0.03em', lineHeight: 1.05,
            margin: '0 0 20px', color: '#ededed' }}>
            Let the society<br />
            <em style={{ color: violet, fontStyle: 'italic' }}>sharpen</em> your prompt.
          </h2>
          <p style={{ color: '#8a8a90', fontSize: 16, lineHeight: 1.65,
            margin: '0 0 36px', maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
            100 credits free. No card required. Your first council run
            takes under a minute — start with any prompt you already have.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center',
            flexWrap: 'wrap' }}>
            <Link href="/register"
              style={{ height: 48, padding: '0 28px', borderRadius: 8,
                background: violet, color: '#fff', textDecoration: 'none',
                fontWeight: 500, fontSize: 15, display: 'inline-flex',
                alignItems: 'center', gap: 8,
                boxShadow: `0 4px 28px ${violet}55` }}>
              ⚡ Try Promptly free
            </Link>
            <a href="#contact"
              style={{ height: 48, padding: '0 24px', borderRadius: 8,
                border: '1px solid #2a2a32', color: '#b5b5ba',
                textDecoration: 'none', fontSize: 15, display: 'inline-flex',
                alignItems: 'center', gap: 8 }}>
              Talk to us →
            </a>
          </div>
        </div>
      </div>

      {/* ── Contact ── */}
      <div id="contact" style={{ background: ink, color: '#ededed',
        padding: '80px 0' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 40px',
          display: 'grid', gridTemplateColumns: '1.1fr 0.9fr',
          gap: 60, alignItems: 'start' }}>
          <div>
            <div style={{ fontFamily: mono, fontSize: 11, color: violet,
              textTransform: 'uppercase', letterSpacing: '0.14em',
              marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%',
                background: violet, display: 'inline-block' }} />
              Get in touch
            </div>
            <h2 style={{ fontFamily: serif, fontWeight: 400,
              fontSize: 'clamp(36px, 4.5vw, 58px)',
              letterSpacing: '-0.025em', lineHeight: 1.05,
              margin: '0 0 16px', color: '#ededed' }}>
              Talk to a human.<br />
              We&apos;re <em style={{ color: violet, fontStyle: 'italic' }}>actually</em> here.
            </h2>
            <p style={{ color: '#b5b5ba', fontSize: 15, lineHeight: 1.65,
              margin: '0 0 32px', maxWidth: 480 }}>
              Sales questions, enterprise trials, partnership pitches, or
              &quot;I tried it and something broke&quot; — pick whichever&apos;s
              fastest and we&apos;ll reply.
            </p>
            <div>
              {[
                { k: 'Email',   v: 'hey@promptly.dev',      m: 'replies within 4 hours' },
                { k: 'Sales',   v: 'sales@promptly.dev',    m: 'for teams of 10+' },
                { k: 'Support', v: 'In-app chat',            m: '8a–8p IST, Mon–Fri' },
                { k: 'Office',  v: 'Bengaluru, IN',          m: '+ distributed across 7 timezones' },
                { k: 'Security',v: 'security@promptly.dev', m: 'PGP key on request' },
              ].map(row => (
                <div key={row.k} style={{ display: 'grid',
                  gridTemplateColumns: '120px 1fr',
                  padding: '16px 0', borderTop: '1px solid #1f1f23',
                  alignItems: 'center', gap: 16 }}>
                  <span style={{ fontFamily: mono, fontSize: 11, color: '#5a5a60',
                    textTransform: 'uppercase', letterSpacing: '0.14em' }}>
                    {row.k}
                  </span>
                  <span style={{ fontSize: 15, color: '#ededed' }}>
                    {row.v}
                    <span style={{ color: '#8a8a90', marginLeft: 8, fontSize: 13 }}>
                      · {row.m}
                    </span>
                  </span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid #1f1f23' }} />
            </div>
          </div>

          {/* Contact form */}
          <div style={{ background: '#1a1a1a', border: '1px solid #1f1f23',
            borderRadius: 14, padding: 24 }}>
            <div style={{ fontFamily: mono, fontSize: 11, color: '#8a8a90',
              textTransform: 'uppercase', letterSpacing: '0.14em',
              marginBottom: 20 }}>
              Send a note
            </div>
            {[
              { label: 'Your name',   type: 'text',  placeholder: 'Ravi Prakash' },
              { label: 'Work email',  type: 'email', placeholder: 'ravi@acme.com' },
            ].map(field => (
              <div key={field.label} style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontFamily: mono, fontSize: 10.5,
                  color: '#8a8a90', textTransform: 'uppercase',
                  letterSpacing: '0.12em', marginBottom: 8 }}>
                  {field.label}
                </label>
                <input type={field.type} placeholder={field.placeholder}
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 8,
                    background: ink, border: '1px solid #2a2a2e', color: '#ededed',
                    fontFamily: sans, fontSize: 14, boxSizing: 'border-box' as const }} />
              </div>
            ))}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontFamily: mono, fontSize: 10.5,
                color: '#8a8a90', textTransform: 'uppercase',
                letterSpacing: '0.12em', marginBottom: 8 }}>
                What&apos;s this about?
              </label>
              <select style={{ width: '100%', padding: '12px 14px', borderRadius: 8,
                background: ink, border: '1px solid #2a2a2e', color: '#ededed',
                fontFamily: sans, fontSize: 14, boxSizing: 'border-box' as const }}>
                <option value="demo">Book a demo</option>
                <option value="enterprise">Enterprise pricing</option>
                <option value="support">Something&apos;s broken</option>
                <option value="partner">Partnership</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontFamily: mono, fontSize: 10.5,
                color: '#8a8a90', textTransform: 'uppercase',
                letterSpacing: '0.12em', marginBottom: 8 }}>
                Message
              </label>
              <textarea rows={4} placeholder="Tell us what you're building…"
                style={{ width: '100%', padding: '12px 14px', borderRadius: 8,
                  background: ink, border: '1px solid #2a2a2e', color: '#ededed',
                  fontFamily: mono, fontSize: 13, lineHeight: 1.5,
                  resize: 'vertical', boxSizing: 'border-box' as const }} />
            </div>
            <button style={{ width: '100%', height: 44, borderRadius: 8,
              background: violet, border: 'none', color: '#fff', fontSize: 14,
              fontWeight: 500, cursor: 'pointer', display: 'flex',
              alignItems: 'center', justifyContent: 'center', gap: 8,
              fontFamily: sans }}>
              Send message →
            </button>
            <div style={{ fontFamily: mono, fontSize: 10.5, color: '#5a5a60',
              marginTop: 12, textAlign: 'center', letterSpacing: '0.1em' }}>
              we never share your address · ever
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{ background: '#fff', padding: '64px 0 32px',
        borderTop: `1px solid ${line}` }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 40px',
          display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr 1fr', gap: 40 }}>
          <div>
            <LogoMark />
            <p style={{ fontSize: 13.5, color: '#666', lineHeight: 1.6,
              maxWidth: 320, margin: '14px 0 24px' }}>
              Promptly applies Society of Mind architecture to prompt
              engineering — four specialist agents propose, peer-review,
              and synthesize a result none of them could produce alone.
            </p>
            <Link href="/register"
              style={{ height: 36, padding: '0 16px', borderRadius: 8,
                background: violet, color: '#fff', textDecoration: 'none',
                fontSize: 13, fontWeight: 500, display: 'inline-flex',
                alignItems: 'center', gap: 6 }}>
              ⚡ Try Promptly free
            </Link>
          </div>
          {[
            { h: 'Product',   links: ['Optimize', 'Analyze', 'Versions', 'API', 'Changelog'] },
            { h: 'Company',   links: ['About', 'Customers', 'Careers · 4 open', 'Press kit', 'Contact'] },
            { h: 'Resources', links: ['Docs', 'Prompt library', 'Benchmarks', 'Blog', 'Community'] },
            { h: 'Legal',     links: ['Privacy', 'Terms', 'Security', 'DPA', 'Status · all systems'] },
          ].map(col => (
            <div key={col.h}>
              <h4 style={{ fontFamily: mono, fontSize: 11, color: '#888',
                textTransform: 'uppercase', letterSpacing: '0.14em',
                margin: '0 0 16px' }}>
                {col.h}
              </h4>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0,
                display: 'flex', flexDirection: 'column', gap: 10 }}>
                {col.links.map(l => {
                  if (l === 'Careers · 4 open') return (
                    <li key={l} style={{ fontSize: 13.5, color: '#444', cursor: 'pointer' }}>
                      Careers · <span style={{ color: violet }}>4 open</span>
                    </li>
                  );
                  if (l === 'Status · all systems') return (
                    <li key={l} style={{ fontSize: 13.5, color: '#444', cursor: 'pointer' }}>
                      Status · <span style={{ color: '#2fd589' }}>✓ all systems</span>
                    </li>
                  );
                  return (
                    <li key={l} style={{ fontSize: 13.5, color: '#444', cursor: 'pointer' }}>
                      {l}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <div style={{ maxWidth: 1240, margin: '48px auto 0', padding: '20px 40px 0',
          borderTop: `1px solid ${line}`, display: 'flex', alignItems: 'center',
          gap: 24, fontFamily: mono, fontSize: 11.5, color: '#888',
          letterSpacing: '0.08em' }}>
          <span>© 2026 Promptly Inc.</span>
          <span>· SOC 2 Type II</span>
          <span>· GDPR</span>
          <span>· Made in Bengaluru</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
            {['𝕏', 'in', 'gh', 'yt'].map(s => (
              <span key={s} style={{ width: 30, height: 30,
                border: `1px solid ${line}`, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: muted, cursor: 'pointer', fontSize: 11 }}>
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

// ─── Components ───────────────────────────────────────────────────────────────

function LogoMark() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9,
      fontSize: 14, fontWeight: 600, color: ink }}>
      <div style={{ width: 22, height: 22, borderRadius: 6, background: violet,
        position: 'relative', display: 'inline-flex', alignItems: 'center',
        justifyContent: 'center', flexShrink: 0,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3), 0 1px 0 rgba(0,0,0,0.15)' }}>
        <div style={{ position: 'absolute', inset: 5, border: '1.5px solid #fff',
          borderRight: '1.5px solid transparent',
          borderBottom: '1.5px solid transparent',
          borderRadius: 2, transform: 'rotate(45deg)' }} />
      </div>
      promptly
    </div>
  );
}
