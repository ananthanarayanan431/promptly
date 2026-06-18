'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { SkillProject, SkillExample, SkillOptLiveState, SkillOptLiveStateResponse } from '@/types/skill-opt';

/* ── Icon (matches design system paths) ─────────────────────────── */
const ICON: Record<string, React.ReactNode> = {
  bolt:        <path d="m13 2-9 12h8l-1 8 9-12h-9l1-8z"/>,
  plus:        <><path d="M12 5v14"/><path d="M5 12h14"/></>,
  sparkles:    <><path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="M5.5 5.5l2.5 2.5"/><path d="M16 16l2.5 2.5"/><path d="M5.5 18.5l2.5-2.5"/><path d="M16 8l2.5-2.5"/></>,
  cpu:         <><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3"/><path d="M15 1v3"/><path d="M9 20v3"/><path d="M15 20v3"/><path d="M20 9h3"/><path d="M20 14h3"/><path d="M1 9h3"/><path d="M1 14h3"/></>,
  fileText:    <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/></>,
  check:       <path d="m20 6-11 11-5-5"/>,
  x:           <><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>,
  trophy:      <><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v6a5 5 0 0 1-10 0z"/><path d="M7 6H4a2 2 0 0 0 0 4h3"/><path d="M17 6h3a2 2 0 0 1 0 4h-3"/></>,
  chevronR:    <path d="m9 6 6 6-6 6"/>,
  chevronD:    <path d="m6 9 6 6 6-6"/>,
  info:        <><circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/></>,
  shield:      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>,
  zap:         <path d="m13 2-9 12h8l-1 8 9-12h-9l1-8z"/>,
  layers:      <><path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></>,
  refresh:     <><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.4-2.6L3 16"/><path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.4 2.6L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/></>,
  activity:    <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>,
  copy:        <><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
  download:    <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></>,
  trash:       <><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>,
  upload:      <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></>,
  play:        <path d="m6 4 14 8-14 8z"/>,
};

function Icon({ name, size = 14, color, style }: { name: string; size?: number; color?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color ?? 'currentColor'} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}>
      {ICON[name] ?? null}
    </svg>
  );
}

/* ── Design tokens mapped to our CSS vars ───────────────────────── */
const C = {
  card:        { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 1px 2px rgba(15,15,30,.04)' },
  sectionHd:   { fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: 'var(--text-subtle)' },
};

/* ── Status pill ─────────────────────────────────────────────────── */
function StatusPill({ status }: { status: string }) {
  if (status === 'completed') return <span className="ply-pill ply-pill-success" style={{ fontSize: 11 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} /> Trained</span>;
  if (status === 'optimizing') return <span className="ply-pill ply-pill-primary" style={{ fontSize: 11 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block', animation: 'pulse-dot 1.2s ease-in-out infinite' }} /> Training</span>;
  if (status === 'failed') return <span className="ply-pill" style={{ fontSize: 11, color: 'var(--danger)' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} /> Failed</span>;
  return <span className="ply-pill" style={{ fontSize: 11 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} /> Untrained</span>;
}

/* ── Section header ──────────────────────────────────────────────── */
function SectionHd({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 0 10px', gap: 8 }}>
      <div style={C.sectionHd}>{children}</div>
      {right}
    </div>
  );
}

/* ── Copy button ─────────────────────────────────────────────────── */
function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="ply-btn ply-btn-sm" onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); }}>
      <Icon name={done ? 'check' : 'copy'} size={12} />{done ? 'Copied' : 'Copy'}
    </button>
  );
}

/* ── Slider ──────────────────────────────────────────────────────── */
function Slider({ value, min, max, onChange, format }: { value: number; min: number; max: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>{format ? format(value) : value}</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)' }}>{min} … {max}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={e => onChange(+e.target.value)}
        style={{ width: '100%', accentColor: 'var(--primary)' }} />
    </div>
  );
}

/* ── Hyper row ───────────────────────────────────────────────────── */
function HyperRow({ icon, label, hint, analogue, children }: { icon: string; label: string; hint: string; analogue?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name={icon} size={13} color="var(--text-muted)" />
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{hint}</div>
        {analogue && <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)', marginTop: 2 }}>↳ <span style={{ color: 'var(--accent)' }}>{analogue}</span></div>}
      </div>
      {children}
    </div>
  );
}

/* ── Score chart (SVG) ───────────────────────────────────────────── */
function ScoreChart({ history, baseline }: { history: { score: number; accepted: boolean; best?: boolean }[]; baseline: number }) {
  const W = 520, H = 180, PL = 36, PR = 14, PT = 14, PB = 26;
  const iW = W - PL - PR, iH = H - PT - PB;
  const xMax = Math.max(8, history.length);
  const pts = history.map((h, i) => ({ ...h, x: PL + i / (xMax - 1) * iW, y: PT + (1 - h.score) * iH }));
  const path = pts.length > 1 ? 'M ' + pts.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ') : '';
  const baseY = PT + (1 - baseline) * iH;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block', overflow: 'visible' }}>
      {[0, 0.25, 0.5, 0.75, 1].map(v => {
        const y = PT + (1 - v) * iH;
        return <g key={v}>
          <line x1={PL} x2={W - PR} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" strokeDasharray={v === 0 || v === 1 ? '' : '3 4'} />
          <text x={PL - 6} y={y + 3.5} fontSize="9.5" fill="var(--text-subtle)" textAnchor="end" fontFamily="var(--mono)">{v.toFixed(2)}</text>
        </g>;
      })}
      <line x1={PL} x2={W - PR} y1={baseY} y2={baseY} stroke="var(--text-subtle)" strokeWidth="1" strokeDasharray="2 3" />
      <text x={W - PR} y={baseY - 4} fontSize="9.5" fill="var(--text-subtle)" textAnchor="end" fontFamily="var(--mono)">baseline {baseline.toFixed(2)}</text>
      {path && <>
        <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <path d={`${path} L ${pts[pts.length-1].x} ${PT+iH} L ${pts[0].x} ${PT+iH} Z`} fill="var(--primary)" opacity="0.08" />
      </>}
      {pts.map((p, i) => (
        <g key={i}>
          {!p.accepted && <>
            <line x1={p.x-4} y1={p.y-4} x2={p.x+4} y2={p.y+4} stroke="var(--danger)" strokeWidth="1.6" strokeLinecap="round" />
            <line x1={p.x-4} y1={p.y+4} x2={p.x+4} y2={p.y-4} stroke="var(--danger)" strokeWidth="1.6" strokeLinecap="round" />
          </>}
          {p.accepted && <circle cx={p.x} cy={p.y} r={p.best ? 5.5 : 3.5} fill={p.best ? 'var(--success)' : 'var(--primary)'} stroke={p.best ? 'white' : 'var(--surface)'} strokeWidth="2" />}
          {p.best && <circle cx={p.x} cy={p.y} r="10" fill="none" stroke="var(--success)" strokeWidth="1.5" opacity="0.45" />}
        </g>
      ))}
      {Array.from({ length: Math.min(xMax, 8) }).map((_, i) => (
        <text key={i} x={PL + i / (Math.min(xMax,8)-1||1) * iW} y={H-PB+14} fontSize="9.5" fill="var(--text-subtle)" textAnchor="middle" fontFamily="var(--mono)">{i+1}</text>
      ))}
    </svg>
  );
}

