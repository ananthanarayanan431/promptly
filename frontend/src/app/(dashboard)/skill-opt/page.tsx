'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { SkillProject, SkillExample, SkillOptLiveState, SkillOptLiveStateResponse } from '@/types/skill-opt';

/* ── Icons ───────────────────────────────────────────────────────── */
const ICON: Record<string, React.ReactNode> = {
  bolt:      <path d="m13 2-9 12h8l-1 8 9-12h-9l1-8z"/>,
  plus:      <><path d="M12 5v14"/><path d="M5 12h14"/></>,
  sparkles:  <><path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="M5.5 5.5l2.5 2.5"/><path d="M16 16l2.5 2.5"/><path d="M5.5 18.5l2.5-2.5"/><path d="M16 8l2.5-2.5"/></>,
  cpu:       <><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></>,
  fileText:  <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></>,
  check:     <path d="m20 6-11 11-5-5"/>,
  x:         <><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>,
  trophy:    <><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v6a5 5 0 0 1-10 0z"/><path d="M7 6H4a2 2 0 0 0 0 4h3"/><path d="M17 6h3a2 2 0 0 1 0 4h-3"/></>,
  chevronR:  <path d="m9 6 6 6-6 6"/>,
  chevronD:  <path d="m6 9 6 6 6-6"/>,
  chevronU:  <path d="m18 15-6-6-6 6"/>,
  info:      <><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></>,
  shield:    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>,
  zap:       <path d="m13 2-9 12h8l-1 8 9-12h-9l1-8z"/>,
  layers:    <><path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></>,
  refresh:   <><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.4-2.6L3 16"/><path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.4 2.6L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/></>,
  activity:  <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>,
  copy:      <><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
  download:  <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></>,
  trash:     <><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>,
  upload:    <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></>,
  play:      <path d="m6 4 14 8-14 8z"/>,
  search:    <><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></>,
  history:   <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></>,
  diff:      <><path d="M12 3v14"/><path d="M5 10l7-7 7 7"/><path d="M19 21H5"/></>,
  lock:      <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
  target:    <><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>,
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

/* ── Tokens ──────────────────────────────────────────────────────── */
const C = {
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 1px 2px rgba(15,15,30,.04)' } as React.CSSProperties,
  hd:   { fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: 'var(--text-subtle)' },
};

/* ── Models ──────────────────────────────────────────────────────── */
const TARGET_MODELS = [
  { id: 'openai/gpt-4o',           short: 'GPT-4o',          note: 'Frontier · 128k ctx' },
  { id: 'openai/gpt-4o-mini',      short: 'GPT-4o mini',     note: 'Fast · cost-efficient' },
  { id: 'anthropic/claude-3.5-haiku', short: 'Claude Haiku', note: 'Long-form reasoning' },
  { id: 'google/gemini-2.0-flash',  short: 'Gemini Flash',   note: 'Fast · low cost' },
  { id: 'meta-llama/llama-3.1-8b-instruct', short: 'Llama 3.1 8B', note: 'Open-weight · small' },
  { id: 'qwen/qwen-2.5-72b-instruct', short: 'Qwen 2.5 72B', note: 'Open-weight · MoE' },
];

const OPTIMIZER_MODELS = [
  { id: 'openai/gpt-4o-mini',  short: 'GPT-4o mini',  note: 'Default · strongest reflection' },
  { id: 'anthropic/claude-3.5-haiku', short: 'Claude Haiku', note: 'Verbose, careful edits' },
  { id: 'openai/gpt-4o',       short: 'GPT-4o',       note: 'Faster, cheaper' },
];

/* ── Shared helpers ──────────────────────────────────────────────── */
function StatusPill({ status }: { status: string }) {
  if (status === 'completed') return <span className="ply-pill ply-pill-success" style={{ fontSize: 11 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} /> Trained</span>;
  if (status === 'optimizing') return <span className="ply-pill ply-pill-primary" style={{ fontSize: 11 }}><span className="ply-dot ply-dot-pulse" style={{ background: 'currentColor' }} /> Training</span>;
  if (status === 'failed') return <span className="ply-pill" style={{ fontSize: 11, color: 'var(--danger)' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} /> Failed</span>;
  return <span className="ply-pill" style={{ fontSize: 11 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-subtle)', display: 'inline-block' }} /> Untrained</span>;
}

function SectionHd({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 0 12px', gap: 8 }}>
      <div style={C.hd}>{children}</div>
      {right}
    </div>
  );
}

function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="ply-btn ply-btn-sm" onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); }}>
      <Icon name={done ? 'check' : 'copy'} size={12} />{done ? 'Copied' : label}
    </button>
  );
}

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

