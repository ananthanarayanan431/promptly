'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { GepaState, GepaCandidate } from '@/types/domain-prompts';

/* ── Config ───────────────────────────────────────────────────────── */
const GEPA_BUDGET  = 678;
const GEPA_NPARETO = 50;
const GEPA_MB      = 3;
const GEPA_NCOLS   = 12;

/* ── Phase rail definition ────────────────────────────────────────── */
const GEPA_PHASES: { id: string; tag: string; name: string; steps: { n: string; t: string; heart?: boolean }[] }[] = [
  { id: 'setup', tag: 'Phase 0–1', name: 'Inputs & Initialisation', steps: [
    { n: '1', t: 'Split data → feedback / Pareto / test' },
    { n: '2', t: 'Init candidate pool P = [Φ₀]' },
    { n: '3', t: 'Score seed on D_pareto → baseline S' },
  ]},
  { id: 'loop', tag: 'Phase 2 · loop', name: 'Reflective Optimisation', steps: [
    { n: '4',  t: 'Pareto-sample a candidate to evolve' },
    { n: '5',  t: 'Pick module — round-robin' },
    { n: '6',  t: 'Sample minibatch M (3 examples)' },
    { n: '7',  t: 'Run system → capture full traces' },
    { n: '8',  t: 'Score + collect feedback μf' },
    { n: '9',  t: 'Reflective mutation (meta-LLM)', heart: true },
    { n: '11', t: 'Re-run Φ′ on same minibatch' },
    { n: '12', t: 'Gate: did σ′ beat σ?' },
    { n: '13', t: 'Full eval on D_pareto' },
    { n: '14', t: 'Add to pool · update frontier' },
  ]},
  { id: 'out', tag: 'Phase 3', name: 'Return Π*', steps: [
    { n: '17', t: 'Select best candidate Φ*' },
  ]},
];

/* ── Inline icon helper (avoids shared component coupling) ─────────── */
const PATHS: Record<string, React.ReactNode> = {
  check:     <path d="m20 6-11 11-5-5"/>,
  arrowRight: <><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></>,
  trophy:    <><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v6a5 5 0 01-10 0z"/><path d="M7 6H4a2 2 0 000 4h3"/><path d="M17 6h3a2 2 0 010 4h-3"/></>,
  sparkles:  <path d="m12 3-1.912 5.813a2 2 0 01-1.275 1.275L3 12l5.813 1.912a2 2 0 011.275 1.275L12 21l1.912-5.813a2 2 0 011.275-1.275L21 12l-5.813-1.912a2 2 0 01-1.275-1.275L12 3z"/>,
  gitBranch: <><path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 01-9 9"/></>,
  refresh:   <><path d="M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 01-9 9 9.75 9.75 0 01-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></>,
  grid:      <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,
  target:    <><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>,
  chip:      <><rect x="9" y="2" width="6" height="3"/><rect x="9" y="19" width="6" height="3"/><rect x="2" y="9" width="3" height="6"/><rect x="19" y="9" width="3" height="6"/><rect x="6" y="6" width="12" height="12" rx="2"/></>,
  info:      <><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></>,
  copy:      <><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></>,
};
function GIcon({ name, size = 14, color }: { name: string; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color || 'currentColor'} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }}>
      {PATHS[name]}
    </svg>
  );
}

/* ── Section label ────────────────────────────────────────────────── */
function GepaLabel({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ fontSize: 10.5, color: color || 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>
      {children}
    </div>
  );
}

/* ── Typewriter (for proposed prompt) ────────────────────────────── */
function GepaType({ text, on }: { text: string; on: boolean }) {
  const [n, setN] = useState(0);
  const prevRef = useRef(text);

  useEffect(() => {
    if (prevRef.current !== text) { prevRef.current = text; setN(0); }
    if (!on) { setN(text.length); return; }
    setN(0);
    let i = 0;
    const id = setInterval(() => {
      i += Math.max(2, Math.round(text.length / 90));
      setN(i);
      if (i >= text.length) clearInterval(id);
    }, 24);
    return () => clearInterval(id);
  }, [text, on]);

  return <>{text.slice(0, n)}{on && n < text.length && <span style={{ opacity: .5 }}>▍</span>}</>;
}

