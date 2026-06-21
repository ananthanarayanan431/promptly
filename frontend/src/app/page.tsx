'use client';

import { useState } from 'react';
import Link from 'next/link';

// ─── Data ────────────────────────────────────────────────────────────────────

const MARQUEE = ['Notion', 'Linear', 'Vercel', 'Anthropic', 'Mistral', 'Hugging Face',
                 'Ramp', 'Retool', 'Supabase', 'Cursor', 'Arc', 'Raycast'];

const STATS = [
  { n: '3.8×',  em: true, l: 'average quality uplift vs. original prompt' },
  { n: '35×',            l: 'fewer rollouts than RL with GEPA (ICLR 2026)' },
  { n: '+23.5',          l: 'accuracy points gained by SkillOpt on GPT-5.5' },
  { n: '94%',            l: 'of users ship the result unchanged' },
];

const PRODUCTS = [
  {
    tag: 'Optimize',
    headline: 'Turn any rough prompt into a production-ready one.',
    body: 'Paste what you have. Promptly runs a multi-model review — parallel proposals, blind peer critique, synthesis — and returns one result that\'s sharper than any single model could produce. Takes under a minute.',
    pills: ['Any prompt', 'Any domain', 'One result'],
    terminal: [
      { c: '#5a5a60', t: '# your prompt' },
      { c: '#b5b5ba', t: 'write a blog post about remote work' },
      { c: '#7c5cff', t: '→ running multi-model review…', mt: 12 },
      { c: '#5a5a60', t: '# result', mt: 12 },
      { c: '#ededed', t: 'You are Maya, a distributed-work researcher…' },
      { c: '#b5b5ba', t: 'Write 800 words (±5%). Open on a scene.' },
      { c: '#b5b5ba', t: 'Weave in 3 cited stats. No "in conclusion."' },
      { c: '#2fd589', t: '✓ done · 38s · quality +2.4 pts', mt: 10 },
    ],
    href: '/sign-up',
    cta: 'Start optimizing',
    accent: '#7c5cff',
  },
  {
    tag: 'Domain',
    headline: 'Empirically find the best prompt for your specific use case.',
    body: 'Upload your domain knowledge as a PDF. Promptly builds a Q&A test suite from it, then runs head-to-head trials between prompt variants — returning the one that empirically wins against your real questions. Not guesswork. Evidence.',
    pills: ['Your knowledge base', 'Head-to-head trials', 'Empirical winner'],
    terminal: [
      { c: '#5a5a60', t: '# knowledge base' },
      { c: '#b5b5ba', t: 'finance-policy-v2.pdf  →  127 Q&A pairs' },
      { c: '#f59e0b', t: '→ tournament running… round 18/40', mt: 12 },
      { c: '#5a5a60', t: 'C0  wins: 6   C1  wins: 4' },
      { c: '#5a5a60', t: 'C2  wins: 3   C3  wins: 5' },
      { c: '#5a5a60', t: '# result', mt: 10 },
      { c: '#ededed', t: 'winner: C0  win-rate: 78%' },
      { c: '#2fd589', t: '✓ empirically tested · 40 rounds · 127 pairs', mt: 6 },
    ],
    href: '/sign-up',
    cta: 'Try domain optimization',
    accent: '#f59e0b',
  },
];

const HOW_IT_WORKS = [
  {
    n: '01',
    t: 'Paste what you have.',
    d: 'Start with any existing prompt — a one-liner, a full system prompt, something you\'ve been tweaking for weeks. No templates, no forms.',
  },
  {
    n: '02',
    t: 'Promptly reviews and rewrites.',
    d: 'A panel of specialized models analyzes your prompt in parallel, critiques each other\'s proposals, and synthesizes a single best result. You see nothing of the process — just the output.',
  },
  {
    n: '03',
    t: 'Get a result you can ship.',
    d: 'One optimized prompt. Copy it, save it with a version tag, or run it through Health Score to see exactly what improved and by how much.',
  },
];

const DOMAIN_HOW = [
  {
    n: '01',
    t: 'Upload your knowledge.',
    d: 'Drop a PDF — a product doc, policy manual, support runbook, financial report. Promptly extracts a Q&A test suite from it automatically.',
  },
  {
    n: '02',
    t: 'The tournament runs.',
    d: 'Your prompt and several generated variants compete head-to-head against real questions from your document. An LLM judge scores each match. 40 rounds, live win matrix you can watch.',
  },
  {
    n: '03',
    t: 'You get the empirical winner.',
    d: 'The variant with the highest win rate against your actual domain knowledge is returned. Not the one that sounds best — the one that performs best.',
  },
];

const AUDIENCE = [
  {
    r: 'for product teams',
    h: 'Stop losing a week to prompt tuning.',
    d: 'Paste the prompt from your PRD. Ship the optimized one to staging by lunch. Role, format, constraints, and edge cases are handled automatically.',
  },
  {
    r: 'for engineers',
    h: 'Treat prompts like code.',
    d: 'Stable IDs, versioned history, diff view, rollback. Wire the API into your CI so every merge runs the health score check automatically.',
  },
  {
    r: 'for domain experts',
    h: 'Your knowledge. Your benchmark.',
    d: 'Upload a PDF of your domain. Promptly builds a test suite from it and finds the prompt that scores best against your real questions — not a generic benchmark.',
  },
  {
    r: 'for agent builders',
    h: 'Ship skills, not fine-tunes.',
    d: 'SkillOpt trains a reusable skill file for your frozen agent. Validated edits, deployable artifact, zero inference-time overhead. +23 points on GPT-5.5 with no model changes.',
  },
];