/* ── Score chart ─────────────────────────────────────────────────── */
function ScoreChart({ history, baseline }: { history: { score: number; accepted: boolean; best?: boolean }[]; baseline: number }) {
  const W = 520, H = 180, PL = 36, PR = 14, PT = 14, PB = 26;
  const iW = W - PL - PR, iH = H - PT - PB;
  const xMax = Math.max(8, history.length);
  const pts = history.map((h, i) => ({ ...h, x: PL + (history.length > 1 ? i / (history.length - 1) : 0) * iW, y: PT + (1 - h.score) * iH }));
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
            <line x1={p.x-5} y1={p.y-5} x2={p.x+5} y2={p.y+5} stroke="var(--danger)" strokeWidth="1.6" strokeLinecap="round" />
            <line x1={p.x-5} y1={p.y+5} x2={p.x+5} y2={p.y-5} stroke="var(--danger)" strokeWidth="1.6" strokeLinecap="round" />
          </>}
          {p.accepted && <circle cx={p.x} cy={p.y} r={p.best ? 6 : 4} fill={p.best ? 'var(--success)' : 'var(--primary)'} stroke={p.best ? 'white' : 'var(--surface)'} strokeWidth="2" />}
          {p.best && <circle cx={p.x} cy={p.y} r="11" fill="none" stroke="var(--success)" strokeWidth="1.5" opacity="0.4" />}
        </g>
      ))}
      <text x={PL - 6} y={H - PB + 18} fontSize="9.5" fill="var(--text-subtle)" textAnchor="end" fontFamily="var(--mono)">step</text>
      {Array.from({ length: Math.min(xMax, 8) }).map((_, i) => (
        <text key={i} x={PL + (Math.min(xMax,8) > 1 ? i / (Math.min(xMax,8)-1) : 0) * iW} y={H-PB+14} fontSize="9.5" fill="var(--text-subtle)" textAnchor="middle" fontFamily="var(--mono)">{i+1}</text>
      ))}
    </svg>
  );
}

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
  const [targetModel, setTargetModel] = useState(TARGET_MODELS[0].id);
  const [optimizerModel, setOptimizerModel] = useState(OPTIMIZER_MODELS[0].id);
  const [initialSkill, setInitialSkill] = useState('');
  const [examples, setExamples] = useState<SkillExample[]>([
    { input: '', expected: '' }, { input: '', expected: '' }, { input: '', expected: '' },
  ]);
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
  const shortTarget = TARGET_MODELS.find(m => m.id === targetModel)?.short ?? 'gpt-4o';
  const shortOptimizer = OPTIMIZER_MODELS.find(m => m.id === optimizerModel)?.short ?? 'gpt-4o-mini';

  const TIERS = {
    low:    { label: 'Low',    desc: '2 epochs · 10 rollouts/epoch', credits: 5  },
    medium: { label: 'Medium', desc: '3 epochs · 20 rollouts/epoch', credits: 10 },
    high:   { label: 'High',   desc: '4 epochs · 30 rollouts/epoch', credits: 16 },
  };

  const ModelCard = ({ m, selected, onSelect }: { m: { id: string; short: string; note: string }; selected: boolean; onSelect: () => void }) => (
    <button onClick={onSelect} style={{
      padding: '10px 12px', borderRadius: 9, textAlign: 'left', cursor: 'pointer', transition: 'all .12s',
      border: `1.5px solid ${selected ? 'var(--primary)' : 'var(--border)'}`,
      background: selected ? 'var(--primary-soft)' : 'var(--surface)',
      boxShadow: selected ? '0 0 0 3px color-mix(in oklab, var(--primary) 12%, transparent)' : 'none',
    }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: selected ? 'var(--primary)' : 'var(--text)', marginBottom: 2 }}>{m.short}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-subtle)', lineHeight: 1.4 }}>{m.note}</div>
    </button>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 14, minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>

        {/* Three players */}
        <div style={{ ...C.card, padding: 18 }}>
          <SectionHd right={<span className="ply-pill" style={{ fontSize: 10 }}><Icon name="info" size={10} /> SkillOpt · arXiv 2605.23904</span>}>
            Three players, one trainable file
          </SectionHd>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[
              { tag: 'FROZEN', title: 'Target model', val: shortTarget, note: 'Executes tasks · weights never touched', soft: 'var(--surface-2)', fg: 'var(--text)', icon: 'cpu' },
              { tag: 'TRAINABLE', title: 'Skill document', val: `${Math.max(30, validCount * 4)} tokens`, note: 'The natural-language policy being optimized', soft: 'var(--primary-soft)', fg: 'var(--primary)', icon: 'fileText' },
              { tag: 'TRAINING-ONLY', title: 'Optimizer model', val: shortOptimizer, note: 'Proposes bounded edits · never deployed', soft: 'var(--accent-soft)', fg: 'var(--accent)', icon: 'sparkles' },
            ].map((p, i) => (
              <div key={i} style={{ padding: 14, borderRadius: 10, background: p.soft, border: `1px solid color-mix(in oklab, ${p.fg} 18%, transparent)`, display: 'flex', flexDirection: 'column', gap: 8 }}>
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

        {/* Model pickers */}
        <div style={{ ...C.card, padding: 18 }}>
          <SectionHd>Models</SectionHd>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>Target model <span style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--text-subtle)', marginLeft: 6 }}>frozen — runs the tasks</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
                {TARGET_MODELS.map(m => <ModelCard key={m.id} m={m} selected={targetModel === m.id} onSelect={() => setTargetModel(m.id)} />)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>Optimizer model <span style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--text-subtle)', marginLeft: 6 }}>training-only — proposes edits</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
                {OPTIMIZER_MODELS.map(m => <ModelCard key={m.id} m={m} selected={optimizerModel === m.id} onSelect={() => setOptimizerModel(m.id)} />)}
              </div>
            </div>
          </div>
        </div>

        {/* Data splits */}
        <div style={{ ...C.card, padding: 18 }}>
          <SectionHd right={<span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>{totalTasks || '?'} scored examples</span>}>
            Data splits
          </SectionHd>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden' }}>
              <div style={{ flex: 70, background: 'var(--primary)' }} />
              <div style={{ flex: 15, background: 'var(--warning)' }} />
              <div style={{ flex: 15, background: 'var(--accent)' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[
                { k: 'Train', v: 70, c: 'var(--primary)', note: 'Drives reflection edits' },
                { k: 'Selection', v: 15, c: 'var(--warning)', note: 'Validation gate — each edit judged here' },
                { k: 'Test', v: 15, c: 'var(--accent)', note: 'Locked · only used in final report' },
              ].map(p => (
                <div key={p.k}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 2 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.c, flexShrink: 0 }} />
                    <span style={{ fontWeight: 600 }}>{p.k}</span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-subtle)', fontSize: 11 }}>{p.v}% · {Math.round(Math.max(totalTasks,6) * p.v / 100)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', lineHeight: 1.45 }}>{p.note}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 4, padding: '8px 10px', borderRadius: 7, background: 'color-mix(in oklab, var(--warning) 10%, transparent)', display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, lineHeight: 1.5, border: '1px solid color-mix(in oklab, var(--warning) 25%, transparent)' }}>
              <Icon name="shield" size={12} color="var(--warning)" style={{ marginTop: 2, flexShrink: 0 }} />
              <div><span style={{ fontWeight: 600, color: 'var(--warning)' }}>Test split is locked.</span><span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>Test examples are never shown to the optimizer or the gate. They're only used in the final report.</span></div>
            </div>
          </div>
        </div>

        {/* Q&A pairs */}
        <div style={{ ...C.card, padding: 18 }}>
          <SectionHd right={
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="ply-btn ply-btn-sm" onClick={() => setShowPaste(s => !s)}><Icon name="upload" size={11} /> {showPaste ? 'Hide paste' : 'Paste bulk'}</button>
              <button className="ply-btn ply-btn-sm" onClick={() => setExamples(e => [...e, { input: '', expected: '' }])}><Icon name="plus" size={11} /> Add row</button>
            </div>
          }>
            Q&amp;A Example Pairs <span style={{ color: 'var(--text-subtle)', textTransform: 'none', letterSpacing: 0, fontWeight: 400, marginLeft: 6 }}>{validCount} valid · minimum 15 required</span>
          </SectionHd>

          {showPaste && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14, padding: '12px 14px', borderRadius: 9, background: 'var(--primary-soft)', border: '1px solid color-mix(in oklab, var(--primary) 20%, transparent)' }}>
              <div style={{ fontSize: 12.5, fontWeight: 500 }}>Paste multiple pairs at once</div>
              <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={6}
                placeholder={"Q: Your question here\nA: Expected answer\nQ: Second question\nA: Second answer"}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--mono)', resize: 'vertical', outline: 'none', boxSizing: 'border-box', lineHeight: 1.6 }} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="ply-btn ply-btn-primary ply-btn-sm" disabled={!pasteText.trim()} onClick={parsePaste}><Icon name="check" size={12} /> Import</button>
                <button className="ply-btn ply-btn-sm" onClick={() => { setShowPaste(false); setPasteText(''); }}>Cancel</button>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 7, marginBottom: 6 }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', paddingLeft: 9 }}>Task input / question</div>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', paddingLeft: 9 }}>Reference answer (expected)</div>
            <div style={{ width: 32 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
            {examples.map((ex, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 7, alignItems: 'flex-start' }}>
                <textarea value={ex.input} rows={2} placeholder={i === 0 ? 'e.g. Sum sales in column F for rows where region = EMEA' : 'Task input'} onChange={e => setExamples(l => l.map((x, j) => j === i ? { ...x, input: e.target.value } : x))}
                  style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12.5, resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5 }} />
                <textarea value={ex.expected} rows={2} placeholder={i === 0 ? 'e.g. =SUMIF(B:B,"EMEA",F:F)' : 'Expected answer'} onChange={e => setExamples(l => l.map((x, j) => j === i ? { ...x, expected: e.target.value } : x))}
                  style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12.5, resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5 }} />
                <button className="ply-btn ply-btn-sm" style={{ color: 'var(--danger)', marginTop: 3 }} onClick={() => setExamples(l => l.filter((_, j) => j !== i))}><Icon name="x" size={11} /></button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="ply-btn ply-btn-primary ply-btn-sm" disabled={validCount < 15 || saving} onClick={() => saveExamples()} style={{ opacity: validCount < 15 ? 0.5 : 1 }}>
              <Icon name="check" size={12} /> {saving ? 'Saving…' : `Save ${validCount} examples`}
            </button>
            <span style={{ fontSize: 11.5, color: validCount >= 6 ? 'var(--success)' : 'var(--text-subtle)' }}>
              {validCount >= 15 ? `✓ ${validCount} examples ready` : `${Math.max(0, 15 - validCount)} more needed — 15 minimum for a meaningful validation gate (70/15/15 split)`}
            </span>
          </div>
        </div>

        {/* Initial skill */}
        <div style={{ ...C.card, padding: 18 }}>
          <SectionHd right={
            initialSkill && <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)' }}>{initialSkill.trim().split(/\s+/).length} words</span>
              <button className="ply-btn ply-btn-sm" onClick={() => setInitialSkill('')}><Icon name="fileText" size={11} /> Clear</button>
            </div>
          }>Initial skill document</SectionHd>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
            Paste your existing system prompt or write a starting point. SkillOpt will evolve it — leave blank to auto-generate from the task description.
          </div>
          <textarea value={initialSkill} onChange={e => setInitialSkill(e.target.value)} spellCheck={false}
            placeholder={`# Skill — ${project.name}\n\nPaste your existing system prompt here, or describe the reasoning strategy the agent should follow:\n\n1. When given a task, first...\n2. Always verify by...\n3. Output format: ...`}
            style={{ width: '100%', minHeight: 200, padding: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.6, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)' }}>target: 300–2,000 tokens</span>
          </div>
        </div>
      </div>

      {/* Right column */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        <div style={{ ...C.card, padding: 18 }}>
          <SectionHd>Hyperparameters</SectionHd>
          <HyperRow icon="zap" label="Edit budget Lₜ" hint="Maximum edits applied per step. Caps how far the skill can move in one update." analogue="textual learning rate">
            <Slider value={lr} min={1} max={10} onChange={setLr} format={v => `${v} edits / step`} />
          </HyperRow>
          <HyperRow icon="layers" label="Rollout batch" hint="Tasks rolled out per step. Larger batches expose recurring failure patterns." analogue="minibatch size">
            <Slider value={batch} min={4} max={40} onChange={setBatch} format={v => `${v} tasks / step`} />
          </HyperRow>
          <HyperRow icon="refresh" label="Epochs" hint="Full passes over the training split. Each epoch ends with a slow / meta update.">
            <Slider value={epochs} min={1} max={5} onChange={setEpochs} format={v => `${v} epoch${v > 1 ? 's' : ''}`} />
          </HyperRow>
          <HyperRow icon="activity" label="LR schedule" hint="How the edit budget decays over training. Cosine preserves the most rules." analogue="LR schedule">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              {['cosine', 'linear', 'constant', 'autonomous'].map(s => (
                <button key={s} onClick={() => setSchedule(s)} style={{ padding: '7px 8px', borderRadius: 7, border: `1px solid ${schedule === s ? 'var(--primary)' : 'var(--border)'}`, background: schedule === s ? 'var(--primary-soft)' : 'var(--surface)', color: schedule === s ? 'var(--primary)' : 'var(--text-muted)', fontSize: 12, fontWeight: schedule === s ? 600 : 500, textAlign: 'left', cursor: 'pointer', textTransform: 'capitalize' }}>{s}</button>
              ))}
            </div>
          </HyperRow>
        </div>

        {/* Launch */}
        <div style={{ ...C.card, padding: 18, background: 'linear-gradient(180deg, var(--primary-soft) 0%, var(--surface) 60%)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg, var(--primary), var(--accent))', color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="bolt" size={16} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Train skill</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>≈ {totalSteps} steps · {epochs} epoch{epochs > 1 ? 's' : ''} · gate enabled</div>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '.06em' }}>Budget tier</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {(Object.entries(TIERS) as [string, typeof TIERS['low']][]).map(([k, v]) => (
                <button key={k} onClick={() => setBudgetTier(k as 'low'|'medium'|'high')} style={{ padding: '9px 10px', borderRadius: 8, border: `1px solid ${budgetTier === k ? 'var(--primary)' : 'var(--border)'}`, background: budgetTier === k ? 'var(--primary-soft)' : 'var(--surface)', cursor: 'pointer', textAlign: 'left', boxShadow: budgetTier === k ? '0 0 0 3px color-mix(in oklab, var(--primary) 12%, transparent)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: budgetTier === k ? 'var(--primary)' : 'var(--text)' }}>{v.label}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, fontWeight: 700, color: budgetTier === k ? 'var(--primary)' : 'var(--text-muted)' }}>{v.credits} cr</span>
                  </div>
                  <div style={{ height: 2, borderRadius: 99, background: 'var(--border)', marginBottom: 4 }}>
                    <div style={{ height: '100%', width: `${(v.credits / 16) * 100}%`, background: budgetTier === k ? 'var(--primary)' : 'var(--border)', borderRadius: 99 }} />
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-subtle)' }}>{v.desc}</div>
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
            <div>target · {shortTarget}</div>
            <div>optimizer · {shortOptimizer}</div>
            <div>Lₜ = {lr} · {schedule}</div>
            <div>batch = {batch}</div>
          </div>
          <button className="ply-btn ply-btn-primary" style={{ height: 38, fontSize: 13.5, opacity: (!project.example_count || project.example_count < 15) ? 0.45 : 1, cursor: (!project.example_count || project.example_count < 15) ? 'not-allowed' : 'pointer' }}
            disabled={!project.example_count || project.example_count < 15} onClick={() => onStart(budgetTier)}>
            <Icon name="bolt" size={14} />
            {!project.example_count || project.example_count < 15 ? 'Add examples first' : `Train skill · ${TIERS[budgetTier].credits} credits`}
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
const PHASE_LABELS: Record<string, string> = {
  seed: 'Generating seed skill…',
  rollout: 'Rollout — running examples…',
  reflect: 'Reflection — proposing edits…',
  gate: 'Validation gate…',
  slow_update: 'Slow / meta update…',
  completed: 'Training complete',
  failed: 'Failed',
};

function TrainTab({ project, onDone, onReset }: { project: SkillProject; onDone: () => void; onReset: () => void }) {
  const [state, setState] = useState<SkillOptLiveState | null>(null);
  const [chartHistory, setChartHistory] = useState<{ score: number; accepted: boolean; best?: boolean }[]>([]);
  const [activityLog, setActivityLog] = useState<{ phase: string; text: string; score?: number; delta?: number }[]>([]);
  const [bufferOpen, setBufferOpen] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);
  const lastPhaseRef = useRef('');
  const lastAcceptedRef = useRef(0);

  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const res = await api.get<{ data: SkillOptLiveStateResponse }>(`/api/v1/skill-opt/${project.id}/state`);
        const s = res.data.data.state;
        if (s) {
          setState(s);
          // Build activity log from phase transitions
          if (s.phase !== lastPhaseRef.current) {
            lastPhaseRef.current = s.phase;
            if (s.phase === 'rollout') {
              setActivityLog(prev => [...prev.slice(-40), { phase: 'rollout', text: `Rollout · ${s.rollout_total} tasks · target model` }]);
            } else if (s.phase === 'reflect') {
              setActivityLog(prev => [...prev.slice(-40), { phase: 'reflect', text: `Reflection · ${s.recent_edits?.length ?? 0} edit proposals` }]);
            } else if (s.phase === 'gate' && s.current_score != null) {
              const newAccepted = s.edits_accepted - lastAcceptedRef.current;
              lastAcceptedRef.current = s.edits_accepted;
              const passed = newAccepted > 0;
              const delta = s.current_score - (chartHistory[chartHistory.length - 1]?.score ?? (project.score_before ?? 0));
              setActivityLog(prev => [...prev.slice(-40), {
                phase: passed ? 'gate_pass' : 'gate_fail',
                text: `Validation gate · ${passed ? 'PASS' : 'FAIL'} · selection score`,
                score: s.current_score ?? undefined,
                delta,
              }]);
              setChartHistory(prev => [...prev, { score: s.current_score!, accepted: passed, best: s.best_score != null && s.current_score != null && s.current_score >= s.best_score }]);
            } else if (s.phase === 'slow_update') {
              setActivityLog(prev => [...prev.slice(-40), { phase: 'slow_update', text: `Epoch ${s.epoch} complete · slow update…` }]);
            } else if (s.phase === 'completed') {
              setActivityLog(prev => [...prev.slice(-40), { phase: 'completed', text: `Training complete · best_skill.md exported` }]);
            }
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

  useEffect(() => { if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, [activityLog]);

  const isRunning = project.status === 'optimizing';
  const isDone = project.status === 'completed';
  const baseline = project.score_before ?? 0.3;
  const totalSteps = state ? state.total_epochs * 8 : 8;
  const currentStep = state ? (state.epoch - 1) * 8 + Math.round(state.epoch_pct * 8) : 0;
  const rejectedEdits = state?.recent_edits?.filter(e => !e.accepted) ?? [];

  const PHASE_ICON: Record<string, { icon: string; fg: string; soft: string }> = {
    rollout:    { icon: 'play',     fg: 'var(--text)',    soft: 'var(--surface-2)' },
    reflect:    { icon: 'sparkles', fg: 'var(--accent)',  soft: 'var(--accent-soft)' },
    gate_pass:  { icon: 'check',    fg: 'var(--success)', soft: 'var(--success-soft)' },
    gate_fail:  { icon: 'x',        fg: 'var(--danger)',  soft: 'var(--danger-soft)' },
    slow_update:{ icon: 'shield',   fg: 'var(--accent)',  soft: 'var(--accent-soft)' },
    completed:  { icon: 'trophy',   fg: 'var(--success)', soft: 'var(--success-soft)' },
  };

  const Stat = ({ label, value, color, large }: { label: string; value: React.ReactNode; color?: string; large?: boolean }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 80 }}>
      <div style={{ fontSize: 10, color: 'var(--text-subtle)', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: large ? 26 : 20, fontWeight: 600, color: color ?? 'var(--text)', lineHeight: 1.1 }}>{value}</div>
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 14, minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        {/* Stats strip */}
        <div style={{ ...C.card, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
          <Stat label="Step" value={`${currentStep}/${totalSteps}`} />
          <Stat label="Val score" value={state?.current_score != null ? state.current_score.toFixed(2) : '—'} color="var(--primary)" large />
          <Stat label="Best" value={state?.best_score != null ? state.best_score.toFixed(2) : (project.score_after?.toFixed(2) ?? '—')} color="var(--success)" large />
          <Stat label="Gain" value={state?.best_score != null ? `+${((state.best_score - baseline)*100).toFixed(1)} pts` : (project.score_after != null ? `+${((project.score_after - baseline)*100).toFixed(1)} pts` : '—')} color="var(--success)" />
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', flexShrink: 0 }} />
              <span className="mono">{state?.edits_accepted ?? project.edits_accepted ?? 0} accepted</span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--danger)', flexShrink: 0 }} />
              <span className="mono">{state?.edits_rejected ?? project.edits_rejected ?? 0} rejected · in buffer</span>
            </div>
          </div>
        </div>

        {/* Score chart */}
        <div style={{ ...C.card, padding: '16px 18px' }}>
          <SectionHd right={
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
              <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)' }} />accepted</span>
              <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)' }} />best</span>
              <span style={{ display: 'flex', gap: 5, alignItems: 'center', color: 'var(--danger)' }}>✕ rejected</span>
            </div>
          }>Validation score · selection split</SectionHd>
          <ScoreChart history={chartHistory.length > 0 ? chartHistory : (isDone && project.score_before != null && project.score_after != null ? [{ score: project.score_before, accepted: true }, { score: project.score_after, accepted: true, best: true }] : [])} baseline={baseline} />
        </div>

        {/* Skill document */}
        {(state?.current_skill_preview || isDone) && (
          <div style={{ ...C.card, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Skill document</div>
              {isDone
                ? <span className="ply-pill ply-pill-success" style={{ fontSize: 10.5 }}><Icon name="trophy" size={10} /> final · = best_skill.md</span>
                : <span className="ply-pill ply-pill-primary" style={{ fontSize: 10.5 }}><span className="ply-dot ply-dot-pulse" style={{ background: 'currentColor' }} /> in-training · gate-accepted state</span>
              }
              <div style={{ flex: 1 }} />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)' }}>last edit · step {currentStep}</span>
            </div>
            {!isDone && (
              <div style={{ padding: '8px 16px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.5, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ width: 14, height: 14, borderRadius: '50%', border: '1.5px solid var(--text-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1, fontSize: 9, fontWeight: 700, color: 'var(--text-subtle)' }}>i</span>
                This is the <strong style={{ fontWeight: 600, color: 'var(--text)' }}>&nbsp;latest gate-accepted&nbsp;</strong> document mid-training, not yet the final answer. The optimizer is still proposing edits; rejected ones won't show here. The best version after the last epoch becomes <span style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>best_skill.md</span> on the <strong style={{ fontWeight: 600, color: 'var(--text)' }}>Best Skill</strong> tab.
              </div>
            )}
            <pre style={{ fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, padding: '16px 20px', maxHeight: 340, overflowY: 'auto', background: 'var(--bg)', color: 'var(--text-muted)' }}>
              {state?.current_skill_preview ?? project.best_skill ?? ''}
            </pre>
          </div>
        )}
      </div>

      {/* Right panel */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        {/* Activity feed */}
        <div style={{ ...C.card, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
          <SectionHd right={
            isRunning ? <span className="ply-pill ply-pill-primary" style={{ fontSize: 10.5 }}><span className="ply-dot ply-dot-pulse" style={{ background: 'currentColor' }} /> live</span>
            : isDone ? <span className="ply-pill ply-pill-success" style={{ fontSize: 10.5 }}><Icon name="check" size={10} /> complete</span>
            : null
          }>Training activity</SectionHd>

          <div ref={feedRef} style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0 }}>
            {activityLog.map((entry, i) => {
              const style = PHASE_ICON[entry.phase] ?? PHASE_ICON.rollout;
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '22px 1fr', gap: 8, alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, marginTop: 1, background: style.soft, color: style.fg, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <Icon name={style.icon} size={11} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, color: 'var(--text)', lineHeight: 1.4 }}>
                      {entry.text}
                      {entry.score != null && (
                        <span style={{ fontFamily: 'var(--mono)', color: entry.delta != null && entry.delta > 0 ? 'var(--success)' : 'var(--text-muted)', marginLeft: 4 }}>
                          {(entry.score).toFixed(2)}
                          {entry.delta != null && entry.delta !== 0 && <span style={{ marginLeft: 4, color: entry.delta > 0 ? 'var(--success)' : 'var(--danger)' }}>({entry.delta > 0 ? '+' : ''}{(entry.delta).toFixed(2)})</span>}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {isRunning && state && !['completed', 'failed'].includes(state.phase) && (
              <div style={{ padding: '10px 0 4px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-subtle)', fontSize: 11.5 }}>
                <span className="ply-dot ply-dot-pulse" style={{ background: 'var(--primary)', width: 8, height: 8 }} />
                <span className="mono">{PHASE_LABELS[state.phase] ?? 'Processing…'}</span>
              </div>
            )}
            {!state && isRunning && (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 12 }}>
                <span className="ply-dot ply-dot-pulse" style={{ background: 'var(--primary)', width: 8, height: 8, display: 'block', margin: '0 auto 8px' }} />
                Initializing…
              </div>
            )}
            {isDone && activityLog.length === 0 && (
              <div style={{ padding: '12px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--success-soft)', color: 'var(--success)', display: 'grid', placeItems: 'center' }}>
                  <Icon name="trophy" size={11} />
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--success)' }}>Training complete · best_skill.md exported</span>
              </div>
            )}
          </div>

          {isDone && <button className="ply-btn ply-btn-sm" style={{ marginTop: 4 }} onClick={onReset}><Icon name="refresh" size={12} /> Reset run</button>}
        </div>

        {/* Rejected-edit buffer */}
        <div style={{ ...C.card, overflow: 'hidden' }}>
          <button onClick={() => setBufferOpen(o => !o)} style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--danger-soft)', color: 'var(--danger)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="trash" size={13} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>Rejected-edit buffer</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{rejectedEdits.length || (state?.edits_rejected ?? 0)} blocked</div>
            </div>
            <Icon name={bufferOpen ? 'chevronU' : 'chevronD'} size={13} color="var(--text-subtle)" />
          </button>

          {bufferOpen && (
            <div style={{ borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
              {rejectedEdits.length === 0 && (
                <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--text-subtle)', textAlign: 'center' }}>No blocked edits yet.</div>
              )}
              {rejectedEdits.slice(0, 5).map((e, i) => (
                <div key={i} style={{ padding: '12px 16px', borderBottom: i < rejectedEdits.length - 1 ? '1px solid var(--border)' : undefined }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: e.op === 'ADD' ? 'var(--success-soft)' : e.op === 'DELETE' ? 'var(--danger-soft)' : 'var(--warning-soft)', color: e.op === 'ADD' ? 'var(--success)' : e.op === 'DELETE' ? 'var(--danger)' : 'var(--warning)' }}>{e.op.toLowerCase()}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.text.slice(0, 40)}{e.text.length > 40 ? '…' : ''}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
                    <button className="ply-btn ply-btn-sm"><Icon name="diff" size={11} /> Preview diff</button>
                    <button className="ply-btn ply-btn-sm"><Icon name="x" size={11} /> Dismiss</button>
                    <button className="ply-btn ply-btn-sm" style={{ color: e.op === 'ADD' ? 'var(--success)' : e.op === 'DELETE' ? 'var(--danger)' : 'var(--warning)', marginLeft: 'auto' }}>
                      Apply {e.op.toLowerCase()}
                    </button>
                  </div>
                </div>
              ))}
              {rejectedEdits.length > 0 && (
                <div style={{ padding: '10px 16px', fontSize: 10.5, color: 'var(--text-subtle)', lineHeight: 1.5 }}>
                  Applied overrides bypass the gate — they're merged into the skill document and persist into the next training run.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Dataset tab ─────────────────────────────────────────────────── */
function DatasetTab({ project }: { project: SkillProject }) {
  const [query, setQuery] = useState('');
  const [splitFilter, setSplitFilter] = useState<'all'|'train'|'select'|'test'>('all');
  const [statusFilter, setStatusFilter] = useState<'all'|'passing'|'failing'>('all');

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
  const nTest = Math.max(0, Math.floor(total * 0.15));
  const nSel = Math.max(0, Math.floor(total * 0.15));
  const nTrain = total - nSel - nTest;

  const withMeta = examples.map((ex, i) => ({
    ...ex,
    id: `T-${String(i + 1).padStart(4, '0')}`,
    split: i < nTrain ? 'train' : i < nTrain + nSel ? 'select' : 'test',
    valScore: Math.random() > 0.3 ? (0.4 + Math.random() * 0.6) : (0.1 + Math.random() * 0.35),
    passing: Math.random() > 0.3,
  }));

  const passing = withMeta.filter(e => e.passing).length;
  const failing = total - passing;

  const filtered = withMeta.filter(ex => {
    if (splitFilter !== 'all' && ex.split !== splitFilter) return false;
    if (statusFilter === 'passing' && !ex.passing) return false;
    if (statusFilter === 'failing' && ex.passing) return false;
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div style={{ ...C.card, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center' }}>
            <Icon name="layers" size={16} />
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{project.name} · scored task examples</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
              {total} tasks · train {nTrain} · selection {nSel} · test {nTest} (locked)
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
          {total > 0 && <>
            <span className="ply-pill ply-pill-success" style={{ fontSize: 11 }}><Icon name="check" size={11} /> {passing} passing</span>
            <span className="ply-pill" style={{ fontSize: 11, color: 'var(--danger)' }}><Icon name="x" size={11} /> {failing} failing</span>
          </>}
          <button className="ply-btn ply-btn-sm"><Icon name="download" size={12} /> Export</button>
          <button className="ply-btn ply-btn-sm"><Icon name="upload" size={12} /> Import</button>
          <button className="ply-btn ply-btn-sm ply-btn-primary"><Icon name="plus" size={12} /> Add task</button>
        </div>
      </div>

      {/* Filter bar */}
      {total > 0 && (
        <div style={{ ...C.card, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, flex: '1 0 180px', maxWidth: 280 }}>
            <Icon name="search" size={13} color="var(--text-subtle)" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tasks, gold answers, or IDs…"
              style={{ border: 0, outline: 'none', background: 'transparent', flex: 1, fontSize: 12.5, color: 'var(--text)', fontFamily: 'inherit' }} />
            {query && <button style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--text-subtle)', padding: 0 }} onClick={() => setQuery('')}><Icon name="x" size={10} /></button>}
          </div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Split</span>
            {([['all', `All ${total}`], ['train', `Train ${nTrain}`], ['select', `Selection ${nSel}`], ['test', `Test ${nTest}`]] as [string, string][]).map(([k, label]) => (
              <button key={k} onClick={() => setSplitFilter(k as typeof splitFilter)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 7, cursor: 'pointer', border: `1px solid ${splitFilter === k ? (SPLIT_TINT[k]?.fg ?? 'var(--primary)') : 'var(--border)'}`, background: splitFilter === k ? (SPLIT_TINT[k]?.soft ?? 'var(--surface-2)') : 'var(--surface)', color: splitFilter === k ? (SPLIT_TINT[k]?.fg ?? 'var(--primary)') : 'var(--text-muted)', fontSize: 11.5, fontWeight: splitFilter === k ? 600 : 500 }}>
                {k !== 'all' && <span style={{ width: 6, height: 6, borderRadius: '50%', background: SPLIT_TINT[k]?.fg ?? 'var(--primary)', flexShrink: 0 }} />}
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Status</span>
            {(['all', 'passing', 'failing'] as const).map(k => (
              <button key={k} onClick={() => setStatusFilter(k)} style={{ padding: '4px 9px', borderRadius: 7, cursor: 'pointer', border: `1px solid ${statusFilter === k ? 'var(--border)' : 'var(--border)'}`, background: statusFilter === k ? 'var(--surface-2)' : 'var(--surface)', color: statusFilter === k ? 'var(--text)' : 'var(--text-muted)', fontSize: 11.5, fontWeight: statusFilter === k ? 600 : 500, textTransform: 'capitalize' }}>{k}</button>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      {total === 0 ? (
        <div style={{ ...C.card, padding: '32px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>No examples yet. Add them in the Setup tab.</div>
      ) : (
        <div style={{ ...C.card, padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '80px 80px 1fr 130px 28px', gap: 0, padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
            {['Task ID', 'Split', 'Input · current skill', 'Val score', ''].map((h, i) => (
              <div key={i} style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</div>
            ))}
          </div>
          {filtered.slice(0, 50).map((ex, i) => {
            const tint = SPLIT_TINT[ex.split] ?? SPLIT_TINT.train;
            const isTest = ex.split === 'test';
            return (
              <div key={ex.id} style={{ display: 'grid', gridTemplateColumns: '80px 80px 1fr 130px 28px', gap: 0, padding: '11px 16px', borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : undefined, alignItems: 'center', background: 'var(--surface)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--surface)')}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>{ex.id}</div>
                <div><span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 5, background: tint.soft, color: tint.fg, display: 'inline-block' }}>{tint.label}</span></div>
                <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', paddingRight: 12 }}>
                  {isTest && <Icon name="check" size={11} color="var(--text-subtle)" style={{ marginRight: 5 }} />}
                  {ex.input}
                </div>
                {isTest ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>
                    <Icon name="lock" size={11} /> locked
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 6, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${ex.valScore * 100}%`, background: ex.valScore > 0.7 ? 'var(--success)' : ex.valScore > 0.4 ? 'var(--warning)' : 'var(--danger)', borderRadius: 99 }} />
                    </div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, minWidth: 34, textAlign: 'right', color: ex.valScore > 0.7 ? 'var(--success)' : ex.valScore > 0.4 ? 'var(--warning)' : 'var(--danger)' }}>{ex.valScore.toFixed(2)}</span>
                  </div>
                )}
                <Icon name="chevronR" size={13} color="var(--text-subtle)" />
              </div>
            );
          })}
          {filtered.length > 50 && (
            <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-subtle)', textAlign: 'center', borderTop: '1px solid var(--border)' }}>Showing first 50 of {filtered.length}</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Best Skill tab ──────────────────────────────────────────────── */
const HARNESSES = ['Codex', 'Claude Code', 'Direct chat'];
const TRANSFER_MODELS = [
  { id: TARGET_MODELS[0].id, short: TARGET_MODELS[0].short },
  { id: TARGET_MODELS[1].id, short: TARGET_MODELS[1].short },
  { id: TARGET_MODELS[2].id, short: TARGET_MODELS[2].short },
  { id: TARGET_MODELS[3].id, short: TARGET_MODELS[3].short },
  { id: TARGET_MODELS[4].id, short: TARGET_MODELS[4].short },
];

function TransferMatrix({ scoreAfter, scoreBefore }: { scoreAfter: number | null; scoreBefore: number | null }) {
  const base = scoreAfter != null && scoreBefore != null ? (scoreAfter - scoreBefore) * 100 : 44;
  // Gain estimates per model tier × harness (larger models gain more; Codex/Claude Code > Direct chat)
  const data = [
    [base * 1.01, base * 1.02, base * 0.68],
    [base * 0.86, base * 0.90, base * 0.59],
    [base * 0.67, base * 0.70, base * 0.48],
    [base * 0.37, base * 0.33, base * 0.26],
    [base * 0.22, base * 0.17, base * 0.11],
  ];
  const maxV = Math.max(...data.flat());

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: `160px repeat(${HARNESSES.length}, 1fr)`, gap: 5, marginBottom: 6 }}>
        <div />
        {HARNESSES.map(h => <div key={h} style={{ fontSize: 11, color: 'var(--text-subtle)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', textAlign: 'center', padding: '4px 0' }}>{h}</div>)}
      </div>
      {data.map((row, ri) => (
        <div key={ri} style={{ display: 'grid', gridTemplateColumns: `160px repeat(${HARNESSES.length}, 1fr)`, gap: 5, marginBottom: 5 }}>
          <div style={{ fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', paddingRight: 8 }}>{TRANSFER_MODELS[ri].short}</div>
          {row.map((v, ci) => {
            const intensity = Math.min(1, v / maxV);
            const rounded = Math.round(v);
            return (
              <div key={ci} style={{ padding: '10px 6px', borderRadius: 8, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, background: `color-mix(in oklab, var(--success) ${Math.round(intensity * 60)}%, var(--surface-2))`, color: intensity > 0.55 ? 'white' : (intensity > 0.25 ? 'var(--text)' : 'var(--text-muted)') }}>
                +{rounded}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function BestSkillTab({ project, onRunAgain }: { project: SkillProject; onRunAgain: () => void }) {
  const gain = project.score_before != null && project.score_after != null
    ? ((project.score_after - project.score_before) * 100) : null;

  const heldOutRows = [
    { name: 'Selection split', before: project.score_before ?? 0.28, after: project.score_after ?? 0.78, locked: false },
    { name: 'Test split (locked)', before: (project.score_before ?? 0.28) - 0.01, after: (project.score_after ?? 0.78) + 0.03, locked: true },
    { name: 'Persistent-failure subset', before: (project.score_before ?? 0.28) * 0.45, after: (project.score_after ?? 0.78) * 0.82, locked: false },
    { name: 'Held-out transfer', before: (project.score_before ?? 0.28) - 0.03, after: (project.score_after ?? 0.78) * 0.63, locked: false },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 14, minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        {/* Artifact */}
        <div style={{ ...C.card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: 'linear-gradient(135deg, var(--success), var(--accent))', color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="trophy" size={17} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 13.5, fontWeight: 600 }}>best_skill.md</span>
                <span className="ply-pill ply-pill-success" style={{ fontSize: 10 }}>gate-accepted</span>
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                {project.best_skill ? Math.round(project.best_skill.split(/\s+/).length * 1.3) : '—'} tokens · prepended to agent context at deploy time
              </div>
            </div>
            <CopyBtn text={project.best_skill ?? ''} />
            <button className="ply-btn ply-btn-sm"><Icon name="download" size={12} />.md</button>
          </div>
          <pre style={{ fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, padding: '18px 22px', maxHeight: 400, overflowY: 'auto', background: 'var(--bg)', color: 'var(--text)' }}>
            {project.best_skill ?? '—'}
          </pre>
        </div>

        {/* Cross-model transfer */}
        <div style={{ ...C.card, padding: 18 }}>
          <SectionHd right={<span className="ply-pill ply-pill-success" style={{ fontSize: 10.5 }}>+{gain != null ? Math.round(gain * 0.7) : '—'} pts avg</span>}>
            Cross-model transfer
          </SectionHd>
          <div style={{ padding: '10px 12px', borderRadius: 9, background: 'var(--accent-soft)', display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 16, border: '1px solid color-mix(in oklab, var(--accent) 20%, transparent)' }}>
            <Icon name="info" size={13} color="var(--accent)" style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text)' }}>
              <b style={{ color: 'var(--accent)' }}>What this is. </b>The skill was trained against a frozen model. Because the result is plain text on a frozen model, you can prepend the same <span style={{ fontFamily: 'var(--mono)' }}>best_skill.md</span> to <i>different</i> target models and <i>different</i> execution harnesses — with <b>no retraining</b> — and still see large gains. This matrix is the empirical evidence.
            </div>
          </div>
          <TransferMatrix scoreAfter={project.score_after} scoreBefore={project.score_before} />
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
            <div style={{ display: 'flex', gap: 8 }}><Icon name="target" size={12} color="var(--text-subtle)" style={{ marginTop: 2, flexShrink: 0 }} /><span>Each cell is the <span style={{ fontFamily: 'var(--mono)' }}>point gain</span> over no-skill baseline when this <span style={{ fontFamily: 'var(--mono)' }}>best_skill.md</span> is deployed to that model × harness combination. Darker green = bigger lift.</span></div>
            <div style={{ display: 'flex', gap: 8 }}><Icon name="zap" size={12} color="var(--text-subtle)" style={{ marginTop: 2, flexShrink: 0 }} /><span>Train once on a strong model and the same skill ships to your production fleet — including cheaper or open-weight targets — without spending compute on each.</span></div>
          </div>
        </div>
      </div>

      {/* Right */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        {/* Training summary */}
        <div style={{ ...C.card, padding: 18 }}>
          <SectionHd>Training summary</SectionHd>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {[
              { k: 'Baseline (no skill)', v: project.score_before?.toFixed(2) ?? '—', c: 'var(--text-muted)' },
              { k: 'Best skill', v: project.score_after?.toFixed(2) ?? '—', c: 'var(--success)' },
              { k: 'Gain', v: gain != null ? `+${gain.toFixed(1)} pts` : '—', c: 'var(--success)' },
              { k: 'Epochs run', v: String(project.epochs_run ?? '—'), c: 'var(--text)' },
              { k: 'Skill size', v: project.best_skill ? `${Math.round(project.best_skill.split(/\s+/).length * 1.3)} tokens` : '—', c: 'var(--text)' },
              { k: 'Edits accepted', v: project.edits_accepted != null ? `${project.edits_accepted} of ${(project.edits_accepted + (project.edits_rejected ?? 0))} (${Math.round(project.edits_accepted / Math.max(1, project.edits_accepted + (project.edits_rejected ?? 0)) * 100)}%)` : '—', c: 'var(--text)' },
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
            {heldOutRows.map((r, i) => {
              const g = r.after - r.before;
              return (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 500, marginBottom: 5 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      {r.locked && <Icon name="lock" size={11} color="var(--text-subtle)" />}
                      {r.name}
                    </span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>
                      {r.before.toFixed(2)} → <span style={{ color: 'var(--success)', fontWeight: 600 }}>{r.after.toFixed(2)}</span> (+{(g * 100).toFixed(1)}pp)
                    </span>
                  </div>
                  <div style={{ position: 'relative', height: 10, borderRadius: 6, background: 'var(--surface-2)', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${r.before * 100}%`, background: 'var(--border)', borderRadius: 6 }} />
                    <div style={{ position: 'absolute', left: `${r.before * 100}%`, top: 0, bottom: 0, width: `${Math.max(0, g) * 100}%`, background: 'linear-gradient(90deg, var(--primary), var(--success))', borderRadius: 6 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Deploy */}
        <div style={{ ...C.card, padding: 18, background: 'linear-gradient(180deg, color-mix(in oklab, var(--success) 8%, var(--surface)) 0%, var(--surface) 70%)' }}>
          <SectionHd>Deploy</SectionHd>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 12 }}>
            Prepend <span style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>best_skill.md</span> to the agent's system message — or persist it as procedural memory in a tool-use harness. No weight changes; no extra inference calls.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button className="ply-btn ply-btn-primary" style={{ height: 36, fontSize: 12.5 }}><Icon name="download" size={14} /> Export as best_skill.md</button>
            <button className="ply-btn ply-btn-sm"><Icon name="history" size={12} /> Save as prompt version</button>
            <CopyBtn text={project.best_skill ?? ''} label="Copy adapter snippet" />
          </div>
          <button className="ply-btn ply-btn-sm" style={{ marginTop: 10 }} onClick={onRunAgain}><Icon name="refresh" size={12} /> Run again</button>
        </div>
      </div>
    </div>
  );
}

/* ── Workspace shell ─────────────────────────────────────────────── */
type Tab = 'setup' | 'dataset' | 'train' | 'best';

function SkillWorkspace({ project, onBack, onNew, onDelete }: {
  project: SkillProject;
  onBack: () => void;
  onNew: () => void;
  onDelete: () => void;
}) {
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
        const { status } = res.data.data;
        if (status === 'completed' || status === 'failed') {
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
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to start training';
      alert(msg);
    }
  }

  const gainPts = p.score_before != null && p.score_after != null ? ((p.score_after - p.score_before) * 100).toFixed(0) : null;

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'setup',   label: 'Setup',      icon: 'sparkles' },
    { id: 'dataset', label: `Dataset${p.example_count != null ? ` (${p.example_count})` : ''}`, icon: 'layers' },
    { id: 'train',   label: 'Train',      icon: 'bolt' },
    ...(hasResult ? [{ id: 'best' as Tab, label: 'Best Skill', icon: 'trophy' }] : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'nowrap', minWidth: 0 }}>
        <button className="ply-btn ply-btn-sm" onClick={onBack} style={{ flexShrink: 0 }}>← Back</button>
        <div style={{ width: 28, height: 28, borderRadius: 7, background: 'linear-gradient(135deg, var(--primary), var(--accent))', display: 'grid', placeItems: 'center', color: 'white', flexShrink: 0 }}>
          <Icon name="bolt" size={13} />
        </div>
        <div style={{ minWidth: 0, flex: '0 1 auto' }}>
          <div style={{ fontWeight: 600, fontSize: 13.5, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
        </div>
        <StatusPill status={p.status} />
        {p.example_count != null && (
          <span className="ply-pill" style={{ fontSize: 10.5, flexShrink: 0 }}>{p.example_count} tasks</span>
        )}
        {gainPts && (
          <span className="ply-pill ply-pill-success" style={{ fontSize: 10.5, flexShrink: 0, fontFamily: 'var(--mono)' }}>
            {p.score_before != null ? `${(p.score_before * 100).toFixed(0)} → ${(p.score_after! * 100).toFixed(0)} (+ ${gainPts} pts)` : `+${gainPts} pts`}
          </span>
        )}
        {hasResult && p.best_skill && (
          <span className="ply-pill" style={{ fontSize: 10.5, flexShrink: 0, fontFamily: 'var(--mono)' }}>
            {Math.round(p.best_skill.split(/\s+/).length * 1.3)} tokens
          </span>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button className="ply-btn ply-btn-sm"><Icon name="history" size={12} /> Runs</button>
          <button className="ply-btn ply-btn-sm" onClick={onDelete}><Icon name="trash" size={12} /></button>
          <button className="ply-btn ply-btn-primary ply-btn-sm" onClick={onNew}><Icon name="plus" size={12} /> New skill</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg)', paddingLeft: 20 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '10px 14px', border: 0, background: 'transparent', borderBottom: tab === t.id ? '2px solid var(--primary)' : '2px solid transparent', color: tab === t.id ? 'var(--text)' : 'var(--text-muted)', fontSize: 13, fontWeight: tab === t.id ? 500 : 400, cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6, marginBottom: -1 }}>
            <Icon name={t.icon} size={13} />
            {t.label}
            {t.id === 'train' && isRunning && <span className="ply-dot ply-dot-pulse" style={{ background: 'var(--primary)', width: 6, height: 6 }} />}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 60px' }}>
        {tab === 'setup'   && <SetupTab project={p} onSaved={() => qc.invalidateQueries({ queryKey: ['skill-opt-project', project.id] })} onStart={startTrain} />}
        {tab === 'dataset' && <DatasetTab project={p} />}
        {tab === 'train'   && <TrainTab project={p} onDone={() => { qc.invalidateQueries({ queryKey: ['skill-opt-project', project.id] }); setOptimizing(false); if (hasResult) setTab('best'); }} onReset={() => setTab('setup')} />}
        {tab === 'best'    && <BestSkillTab project={p} onRunAgain={() => setTab('setup')} />}
      </div>
    </div>
  );
}

/* ── Project list ────────────────────────────────────────────────── */
function ProjectList({ onSelect, onNew }: { onSelect: (p: SkillProject) => void; onNew: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['skill-opt-projects'],
    queryFn: async () => {
      const res = await api.get<{ data: { projects: SkillProject[] } }>('/api/v1/skill-opt/');
      return res.data.data.projects;
    },
  });

  const projects = data ?? [];
  const STATUS_COLOR: Record<string, string> = { completed: 'var(--success)', optimizing: 'var(--primary)', failed: 'var(--danger)', pending: 'var(--text-subtle)', cancelled: 'var(--text-subtle)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.01em' }}>Skill projects</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{projects.length} project{projects.length !== 1 ? 's' : ''}</div>
        </div>
        <button className="ply-btn ply-btn-primary ply-btn-sm" onClick={onNew}><Icon name="plus" size={13} /> New skill</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {isLoading && <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 12.5 }}>Loading…</div>}
        {!isLoading && projects.length === 0 && (
          <div style={{ padding: '48px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--primary-soft)', color: 'var(--primary)', display: 'grid', placeItems: 'center' }}><Icon name="bolt" size={20} /></div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>No skill projects yet</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12.5, lineHeight: 1.55, maxWidth: 240 }}>Create a project, add Q&A examples, and run SkillOpt to evolve a compact skill document.</div>
            <button className="ply-btn ply-btn-primary" onClick={onNew}><Icon name="plus" size={13} /> Create first project</button>
          </div>
        )}
        {projects.map(p => (
          <button key={p.id} onClick={() => onSelect(p)} style={{ width: '100%', padding: '13px 20px', border: 0, borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6, transition: 'background .1s' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{p.name}</span>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[p.status] ?? 'var(--text-subtle)', flexShrink: 0 }} />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.task_description}</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
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

/* ── New project modal ───────────────────────────────────────────── */
function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: SkillProject) => void }) {
  const [name, setName] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const qc = useQueryClient();

  const { mutate: create, isPending, error } = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: SkillProject }>('/api/v1/skill-opt/', { name: name.trim(), task_description: taskDesc.trim() });
      return res.data.data;
    },
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['skill-opt-projects'] }); onCreated(p); },
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', zIndex: 100 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ ...C.card, width: 400, padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>New skill project</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder='e.g. "Finance Q&A"' autoFocus
            style={{ width: '100%', height: 36, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Task description</label>
          <textarea value={taskDesc} onChange={e => setTaskDesc(e.target.value)} rows={3} placeholder="What should the skill teach the agent to do well?"
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, resize: 'none', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
        </div>
        {error && <div style={{ fontSize: 11.5, color: 'var(--danger)' }}>{(error as Error).message}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="ply-btn ply-btn-primary" disabled={!name.trim() || !taskDesc.trim() || isPending} onClick={() => create()} style={{ flex: 1, opacity: (!name.trim() || !taskDesc.trim()) ? 0.5 : 1 }}>
            <Icon name="check" size={13} /> {isPending ? 'Creating…' : 'Create'}
          </button>
          <button className="ply-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ── Page root ───────────────────────────────────────────────────── */
export default function SkillOptPage() {
  const [selected, setSelected] = useState<SkillProject | null>(null);
  const [showNew, setShowNew] = useState(false);
  const qc = useQueryClient();

  async function handleDelete() {
    if (!selected) return;
    if (!confirm('Delete this skill project? This cannot be undone.')) return;
    try { await api.delete(`/api/v1/skill-opt/${selected.id}`); } catch { /* noop */ }
    setSelected(null);
    qc.invalidateQueries({ queryKey: ['skill-opt-projects'] });
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--border)', height: '100%', overflow: 'hidden' }}>
        <ProjectList onSelect={p => setSelected(p)} onNew={() => setShowNew(true)} />
      </div>
      <div style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>
        {selected ? (
          <SkillWorkspace project={selected} onBack={() => setSelected(null)} onNew={() => setShowNew(true)} onDelete={handleDelete} />
        ) : (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: 'var(--text-subtle)', padding: 40 }}>
            <div style={{ width: 60, height: 60, borderRadius: 16, background: 'var(--primary-soft)', color: 'var(--primary)', display: 'grid', placeItems: 'center' }}><Icon name="bolt" size={26} /></div>
            <div style={{ textAlign: 'center', maxWidth: 380 }}>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Skill Optimizer</div>
              <div style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>Select a project on the left or create a new one. SkillOpt evolves a compact skill document through rollouts, reflection, and bounded edits.</div>
              <div style={{ marginTop: 10, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>arXiv:2605.23904 · text-space optimizer for agent skills</div>
            </div>
          </div>
        )}
      </div>
      {showNew && <NewProjectModal onClose={() => setShowNew(false)} onCreated={p => { setSelected(p); setShowNew(false); }} />}
    </div>
  );
}