/* ── Budget — linear progress bar ────────────────────────────────── */
function GepaBudget({ used }: { used: number }) {
  const pct = Math.min(100, (used / GEPA_BUDGET) * 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>
          Rollout budget B
        </span>
        <span className="mono" style={{ fontSize: 11.5 }}>
          <b>{used}</b> <span style={{ color: 'var(--text-subtle)' }}>/ {GEPA_BUDGET}</span>
        </span>
      </div>
      <div className="ply-progress" style={{ height: 6 }}>
        <i style={{
          width: `${pct}%`, display: 'block', height: '100%', borderRadius: 999,
          background: 'linear-gradient(90deg, #06b6d4, var(--primary))',
          transition: 'width .4s ease',
        }} />
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--text-subtle)' }} className="mono">
        minibatch {GEPA_MB}·rollout · npareto {GEPA_NPARETO} · {GEPA_BUDGET - used} left
      </div>
    </div>
  );
}

/* ── Score matrix with Pareto frontier row ────────────────────────── */
function GepaMatrix({ pool, frontier }: { pool: GepaCandidate[]; frontier: number[] }) {
  if (!pool.length) return null;
  const frontierAvg = frontier.length
    ? (frontier.reduce((a, b) => a + b, 0) / frontier.length) * 100
    : 0;
  const cols = `46px repeat(${GEPA_NCOLS}, 1fr) 52px`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5 }}>
      {/* column header */}
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 2, alignItems: 'center' }}>
        <span />
        {frontier.map((_, i) => <span key={i} />)}
        <span className="mono" style={{ fontSize: 8.5, color: 'var(--text-subtle)', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          avg
        </span>
      </div>

      {/* Pareto frontier row */}
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 2, alignItems: 'center' }}>
        <span className="mono" style={{ color: 'var(--primary)', fontSize: 9.5, fontWeight: 700 }}>s*[i]</span>
        {frontier.map((s, i) => (
          <div key={i} title={`best on ex ${i + 1}: ${Math.round(s * 100)}%`} style={{
            height: 18, borderRadius: 3, display: 'grid', placeItems: 'center',
            background: `color-mix(in oklab, var(--primary) ${Math.round(25 + s * 55)}%, transparent)`,
            border: '1px solid color-mix(in oklab, var(--primary) 35%, transparent)',
          }}>
            <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: s > 0.55 ? 'white' : 'var(--primary)' }}>
              {Math.round(s * 100)}
            </span>
          </div>
        ))}
        <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', textAlign: 'right' }}>
          {frontierAvg.toFixed(1)}%
        </span>
      </div>

      {/* Candidate rows */}
      {pool.map(c => (
        <div key={c.id} className="anim-slide" style={{ display: 'grid', gridTemplateColumns: cols, gap: 2, alignItems: 'center' }}>
          <span className="mono" style={{ color: c.star ? 'var(--primary)' : 'var(--text-muted)', fontWeight: c.star ? 700 : 500, fontSize: 10 }}>
            {c.id}{c.star ? '★' : ''}
          </span>
          {(c.cells.length ? c.cells : Array(GEPA_NCOLS).fill(0)).map((s: number, i: number) => {
            const isWin = frontier[i] > 0 && Math.abs(s - frontier[i]) < 0.001;
            return (
              <div key={i} title={`ex ${i + 1}: ${Math.round(s * 100)}%`} style={{
                height: 16, borderRadius: 2,
                background: `color-mix(in oklab, var(--success) ${Math.round(20 + s * 70)}%, var(--surface-2))`,
                outline: isWin ? '1.5px solid var(--primary)' : 'none',
                outlineOffset: -1.5,
              }} />
            );
          })}
          <span className="mono" style={{ fontSize: 10.5, fontWeight: c.star ? 700 : 500, color: c.star ? 'var(--primary)' : 'var(--text-muted)', textAlign: 'right' }}>
            {c.score.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Step rail ────────────────────────────────────────────────────── */
function GepaRail({ doneSteps, currentStep, iterIdx, looping }: {
  doneSteps: string[];
  currentStep: string | null;
  iterIdx: number;
  looping: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {GEPA_PHASES.map(ph => (
        <div key={ph.id}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600 }}>{ph.name}</span>
            <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-subtle)' }}>{ph.tag}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {ph.steps.map(st => {
              const isActive = currentStep === st.n;
              const isDone  = doneSteps.includes(st.n) && !isActive;
              return (
                <div key={st.n} style={{
                  display: 'grid', gridTemplateColumns: '22px 1fr', gap: 8, alignItems: 'center',
                  padding: '5px 8px', borderRadius: 7,
                  background: isActive ? (st.heart ? 'var(--primary-soft)' : 'var(--surface-2)') : 'transparent',
                  outline: isActive ? `1px solid ${st.heart ? 'var(--primary)' : 'var(--border)'}` : 'none',
                  transition: 'background .2s, outline .2s',
                }}>
                  <span style={{
                    width: 20, height: 20, borderRadius: 6, display: 'grid', placeItems: 'center',
                    fontSize: 9.5, fontWeight: 700, flexShrink: 0,
                    background: isActive ? (st.heart ? 'var(--primary)' : 'var(--text)') : isDone ? 'rgba(16,185,129,0.12)' : 'var(--surface-2)',
                    color: isActive ? 'white' : isDone ? 'var(--success)' : 'var(--text-subtle)',
                  }} className="mono">
                    {isDone ? <GIcon name="check" size={11} /> : st.n}
                  </span>
                  <span style={{
                    fontSize: 11.5, lineHeight: 1.3,
                    color: isActive ? 'var(--text)' : isDone ? 'var(--text-muted)' : 'var(--text-subtle)',
                    fontWeight: isActive ? 600 : 400,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {st.t}
                    {st.heart && (
                      <span className="ply-pill ply-pill-primary" style={{ fontSize: 9, padding: '0 5px' }}>heart</span>
                    )}
                    {isActive && (
                      <span className="ply-dot ply-dot-pulse" style={{ background: st.heart ? 'var(--primary)' : 'var(--text-muted)' }} />
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          {ph.id === 'loop' && looping && (
            <div style={{
              marginTop: 6, padding: '4px 8px', borderRadius: 6,
              background: 'rgba(6,182,212,0.1)', color: '#06b6d4',
              fontSize: 10.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <GIcon name="refresh" size={11} color="#06b6d4" />
              iteration {iterIdx} · loops until B exhausted
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Candidate lineage — horizontal with arrows ───────────────────── */
function GepaLineage({ pool, pending, baseline }: {
  pool: GepaCandidate[];
  pending: { parent: string; fail: boolean } | null;
  baseline: number | null;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, overflowX: 'auto', paddingBottom: 4 }}>
      {pool.map((c, i) => (
        <div style={{ display: 'contents' }} key={c.id}>
          {i > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 4px', flexShrink: 0 }}>
              {c.delta && (
                <span className="ply-pill ply-pill-success" style={{ fontSize: 9.5, padding: '1px 6px', marginBottom: 2 }}>
                  {c.delta}
                </span>
              )}
              <GIcon name="arrowRight" size={14} color="var(--text-subtle)" />
            </div>
          )}
          <div className="anim-fade" style={{
            flexShrink: 0, width: 152, padding: '10px 12px', borderRadius: 10,
            border: `1px solid ${c.star ? 'var(--primary)' : 'var(--border)'}`,
            background: c.star ? 'linear-gradient(150deg, var(--primary-soft), transparent 75%)' : 'var(--surface)',
            boxShadow: c.star ? '0 0 0 3px rgba(124,92,255,0.15)' : '0 1px 3px rgba(0,0,0,.08)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: c.star ? 'var(--primary)' : 'var(--text)' }}>
                {c.id}{c.star ? ' ★' : ''}
              </span>
              {i === 0 && baseline !== null && (
                <span className="ply-pill" style={{ fontSize: 9, padding: '0 5px' }}>seed</span>
              )}
              {c.star && <GIcon name="trophy" size={12} color="var(--primary)" />}
            </div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 3, letterSpacing: '-.02em' }}>
              {c.score.toFixed(2)}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.35, marginTop: 4 }}>
              {c.desc}
            </div>
          </div>
        </div>
      ))}

      {pending && (
        <div style={{ display: 'contents' }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '0 4px', flexShrink: 0 }}>
            <GIcon name="arrowRight" size={14} color="var(--text-subtle)" />
          </div>
          <div style={{
            flexShrink: 0, width: 152, padding: '10px 12px', borderRadius: 10,
            border: `1.5px dashed ${pending.fail ? 'var(--danger)' : '#06b6d4'}`,
            background: 'var(--surface-2)',
            opacity: pending.fail ? 0.7 : 1,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: pending.fail ? 'var(--danger)' : '#06b6d4' }}>
                Φ′
              </span>
              <span className="ply-dot ply-dot-pulse" style={{ background: pending.fail ? 'var(--danger)' : '#06b6d4' }} />
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.35 }}>
              {pending.fail
                ? '✕ discarded — σ′ ≤ σ on minibatch'
                : `child of ${pending.parent} · evaluating…`}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Iteration theater — morphs by sub-step ───────────────────────── */
function GepaTheater({ state }: { state: GepaState }) {
  const it  = state.current_iter;
  const sub = state.sub;

  // Init phase — no current_iter yet
  if (!it && state.phase === 'init') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <GepaLabel>Initialisation</GepaLabel>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Splitting your dataset into <b>feedback (50%)</b>, <b>Pareto (30%)</b> and a locked <b>test set (20%)</b>,
          then scoring the seed system on every Pareto example to build the baseline score matrix S.
        </div>
        <div className="ply-progress indet" style={{ maxWidth: 280 }}><i /></div>
      </div>
    );
  }

  if (!it) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-subtle)', fontSize: 13, padding: 16 }}>
        <span className="ply-dot ply-dot-pulse" style={{ background: 'var(--primary)', width: 7, height: 7 }} />
        Waiting for next iteration…
      </div>
    );
  }

  /* SELECT / MODULE / MINIBATCH — 3-card setup strip */
  if (sub === 'select' || sub === 'module' || sub === 'minibatch') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div className="ply-card" style={{ padding: '12px 14px', boxShadow: 'none' }}>
            <GepaLabel>Step 4 · Pareto select</GepaLabel>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{it.parent}</span>
              <GIcon name="target" size={14} color="var(--primary)" />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.4 }}>
              Sampled from the frontier — not the single best. Diversity preserved.
            </div>
          </div>
          <div className="ply-card" style={{ padding: '12px 14px', boxShadow: 'none', opacity: sub === 'select' ? 0.45 : 1, transition: 'opacity .3s' }}>
            <GepaLabel>Step 5 · Module</GepaLabel>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <GIcon name="chip" size={14} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>System Prompt</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.4 }}>
              Round-robin — every module gets attention.
            </div>
          </div>
          <div className="ply-card" style={{ padding: '12px 14px', boxShadow: 'none', opacity: sub === 'minibatch' ? 1 : 0.45, transition: 'opacity .3s' }}>
            <GepaLabel>Step 6 · Minibatch M</GepaLabel>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['ex-1', 'ex-2', 'ex-3'].map(m => (
                <span key={m} className="ply-pill" style={{ fontSize: 10.5 }}>{m}</span>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.4 }}>
              3 examples from D_feedback — rich signal, low cost.
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* RUN / SCORE — traces */
  if (sub === 'run' || sub === 'score') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <GepaLabel>
          {sub === 'run' ? 'Step 7 · Executing Φₖ — capturing traces' : 'Step 8 · Scoring + feedback μf'}
        </GepaLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {it.traces.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text-subtle)', fontSize: 12 }}>
              <span className="ply-dot ply-dot-pulse" style={{ background: 'var(--primary)', width: 6, height: 6 }} />
              Running examples…
            </div>
          )}
          {it.traces.map((tr, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center',
              padding: '10px 14px', borderRadius: 8, background: 'var(--surface-2)',
            }}>
              <div style={{ minWidth: 0 }}>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  in: {tr.input}
                </div>
                {tr.output && (
                  <div className="mono" style={{ fontSize: 11, color: 'var(--text)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    out: {tr.output}
                  </div>
                )}
                {sub === 'score' && tr.feedback && (
                  <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 5, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <GIcon name="info" size={11} />
                    <span>μf: {tr.feedback}</span>
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {sub === 'run'
                  ? <div className="ply-progress indet" style={{ width: 64 }}><i /></div>
                  : <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: tr.score < 0.5 ? 'var(--danger)' : '#f59e0b' }}>
                      {tr.score.toFixed(2)}
                    </span>
                }
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* REFLECT — the heart of GEPA */
  if (sub === 'reflect') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--primary)', color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <GIcon name="sparkles" size={13} color="white" />
          </span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Step 9 · Reflective Prompt Mutation</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              One meta-LLM call reads every trace, score, feedback &amp; ancestor lesson — then rewrites the prompt.
            </div>
          </div>
          <span className="ply-pill ply-pill-primary" style={{ fontSize: 10, marginLeft: 'auto' }}>
            <span className="ply-dot ply-dot-pulse" /> the heart of GEPA
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 14px 1fr', gap: 10, alignItems: 'stretch' }}>
          {/* Inputs */}
          <div className="ply-card" style={{ padding: '12px 14px', boxShadow: 'none', display: 'flex', flexDirection: 'column', gap: 9 }}>
            <GepaLabel>Meta-LLM reads</GepaLabel>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-subtle)', fontWeight: 600 }}>CURRENT πⱼ</div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.45, marginTop: 3 }}>
                {it.cur_prompt.slice(0, 180)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-subtle)', fontWeight: 600 }}>3 TRACES + FEEDBACK</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                {it.traces.map((tr, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10.5 }}>
                    <span className="mono" style={{ color: tr.score < 0.5 ? 'var(--danger)' : '#f59e0b', fontWeight: 700, width: 30 }}>
                      {tr.score.toFixed(2)}
                    </span>
                    <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {tr.feedback}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {it.ancestor && it.ancestor !== 'No ancestors yet.' && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-subtle)', fontWeight: 600 }}>ANCESTOR LESSONS</div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.45, marginTop: 3, display: 'flex', gap: 5 }}>
                  <GIcon name="gitBranch" size={11} />
                  <span>{it.ancestor.slice(0, 140)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Arrow */}
          <div style={{ display: 'grid', placeItems: 'center' }}>
            <GIcon name="arrowRight" size={16} color="var(--primary)" />
          </div>

          {/* Output */}
          <div style={{
            padding: '12px 14px', borderRadius: 12,
            border: '1px solid var(--primary)',
            background: 'linear-gradient(160deg, var(--primary-soft), transparent 80%)',
            display: 'flex', flexDirection: 'column', gap: 9,
          }}>
            <GepaLabel color="var(--primary)">Diagnosis → proposed π′ⱼ</GepaLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {it.reasoning.length === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-subtle)', fontSize: 11 }}>
                  <span className="ply-dot ply-dot-pulse" style={{ background: 'var(--primary)', width: 5, height: 5 }} />
                  Reflecting on traces…
                </div>
              )}
              {it.reasoning.map((r, i) => (
                <div key={i} style={{ fontSize: 11, color: 'var(--text)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <GIcon name="check" size={11} color="var(--primary)" />
                  <span>{r}</span>
                </div>
              ))}
            </div>
            {it.new_prompt && (
              <div style={{ marginTop: 2 }}>
                <div style={{ fontSize: 10, color: 'var(--primary)', fontWeight: 600 }}>NEW PROMPT π′ⱼ</div>
                <div className="mono" style={{ fontSize: 10.5, lineHeight: 1.5, marginTop: 4, color: 'var(--text)' }}>
                  <GepaType text={it.new_prompt} on={true} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* RERUN / GATE / FULLEVAL / UPDATE — σ before/after comparison */
  if (sub === 'rerun' || sub === 'gate' || sub === 'fulleval' || sub === 'update') {
    const passed = it.accept;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <GepaLabel>Step 10–12 · Assemble Φ′ → re-run same minibatch → gate</GepaLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, alignItems: 'stretch' }}>
          <div className="ply-card" style={{ padding: '14px 16px', boxShadow: 'none', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>σ before · {it.parent}</div>
            <div className="mono" style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>
              {it.sigma.toFixed(2)}
            </div>
          </div>

          <div style={{ display: 'grid', placeItems: 'center' }}>
            {sub === 'rerun'
              ? <div className="ply-progress indet" style={{ width: 90 }}><i /></div>
              : <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 26, color: passed ? 'var(--success)' : 'var(--danger)' }}>
                    {passed ? '✓' : '✗'}
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: passed ? 'var(--success)' : 'var(--danger)', marginTop: 2 }}>
                    {passed ? 'σ′ > σ — improved' : 'σ′ ≤ σ — discard'}
                  </div>
                </div>
            }
          </div>

          <div className="ply-card" style={{
            padding: '14px 16px', boxShadow: 'none', textAlign: 'center',
            border: sub !== 'rerun' && passed !== null
              ? `1px solid ${passed ? 'var(--success)' : 'var(--danger)'}`
              : undefined,
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>σ′ after · Φ′</div>
            <div className="mono" style={{
              fontSize: 26, fontWeight: 700, marginTop: 4,
              color: sub === 'rerun' ? 'var(--text-subtle)' : (passed ? 'var(--success)' : 'var(--danger)'),
            }}>
              {sub === 'rerun' ? '…' : (it.sigma_p !== null ? it.sigma_p.toFixed(2) : '…')}
            </div>
          </div>
        </div>

        {(sub === 'fulleval' || sub === 'update') && (
          <div className="ply-card anim-fade" style={{ padding: '12px 16px', boxShadow: 'none', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ flexShrink: 0 }}>
              <GepaLabel>Step 13 · Full eval on D_pareto</GepaLabel>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                {GEPA_NPARETO} rollouts — only spent because the gate passed.
              </div>
            </div>
            <div className="ply-progress" style={{ flex: 1, height: 7 }}>
              <i style={{ width: `${state.full_pct}%`, display: 'block', height: '100%', background: 'var(--primary)', borderRadius: 999, transition: 'width .3s ease' }} />
            </div>
            <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)' }}>
              {Math.round(state.full_pct)}%
            </span>
          </div>
        )}
      </div>
    );
  }

  /* Fallback */
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-subtle)', fontSize: 13, padding: 16 }}>
      <span className="ply-dot ply-dot-pulse" style={{ background: 'var(--primary)', width: 7, height: 7 }} />
      Step {state.step ?? '—'} · {sub ?? 'processing…'}
    </div>
  );
}