const TESTIMONIALS = [
  {
    quote: '"We had a 600-word prompt that worked on Claude but fell apart on GPT. Promptly rewrote it in forty seconds. It works on both now, and our eval scores went up eleven points."',
    name: 'Kiran Menon', role: 'Staff Eng · Fintech unicorn', initials: 'KM',
    grad: 'linear-gradient(135deg, #7c5cff, #3a1eff)', featured: true,
  },
  {
    quote: '"The health score told us tone was the problem — we\'d been blaming the model for six weeks."',
    name: 'Aditi Sharma', role: 'Head of AI · Retail SaaS', initials: 'AS',
    grad: 'linear-gradient(135deg, #5cffb1, #2fd589)',
  },
  {
    quote: '"Domain optimization found a variant that beat our hand-tuned prompt by 23 points on our own test set. We never would have written it ourselves."',
    name: 'Jamie Liu', role: 'Founding Engineer · Seed-stage', initials: 'JL',
    grad: 'linear-gradient(135deg, #f59e0b, #d68a2b)',
  },
];

const PRICING = [
  {
    plan: 'Free', price: '$0', per: '/ forever',
    desc: 'Kick the tires. Good for side projects and one-off runs.',
    features: ['3M tokens on signup', 'Council Optimize · Health Score · Advisory', '3 saved prompt families', 'Community support'],
    cta: 'Start free', href: '/sign-up', featured: false,
  },
  {
    plan: 'Pro', price: '$29', per: '/ month',
    desc: 'For people shipping LLM features at work. Most teams start here.',
    features: ['30M tokens / month', 'All engines: PDO · GEPA · SkillOpt · Bridge', 'Unlimited prompt families · API access', 'Version history · Prompt Library', 'Priority email support'],
    cta: 'Go Pro', href: '/sign-up', featured: true,
  },
  {
    plan: 'Team', price: '$99', per: '/ month',
    desc: 'Shared workspaces, roles, and billing. Built for crews of 3–20.',
    features: ['150M tokens pooled', 'Up to 10 seats', 'Shared domain knowledge bases', 'SSO + audit log', 'Dedicated Slack channel'],
    cta: 'Start team trial', href: '/sign-up', featured: false,
  },
];

const FAQS = [
  { q: 'What\'s the difference between Optimize, PDO, and GEPA?', a: 'Optimize is the fastest path — a 4-model council rewrites any prompt in under a minute, no examples needed. PDO (Prompt Duel Optimizer) needs your domain Q&A and runs a 30-round duel tournament; it\'s label-free and ideal when you have examples but no scores. GEPA goes deepest — 678 rollouts of reflective evolution that outperforms RL (GRPO) by 10%+ and uses 35× fewer rollouts. Use Optimize for speed, PDO for empirical validation, GEPA for maximum quality.' },
  { q: 'What is SkillOpt and how is it different?', a: 'SkillOpt (arXiv 2605.23904, Microsoft) trains a reusable "skill file" — a natural-language system prompt — for a frozen LLM agent. Unlike Optimize which rewrites a one-off prompt, SkillOpt evolves a structured skill document through validated ADD/REPLACE/DELETE edits, producing a deployable artifact that works at zero inference-time overhead. It lifted average accuracy by +23.5 pts on GPT-5.5 across six benchmarks.' },
  { q: 'What is PromptBridge for?', a: 'PromptBridge adapts prompts across models. If you have prompts fine-tuned for GPT-4 and need them on Claude or Mistral, Bridge learns the structural transfer mapping from calibrated example pairs, then applies it to any new prompt instantly. Reuse the mapping across transfers to save tokens.' },
  { q: 'Does Promptly store my prompts?', a: 'Only the ones you explicitly save to a family. Ad-hoc runs are kept for 7 days for debugging then deleted. Your domain PDFs and Q&A datasets are stored securely and only used to run your optimization — never shared or used for training.' },
  { q: 'What models does Promptly use?', a: 'A curated mix drawn from frontier providers, benchmarked weekly. We swap in whatever performs best on our eval set. You get the benefit of model diversity without managing multiple API keys. Council model identities are not exposed to users.' },
  { q: 'Can I use the optimized prompts anywhere?', a: 'Yes. Every result is plain text — copy it into any SDK, API, or product. No lock-in, no runtime dependency on Promptly.' },
  { q: 'Is there a refund policy?', a: "If the optimized prompt doesn't beat your original on our health score, we refund the tokens automatically. No ticket required." },
];


// ─── Style tokens ─────────────────────────────────────────────────────────────

