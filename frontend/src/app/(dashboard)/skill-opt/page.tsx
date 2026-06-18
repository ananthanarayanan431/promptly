'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { SkillProject, SkillExample, SkillOptLiveState, SkillOptLiveStateResponse } from '@/types/skill-opt';
import { PageHeader } from '@/components/layout/page-header';

/* ── Icon helper ─────────────────────────────────────────────────── */
const PATHS: Record<string, string> = {
  bolt:      'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  plus:      'M12 5v14M5 12h14',
  trash:     'M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6',
  sparkles:  'M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8',
  check:     'M20 6 9 17 4 12',
  x:         'M18 6 6 18M6 6l12 12',
  copy:      'M8 17.929H6c-1.105 0-2-.912-2-2.036V5.107C4 3.983 4.895 3 6 3h8c1.105 0 2 .983 2 2.107V6M10 20.036V9.107C10 7.983 10.895 7 12 7h8c1.105 0 2 .983 2 2.107v10.929C22 21.017 21.105 22 20 22h-8c-1.105 0-2-.983-2-2.036z',
  chevronR:  'M9 18l6-6-6-6',
  chevronD:  'M6 9l6 6 6-6',
  upload:    'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12',
  zap:       'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  edit:      'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z',
};
function Icon({ name, size = 14, color }: { name: string; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color || 'currentColor'} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      {(PATHS[name] || '').split('M').filter(Boolean).map((seg, i) => (
        <path key={i} d={`M${seg}`} />
      ))}
    </svg>
  );
}

/* ── Stat chip ───────────────────────────────────────────────────── */
function StatChip({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>{label}</span>
      <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: color ?? 'var(--text)', lineHeight: 1 }}>{value}</span>
    </div>
  );
}

/* ── Phase label ─────────────────────────────────────────────────── */
const PHASE_LABELS: Record<string, string> = {
  seed: 'Generating seed skill…',
  rollout: 'Running examples with current skill…',
  reflect: 'Analyzing traces & proposing edits…',
  gate: 'Validating candidate skill…',
  slow_update: 'Epoch meta-update…',
  completed: 'Completed',
  failed: 'Failed',
};

/* ── Edit op badge ───────────────────────────────────────────────── */
const OP_COLORS: Record<string, string> = { ADD: '#10b981', DELETE: '#ef4444', REPLACE: '#f59e0b' };
function OpBadge({ op, accepted }: { op: string; accepted: boolean }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 4,
      textTransform: 'uppercase', letterSpacing: '.06em',
      background: accepted ? `${OP_COLORS[op]}18` : 'var(--surface-2)',
      color: accepted ? OP_COLORS[op] : 'var(--text-subtle)',
      border: `1px solid ${accepted ? `${OP_COLORS[op]}30` : 'var(--border)'}`,
      opacity: accepted ? 1 : 0.65,
    }}>
      {op}
    </span>
  );
}