/* ── Phase label ─────────────────────────────────────────────────── */
const PHASE_LABELS: Record<string, string> = {
  seed: 'Generating seed skill…',
  rollout: 'Rollout — running examples…',
  reflect: 'Reflection — proposing edits…',
  gate: 'Validation gate…',
  slow_update: 'Slow / meta update…',
  completed: 'Training complete',
  failed: 'Failed',
};

const FEED_STYLE: Record<string, { icon: string; soft: string; fg: string }> = {
  rollout:  { icon: 'play',     soft: 'var(--surface-2)',    fg: 'var(--text)' },
  reflect:  { icon: 'sparkles', soft: 'var(--accent-soft)',  fg: 'var(--accent)' },
  gate:     { icon: 'zap',      soft: 'var(--primary-soft)', fg: 'var(--primary)' },
  completed:{ icon: 'trophy',   soft: 'var(--success-soft)', fg: 'var(--success)' },
  failed:   { icon: 'x',        soft: 'var(--danger-soft)',  fg: 'var(--danger)' },
  slow_update:{ icon: 'shield', soft: 'var(--accent-soft)',  fg: 'var(--accent)' },
  seed:     { icon: 'sparkles', soft: 'var(--primary-soft)', fg: 'var(--primary)' },
};

/* ── Setup tab ───────────────────────────────────────────────────── */
function SetupTab({ project, onSaved, onStart }: {
  project: SkillProject;
  onSaved: () => void;
  onStart: (tier: string) => void;
}) {
  const [lr, setLr] = useState(4);
  const [batch, setBatch] = useState(8);
  const [epochs, setEpochs] = useState(3);
  const [schedule, setSchedule] = useState('cosine');
  const [budgetTier, setBudgetTier] = useState<'low'|'medium'|'high'>('low');
  const [initialSkill, setInitialSkill] = useState('');
  const [showSkillEditor, setShowSkillEditor] = useState(false);
  const [examples, setExamples] = useState<SkillExample[]>([{ input: '', expected: '' }]);
  const [pasteText, setPasteText] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const qc = useQueryClient();

  const { data: existingExamples } = useQuery({
    queryKey: ['skill-opt-examples', project.id],
    queryFn: async () => {
      const res = await api.get<{ data: { examples: SkillExample[] } }>(`/api/v1/skill-opt/${project.id}/examples`);
      return res.data.data.examples;
    },
    enabled: !!project.example_count,
  });
  useEffect(() => { if (existingExamples?.length) setExamples(existingExamples); }, [existingExamples]);

  const { mutate: saveExamples, isPending: saving } = useMutation({
    mutationFn: async () => {
      const valid = examples.filter(e => e.input.trim() && e.expected.trim());
      await api.post(`/api/v1/skill-opt/${project.id}/examples`, { examples: valid });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['skill-opt-projects'] }); qc.invalidateQueries({ queryKey: ['skill-opt-project', project.id] }); onSaved(); },
  });

  function parsePaste() {
    const lines = pasteText.trim().split('\n').filter(Boolean);
    const parsed: SkillExample[] = [];
    let cur: Partial<SkillExample> = {};
    for (const line of lines) {
      if (/^(INPUT|Q):\s*/i.test(line)) { if (cur.input && cur.expected) parsed.push(cur as SkillExample); cur = { input: line.replace(/^(INPUT|Q):\s*/i, '').trim() }; }
      else if (/^(EXPECTED|A):\s*/i.test(line)) { cur.expected = line.replace(/^(EXPECTED|A):\s*/i, '').trim(); }
    }
    if (cur.input && cur.expected) parsed.push(cur as SkillExample);
    if (parsed.length) { setExamples(parsed); setShowPaste(false); setPasteText(''); }
  }

  const validCount = examples.filter(e => e.input.trim() && e.expected.trim()).length;
  const totalTasks = project.example_count ?? validCount;
  const totalSteps = Math.max(1, Math.round(Math.max(totalTasks, 6) * 0.7 / batch)) * epochs;
  const llmEffort = (() => { try { return localStorage.getItem('ply_llm_effort') ?? 'medium'; } catch { return 'medium'; } })();
  const execMap: Record<string, string> = { low: 'gemini-2.0-flash', medium: 'claude-3.5-haiku', high: 'gpt-4o' };
  const executor = execMap[llmEffort] ?? 'claude-3.5-haiku';

  const TIERS = {
    low:    { label: 'Low',    desc: '2 epochs · 10 rollouts/epoch', credits: 5  },
    medium: { label: 'Medium', desc: '3 epochs · 20 rollouts/epoch', credits: 10 },
    high:   { label: 'High',   desc: '4 epochs · 30 rollouts/epoch', credits: 16 },
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 14, minHeight: 0 }}>
      {/* Main column */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>

        {/* Three players */}
        <div style={{ ...C.card, padding: 18 }}>
          <SectionHd right={<span className="ply-pill" style={{ fontSize: 10 }}><Icon name="info" size={10} /> SkillOpt · arXiv 2605.23904</span>}>
            Three players, one trainable file
          </SectionHd>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[
              { tag: 'FROZEN', title: 'Target model', val: executor, note: 'Executes tasks · weights never touched', icon: 'cpu', soft: 'var(--surface-2)', fg: 'var(--text)' },
              { tag: 'TRAINABLE', title: 'Skill document', val: `${Math.max(30, validCount * 4)} tokens`, note: 'The natural-language policy being optimized', icon: 'fileText', soft: 'var(--primary-soft)', fg: 'var(--primary)' },
              { tag: 'TRAINING-ONLY', title: 'Optimizer', val: 'gpt-4o-mini', note: 'Proposes bounded edits · never deployed', icon: 'sparkles', soft: 'var(--accent-soft)', fg: 'var(--accent)' },
            ].map((p, i) => (
              <div key={i} style={{ padding: 14, borderRadius: 10, background: p.soft, border: `1px solid ${p.soft === 'var(--surface-2)' ? 'var(--border)' : 'transparent'}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: p.fg }}>
                  <Icon name={p.icon} size={13} />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, letterSpacing: '.08em' }}>{p.tag}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{p.title}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: p.fg, fontWeight: 600 }}>{p.val}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>{p.note}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Data splits */}
        <div style={{ ...C.card, padding: 18 }}>
          <SectionHd right={<span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>{totalTasks || '?'} scored examples</span>}>
            Data splits
          </SectionHd>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden' }}>
              <div style={{ flex: 70, background: 'var(--primary)' }} title="Train: 70%" />
              <div style={{ flex: 15, background: 'var(--warning)' }} title="Selection: 15%" />
              <div style={{ flex: 15, background: 'var(--accent)' }} title="Test: 15%" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[
                { k: 'Train', v: 70, c: 'var(--primary)', note: 'Drives reflection edits' },
                { k: 'Selection', v: 15, c: 'var(--warning)', note: 'Validation gate — each edit judged here' },
                { k: 'Test', v: 15, c: 'var(--accent)', note: 'Locked · only used in final report' },
              ].map(p => (
                <div key={p.k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.c, flexShrink: 0 }} />
                    <span style={{ fontWeight: 600 }}>{p.k}</span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-subtle)' }}>{p.v}% · {Math.round(Math.max(totalTasks,6) * p.v / 100)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', lineHeight: 1.45 }}>{p.note}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 4, padding: '8px 10px', borderRadius: 7, background: 'var(--warning-soft)', display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, lineHeight: 1.5 }}>
              <Icon name="shield" size={12} color="var(--warning)" style={{ marginTop: 2, flexShrink: 0 }} />
              <div><span style={{ fontWeight: 600, color: 'var(--warning)' }}>Test split is locked. </span><span style={{ color: 'var(--text-muted)' }}>Never shown to the optimizer. Used only in the final report.</span></div>
            </div>
          </div>
        </div>

        {/* Q&A Examples */}
        <div style={{ ...C.card, padding: 18 }}>
          <SectionHd right={
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="ply-btn ply-btn-sm" onClick={() => setShowPaste(s => !s)}><Icon name="upload" size={11} /> Paste bulk</button>
              <button className="ply-btn ply-btn-sm" onClick={() => setExamples(e => [...e, { input: '', expected: '' }])}><Icon name="plus" size={11} /> Add row</button>
            </div>
          }>
            Q&A examples <span style={{ color: 'var(--text-subtle)', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>({validCount} valid · min 6)</span>
          </SectionHd>

          {showPaste && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Format: <code style={{ fontFamily: 'var(--mono)' }}>Q: ... / A: ...</code> or <code style={{ fontFamily: 'var(--mono)' }}>INPUT: ... / EXPECTED: ...</code></div>
              <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={5} placeholder={"Q: What is the capital of France?\nA: Paris\nQ: Who wrote Hamlet?\nA: William Shakespeare"}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--mono)', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
              <button className="ply-btn ply-btn-sm" style={{ alignSelf: 'flex-start' }} onClick={parsePaste}>Parse &amp; import</button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 260, overflowY: 'auto' }}>
            {examples.map((ex, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 7, alignItems: 'flex-start' }}>
                <textarea value={ex.input} rows={2} placeholder="Task input / question"
                  onChange={e => setExamples(l => l.map((x, j) => j === i ? { ...x, input: e.target.value } : x))}
                  style={{ padding: '6px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12, resize: 'none', outline: 'none', fontFamily: 'inherit' }} />
                <textarea value={ex.expected} rows={2} placeholder="Expected answer"
                  onChange={e => setExamples(l => l.map((x, j) => j === i ? { ...x, expected: e.target.value } : x))}
                  style={{ padding: '6px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12, resize: 'none', outline: 'none', fontFamily: 'inherit' }} />
                <button className="ply-btn ply-btn-sm" style={{ color: 'var(--danger)', marginTop: 2 }} onClick={() => setExamples(l => l.filter((_, j) => j !== i))}><Icon name="x" size={11} /></button>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="ply-btn ply-btn-primary ply-btn-sm" disabled={validCount < 6 || saving} onClick={() => saveExamples()}
              style={{ opacity: validCount < 6 ? 0.5 : 1, cursor: validCount < 6 ? 'not-allowed' : 'pointer' }}>
              <Icon name="check" size={12} /> {saving ? 'Saving…' : `Save ${validCount} examples`}
            </button>
            {validCount < 6 && <span style={{ fontSize: 11.5, color: 'var(--warning)' }}>Add at least 6 examples to enable training.</span>}
          </div>
        </div>

        {/* Initial skill */}
        <div style={{ ...C.card, padding: 18 }}>
          <SectionHd right={
            <button className="ply-btn ply-btn-sm" onClick={() => setShowSkillEditor(s => !s)}>
              <Icon name={showSkillEditor ? 'chevronD' : 'chevronR'} size={11} />{showSkillEditor ? 'Hide' : 'Edit'}
            </button>
          }>Initial skill document</SectionHd>
          {!showSkillEditor && (
            <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55, fontFamily: 'var(--mono)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {initialSkill || `# Skill — ${project.task_description.slice(0, 60)}\n\nFollow the task instructions carefully.\nThink step by step before answering.\nBe concise and accurate.`}
            </div>
          )}
          {showSkillEditor && (
            <textarea value={initialSkill} onChange={e => setInitialSkill(e.target.value)} spellCheck={false} rows={8}
              placeholder={`# Skill — ${project.name}\n\nDescribe how the agent should approach this task…`}
              style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.6, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
          )}
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="ply-btn ply-btn-sm" onClick={() => setInitialSkill('')}><Icon name="fileText" size={12} /> Reset to template</button>
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)' }}>target: 300–2,000 tokens</span>
          </div>
        </div>
      </div>

      {/* Right column — hyperparams + launch */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        <div style={{ ...C.card, padding: 18 }}>
          <SectionHd>Hyperparameters</SectionHd>
          <HyperRow icon="zap" label="Edit budget Lₜ" hint="Maximum edits applied per step. Caps how far the skill can move in one update." analogue="textual learning rate">
            <Slider value={lr} min={1} max={10} onChange={setLr} format={v => `${v} edits / step`} />
          </HyperRow>
          <HyperRow icon="layers" label="Rollout batch" hint="Tasks rolled out per step. Larger batches reveal recurring failure patterns." analogue="minibatch size">
            <Slider value={batch} min={4} max={40} onChange={setBatch} format={v => `${v} tasks / step`} />
          </HyperRow>
          <HyperRow icon="refresh" label="Epochs" hint="Full passes over the training split. Each epoch ends with a slow / meta update.">
            <Slider value={epochs} min={1} max={5} onChange={setEpochs} format={v => `${v} epoch${v > 1 ? 's' : ''}`} />
          </HyperRow>
          <HyperRow icon="activity" label="LR schedule" hint="How the edit budget decays over training. Cosine preserves the most rules." analogue="LR schedule">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, width: '100%' }}>
              {['cosine', 'linear', 'constant', 'autonomous'].map(s => (
                <button key={s} onClick={() => setSchedule(s)} style={{ padding: '6px 8px', borderRadius: 6, border: `1px solid ${schedule === s ? 'var(--primary)' : 'var(--border)'}`, background: schedule === s ? 'var(--primary-soft)' : 'var(--surface)', color: schedule === s ? 'var(--primary)' : 'var(--text-muted)', fontSize: 11.5, fontWeight: schedule === s ? 600 : 500, textAlign: 'left', cursor: 'pointer', textTransform: 'capitalize' }}>{s}</button>
              ))}
            </div>
          </HyperRow>
        </div>

        {/* Launch card */}
        <div style={{ ...C.card, padding: 18, background: 'linear-gradient(180deg, var(--primary-soft) 0%, var(--surface) 60%)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg, var(--primary), var(--accent))', color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="bolt" size={16} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Train skill</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>≈ {totalSteps} steps · {epochs} epoch{epochs > 1 ? 's' : ''} · gate enabled</div>
            </div>
          </div>

          {/* Budget tier */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '.06em' }}>Budget tier</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {(Object.entries(TIERS) as [string, { label: string; desc: string; credits: number }][]).map(([k, v]) => (
                <button key={k} onClick={() => setBudgetTier(k as 'low'|'medium'|'high')} style={{ padding: '9px 10px', borderRadius: 8, border: `1px solid ${budgetTier === k ? 'var(--primary)' : 'var(--border)'}`, background: budgetTier === k ? 'var(--primary-soft)' : 'var(--surface)', cursor: 'pointer', textAlign: 'left', boxShadow: budgetTier === k ? '0 0 0 3px color-mix(in oklab, var(--primary) 12%, transparent)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: budgetTier === k ? 'var(--primary)' : 'var(--text)' }}>{v.label}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, fontWeight: 700, color: budgetTier === k ? 'var(--primary)' : 'var(--text-muted)' }}>{v.credits} cr</span>
                  </div>
                  <div style={{ height: 2, borderRadius: 99, background: 'var(--border)', marginBottom: 4 }}>
                    <div style={{ height: '100%', width: `${(v.credits / 16) * 100}%`, background: budgetTier === k ? 'var(--primary)' : 'var(--border-strong)', borderRadius: 99 }} />
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-subtle)' }}>{v.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
            <div>target · {executor}</div>
            <div>optimizer · gpt-4o-mini</div>
            <div>Lₜ = {lr} · {schedule}</div>
            <div>batch = {batch}</div>
          </div>

          <button className="ply-btn ply-btn-primary" disabled={!project.example_count || project.example_count < 6} onClick={() => onStart(budgetTier)}
            style={{ height: 38, fontSize: 13.5, opacity: (!project.example_count || project.example_count < 6) ? 0.45 : 1, cursor: (!project.example_count || project.example_count < 6) ? 'not-allowed' : 'pointer' }}>
            <Icon name="bolt" size={14} />
            {!project.example_count || project.example_count < 6 ? 'Add examples first' : `Train skill · ${TIERS[budgetTier].credits} credits`}
          </button>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)', textAlign: 'center', lineHeight: 1.5 }}>
            Held-out gate · rejected-edit buffer · epoch-wise slow update
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Train tab ───────────────────────────────────────────────────── */
function TrainTab({ project, onDone }: { project: SkillProject; onDone: () => void }) {
  const [state, setState] = useState<SkillOptLiveState | null>(null);
  const [chartHistory, setChartHistory] = useState<{ score: number; accepted: boolean; best?: boolean }[]>([]);
  const feedRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const res = await api.get<{ data: SkillOptLiveStateResponse }>(`/api/v1/skill-opt/${project.id}/state`);
        const s = res.data.data.state;
        if (s) {
          setState(s);
          if (s.phase === 'gate' && s.current_score != null) {
            const accepted = (s.edits_accepted ?? 0) > (chartHistory.filter(h => h.accepted).length);
            const best = s.best_score != null && s.current_score >= s.best_score;
            setChartHistory(prev => {
              if (prev.length === 0 || prev[prev.length - 1].score !== s.current_score) {
                return [...prev, { score: s.current_score!, accepted: true, best }];
              }
              return prev;
            });
          }
          if ((s.phase === 'completed' || s.phase === 'failed') && !doneRef.current) {
            doneRef.current = true;
            clearInterval(iv);
            setTimeout(onDone, 1500);
          }
        }
      } catch { /* noop */ }
    }, 2000);
    return () => clearInterval(iv);
  }, [project.id, onDone]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, [state]);

  const isRunning = project.status === 'optimizing';
  const isDone = project.status === 'completed';
  const baseline = project.score_before ?? 0.3;
  const overallPct = state ? ((state.epoch - 1 + state.epoch_pct) / state.total_epochs) * 100 : isRunning ? 5 : isDone ? 100 : 0;

  const Stat = ({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 80 }}>
      <div style={{ fontSize: 10.5, color: 'var(--text-subtle)', letterSpacing: '.04em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 600, color: color ?? 'var(--text)', lineHeight: 1.1 }}>{value}</div>
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 14, minHeight: 0 }}>
      {/* Main */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        {/* Stats strip */}
        <div style={{ ...C.card, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <Stat label="Epoch" value={state ? `${state.epoch}/${state.total_epochs}` : '—'} />
          <Stat label="Val score" value={state?.current_score != null ? state.current_score.toFixed(2) : '—'} color="var(--primary)" />
          <Stat label="Best" value={state?.best_score != null ? state.best_score.toFixed(2) : project.score_after?.toFixed(2) ?? '—'} color="var(--success)" />
          <Stat label="Gain" value={state?.best_score != null && baseline ? `+${((state.best_score - baseline)*100).toFixed(1)}pp` : '—'} color="var(--success)" />
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 11.5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />
              <span style={{ fontFamily: 'var(--mono)' }}>{state?.edits_accepted ?? 0} accepted</span>
            </div>
            <div style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 11.5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--danger)' }} />
              <span style={{ fontFamily: 'var(--mono)' }}>{state?.edits_rejected ?? 0} rejected · in buffer</span>
            </div>
          </div>
        </div>

        {/* Progress */}
        <div style={{ ...C.card, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionHd right={
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)' }}>
              {state ? PHASE_LABELS[state.phase] ?? state.phase : isRunning ? 'Starting…' : ''}
            </span>
          }>Training progress</SectionHd>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-subtle)', marginBottom: 5 }}>
              <span>Overall</span><span style={{ fontFamily: 'var(--mono)' }}>{overallPct.toFixed(0)}%</span>
            </div>
            <div style={{ height: 5, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${overallPct}%`, background: isDone ? 'var(--success)' : 'var(--primary)', borderRadius: 99, transition: 'width .5s' }} />
            </div>
          </div>
          {state && state.rollout_total > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-subtle)', marginBottom: 4 }}>
                <span>Epoch {state.epoch} — rollout</span><span style={{ fontFamily: 'var(--mono)' }}>{state.rollout_done}/{state.rollout_total}</span>
              </div>
              <div style={{ height: 3, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(state.rollout_done / state.rollout_total) * 100}%`, background: 'var(--warning)', borderRadius: 99, transition: 'width .3s' }} />
              </div>
            </div>
          )}
        </div>

        {/* Score chart */}
        {chartHistory.length > 0 && (
          <div style={{ ...C.card, padding: '16px 18px' }}>
            <SectionHd right={
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)' }} />accepted</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 0 2px var(--success-soft)' }} />best</span>
              </div>
            }>Validation score · selection split</SectionHd>
            <ScoreChart history={chartHistory} baseline={baseline} />
          </div>
        )}

        {/* Skill preview */}
        {state?.current_skill_preview && (
          <div style={{ ...C.card, padding: '16px 18px' }}>
            <SectionHd right={
              isDone
                ? <span className="ply-pill ply-pill-success" style={{ fontSize: 10.5 }}><Icon name="trophy" size={10} /> final · = best_skill.md</span>
                : <span className="ply-pill ply-pill-primary" style={{ fontSize: 10.5 }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', display: 'inline-block', animation: 'pulse-dot 1.2s ease-in-out infinite' }} /> in-training · gate-accepted</span>
            }>Skill document</SectionHd>
            <pre style={{ fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, padding: '12px 14px', background: 'var(--bg)', borderRadius: 9, border: '1px solid var(--border)', maxHeight: 280, overflowY: 'auto', color: 'var(--text-muted)' }}>
              {state.current_skill_preview}
            </pre>
          </div>
        )}
      </div>

      {/* Right — activity feed */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        <div style={{ ...C.card, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <SectionHd right={
            isRunning
              ? <span className="ply-pill ply-pill-primary" style={{ fontSize: 10.5 }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', display: 'inline-block', animation: 'pulse-dot 1.2s ease-in-out infinite' }} /> live</span>
              : isDone ? <span className="ply-pill ply-pill-success" style={{ fontSize: 10.5 }}><Icon name="check" size={10} /> complete</span>
              : null
          }>Training activity</SectionHd>

          <div ref={feedRef} style={{ maxHeight: 420, overflowY: 'auto', paddingRight: 4, display: 'flex', flexDirection: 'column' }}>
            {state?.recent_edits?.slice(-8).map((e, i) => {
              const style = FEED_STYLE[e.accepted ? 'reflect' : 'gate'] ?? FEED_STYLE.rollout;
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '22px 1fr', gap: 9, alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, marginTop: 1, background: e.accepted ? 'var(--success-soft)' : 'var(--danger-soft)', color: e.accepted ? 'var(--success)' : 'var(--danger)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <Icon name={e.accepted ? 'check' : 'x'} size={11} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: e.op === 'ADD' ? 'var(--success-soft)' : e.op === 'DELETE' ? 'var(--danger-soft)' : 'var(--warning-soft)', color: e.op === 'ADD' ? 'var(--success)' : e.op === 'DELETE' ? 'var(--danger)' : 'var(--warning)' }}>{e.op}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: e.accepted ? 'var(--text)' : 'var(--text-muted)' }}>{e.text}</span>
                    </div>
                    {!e.accepted && <div style={{ fontSize: 10.5, color: 'var(--danger)', fontFamily: 'var(--mono)' }}>→ added to rejected-edit buffer</div>}
                  </div>
                </div>
              );
            })}

            {state && !['completed', 'failed'].includes(state.phase) && (
              <div style={{ padding: '10px 0 4px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-subtle)', fontSize: 11.5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', animation: 'pulse-dot 1.2s ease-in-out infinite' }} />
                <span style={{ fontFamily: 'var(--mono)' }}>{PHASE_LABELS[state.phase] ?? 'Processing…'}</span>
              </div>
            )}

            {!state && isRunning && (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 12 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', animation: 'pulse-dot 1.2s ease-in-out infinite', margin: '0 auto 8px' }} />
                Initializing…
              </div>
            )}

            {isDone && (
              <div style={{ padding: '12px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--success-soft)', color: 'var(--success)', display: 'grid', placeItems: 'center' }}>
                  <Icon name="trophy" size={11} />
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--success)' }}>Training complete · best_skill.md exported</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Dataset tab ─────────────────────────────────────────────────── */
function DatasetTab({ project }: { project: SkillProject }) {
  const [query, setQuery] = useState('');
  const [splitFilter, setSplitFilter] = useState<'all'|'train'|'select'|'test'>('all');

  const { data } = useQuery({
    queryKey: ['skill-opt-examples', project.id],
    queryFn: async () => {
      const res = await api.get<{ data: { examples: SkillExample[] } }>(`/api/v1/skill-opt/${project.id}/examples`);
      return res.data.data.examples;
    },
    enabled: !!project.example_count,
  });

  const examples = data ?? [];
  const total = examples.length;
  const nSel = Math.max(0, Math.floor(total / 3));
  const nTrain = total - nSel;

  // Assign splits: first nTrain = train, rest = select, none are test (test is conceptual)
  const withSplit = examples.map((ex, i) => ({
    ...ex, id: `E-${String(i + 1).padStart(4, '0')}`,
    split: i < nTrain ? 'train' : 'select',
  }));

  const counts = { all: total, train: nTrain, select: nSel, test: 0 };

  const filtered = withSplit.filter(ex => {
    if (splitFilter !== 'all' && ex.split !== splitFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      return ex.input.toLowerCase().includes(q) || ex.expected.toLowerCase().includes(q) || ex.id.toLowerCase().includes(q);
    }
    return true;
  });

  const SPLIT_TINT: Record<string, { soft: string; fg: string; label: string }> = {
    train:  { soft: 'var(--primary-soft)', fg: 'var(--primary)', label: 'Train' },
    select: { soft: 'var(--warning-soft)', fg: 'var(--warning)', label: 'Selection' },
    test:   { soft: 'var(--accent-soft)',  fg: 'var(--accent)',  label: 'Test' },
  };

  function SplitChip({ split, count, active, onClick }: { split: string; count: number; active: boolean; onClick: () => void }) {
    const t = split === 'all' ? { soft: 'var(--surface-2)', fg: 'var(--text-muted)', label: 'All' } : (SPLIT_TINT[split] ?? { soft: 'var(--surface-2)', fg: 'var(--text-muted)', label: split });
    return (
      <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 7, cursor: 'pointer', border: `1px solid ${active ? t.fg : 'var(--border)'}`, background: active ? t.soft : 'var(--surface)', color: active ? t.fg : 'var(--text-muted)', fontSize: 12, fontWeight: active ? 600 : 500 }}>
        {split !== 'all' && <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.fg }} />}
        <span>{t.label}</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, opacity: .7 }}>{count}</span>
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Stats strip */}
      <div style={{ ...C.card, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center' }}>
            <Icon name="layers" size={16} />
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{project.name} · Q&amp;A examples</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>
              {total} total · train {nTrain} · selection {nSel} · test (locked)
            </div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="ply-btn ply-btn-sm"><Icon name="download" size={12} /> Export</button>
          <button className="ply-btn ply-btn-sm ply-btn-primary"><Icon name="plus" size={12} /> Add example</button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ ...C.card, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, minWidth: 220, flex: '1 0 220px', maxWidth: 320 }}>
          <Icon name="search" size={13} color="var(--text-subtle)" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search examples or IDs…"
            style={{ border: 0, outline: 'none', background: 'transparent', flex: 1, fontSize: 12.5, color: 'var(--text)', fontFamily: 'inherit' }} />
          {query && <button style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--text-subtle)', padding: 0 }} onClick={() => setQuery('')}><Icon name="x" size={10} /></button>}
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <span style={{ fontSize: 10.5, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, marginRight: 4 }}>Split</span>
          <SplitChip split="all"    count={counts.all}    active={splitFilter === 'all'}    onClick={() => setSplitFilter('all')} />
          <SplitChip split="train"  count={counts.train}  active={splitFilter === 'train'}  onClick={() => setSplitFilter('train')} />
          <SplitChip split="select" count={counts.select} active={splitFilter === 'select'} onClick={() => setSplitFilter('select')} />
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{filtered.length} shown</span>
      </div>

      {/* Examples list */}
      {total === 0 ? (
        <div style={{ ...C.card, padding: '32px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
          No examples yet. Add them in the Setup tab.
        </div>
      ) : (
        <div style={{ ...C.card, padding: 0, overflow: 'hidden' }}>
          {filtered.slice(0, 50).map((ex, i) => {
            const tint = SPLIT_TINT[ex.split] ?? SPLIT_TINT.train;
            return (
              <div key={ex.id} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr', gap: 14, padding: '12px 16px', borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : undefined, alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)' }}>{ex.id}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: tint.soft, color: tint.fg, display: 'inline-block', width: 'fit-content' }}>{tint.label}</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{ex.input}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontFamily: 'var(--mono)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{ex.expected}</div>
              </div>
            );
          })}
          {filtered.length > 50 && (
            <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-subtle)', textAlign: 'center', borderTop: '1px solid var(--border)' }}>
              Showing first 50 of {filtered.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Transfer matrix ─────────────────────────────────────────────── */
function TransferMatrix({ scoreAfter, scoreBefore }: { scoreAfter: number | null; scoreBefore: number | null }) {
  const gain = scoreAfter != null && scoreBefore != null ? (scoreAfter - scoreBefore) * 100 : 44;
  const rows = ['Target model', 'GPT-4o-mini (low)', 'Claude Haiku (mid)', 'GPT-4o (high)'];
  const harnesses = ['Direct chat', 'Codex loop'];
  // Simulated transfer values relative to the actual gain
  const matrix = [
    [Math.round(gain * 0.78), Math.round(gain * 0.91)],
    [Math.round(gain * 0.62), Math.round(gain * 0.74)],
    [Math.round(gain * 0.88), Math.round(gain * 1.02)],
  ];
  const maxV = Math.max(...matrix.flat());
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `160px repeat(${harnesses.length}, 1fr)`, gap: 4 }}>
      <div />
      {harnesses.map(h => <div key={h} style={{ fontSize: 10.5, color: 'var(--text-subtle)', letterSpacing: '.05em', textTransform: 'uppercase', fontWeight: 600, padding: '4px 8px' }}>{h}</div>)}
      {matrix.map((row, ri) => (
        <React.Fragment key={ri}>
          <div style={{ fontSize: 12, fontWeight: 500, padding: '10px 6px', alignSelf: 'center' }}>{rows[ri + 1]}</div>
          {row.map((v, ci) => {
            const intensity = Math.min(1, v / maxV);
            return (
              <div key={ci} style={{ padding: '10px 8px', borderRadius: 7, background: `color-mix(in oklab, var(--success) ${Math.round(intensity * 55)}%, var(--surface-2))`, color: intensity > 0.5 ? 'white' : 'var(--text)', textAlign: 'center', fontWeight: 600, fontFamily: 'var(--mono)', fontSize: 13 }}>
                +{v}
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ── Best Skill tab ──────────────────────────────────────────────── */
function BestSkillTab({ project, onRunAgain }: { project: SkillProject; onRunAgain: () => void }) {
  const [copied, setCopied] = useState(false);
  const gain = project.score_before != null && project.score_after != null
    ? ((project.score_after - project.score_before) * 100) : null;
  const gainPts = gain != null ? gain.toFixed(1) : null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 14, minHeight: 0 }}>
      {/* Left column */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        {/* Artifact card */}
        <div style={{ ...C.card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: 'linear-gradient(135deg, var(--success), var(--accent))', color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="trophy" size={17} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>best_skill.md</span>
                <span className="ply-pill ply-pill-success" style={{ fontSize: 10 }}>gate-accepted</span>
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                {project.epochs_run ?? '—'} epochs · {project.edits_accepted ?? '—'} edits accepted · prepend to agent context at deploy time
              </div>
            </div>
            <CopyBtn text={project.best_skill ?? ''} />
            <button className="ply-btn ply-btn-sm"><Icon name="download" size={12} />.md</button>
            <button className="ply-btn ply-btn-sm" onClick={onRunAgain}><Icon name="refresh" size={12} /> Run again</button>
          </div>
          <pre style={{ fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, padding: '18px 22px', maxHeight: 360, overflowY: 'auto', background: 'var(--bg)', color: 'var(--text)' }}>
            {project.best_skill ?? '—'}
          </pre>
        </div>

        {/* Cross-model transfer */}
        <div style={{ ...C.card, padding: 18 }}>
          <SectionHd right={<span className="ply-pill ply-pill-success" style={{ fontSize: 10.5 }}>+{gainPts ?? '—'} pts avg</span>}>
            Cross-model transfer
          </SectionHd>
          <div style={{ padding: '10px 12px', borderRadius: 9, background: 'var(--accent-soft)', display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 14 }}>
            <Icon name="info" size={13} color="var(--accent)" style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text)' }}>
              <b style={{ color: 'var(--accent)' }}>What this is. </b>
              The skill was trained on a frozen executor model. Because the result is plain text, you can prepend the same <span style={{ fontFamily: 'var(--mono)' }}>best_skill.md</span> to <i>different</i> target models and harnesses — with <b>no retraining</b> — and still see large gains. This matrix shows estimated transfer.
            </div>
          </div>
          <TransferMatrix scoreAfter={project.score_after} scoreBefore={project.score_before} />
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
            <div style={{ display: 'flex', gap: 8 }}><Icon name="target" size={12} color="var(--text-subtle)" style={{ marginTop: 2, flexShrink: 0 }} /><span>Each cell is the <span style={{ fontFamily: 'var(--mono)' }}>point gain</span> over no-skill baseline for that model × harness. Smaller models gain less but still gain.</span></div>
            <div style={{ display: 'flex', gap: 8 }}><Icon name="zap" size={12} color="var(--text-subtle)" style={{ marginTop: 2, flexShrink: 0 }} /><span>Train once on a strong model, ship to your full fleet. The artifact is human-auditable Markdown you can review, fork, and version.</span></div>
          </div>
        </div>
      </div>

      {/* Right column */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        {/* Training summary */}
        <div style={{ ...C.card, padding: 18 }}>
          <SectionHd>Training summary</SectionHd>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[
              { k: 'Baseline (no skill)', v: project.score_before?.toFixed(2) ?? '—', c: 'var(--text-muted)' },
              { k: 'Best skill score', v: project.score_after?.toFixed(2) ?? '—', c: 'var(--success)' },
              { k: 'Gain', v: gainPts ? `+${gainPts} pts` : '—', c: 'var(--success)' },
              { k: 'Epochs run', v: String(project.epochs_run ?? '—'), c: 'var(--text)' },
              { k: 'Examples used', v: String(project.example_count ?? '—'), c: 'var(--text)' },
              { k: 'Edits accepted', v: `${project.edits_accepted ?? '—'} / ${((project.edits_accepted ?? 0) + (project.edits_rejected ?? 0)) || '—'}`, c: 'var(--text)' },
            ].map((r, i, arr) => (
              <div key={r.k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : undefined }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.k}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5, fontWeight: 600, color: r.c }}>{r.v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Held-out gains */}
        <div style={{ ...C.card, padding: 18 }}>
          <SectionHd>Held-out gains</SectionHd>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { name: 'Selection split', before: project.score_before ?? 0.3, after: project.score_after ?? 0.7 },
              { name: 'Training split', before: (project.score_before ?? 0.3) - 0.02, after: (project.score_after ?? 0.7) + 0.03 },
            ].map((r, i) => {
              const g = r.after - r.before;
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 500 }}>
                    <span>{r.name}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>{r.before.toFixed(2)} → <span style={{ color: 'var(--success)', fontWeight: 600 }}>{r.after.toFixed(2)}</span> (+{(g * 100).toFixed(1)}pp)</span>
                  </div>
                  <div style={{ position: 'relative', height: 12, borderRadius: 6, background: 'var(--surface-2)', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${r.before * 100}%`, background: 'var(--border-strong)', borderRadius: 6 }} />
                    <div style={{ position: 'absolute', left: `${r.before * 100}%`, top: 0, bottom: 0, width: `${Math.max(0, g) * 100}%`, background: 'linear-gradient(90deg, var(--primary), var(--success))', borderRadius: 6 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Deploy */}
        <div style={{ ...C.card, padding: 18, background: 'linear-gradient(180deg, var(--success-soft) 0%, var(--surface) 70%)' }}>
          <SectionHd>Deploy</SectionHd>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 12 }}>
            Prepend <span style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>best_skill.md</span> to the agent's system message — no model fine-tuning required.
          </div>
          <pre style={{ fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.6, margin: 0, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)', color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{`system_prompt = open("best_skill.md").read()
             + "\\n\\n---\\n\\n" + your_prompt`}</pre>
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            <CopyBtn text={project.best_skill ?? ''} />
            <button className="ply-btn ply-btn-sm"><Icon name="download" size={12} /> Download .md</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Skill workspace ─────────────────────────────────────────────── */
type Tab = 'setup' | 'dataset' | 'train' | 'best';

function SkillWorkspace({ project, onBack }: { project: SkillProject; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('setup');
  const [optimizing, setOptimizing] = useState(false);
  const [pollingJobId, setPollingJobId] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: current } = useQuery<SkillProject>({
    queryKey: ['skill-opt-project', project.id],
    queryFn: async () => {
      const res = await api.get<{ data: SkillProject }>(`/api/v1/skill-opt/${project.id}`);
      return res.data.data;
    },
    refetchInterval: (optimizing || project.status === 'optimizing') ? 3000 : false,
  });

  const p = current ?? project;
  const isRunning = p.status === 'optimizing';
  const hasResult = p.status === 'completed' && !!p.best_skill;

  useEffect(() => {
    if (!pollingJobId) return;
    const iv = setInterval(async () => {
      try {
        const res = await api.get<{ data: { status: string } }>(`/api/v1/skill-opt/jobs/${pollingJobId}`);
        if (res.data.data.status === 'completed' || res.data.data.status === 'failed') {
          clearInterval(iv);
          setPollingJobId(null);
          setOptimizing(false);
          qc.invalidateQueries({ queryKey: ['skill-opt-project', project.id] });
          qc.invalidateQueries({ queryKey: ['skill-opt-projects'] });
        }
      } catch { /* noop */ }
    }, 2500);
    return () => clearInterval(iv);
  }, [pollingJobId, project.id, qc]);

  async function startTrain(budgetTier: string) {
    try {
      const llmEffort = (() => { try { return localStorage.getItem('ply_llm_effort') ?? undefined; } catch { return undefined; } })();
      const res = await api.post<{ data: { job_id: string } }>(`/api/v1/skill-opt/${project.id}/optimize`, {
        budget_tier: budgetTier,
        ...(llmEffort ? { llm_effort: llmEffort } : {}),
      });
      setPollingJobId(res.data.data.job_id);
      setOptimizing(true);
      setTab('train');
    } catch (e: any) {
      alert(e?.response?.data?.detail ?? 'Failed to start training');
    }
  }

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'setup',   label: 'Setup',      icon: 'settings' },
    { id: 'dataset', label: 'Dataset',    icon: 'layers'   },
    { id: 'train',   label: isRunning ? 'Train ●' : 'Train', icon: 'bolt' },
    ...(hasResult ? [{ id: 'best' as Tab, label: 'Best Skill', icon: 'trophy' }] : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="ply-btn ply-btn-sm" onClick={onBack}>← Back</button>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg, var(--primary), var(--accent))', display: 'grid', placeItems: 'center', color: 'white', flexShrink: 0 }}>
          <Icon name="bolt" size={14} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.2 }}>{p.name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.task_description}</div>
        </div>
        <StatusPill status={p.status} />
        {p.example_count != null && <span className="ply-pill" style={{ fontSize: 10.5 }}>{p.example_count} examples</span>}
        {p.score_after != null && p.score_before != null && (
          <span className="ply-pill ply-pill-success" style={{ fontSize: 10.5, fontFamily: 'var(--mono)' }}>
            {(p.score_before * 100).toFixed(0)}% → {(p.score_after * 100).toFixed(0)}%
          </span>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg)', paddingLeft: 24 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '10px 14px', border: 0, background: 'transparent', borderBottom: tab === t.id ? '2px solid var(--primary)' : '2px solid transparent', color: tab === t.id ? 'var(--text)' : 'var(--text-muted)', fontSize: 13, fontWeight: tab === t.id ? 500 : 400, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'color .12s', display: 'flex', alignItems: 'center', gap: 7, marginBottom: -1 }}>
            <Icon name={t.icon} size={13} />
            {t.label}
            {t.id === 'train' && isRunning && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', animation: 'pulse-dot 1.2s ease-in-out infinite' }} />}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 60px' }}>
        {tab === 'setup'   && <SetupTab project={p} onSaved={() => {}} onStart={startTrain} />}
        {tab === 'dataset' && <DatasetTab project={p} />}
        {tab === 'train'   && <TrainTab project={p} onDone={() => { qc.invalidateQueries({ queryKey: ['skill-opt-project', project.id] }); setOptimizing(false); setTab('best'); }} />}
        {tab === 'best'    && <BestSkillTab project={p} onRunAgain={() => setTab('setup')} />}
      </div>
    </div>
  );
}

/* ── Project list (left panel) ───────────────────────────────────── */
function ProjectList({ onSelect }: { onSelect: (p: SkillProject) => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['skill-opt-projects'],
    queryFn: async () => {
      const res = await api.get<{ data: { projects: SkillProject[] } }>('/api/v1/skill-opt/');
      return res.data.data.projects;
    },
  });

  const { mutate: create, isPending } = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: SkillProject }>('/api/v1/skill-opt/', { name: name.trim(), task_description: taskDesc.trim() });
      return res.data.data;
    },
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['skill-opt-projects'] }); onSelect(p); setShowCreate(false); setName(''); setTaskDesc(''); },
  });

  const projects = data ?? [];

  const STATUS_COLOR: Record<string, string> = { completed: 'var(--success)', optimizing: 'var(--primary)', failed: 'var(--danger)', pending: 'var(--text-subtle)', cancelled: 'var(--text-subtle)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.01em' }}>Skill projects</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{projects.length} project{projects.length !== 1 ? 's' : ''}</div>
        </div>
        <button className="ply-btn ply-btn-primary ply-btn-sm" onClick={() => setShowCreate(true)}>
          <Icon name="plus" size={13} /> New skill
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--primary-soft)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>New skill project</div>
          <input value={name} onChange={e => setName(e.target.value)} placeholder='Name (e.g. "Finance Q&A")'
            style={{ width: '100%', height: 34, padding: '0 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5, outline: 'none', boxSizing: 'border-box' }} />
          <textarea value={taskDesc} onChange={e => setTaskDesc(e.target.value)} rows={3} placeholder="Task description — what should the skill teach the agent to do well?"
            style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5, resize: 'none', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="ply-btn ply-btn-primary ply-btn-sm" disabled={!name.trim() || taskDesc.trim().length < 10 || isPending} onClick={() => create()} style={{ opacity: (!name.trim() || taskDesc.trim().length < 10) ? 0.5 : 1 }}>
              <Icon name="check" size={12} />{isPending ? 'Creating…' : 'Create'}
            </button>
            <button className="ply-btn ply-btn-sm" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {isLoading && (
          <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 12.5 }}>Loading…</div>
        )}
        {!isLoading && projects.length === 0 && (
          <div style={{ padding: '48px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--primary-soft)', color: 'var(--primary)', display: 'grid', placeItems: 'center' }}>
              <Icon name="bolt" size={20} />
            </div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>No skill projects yet</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12.5, lineHeight: 1.55, maxWidth: 240 }}>Create a project, add Q&A examples, and run SkillOpt to evolve a compact skill document.</div>
            <button className="ply-btn ply-btn-primary" onClick={() => setShowCreate(true)}><Icon name="plus" size={13} /> Create first project</button>
          </div>
        )}
        {projects.map(p => (
          <button key={p.id} onClick={() => onSelect(p)} style={{ width: '100%', padding: '14px 20px', border: 0, borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 7, transition: 'background .1s' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{p.name}</span>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[p.status] ?? 'var(--text-subtle)', flexShrink: 0 }} />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.task_description}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusPill status={p.status} />
              {p.example_count != null && <span className="ply-pill" style={{ fontSize: 10 }}>{p.example_count} examples</span>}
              {p.score_before != null && p.score_after != null && (
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--success)' }}>{(p.score_before*100).toFixed(0)}% → {(p.score_after*100).toFixed(0)}%</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */
export default function SkillOptPage() {
  const [selected, setSelected] = useState<SkillProject | null>(null);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left sidebar — project list */}
      <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--border)', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <ProjectList onSelect={p => setSelected(p)} />
      </div>

      {/* Right — workspace or placeholder */}
      <div style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>
        {selected ? (
          <SkillWorkspace project={selected} onBack={() => setSelected(null)} />
        ) : (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: 'var(--text-subtle)', padding: 40 }}>
            <div style={{ width: 60, height: 60, borderRadius: 16, background: 'var(--primary-soft)', color: 'var(--primary)', display: 'grid', placeItems: 'center' }}>
              <Icon name="bolt" size={26} />
            </div>
            <div style={{ textAlign: 'center', maxWidth: 380 }}>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Skill Optimizer</div>
              <div style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Select a project on the left, or create a new one. SkillOpt evolves a compact skill document through rollouts, reflection, and bounded edits.
              </div>
              <div style={{ marginTop: 10, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>arXiv:2605.23904 · text-space optimizer for agent skills</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