const paper   = '#fafaf7';
const line    = '#e5e5e1';
const violet  = '#7c5cff';
const amber   = '#f59e0b';
const sky     = '#0ea5e9';
const rose    = '#f43f5e';
const emerald = '#10b981';
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
            { l: 'Optimize',  href: '#optimize' },
            { l: 'Domain',    href: '#domain' },
            { l: 'SkillOpt',  href: '#skillopt' },
            { l: 'Pricing',   href: '#pricing' },
            { l: 'Docs',      href: '/docs' },
          ].map(({ l, href }) => (
            <a key={l} href={href} style={{ color: '#555', textDecoration: 'none' }}>{l}</a>
          ))}
          <Link href="/sign-in"
            style={{ height: 32, padding: '0 14px', borderRadius: 6,
              border: `1px solid ${line}`, display: 'inline-flex', alignItems: 'center',
              fontSize: 13, color: ink, textDecoration: 'none' }}>
            Sign in
          </Link>
          <Link href="/sign-up"
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
            <div style={{ fontFamily: mono, fontSize: 11.5, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: '#888', marginBottom: 28,
              display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: violet,
                display: 'inline-block', boxShadow: `0 0 8px ${violet}` }} />
              Now in public beta · 3M tokens free
            </div>

            <h1 style={{ fontFamily: serif, fontWeight: 400,
              fontSize: 'clamp(48px, 6.5vw, 88px)',
              letterSpacing: '-0.03em', lineHeight: 1.04, margin: '0 0 28px', color: ink }}>
              Better prompts.<br />
              <em style={{ fontStyle: 'italic', color: violet }}>Proven</em> against<br />
              your real data.
            </h1>

            <p style={{ fontSize: 17, lineHeight: 1.55, color: '#444',
              maxWidth: 480, margin: '0 0 36px' }}>
              Five research-backed engines: council optimization, PDO tournament, GEPA
              reflective evolution, SkillOpt agent skill training, and cross-model
              PromptBridge — all in one platform.
            </p>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
              <Link href="/sign-up"
                style={{ height: 46, padding: '0 22px', borderRadius: 8, background: violet,
                  color: '#fff', textDecoration: 'none', fontWeight: 500, fontSize: 14,
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  boxShadow: `0 4px 24px ${violet}44` }}>
                ⚡ Try it free
              </Link>
              <a href="#optimize"
                style={{ height: 46, padding: '0 22px', borderRadius: 8,
                  border: `1px solid ${line}`, color: ink, textDecoration: 'none',
                  fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                See how it works →
              </a>
            </div>
            <div style={{ fontFamily: mono, fontSize: 11.5, color: '#999' }}>
              3M tokens free · no card · cancel with a button, not an email
            </div>
          </div>

          {/* Hero: two-product terminal */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Optimize terminal */}
            <div style={{ background: ink2, color: '#ededed', borderRadius: 14,
              overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.18)' }}>
              <div style={{ padding: '10px 16px', borderBottom: '1px solid #1f1f23',
                display: 'flex', gap: 7, alignItems: 'center' }}>
                {['#ff5f57','#febc2e','#28c840'].map(c => (
                  <span key={c} style={{ width: 9, height: 9, borderRadius: '50%',
                    background: c, display: 'inline-block' }} />
                ))}
                <span style={{ fontFamily: mono, fontSize: 10.5, color: '#5a5a60', marginLeft: 8 }}>
                  optimize
                </span>
                <span style={{ marginLeft: 'auto', fontFamily: mono, fontSize: 10,
                  background: `${violet}22`, color: violet,
                  padding: '2px 8px', borderRadius: 999 }}>−10 cr</span>
              </div>
              <div style={{ padding: '16px 18px', fontFamily: mono, fontSize: 11.5, lineHeight: 1.65 }}>
                <div style={{ color: '#5a5a60' }}># your prompt</div>
                <div style={{ color: '#b5b5ba', marginBottom: 12 }}>write a blog post about remote work</div>
                <div style={{ color: violet, marginBottom: 12 }}>→ multi-model review running…</div>
                <div style={{ color: '#5a5a60' }}># result</div>
                <div style={{ color: '#ededed' }}>You are Maya, a distributed-work researcher…</div>
                <div style={{ color: '#b5b5ba' }}>Write 800 words (±5%). Open on a scene.</div>
                <div style={{ color: '#2fd589', marginTop: 8 }}>✓ done · 38s</div>
              </div>
            </div>

            {/* Domain terminal */}
            <div style={{ background: '#1a1400', color: '#ededed', borderRadius: 14,
              overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.18)',
              border: `1px solid ${amber}22` }}>
              <div style={{ padding: '10px 16px', borderBottom: `1px solid ${amber}18`,
                display: 'flex', gap: 7, alignItems: 'center' }}>
                {['#ff5f57','#febc2e','#28c840'].map(c => (
                  <span key={c} style={{ width: 9, height: 9, borderRadius: '50%',
                    background: c, display: 'inline-block' }} />
                ))}
                <span style={{ fontFamily: mono, fontSize: 10.5, color: `${amber}99`, marginLeft: 8 }}>
                  domain · empirical tournament
                </span>
                <span style={{ marginLeft: 'auto', fontFamily: mono, fontSize: 10,
                  background: `${amber}22`, color: amber,
                  padding: '2px 8px', borderRadius: 999 }}>−10 cr</span>
              </div>
              <div style={{ padding: '16px 18px', fontFamily: mono, fontSize: 11.5, lineHeight: 1.65 }}>
                <div style={{ color: `${amber}88` }}># knowledge base</div>
                <div style={{ color: `${amber}cc`, marginBottom: 10 }}>finance-policy.pdf → 127 Q&A pairs</div>
                <div style={{ color: amber, marginBottom: 8 }}>→ tournament · round 32/40</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 10 }}>
                  {[['C0','wins: 14'],['C1','wins: 9'],['C2','wins: 7'],['C3','wins: 10']].map(([n,w]) => (
                    <div key={n} style={{ fontFamily: mono, fontSize: 10.5, color: `${amber}88` }}>
                      <span style={{ color: amber, fontWeight: 700 }}>{n}</span>  {w}
                    </div>
                  ))}
                </div>
                <div style={{ color: '#2fd589' }}>✓ winner: C0 · win-rate: 78%</div>
              </div>
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

        {/* ══ OPTIMIZE ══ */}
        <div id="optimize" style={{ paddingTop: 96, marginTop: 40, borderTop: `1px solid ${line}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr',
            gap: 60, alignItems: 'end', marginBottom: 56 }}>
            <div>
              <div style={{ fontFamily: mono, fontSize: 11, color: '#888',
                textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 12 }}>
                Optimize · general
              </div>
              <h2 style={{ fontFamily: serif, fontWeight: 400,
                fontSize: 'clamp(38px, 5vw, 60px)',
                letterSpacing: '-0.025em', lineHeight: 1.05, margin: 0, color: ink }}>
                Any prompt.<br />
                <em style={{ fontStyle: 'italic', color: violet }}>Rewritten</em> in under a minute.
              </h2>
            </div>
            <p style={{ fontSize: 15.5, lineHeight: 1.65, color: muted, maxWidth: 380, margin: 0 }}>
              Paste the prompt you have. Promptly runs a multi-model review — parallel
              proposals, blind critique, synthesis — and returns a single result that&apos;s
              sharper than any individual model could produce. Works on any prompt, any domain.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
            border: `1px solid ${line}`, borderRadius: 14, overflow: 'hidden' }}>
            {HOW_IT_WORKS.map((s, i) => (
              <div key={i} style={{ padding: '28px 26px 32px',
                borderRight: i < 2 ? `1px solid ${line}` : 'none', background: '#fff' }}>
                <div style={{ fontFamily: mono, fontSize: 11, color: violet,
                  letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                  {s.n}
                </div>
                <div style={{ fontFamily: serif, fontSize: 25,
                  letterSpacing: '-0.02em', lineHeight: 1.15,
                  margin: '16px 0 10px', color: ink }}>
                  {s.t}
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.65, color: muted }}>
                  {s.d}
                </div>
              </div>
            ))}
          </div>

          {/* What it improves */}
          <div style={{ marginTop: 16, display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {[
              { label: 'Role & persona',    desc: 'Adds a clear expert identity so the model knows exactly what mode to operate in.' },
              { label: 'Task precision',    desc: 'Replaces vague instructions with specific, executable ones the model can follow.' },
              { label: 'Output format',     desc: 'Adds structure, length targets, and format requirements when the original left them undefined.' },
              { label: 'Constraints',       desc: 'Guardrails for the most likely failure modes — wrong format, off-topic responses, missing context.' },
            ].map((item, i) => (
              <div key={i} style={{ border: `1px solid ${line}`, borderRadius: 12,
                padding: '20px 20px' }}>
                <div style={{ fontFamily: mono, fontSize: 10.5, fontWeight: 600,
                  color: violet, textTransform: 'uppercase', letterSpacing: '0.1em',
                  marginBottom: 8 }}>
                  {item.label}
                </div>
                <div style={{ fontSize: 12.5, color: muted, lineHeight: 1.55 }}>
                  {item.desc}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
            <Link href="/sign-up"
              style={{ height: 44, padding: '0 20px', borderRadius: 8, background: violet,
                color: '#fff', textDecoration: 'none', fontWeight: 500, fontSize: 14,
                display: 'inline-flex', alignItems: 'center', gap: 8,
                boxShadow: `0 4px 20px ${violet}33` }}>
              ⚡ Optimize your first prompt
            </Link>
            <Link href="/docs#optimize"
              style={{ height: 44, padding: '0 20px', borderRadius: 8,
                border: `1px solid ${line}`, color: ink, textDecoration: 'none',
                fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              Read the docs →
            </Link>
          </div>
        </div>

        {/* ══ DOMAIN ══ */}
        <div id="domain" style={{ paddingTop: 96, marginTop: 40, borderTop: `1px solid ${line}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr',
            gap: 60, alignItems: 'end', marginBottom: 56 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ fontFamily: mono, fontSize: 11, color: '#888',
                  textTransform: 'uppercase', letterSpacing: '0.14em' }}>
                  Domain · empirical
                </div>
                <span style={{ fontFamily: mono, fontSize: 10, background: `${amber}15`,
                  color: amber, padding: '2px 8px', borderRadius: 999,
                  border: `1px solid ${amber}30` }}>
                  new
                </span>
              </div>
              <h2 style={{ fontFamily: serif, fontWeight: 400,
                fontSize: 'clamp(38px, 5vw, 60px)',
                letterSpacing: '-0.025em', lineHeight: 1.05, margin: 0, color: ink }}>
                Your knowledge base.<br />
                Your <em style={{ fontStyle: 'italic', color: amber }}>benchmark</em>.
              </h2>
            </div>
            <p style={{ fontSize: 15.5, lineHeight: 1.65, color: muted, maxWidth: 380, margin: 0 }}>
              Upload a PDF — a product doc, support runbook, policy manual, financial report.
              Promptly builds a Q&A test suite from it, then runs head-to-head trials between
              prompt variants against your real questions. You get the one that empirically wins.
              Not guesswork — evidence.
            </p>
          </div>

          {/* Domain how it works */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
            border: `1px solid ${amber}33`, borderRadius: 14, overflow: 'hidden',
            background: '#fffdf5' }}>
            {DOMAIN_HOW.map((s, i) => (
              <div key={i} style={{ padding: '28px 26px 32px',
                borderRight: i < 2 ? `1px solid ${amber}22` : 'none' }}>
                <div style={{ fontFamily: mono, fontSize: 11, color: amber,
                  letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                  {s.n}
                </div>
                <div style={{ fontFamily: serif, fontSize: 25,
                  letterSpacing: '-0.02em', lineHeight: 1.15,
                  margin: '16px 0 10px', color: ink }}>
                  {s.t}
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.65, color: muted }}>
                  {s.d}
                </div>
              </div>
            ))}
          </div>

          {/* Domain differentiators */}
          <div style={{ marginTop: 16, display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {[
              { label: 'Auto test suite',    desc: 'Q&A pairs extracted from your PDF become the benchmark — no manual labeling.' },
              { label: 'Live tournament',    desc: 'Watch the win matrix update in real time as variants go head-to-head.' },
              { label: 'Empirical winner',   desc: 'The prompt with the highest win rate against your questions is returned.' },
              { label: 'Full history',       desc: 'Every tournament run is saved — compare results across different prompt strategies.' },
            ].map((item, i) => (
              <div key={i} style={{ border: `1px solid ${amber}30`, borderRadius: 12,
                padding: '20px 20px', background: '#fffdf5' }}>
                <div style={{ fontFamily: mono, fontSize: 10.5, fontWeight: 600,
                  color: amber, textTransform: 'uppercase', letterSpacing: '0.1em',
                  marginBottom: 8 }}>
                  {item.label}
                </div>
                <div style={{ fontSize: 12.5, color: muted, lineHeight: 1.55 }}>
                  {item.desc}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
            <Link href="/sign-up"
              style={{ height: 44, padding: '0 20px', borderRadius: 8, background: amber,
                color: '#fff', textDecoration: 'none', fontWeight: 500, fontSize: 14,
                display: 'inline-flex', alignItems: 'center', gap: 8,
                boxShadow: `0 4px 20px ${amber}44` }}>
              Try domain optimization
            </Link>
            <Link href="/docs#domain"
              style={{ height: 44, padding: '0 20px', borderRadius: 8,
                border: `1px solid ${line}`, color: ink, textDecoration: 'none',
                fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              Read the docs →
            </Link>
          </div>
        </div>

        {/* ══ PDO ══ */}
        <div id="pdo" style={{ paddingTop: 96, marginTop: 40, borderTop: `1px solid ${line}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'end', marginBottom: 56 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ fontFamily: mono, fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
                  PDO · arXiv 2510.13907
                </div>
                <span style={{ fontFamily: mono, fontSize: 10, background: `${sky}15`, color: sky, padding: '2px 8px', borderRadius: 999, border: `1px solid ${sky}30` }}>label-free</span>
              </div>
              <h2 style={{ fontFamily: serif, fontWeight: 400, fontSize: 'clamp(38px, 5vw, 60px)', letterSpacing: '-0.025em', lineHeight: 1.05, margin: 0, color: ink }}>
                Ten prompts enter.<br />
                One <em style={{ fontStyle: 'italic', color: sky }}>wins</em>.
              </h2>
            </div>
            <p style={{ fontSize: 15.5, lineHeight: 1.65, color: muted, maxWidth: 380, margin: 0 }}>
              Prompt Duel Optimizer runs a head-to-head tournament across 30 rounds of Double Thompson Sampling.
              Prompts compete on your real Q&A examples, a dual LLM judge picks each winner, and top performers
              mutate into stronger variants. No labeled scores needed — just your data.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', border: `1px solid ${sky}33`, borderRadius: 14, overflow: 'hidden', background: '#f0f9ff' }}>
            {[
              { n: '01', t: 'Upload your examples.', d: 'Provide Q&A pairs from your domain. PDO uses them as the benchmark — no manual labeling or score functions required.' },
              { n: '02', t: 'The tournament runs.', d: '10 prompt candidates compete in 30 duel rounds. Double Thompson Sampling selects the most informative matchups. Weak prompts are pruned; top performers mutate.' },
              { n: '03', t: 'The Copeland winner.', d: 'The prompt that won the most head-to-head duels is returned. Consistently beats label-free baselines on BBH and MS-MARCO benchmarks.' },
            ].map((s, i) => (
              <div key={i} style={{ padding: '28px 26px 32px', borderRight: i < 2 ? `1px solid ${sky}22` : 'none' }}>
                <div style={{ fontFamily: mono, fontSize: 11, color: sky, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{s.n}</div>
                <div style={{ fontFamily: serif, fontSize: 25, letterSpacing: '-0.02em', lineHeight: 1.15, margin: '16px 0 10px', color: ink }}>{s.t}</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.65, color: muted }}>{s.d}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {[
              { label: 'No labels needed',   desc: 'Tournament comparison replaces absolute scoring — works even when you can\'t write a score function.' },
              { label: 'D-TS sampling',       desc: 'Double Thompson Sampling maximises informative duels under a fixed judge budget.' },
              { label: 'Guided mutation',     desc: 'Every 10 rounds, the top 3 Copeland leaders seed new candidates. Weak prompts are pruned.' },
              { label: 'Live win matrix',     desc: 'Watch duels and win rates update in real time as the tournament progresses.' },
            ].map((item, i) => (
              <div key={i} style={{ border: `1px solid ${sky}30`, borderRadius: 12, padding: '20px 20px', background: '#f0f9ff' }}>
                <div style={{ fontFamily: mono, fontSize: 10.5, fontWeight: 600, color: sky, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>{item.label}</div>
                <div style={{ fontSize: 12.5, color: muted, lineHeight: 1.55 }}>{item.desc}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
            <Link href="/sign-up" style={{ height: 44, padding: '0 20px', borderRadius: 8, background: sky, color: '#fff', textDecoration: 'none', fontWeight: 500, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: `0 4px 20px ${sky}44` }}>
              Run a PDO tournament
            </Link>
            <Link href="/docs#pdo" style={{ height: 44, padding: '0 20px', borderRadius: 8, border: `1px solid ${line}`, color: ink, textDecoration: 'none', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              Read the docs →
            </Link>
          </div>
        </div>

        {/* ══ GEPA ══ */}
        <div id="gepa" style={{ paddingTop: 96, marginTop: 40, borderTop: `1px solid ${line}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'end', marginBottom: 56 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ fontFamily: mono, fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
                  GEPA · arXiv 2507.19457 · ICLR 2026 Oral
                </div>
                <span style={{ fontFamily: mono, fontSize: 10, background: `${rose}12`, color: rose, padding: '2px 8px', borderRadius: 999, border: `1px solid ${rose}30` }}>beats RL</span>
              </div>
              <h2 style={{ fontFamily: serif, fontWeight: 400, fontSize: 'clamp(38px, 5vw, 60px)', letterSpacing: '-0.025em', lineHeight: 1.05, margin: 0, color: ink }}>
                Reflective evolution.<br />
                <em style={{ fontStyle: 'italic', color: rose }}>Maximum</em> quality.
              </h2>
            </div>
            <p style={{ fontSize: 15.5, lineHeight: 1.65, color: muted, maxWidth: 380, margin: 0 }}>
              GEPA (accepted ICLR 2026 as Oral) maintains a Pareto frontier of prompt candidates and
              uses a meta-LLM to reflect on execution traces — learning <em>why</em> failures happen, not
              just that they do. Outperforms GRPO by 10% on average using 35× fewer rollouts.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', border: `1px solid ${rose}22`, borderRadius: 14, overflow: 'hidden', background: '#fff1f2' }}>
            {[
              { n: '01', t: 'Split dataset.', d: 'Your examples are split: 50% feedback, 30% Pareto evaluation, 20% held-out test.' },
              { n: '02', t: 'Pareto sampling.', d: 'Candidates that excel on any single example stay in the frontier. Diversity is preserved across the whole space.' },
              { n: '03', t: 'Reflective mutation.', d: 'A meta-LLM reads execution traces and ancestry to propose targeted edits — learn from failures, not just scores.' },
              { n: '04', t: 'Score-gated acceptance.', d: 'A new candidate is accepted only if it strictly beats the parent\'s score on the same minibatch. No regressions.' },
            ].map((s, i) => (
              <div key={i} style={{ padding: '24px 22px 28px', borderRight: i < 3 ? `1px solid ${rose}15` : 'none' }}>
                <div style={{ fontFamily: mono, fontSize: 11, color: rose, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{s.n}</div>
                <div style={{ fontFamily: serif, fontSize: 21, letterSpacing: '-0.02em', lineHeight: 1.2, margin: '14px 0 8px', color: ink }}>{s.t}</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.6, color: muted }}>{s.d}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {[
              { label: '+10% over GRPO',      desc: 'Outperforms reinforcement learning on average across four tasks, with up to +20% in the best case.' },
              { label: '35× fewer rollouts',  desc: 'GEPA reaches the same quality as RL with dramatically less compute — making it practical for real workloads.' },
              { label: '+10% over MIPROv2',   desc: 'Beats the leading discrete prompt optimizer by over 10% across two frontier LLMs.' },
            ].map((item, i) => (
              <div key={i} style={{ border: `1px solid ${rose}22`, borderRadius: 12, padding: '20px 20px', background: '#fff1f2' }}>
                <div style={{ fontFamily: mono, fontSize: 10.5, fontWeight: 600, color: rose, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>{item.label}</div>
                <div style={{ fontSize: 12.5, color: muted, lineHeight: 1.55 }}>{item.desc}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
            <Link href="/sign-up" style={{ height: 44, padding: '0 20px', borderRadius: 8, background: rose, color: '#fff', textDecoration: 'none', fontWeight: 500, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: `0 4px 20px ${rose}44` }}>
              Evolve with GEPA
            </Link>
            <Link href="/docs#gepa" style={{ height: 44, padding: '0 20px', borderRadius: 8, border: `1px solid ${line}`, color: ink, textDecoration: 'none', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              Read the docs →
            </Link>
          </div>
        </div>

        {/* ══ SKILLOPT ══ */}
        <div id="skillopt" style={{ paddingTop: 96, marginTop: 40, borderTop: `1px solid ${line}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'end', marginBottom: 56 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ fontFamily: mono, fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
                  SkillOpt · arXiv 2605.23904 · Microsoft Research
                </div>
                <span style={{ fontFamily: mono, fontSize: 10, background: `${emerald}12`, color: emerald, padding: '2px 8px', borderRadius: 999, border: `1px solid ${emerald}30` }}>agent skills</span>
              </div>
              <h2 style={{ fontFamily: serif, fontWeight: 400, fontSize: 'clamp(38px, 5vw, 60px)', letterSpacing: '-0.025em', lineHeight: 1.05, margin: 0, color: ink }}>
                Train skills.<br />
                Freeze the <em style={{ fontStyle: 'italic', color: emerald }}>model</em>.
              </h2>
            </div>
            <p style={{ fontSize: 15.5, lineHeight: 1.65, color: muted, maxWidth: 380, margin: 0 }}>
              SkillOpt evolves the system prompt — the &quot;skill file&quot; — while the target LLM stays frozen.
              A separate optimizer model issues ADD, REPLACE, and DELETE edits on a single skill document,
              accepting only changes that strictly improve a held-out validation score. Deploy the artifact.
              No fine-tuning, no inference overhead.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            {/* Three-player diagram */}
            <div style={{ border: `1px solid ${emerald}25`, borderRadius: 14, padding: 26, background: '#f0fdf4' }}>
              <div style={{ fontFamily: mono, fontSize: 10.5, color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>Three players</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { tag: 'FROZEN', name: 'Target model', desc: 'Executes tasks. Weights never touched.', color: muted, bg: '#f9f9f9' },
                  { tag: 'EVOLVES', name: 'Skill file', desc: 'Single .md document — the only thing that changes.', color: emerald, bg: `${emerald}0a` },
                  { tag: 'OPTIMIZER', name: 'SkillOpt', desc: 'Reads scored rollouts → proposes bounded edits.', color: violet, bg: `${violet}08` },
                ].map(p => (
                  <div key={p.tag} style={{ display: 'flex', gap: 12, padding: '10px 14px', borderRadius: 9, background: p.bg, border: `1px solid ${p.color}22` }}>
                    <div style={{ fontFamily: mono, fontSize: 9, fontWeight: 700, color: p.color, letterSpacing: '.07em', minWidth: 64, paddingTop: 2 }}>{p.tag}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: ink }}>{p.name}</div>
                      <div style={{ fontSize: 11.5, color: muted, lineHeight: 1.4 }}>{p.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Results */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { metric: '+23.5 pts',   desc: 'accuracy gain on GPT-5.5 direct chat vs. no-skill baseline', color: emerald },
                { metric: '+24.8 pts',   desc: 'accuracy gain inside the Codex agentic loop', color: emerald },
                { metric: '+19.1 pts',   desc: 'accuracy gain running inside Claude Code harness', color: emerald },
                { metric: '52 / 52',     desc: 'best or tied on every (model × benchmark × harness) cell evaluated', color: violet },
              ].map((r, i) => (
                <div key={i} style={{ border: `1px solid ${line}`, borderRadius: 12, padding: '16px 20px', display: 'flex', gap: 16, alignItems: 'center' }}>
                  <div style={{ fontFamily: serif, fontSize: 30, letterSpacing: '-0.03em', color: r.color, flexShrink: 0, lineHeight: 1 }}>{r.metric}</div>
                  <div style={{ fontSize: 12.5, color: muted, lineHeight: 1.4 }}>{r.desc}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Link href="/sign-up" style={{ height: 44, padding: '0 20px', borderRadius: 8, background: emerald, color: '#fff', textDecoration: 'none', fontWeight: 500, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: `0 4px 20px ${emerald}44` }}>
              Train your first skill
            </Link>
            <Link href="/docs#skillopt" style={{ height: 44, padding: '0 20px', borderRadius: 8, border: `1px solid ${line}`, color: ink, textDecoration: 'none', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              Read the docs →
            </Link>
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
              fontSize: 'clamp(38px, 5vw, 60px)',
              letterSpacing: '-0.025em', lineHeight: 1.05, margin: 0, color: ink }}>
              Built for people<br />
              who ship with <em style={{ fontStyle: 'italic', color: violet }}>LLMs</em>.
            </h2>
          </div>
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: muted, maxWidth: 360, margin: 0 }}>
            If your product depends on prompts that have to keep working across
            models, users, and versions — Promptly is for you.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {AUDIENCE.map((a, i) => (
            <div key={i} style={{ border: `1px solid ${line}`,
              borderRadius: 14, padding: 26, background: '#fff' }}>
              <div style={{ fontFamily: mono, fontSize: 10.5, color: violet,
                textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 16 }}>
                {a.r}
              </div>
              <h3 style={{ fontFamily: serif, fontSize: 24, fontWeight: 400,
                letterSpacing: '-0.015em', margin: '0 0 10px',
                lineHeight: 1.2, color: ink }}>
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
              fontSize: 'clamp(38px, 5vw, 60px)',
              letterSpacing: '-0.025em', lineHeight: 1.05, margin: 0, color: ink }}>
              Stronger prompts<br />
              in <em style={{ fontStyle: 'italic', color: violet }}>hours</em>,
              not sprints.
            </h2>
          </div>
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: muted, maxWidth: 360, margin: 0 }}>
            Early users say the biggest surprise isn&apos;t the quality —
            it&apos;s how fast the result arrives.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.8fr', gap: 16 }}>
          {TESTIMONIALS.map((t, i) => (
            <div key={i} style={{ border: `1px solid ${t.featured ? 'transparent' : line}`,
              borderRadius: 14, padding: 26,
              background: t.featured ? ink : '#fff',
              color: t.featured ? '#ededed' : ink,
              display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontFamily: serif, fontSize: 20, lineHeight: 1.4,
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
              fontSize: 'clamp(38px, 5vw, 60px)',
              letterSpacing: '-0.025em', lineHeight: 1.05, margin: 0, color: ink }}>
              Pay for what<br />
              you <em style={{ fontStyle: 'italic', color: violet }}>actually</em> run.
            </h2>
          </div>
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: muted, maxWidth: 360, margin: 0 }}>
            Tokens, not seats. You&apos;re billed for actual LLM usage — a fast Optimize run
            costs ~15K tokens; a full GEPA evolution up to 1M. Unused tokens roll over for 90 days.
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
              fontSize: 'clamp(38px, 5vw, 60px)',
              letterSpacing: '-0.025em', lineHeight: 1.05, margin: 0, color: ink }}>
              Questions,<br />answered.
            </h2>
          </div>
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: muted, maxWidth: 360, margin: 0 }}>
            Something we didn&apos;t cover?{' '}
            <a href="mailto:hey@promptly.dev" style={{ color: violet, fontWeight: 500,
              textDecoration: 'none' }}>
              Email us
            </a>{' '}
            — we reply within a few hours on weekdays.
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
                <span style={{ fontFamily: serif, fontSize: 20,
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

      {/* ── Final CTA ── */}
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
            fontSize: 'clamp(38px, 5vw, 64px)',
            letterSpacing: '-0.03em', lineHeight: 1.05,
            margin: '0 0 20px', color: '#ededed' }}>
            Better prompts start<br />
            with <em style={{ color: violet, fontStyle: 'italic' }}>evidence</em>.
          </h2>
          <p style={{ color: '#8a8a90', fontSize: 16, lineHeight: 1.65,
            margin: '0 0 36px', maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
            3M tokens free. No card required. Start with any prompt you already
            have — or upload a PDF and let your own data decide which prompt wins.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/sign-up"
              style={{ height: 48, padding: '0 28px', borderRadius: 8,
                background: violet, color: '#fff', textDecoration: 'none',
                fontWeight: 500, fontSize: 15, display: 'inline-flex',
                alignItems: 'center', gap: 8,
                boxShadow: `0 4px 28px ${violet}55` }}>
              ⚡ Try Promptly free
            </Link>
            <a href="mailto:hey@promptly.dev"
              style={{ height: 48, padding: '0 24px', borderRadius: 8,
                border: '1px solid #2a2a32', color: '#b5b5ba',
                textDecoration: 'none', fontSize: 15, display: 'inline-flex',
                alignItems: 'center', gap: 8 }}>
              Talk to us →
            </a>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{ background: '#fff', padding: '64px 0 32px', borderTop: `1px solid ${line}` }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 40px',
          display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr 1fr', gap: 40 }}>
          <div>
            <LogoMark />
            <p style={{ fontSize: 13.5, color: '#666', lineHeight: 1.6,
              maxWidth: 320, margin: '14px 0 24px' }}>
              Promptly gives you two ways to improve prompts: a multi-model
              review for any prompt, and an empirical domain tournament that
              tests variants against your own knowledge base.
            </p>
            <Link href="/sign-up"
              style={{ height: 36, padding: '0 16px', borderRadius: 8,
                background: violet, color: '#fff', textDecoration: 'none',
                fontSize: 13, fontWeight: 500, display: 'inline-flex',
                alignItems: 'center', gap: 6 }}>
              ⚡ Try Promptly free
            </Link>
          </div>
          {[
            { h: 'Product',   links: ['Optimize', 'Domain', 'Analyze', 'Versions', 'API'] },
            { h: 'Company',   links: ['About', 'Customers', 'Careers · 4 open', 'Press kit', 'Contact'] },
            { h: 'Resources', links: ['Docs', 'Prompt library', 'Benchmarks', 'Blog', 'Community'] },
            { h: 'Legal',     links: ['Privacy', 'Terms', 'Security', 'DPA', 'Status · all systems'] },
          ].map(col => (
            <div key={col.h}>
              <h4 style={{ fontFamily: mono, fontSize: 11, color: '#888',
                textTransform: 'uppercase', letterSpacing: '0.14em', margin: '0 0 16px' }}>
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
                    <li key={l} style={{ fontSize: 13.5, color: '#444', cursor: 'pointer' }}>{l}</li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <div style={{ maxWidth: 1240, margin: '48px auto 0', padding: '20px 40px 0',
          borderTop: `1px solid ${line}`, display: 'flex', alignItems: 'center',
          gap: 24, fontFamily: mono, fontSize: 11.5, color: '#888', letterSpacing: '0.08em' }}>
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