/* ── Live optimization view ─────────────────────────────────────── */
function LiveView({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [state, setState] = useState<SkillOptLiveState | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const res = await api.get<{ data: SkillOptLiveStateResponse }>(`/api/v1/skill-opt/${projectId}/state`);
        const s = res.data.data.state;
        if (s) {
          setState(s);
          if ((s.phase === 'completed' || s.phase === 'failed') && !doneRef.current) {
            doneRef.current = true;
            clearInterval(iv);
            setTimeout(onDone, 1200);
          }
        }
      } catch { /* noop */ }
    }, 2000);
    return () => clearInterval(iv);
  }, [projectId, onDone]);

  const overallPct = state
    ? ((state.epoch - 1 + state.epoch_pct) / state.total_epochs) * 100
    : 0;

  return (
    <div className="ply-card anim-fade" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid var(--border)',
        background: 'linear-gradient(135deg, var(--primary-soft), transparent 70%)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ position: 'relative', width: 20, height: 20 }}>
            <span className="ply-dot ply-dot-pulse" style={{ background: state?.phase === 'completed' ? 'var(--success)' : 'var(--primary)', position: 'absolute', inset: 0 }} />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>SkillOpt — Evolving skill document</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
              {PHASE_LABELS[state?.phase ?? ''] ?? `Epoch ${state?.epoch ?? 0} / ${state?.total_epochs ?? '—'}`}
            </div>
          </div>
        </div>
        {state && (
          <div style={{ display: 'flex', gap: 20 }}>
            <StatChip label="Best score" value={state.best_score != null ? `${(state.best_score * 100).toFixed(1)}%` : '—'} color="var(--success)" />
            <StatChip label="Accepted" value={state.edits_accepted} color="var(--success)" />
            <StatChip label="Rejected" value={state.edits_rejected} color="var(--text-subtle)" />
          </div>
        )}
      </div>

      {/* Progress bars */}
      {state && (
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-subtle)', marginBottom: 4 }}>
              <span>Overall progress</span>
              <span className="mono">{overallPct.toFixed(0)}%</span>
            </div>
            <div style={{ height: 5, background: 'var(--border)', borderRadius: 99 }}>
              <div style={{ height: '100%', width: `${overallPct}%`, background: 'var(--primary)', borderRadius: 99, transition: 'width .5s' }} />
            </div>
          </div>
          {state.rollout_total > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-subtle)', marginBottom: 4 }}>
                <span>Epoch {state.epoch} — rollout</span>
                <span className="mono">{state.rollout_done}/{state.rollout_total}</span>
              </div>
              <div style={{ height: 3, background: 'var(--border)', borderRadius: 99 }}>
                <div style={{ height: '100%', width: `${(state.rollout_done / state.rollout_total) * 100}%`, background: '#f59e0b', borderRadius: 99, transition: 'width .3s' }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit log + skill preview */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 200 }}>
        {/* Recent edits */}
        <div style={{ padding: '12px 16px', borderRight: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600, marginBottom: 8 }}>Recent edits</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(state?.recent_edits ?? []).slice(-6).reverse().map((e, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11.5 }}>
                <OpBadge op={e.op} accepted={e.accepted} />
                <span style={{ color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.text}
                </span>
              </div>
            ))}
            {(!state?.recent_edits?.length) && (
              <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Waiting for first reflection…</span>
            )}
          </div>
        </div>

        {/* Current skill preview */}
        <div style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 10, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600, marginBottom: 8 }}>
            Current skill preview
          </div>
          <pre style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, lineHeight: 1.6, maxHeight: 160, overflowY: 'auto' }}>
            {state?.current_skill_preview || '…'}
          </pre>
        </div>
      </div>
    </div>
  );
}