/* ── Stats bar ────────────────────────────────────────────────────── */
function GepaStat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingRight: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-.01em' }} className="mono">{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hint}</div>
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────────── */
export function GepaOptimizer({
  domainId,
  optimizedPrompt,
  promptInput,
}: {
  domainId: string;
  optimizedPrompt: string | null;
  promptInput?: string | null;
}) {
  const { data: state } = useQuery<GepaState | null>({
    queryKey: ['gepa-state', domainId],
    queryFn: async () => {
      try {
        const res = await api.get<{ data: GepaState }>(`/api/v1/domain-prompts/${domainId}/gepa-state`);
        return res.data.data;
      } catch {
        return null;
      }
    },
    refetchInterval: 2000,
    staleTime: 0,
  });

  const [copied, setCopied] = useState(false);
  function copyPrompt() {
    if (!optimizedPrompt) return;
    void navigator.clipboard.writeText(optimizedPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isRunning   = !!state && state.phase !== 'completed';
  const isCompleted = state?.phase === 'completed';
  const noState     = !state && optimizedPrompt !== null;

  const best = state?.pool.find(c => c.star) ?? state?.pool[state.pool.length - 1] ?? null;
  const frontier = state?.pool.length
    ? Array.from({ length: GEPA_NCOLS }, (_, i) => Math.max(...state.pool.map(c => c.cells[i] ?? 0)))
    : Array(GEPA_NCOLS).fill(0) as number[];

  const phaseLabel = !state ? 'Ready'
    : state.phase === 'init' ? 'Initialising — split data, score seed baseline'
    : state.phase === 'loop' ? `Optimisation loop · iteration ${state.iter_idx}`
    : state.phase === 'final' ? 'Selecting best candidate Φ*'
    : 'Done';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Stats bar — shown while running or when we have live completed state */}
      {(isRunning || isCompleted) && state && (
        <div className="ply-card" style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 0 }}>
          <GepaStat
            label="Phase"
            value={<span style={{ fontSize: 13 }}>{phaseLabel}</span>}
            hint={isRunning ? <span className="ply-dot ply-dot-pulse" style={{ background: 'var(--primary)' }} /> : null}
          />
          <GepaStat
            label="Best score"
            value={best ? <span style={{ color: 'var(--success)' }}>{best.score.toFixed(2)}</span> : '—'}
            hint={<span style={{ fontSize: 11 }}>on D_pareto</span>}
          />
          <GepaStat
            label="Pool P"
            value={state.pool.length}
            hint={<span style={{ fontSize: 11 }}>candidates kept</span>}
          />
          <GepaStat
            label="Iterations"
            value={`${state.iter_idx}`}
            hint={<span style={{ fontSize: 11 }}>mutations attempted</span>}
          />
          <GepaStat
            label="Budget B"
            value={
              <span className="mono">
                {state.budget_used}<span style={{ color: 'var(--text-subtle)', fontSize: 13 }}>/{GEPA_BUDGET}</span>
              </span>
            }
            hint={<span style={{ fontSize: 11 }}>rollouts used</span>}
          />
        </div>
      )}

      {/* Live workspace */}
      {isRunning && state && (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 14, alignItems: 'start' }}>

          {/* Left: rail + budget (sticky) */}
          <div className="ply-card" style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 14 }}>
            <GepaRail
              doneSteps={state.done_steps}
              currentStep={state.step}
              iterIdx={state.iter_idx}
              looping={state.phase === 'loop'}
            />
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <GepaBudget used={state.budget_used} />
            </div>
          </div>

          {/* Right: lineage → theater → matrix */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>

            {state.pool.length > 0 && (
              <div className="ply-card" style={{ padding: '14px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <GIcon name="gitBranch" size={14} color="var(--primary)" />
                  <span style={{ fontWeight: 600, fontSize: 13 }}>Candidate pool — evolution tree</span>
                  {state.baseline !== null && (
                    <span className="ply-pill" style={{ fontSize: 10.5, marginLeft: 'auto' }}>
                      seed baseline {state.baseline.toFixed(2)}
                    </span>
                  )}
                </div>
                <GepaLineage pool={state.pool} pending={state.pending} baseline={state.baseline} />
              </div>
            )}

            <div className="ply-card" style={{ padding: '16px 18px', minHeight: 240 }}>
              <GepaTheater state={state} />
              {state.phase === 'final' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', justifyContent: 'center', padding: '24px 0' }}>
                  <GIcon name="trophy" size={26} color="var(--primary)" />
                  <div style={{ fontWeight: 600 }}>Budget exhausted — selecting Φ* with the highest D_pareto score.</div>
                </div>
              )}
            </div>

            {state.pool.length > 1 && (
              <div className="ply-card" style={{ padding: '14px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <GIcon name="grid" size={13} />
                  <span style={{ fontWeight: 600, fontSize: 12.5 }}>Score matrix S · Pareto frontier</span>
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)', marginLeft: 'auto' }}>
                    outlined cells = per-example winners
                  </span>
                </div>
                <GepaMatrix pool={state.pool} frontier={frontier} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Completed — live state available (full lineage view) */}
      {isCompleted && state && (
        <div className="ply-card anim-fade" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '14px 18px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'linear-gradient(135deg, var(--primary-soft), transparent 70%)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <GIcon name="trophy" size={18} color="var(--primary)" />
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Φ* {best?.id ?? ''} · optimised through reflection</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  Score:{' '}
                  <span className="mono">{state.baseline?.toFixed(2) ?? '—'}</span>
                  {' → '}
                  <span className="mono" style={{ color: 'var(--success)', fontWeight: 600 }}>
                    {best?.score.toFixed(2) ?? '—'}
                  </span>
                  {best && state.baseline !== null && (
                    <> on D_pareto · total gain{' '}
                      <span className="mono" style={{ color: 'var(--success)' }}>
                        +{(best.score - state.baseline).toFixed(2)}
                      </span>
                    </>
                  )}
                  {' · '}{state.budget_used} rollouts
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {optimizedPrompt && (
                <button className="ply-btn ply-btn-sm" onClick={copyPrompt}>
                  <GIcon name={copied ? 'check' : 'copy'} size={12} />
                  {copied ? 'Copied' : 'Copy'}
                </button>
              )}
              <button className="ply-btn ply-btn-sm">
                <GIcon name="trophy" size={12} /> Save
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', minHeight: 340 }}>
            <div style={{ padding: '16px 20px' }}>
              <GepaLabel>Seed prompt Π₀</GepaLabel>
              <pre className="ply-prompt-block" style={{ margin: '8px 0 0', color: 'var(--text-muted)' }}>
                {promptInput ?? '—'}
              </pre>
              <div style={{ marginTop: 14 }}>
                <GepaLabel>Lineage</GepaLabel>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' }}>
                  {state.pool.map((c, i) => (
                    <div style={{ display: 'contents' }} key={c.id}>
                      {i > 0 && <GIcon name="arrowRight" size={11} color="var(--text-subtle)" />}
                      <span className="ply-pill" style={{ fontSize: 10.5, color: c.star ? 'var(--primary)' : 'var(--text-muted)' }}>
                        {c.id} {c.score.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ background: 'var(--border)' }} />
            <div style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <GepaLabel color="var(--primary)">Π* — optimised protocol</GepaLabel>
                <span className="ply-pill ply-pill-primary" style={{ fontSize: 11 }}>
                  <GIcon name="sparkles" size={11} /> {best?.id ?? 'Φ*'} ★
                </span>
              </div>
              <pre className="ply-prompt-block" style={{ margin: 0, maxHeight: 420, overflow: 'auto' }}>
                {optimizedPrompt ?? '—'}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Completed — no live state (result loaded from DB) */}
      {noState && (
        <div className="ply-card anim-fade" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '14px 18px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'linear-gradient(135deg, var(--primary-soft), transparent 70%)',
          }}>
            <GIcon name="trophy" size={18} color="var(--primary)" />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>GEPA Φ* — optimised through reflection</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Reflective Prompt Evolution · arXiv:2507.19457</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button className="ply-btn ply-btn-sm" onClick={copyPrompt}>
                <GIcon name={copied ? 'check' : 'copy'} size={12} />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', minHeight: 280 }}>
            <div style={{ padding: '16px 20px' }}>
              <GepaLabel>Seed prompt</GepaLabel>
              <pre className="ply-prompt-block" style={{ margin: '8px 0 0', color: 'var(--text-muted)' }}>
                {promptInput ?? '—'}
              </pre>
            </div>
            <div style={{ background: 'var(--border)' }} />
            <div style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <GepaLabel color="var(--primary)">GEPA optimised</GepaLabel>
                <span className="ply-pill ply-pill-primary" style={{ fontSize: 11 }}>
                  <GIcon name="sparkles" size={11} /> Φ* ★
                </span>
              </div>
              <pre className="ply-prompt-block" style={{ margin: 0 }}>{optimizedPrompt}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