/* ── Result card ─────────────────────────────────────────────────── */
function ResultCard({ project, onRunAgain }: { project: SkillProject; onRunAgain: () => void }) {
  const [copied, setCopied] = useState(false);

  function copySkill() {
    if (!project.best_skill) return;
    navigator.clipboard.writeText(project.best_skill).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  }

  const gain = project.score_before != null && project.score_after != null
    ? ((project.score_after - project.score_before) * 100).toFixed(1)
    : null;

  return (
    <div className="ply-card anim-fade" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid var(--border)',
        background: 'linear-gradient(135deg, var(--primary-soft), transparent 70%)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="zap" size={18} color="var(--primary)" />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Optimized skill document</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
              {project.score_before != null && project.score_after != null && (
                <>
                  Score: <span className="mono">{(project.score_before * 100).toFixed(1)}%</span>
                  {' → '}
                  <span className="mono" style={{ color: 'var(--success)', fontWeight: 600 }}>
                    {(project.score_after * 100).toFixed(1)}%
                  </span>
                  {gain && (
                    <> · gain <span className="mono" style={{ color: 'var(--success)' }}>+{gain}pp</span></>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="ply-btn ply-btn-sm" onClick={onRunAgain}>
            <Icon name="sparkles" size={12} /> Run again
          </button>
          <button className="ply-btn ply-btn-sm" onClick={copySkill}>
            <Icon name={copied ? 'check' : 'copy'} size={12} />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 24 }}>
        <StatChip label="Epochs" value={project.epochs_run ?? '—'} />
        <StatChip label="Edits accepted" value={project.edits_accepted ?? '—'} color="var(--success)" />
        <StatChip label="Edits rejected" value={project.edits_rejected ?? '—'} color="var(--text-subtle)" />
        <StatChip label="Examples" value={project.example_count ?? '—'} />
        <StatChip label="Score after" value={project.score_after != null ? `${(project.score_after * 100).toFixed(1)}%` : '—'} color="var(--success)" />
      </div>

      {/* Skill doc split view */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr' }}>
        {/* Seed skill */}
        <div style={{ padding: '16px 18px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600, marginBottom: 8 }}>
            Seed skill (before)
          </div>
          <pre className="ply-prompt-block" style={{ margin: 0, fontSize: 12, maxHeight: 300, overflowY: 'auto', color: 'var(--text-muted)' }}>
            {project.seed_skill ?? '—'}
          </pre>
        </div>

        <div style={{ background: 'var(--border)' }} />

        {/* Best skill */}
        <div style={{ padding: '16px 18px' }}>
          <div style={{ fontSize: 10, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600, marginBottom: 8 }}>
            Best skill · arXiv:2605.23904
          </div>
          <pre className="ply-prompt-block" style={{ margin: 0, fontSize: 12, maxHeight: 300, overflowY: 'auto', border: '1px solid var(--primary)' }}>
            {project.best_skill ?? '—'}
          </pre>
        </div>
      </div>
    </div>
  );
}

/* ── Create project form ─────────────────────────────────────────── */
function CreateProjectForm({ onCreated }: { onCreated: (p: SkillProject) => void }) {
  const [name, setName] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [description, setDescription] = useState('');
  const qc = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: SkillProject }>('/api/v1/skill-opt/', {
        name: name.trim(),
        task_description: taskDesc.trim(),
        description: description.trim() || undefined,
      });
      return res.data.data;
    },
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['skill-opt-projects'] }); onCreated(p); },
  });

  const canSubmit = name.trim().length >= 1 && taskDesc.trim().length >= 10;

  return (
    <div className="ply-card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--primary-soft)', border: '1px solid var(--primary-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
          <Icon name="bolt" size={16} />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>New Skill project</div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>SkillOpt evolves a compact skill document for your task domain</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Project name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder='e.g. "Finance Q&A Agent"'
            style={{ width: '100%', height: 36, padding: '0 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Task description <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>(what should the agent be good at?)</span></label>
          <textarea value={taskDesc} onChange={e => setTaskDesc(e.target.value)}
            placeholder="Describe the task this agent/prompt should handle. E.g. 'Answer financial analysis questions accurately, including ratio calculations and forecasting.'"
            rows={3}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Description (optional)</label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Internal notes"
            style={{ width: '100%', height: 36, padding: '0 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
        </div>
      </div>

      <button className="ply-btn ply-btn-primary" onClick={() => mutate()} disabled={!canSubmit || isPending}
        style={{ alignSelf: 'flex-start', opacity: (!canSubmit || isPending) ? 0.5 : 1, cursor: (!canSubmit || isPending) ? 'not-allowed' : 'pointer' }}>
        <Icon name="plus" size={13} /> {isPending ? 'Creating…' : 'Create project'}
      </button>
    </div>
  );
}

/* ── Example editor ──────────────────────────────────────────────── */
function ExamplesEditor({ projectId, exampleCount, onSaved }: {
  projectId: string; exampleCount: number | null; onSaved: () => void;
}) {
  const [examples, setExamples] = useState<SkillExample[]>([{ input: '', expected: '' }]);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['skill-opt-examples', projectId],
    queryFn: async () => {
      const res = await api.get<{ data: { examples: SkillExample[] } }>(`/api/v1/skill-opt/${projectId}/examples`);
      return res.data.data.examples;
    },
    enabled: !!exampleCount,
  });

  useEffect(() => {
    if (data && data.length > 0) setExamples(data);
  }, [data]);

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      const valid = examples.filter(e => e.input.trim() && e.expected.trim());
      await api.post(`/api/v1/skill-opt/${projectId}/examples`, { examples: valid });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['skill-opt-projects'] }); onSaved(); },
  });

  function parsePaste() {
    const lines = pasteText.trim().split('\n').filter(Boolean);
    const parsed: SkillExample[] = [];
    let cur: Partial<SkillExample> = {};
    for (const line of lines) {
      if (line.startsWith('INPUT:') || line.startsWith('Q:')) {
        if (cur.input && cur.expected) parsed.push(cur as SkillExample);
        cur = { input: line.replace(/^(INPUT:|Q:)\s*/, '').trim() };
      } else if (line.startsWith('EXPECTED:') || line.startsWith('A:')) {
        cur.expected = line.replace(/^(EXPECTED:|A:)\s*/, '').trim();
      }
    }
    if (cur.input && cur.expected) parsed.push(cur as SkillExample);
    if (parsed.length > 0) { setExamples(parsed); setPasteMode(false); setPasteText(''); }
  }

  const validCount = examples.filter(e => e.input.trim() && e.expected.trim()).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
          Q&A Examples
          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-subtle)', fontWeight: 400 }}>
            {validCount} valid · minimum 6 required
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="ply-btn ply-btn-sm" onClick={() => setPasteMode(m => !m)}>
            <Icon name="upload" size={11} /> Paste bulk
          </button>
          <button className="ply-btn ply-btn-sm" onClick={() => setExamples(e => [...e, { input: '', expected: '' }])}>
            <Icon name="plus" size={11} /> Add row
          </button>
        </div>
      </div>

      {pasteMode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Paste in format: <code style={{ fontFamily: 'var(--mono)' }}>Q: ... / A: ...</code> or <code style={{ fontFamily: 'var(--mono)' }}>INPUT: ... / EXPECTED: ...</code> — one pair per two lines.
          </div>
          <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={6}
            placeholder={"Q: What is the P/E ratio of Apple?\nA: Apple's P/E ratio is approximately 28x as of Q3 2025.\nQ: How do you calculate EBITDA?\nA: EBITDA = Net Income + Interest + Taxes + Depreciation + Amortization"}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--mono)', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
          <button className="ply-btn ply-btn-sm" onClick={parsePaste} disabled={!pasteText.trim()} style={{ alignSelf: 'flex-start' }}>
            Parse &amp; import
          </button>
        </div>
      )}

      {/* Example rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
        {examples.map((ex, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'flex-start' }}>
            <textarea value={ex.input} rows={2} placeholder="Task input / question"
              onChange={e => setExamples(list => list.map((l, j) => j === i ? { ...l, input: e.target.value } : l))}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12, resize: 'none', outline: 'none', fontFamily: 'inherit' }} />
            <textarea value={ex.expected} rows={2} placeholder="Expected / reference answer"
              onChange={e => setExamples(list => list.map((l, j) => j === i ? { ...l, expected: e.target.value } : l))}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12, resize: 'none', outline: 'none', fontFamily: 'inherit' }} />
            <button className="ply-btn ply-btn-sm" onClick={() => setExamples(list => list.filter((_, j) => j !== i))}
              style={{ color: 'var(--danger)' }}>
              <Icon name="x" size={11} />
            </button>
          </div>
        ))}
      </div>

      <button className="ply-btn ply-btn-primary" onClick={() => save()} disabled={validCount < 6 || isPending}
        style={{ alignSelf: 'flex-start', opacity: (validCount < 6 || isPending) ? 0.5 : 1, cursor: (validCount < 6 || isPending) ? 'not-allowed' : 'pointer' }}>
        <Icon name="check" size={13} /> {isPending ? 'Saving…' : `Save ${validCount} examples`}
      </button>
    </div>
  );
}

/* ── Project workspace ───────────────────────────────────────────── */
function SkillWorkspace({ project, onBack }: { project: SkillProject; onBack: () => void }) {
  const [tab, setTab] = useState<'examples' | 'optimize' | 'result'>('examples');
  const [budgetTier, setBudgetTier] = useState<'low' | 'medium' | 'high'>('low');
  const [pollingJobId, setPollingJobId] = useState<string | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const qc = useQueryClient();

  const { data: current } = useQuery<SkillProject>({
    queryKey: ['skill-opt-project', project.id],
    queryFn: async () => {
      const res = await api.get<{ data: SkillProject }>(`/api/v1/skill-opt/${project.id}`);
      return res.data.data;
    },
    refetchInterval: optimizing ? 3000 : false,
  });

  const p = current ?? project;
  const isRunning = p.status === 'optimizing';
  const hasResult = p.status === 'completed' && !!p.best_skill;

  // Poll job
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
          if (status === 'completed') setTab('result');
        }
      } catch { /* noop */ }
    }, 2500);
    return () => clearInterval(iv);
  }, [pollingJobId, project.id, qc]);

  async function startOptimization() {
    try {
      const res = await api.post<{ data: { job_id: string } }>(`/api/v1/skill-opt/${project.id}/optimize`, { budget_tier: budgetTier });
      setPollingJobId(res.data.data.job_id);
      setOptimizing(true);
      setTab('optimize' as any);
    } catch (e: any) {
      alert(e?.response?.data?.detail ?? 'Failed to start optimization');
    }
  }

  const TIERS = {
    low:    { label: 'Low',    desc: '2 epochs · 10 rollouts', credits: 5  },
    medium: { label: 'Medium', desc: '3 epochs · 20 rollouts', credits: 10 },
    high:   { label: 'High',   desc: '4 epochs · 30 rollouts', credits: 16 },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, height: '100%' }}>
      {/* Top bar */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="ply-btn ply-btn-sm" onClick={onBack}>← Back</button>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--primary-soft)', border: '1px solid var(--primary-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
          <Icon name="bolt" size={14} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.task_description}
          </div>
        </div>
        {p.example_count != null && (
          <span className="ply-pill"><Icon name="check" size={11} /> {p.example_count} examples</span>
        )}
        {hasResult && (
          <span className="ply-pill ply-pill-success">
            {p.score_after != null ? `${(p.score_after * 100).toFixed(1)}% score` : 'Completed'}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
        {[
          { id: 'examples', label: 'Examples' },
          { id: 'optimize', label: isRunning ? 'Running…' : 'Optimize' },
          ...(hasResult ? [{ id: 'result', label: 'Skill document' }] : []),
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)} style={{
            padding: '10px 16px', border: 0, background: 'transparent',
            borderBottom: tab === t.id ? '2px solid var(--primary)' : '2px solid transparent',
            color: tab === t.id ? 'var(--text)' : 'var(--text-muted)',
            fontSize: 13, fontWeight: tab === t.id ? 600 : 400, cursor: 'pointer',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {tab === 'examples' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <ExamplesEditor
              projectId={p.id}
              exampleCount={p.example_count}
              onSaved={() => { qc.invalidateQueries({ queryKey: ['skill-opt-project', p.id] }); }}
            />
          </div>
        )}

        {tab === 'optimize' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {(isRunning || optimizing) ? (
              <LiveView
                projectId={p.id}
                onDone={() => {
                  qc.invalidateQueries({ queryKey: ['skill-opt-project', p.id] });
                  setOptimizing(false);
                  setTab('result');
                }}
              />
            ) : (
              <div className="ply-card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Run SkillOpt</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    The optimizer will evolve a skill document across multiple epochs using your examples.
                    Each epoch: rollout → reflect → edit → validate.
                  </div>
                </div>

                {/* Tier selector */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 10 }}>Effort tier</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    {(Object.entries(TIERS) as [string, { label: string; desc: string; credits: number }][]).map(([k, v]) => (
                      <button key={k} onClick={() => setBudgetTier(k as any)} style={{
                        padding: '12px 14px', borderRadius: 9, border: 0, cursor: 'pointer', textAlign: 'left',
                        background: budgetTier === k ? 'var(--surface)' : 'var(--surface-2)',
                        outline: budgetTier === k ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                        boxShadow: budgetTier === k ? '0 0 0 3px color-mix(in oklab, var(--primary) 12%, transparent)' : 'none',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: budgetTier === k ? 'var(--primary)' : 'var(--text)' }}>{v.label}</span>
                          <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: budgetTier === k ? 'var(--primary)' : 'var(--text-muted)' }}>−{v.credits} cr</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{v.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <button className="ply-btn ply-btn-primary"
                  disabled={!p.example_count || p.example_count < 6}
                  onClick={startOptimization}
                  style={{
                    alignSelf: 'flex-start',
                    opacity: (!p.example_count || p.example_count < 6) ? 0.4 : 1,
                    cursor: (!p.example_count || p.example_count < 6) ? 'not-allowed' : 'pointer',
                  }}>
                  <Icon name="zap" size={14} />
                  Run SkillOpt · {TIERS[budgetTier].credits} cr
                </button>

                {(!p.example_count || p.example_count < 6) && (
                  <div style={{ fontSize: 12, color: '#f59e0b' }}>
                    Add at least 6 examples in the Examples tab to unlock optimization.
                  </div>
                )}

                {hasResult && p.best_skill && (
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 8 }}>Previous best skill</div>
                    <pre className="ply-prompt-block" style={{ margin: 0, fontSize: 11.5, maxHeight: 160, overflowY: 'auto' }}>
                      {p.best_skill.slice(0, 500)}{p.best_skill.length > 500 ? '…' : ''}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'result' && (
          <ResultCard project={p} onRunAgain={() => setTab('optimize')} />
        )}
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

  const STATUS_COLORS: Record<string, string> = {
    completed: 'var(--success)', optimizing: 'var(--primary)', failed: 'var(--danger)',
    pending: 'var(--text-subtle)', cancelled: 'var(--text-subtle)',
  };

  const projects = data ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {isLoading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>Loading…</div>
      ) : projects.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
          No skill projects yet.
          <div style={{ marginTop: 8 }}>
            <button className="ply-btn ply-btn-primary" onClick={onNew}><Icon name="plus" size={13} /> Create first project</button>
          </div>
        </div>
      ) : (
        projects.map(p => (
          <div key={p.id} onClick={() => onSelect(p)}
            className="ply-card" style={{ padding: '14px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--primary-soft)', border: '1px solid var(--primary-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', flexShrink: 0 }}>
              <Icon name="bolt" size={15} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: 13.5, marginBottom: 2 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.task_description}</div>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
              {p.example_count != null && <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{p.example_count} examples</span>}
              {p.score_after != null && (
                <span className="ply-pill ply-pill-success" style={{ fontSize: 11 }}>{(p.score_after * 100).toFixed(1)}%</span>
              )}
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[p.status] ?? 'var(--text-subtle)', flexShrink: 0 }} />
              <Icon name="chevronR" size={14} color="var(--text-subtle)" />
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */
export default function SkillOptPage() {
  const [view, setView] = useState<'list' | 'create' | 'project'>('list');
  const [selected, setSelected] = useState<SkillProject | null>(null);

  if (view === 'project' && selected) {
    return (
      <div style={{ height: '100%', overflow: 'hidden' }}>
        <SkillWorkspace project={selected} onBack={() => { setView('list'); setSelected(null); }} />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Skill Optimizer"
        subtitle="SkillOpt evolves a compact skill document for your task domain — arXiv:2605.23904"
      />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 28px 80px' }}>
        <div style={{ maxWidth: 800, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Top action */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              {view === 'create' && (
                <button className="ply-btn ply-btn-sm" onClick={() => setView('list')}>← Back to projects</button>
              )}
            </div>
            {view === 'list' && (
              <button className="ply-btn ply-btn-primary" onClick={() => setView('create')}>
                <Icon name="plus" size={13} /> New project
              </button>
            )}
          </div>

          {view === 'create' ? (
            <CreateProjectForm onCreated={p => { setSelected(p); setView('project'); }} />
          ) : (
            <ProjectList
              onSelect={p => { setSelected(p); setView('project'); }}
              onNew={() => setView('create')}
            />
          )}
        </div>
      </div>
    </>
  );
}
