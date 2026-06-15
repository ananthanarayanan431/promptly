'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DomainPrompt, QAPair, DatasetRowsResponse } from '@/types/domain-prompts';

interface Props {
  domain: DomainPrompt;
  onClose: () => void;
  onReoptimize: (prompt: string) => void;
  onDeleted: () => void;
  reoptimizing: boolean;
}

type Tab = 'optimize' | 'dataset';

export function DomainDetail({ domain, onClose, onReoptimize, onDeleted, reoptimizing }: Props) {
  const [tab, setTab] = useState<Tab>('optimize');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();

  const isRunning = domain.status === 'pending' || domain.status === 'preparing_dataset' || domain.status === 'optimizing';

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.delete(`/api/v1/domain-prompts/${domain.id}`);
      void qc.invalidateQueries({ queryKey: ['domain-prompts'] });
      onDeleted();
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={domain.name}
        style={{
          background: '#101014', border: '1px solid #222226', borderRadius: 14,
          width: '100%', maxWidth: 860, height: '90vh',
          fontFamily: 'var(--font-geist, ui-sans-serif)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{ padding: '18px 24px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#ededed' }}>
                  {domain.name}
                </h2>
                <StatusPill domain={domain} />
              </div>
              {domain.description && (
                <p style={{ margin: '2px 0 0', fontSize: 12.5, color: '#6a6a72' }}>
                  {domain.description}
                </p>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
              {confirmDelete ? (
                <>
                  <span style={{ fontSize: 12, color: '#f43f5e' }}>Delete domain + dataset?</span>
                  <button
                    onClick={handleDelete} disabled={deleting}
                    style={{
                      padding: '4px 10px', borderRadius: 5, border: 'none',
                      background: '#f43f5e', color: '#fff', fontSize: 12,
                      fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer',
                      opacity: deleting ? 0.6 : 1,
                    }}
                  >
                    {deleting ? 'Deleting…' : 'Yes, delete'}
                  </button>
                  <button onClick={() => setConfirmDelete(false)} style={ghostBtnSm}>
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Delete domain"
                  title="Delete domain"
                  style={{ background: 'none', border: 'none', color: '#4a4a52', cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                    <path d="M10 11v6M14 11v6M9 6V4h6v2" />
                  </svg>
                </button>
              )}
              <button onClick={onClose} aria-label="Close" style={{
                background: 'none', border: 'none', color: '#5a5a60', cursor: 'pointer',
                fontSize: 20, lineHeight: 1, padding: '0 2px',
              }}>×</button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid #1a1a1e' }}>
            {(['optimize', 'dataset'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '7px 16px', fontSize: 13, fontWeight: tab === t ? 600 : 400,
                  color: tab === t ? '#ededed' : '#5a5a60',
                  borderBottom: `2px solid ${tab === t ? '#7c5cff' : 'transparent'}`,
                  marginBottom: -1, transition: 'color 100ms',
                }}
              >
                {t === 'optimize' ? 'Optimize' : 'Dataset'}
                {t === 'dataset' && domain.dataset?.row_count != null && (
                  <span style={{
                    marginLeft: 6, fontSize: 10, background: 'rgba(124,92,255,0.15)',
                    color: '#7c5cff', padding: '1px 5px', borderRadius: 3,
                    fontFamily: 'var(--font-geist-mono, monospace)',
                  }}>
                    {domain.dataset.row_count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tab bodies ── */}
        {tab === 'optimize' && (
          <OptimizeTab
            domain={domain}
            isRunning={isRunning}
            reoptimizing={reoptimizing}
            onReoptimize={onReoptimize}
          />
        )}
        {tab === 'dataset' && <DatasetTab domain={domain} />}
      </div>

      <style>{`@keyframes ddPulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
    </div>
  );
}

// ── Status pill ───────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  pending: '#6a6a72',
  preparing_dataset: '#f59e0b',
  optimizing: '#7c5cff',
  completed: '#22c55e',
  failed: '#f43f5e',
};

function StatusPill({ domain }: { domain: DomainPrompt }) {
  const isRunning = domain.status === 'pending' || domain.status === 'preparing_dataset' || domain.status === 'optimizing';
  const c = STATUS_COLOR[domain.status] ?? '#6a6a72';
  const label = {
    pending: 'Pending', preparing_dataset: 'Building dataset',
    optimizing: 'Optimizing', completed: 'Ready', failed: 'Failed', cancelled: 'Cancelled',
  }[domain.status] ?? domain.status;

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, padding: '2px 7px', borderRadius: 4,
      background: `${c}1a`, color: c,
    }}>
      {isRunning && (
        <span style={{
          width: 5, height: 5, borderRadius: '50%', background: c,
          animation: 'ddPulse 1.4s ease-in-out infinite', display: 'inline-block',
        }} />
      )}
      {label}
    </span>
  );
}

// ── Progress steps definition ─────────────────────────────────────────────────
// Times are approximate seconds from job start at which each step becomes active.
// The optimizing job takes ~3-6 min total; steps are spaced to feel live.

const DATASET_STEPS = [
  { at: 0,   icon: '📄', label: 'Reading your document',        detail: 'Extracting text from the uploaded PDF.' },
  { at: 8,   icon: '✂️', label: 'Breaking it into sections',    detail: 'Splitting the document into manageable chunks for analysis.' },
  { at: 18,  icon: '💡', label: 'Generating questions & answers', detail: 'Creating a set of Q&A pairs that capture the key knowledge in your document.' },
  { at: 45,  icon: '✅', label: 'Saving your knowledge base',    detail: 'Storing the dataset so it can be reused for every future prompt run.' },
];

const OPTIMIZE_STEPS = [
  { at: 0,   icon: '🔍', label: 'Reading your prompt',           detail: 'Understanding the intent and structure of the prompt you submitted.' },
  { at: 8,   icon: '✏️', label: 'Drafting prompt variations',    detail: 'Creating several rewritten versions that might perform better.' },
  { at: 22,  icon: '⚔️', label: 'Running head-to-head trials',   detail: 'Pitting prompt versions against each other on real questions from your knowledge base.' },
  { at: 80,  icon: '🔄', label: 'Refining the best version',     detail: 'Taking the current leader and generating smarter follow-up variations.' },
  { at: 140, icon: '📊', label: 'Measuring the improvement',     detail: 'Scoring the winning prompt on a separate set of questions it hasn\'t seen before.' },
  { at: 190, icon: '🏆', label: 'Selecting the winner',          detail: 'Picking the single best prompt from all the candidates tried.' },
];

// ── Optimize Tab ──────────────────────────────────────────────────────────────

function OptimizeTab({ domain, isRunning, reoptimizing, onReoptimize }: {
  domain: DomainPrompt;
  isRunning: boolean;
  reoptimizing: boolean;
  onReoptimize: (p: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  const hasResult = !!domain.optimized_prompt && !!domain.last_prompt;
  const busy = isRunning || reoptimizing;
  const datasetReady = !!domain.dataset?.dataset_key;
  const canSubmit = datasetReady && !busy && draft.trim().length >= 10;

  // Track elapsed seconds while busy so progress steps animate forward
  useEffect(() => {
    if (!busy) { startRef.current = null; setElapsed(0); return; }
    if (startRef.current === null) startRef.current = Date.now();
    const iv = setInterval(() => {
      setElapsed(Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [busy]);


  function copyResult() {
    if (!domain.optimized_prompt) return;
    navigator.clipboard.writeText(domain.optimized_prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  }

  function submit() {
    if (!canSubmit) return;
    const t = draft.trim();
    setDraft('');
    onReoptimize(t);
  }

  const isDatasetPhase = isRunning && domain.status === 'preparing_dataset';
  const steps = isDatasetPhase ? DATASET_STEPS : OPTIMIZE_STEPS;
  // current active step = last step whose `at` threshold has been crossed
  const activeStep = steps.reduce((acc, s, i) => (elapsed >= s.at ? i : acc), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

      {/* ── Result area (scrollable) ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

        {/* Empty state */}
        {!hasResult && !busy && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', gap: 12, textAlign: 'center',
          }}>
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none"
              stroke="#2a2a3e" strokeWidth="1">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 12h8M12 8l4 4-4 4" />
            </svg>
            <p style={{ margin: 0, fontSize: 13, color: '#4a4a58', maxWidth: 340 }}>
              {datasetReady
                ? 'Paste your system prompt below and click Run. The optimizer will test multiple versions and return the best one.'
                : 'Dataset is still being built from your PDF. Come back in a moment.'}
            </p>
          </div>
        )}

        {/* In-progress: step tracker */}
        {busy && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', minHeight: '100%', padding: '20px 0',
          }}>
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <p style={{ margin: '0 0 6px', fontSize: 15, color: '#a78bfa', fontWeight: 700 }}>
                {isDatasetPhase ? 'Building your knowledge base…' : 'Optimizing your prompt…'}
              </p>
              <p style={{ margin: 0, fontSize: 12, color: '#4a4a58' }}>
                {isDatasetPhase
                  ? 'This usually takes under a minute.'
                  : 'This usually takes 3–6 minutes. Feel free to leave and come back.'}
              </p>
            </div>

            {/* Step list */}
            <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 0 }}>
              {steps.map((step, i) => {
                const done = i < activeStep;
                const active = i === activeStep;
                const pending = i > activeStep;
                return (
                  <div key={i} style={{ display: 'flex', gap: 0, alignItems: 'stretch' }}>
                    {/* Left: icon + connector line */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 36, flexShrink: 0 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: done ? 14 : (active ? 15 : 13),
                        background: done ? '#22c55e1a' : (active ? 'rgba(124,92,255,0.15)' : '#1a1a1e'),
                        border: `1.5px solid ${done ? '#22c55e44' : (active ? 'rgba(124,92,255,0.5)' : '#222228')}`,
                        transition: 'all 0.4s ease',
                        position: 'relative',
                      }}>
                        {done
                          ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                          : <span style={{ opacity: pending ? 0.3 : 1 }}>{step.icon}</span>
                        }
                        {active && (
                          <span style={{
                            position: 'absolute', inset: -3, borderRadius: '50%',
                            border: '1.5px solid rgba(124,92,255,0.3)',
                            animation: 'ripple 2s ease-out infinite',
                          }} />
                        )}
                      </div>
                      {i < steps.length - 1 && (
                        <div style={{
                          width: 1.5, flex: 1, minHeight: 16,
                          background: done ? '#22c55e44' : '#1f1f23',
                          transition: 'background 0.4s ease',
                        }} />
                      )}
                    </div>

                    {/* Right: text */}
                    <div style={{ paddingLeft: 12, paddingBottom: i < steps.length - 1 ? 20 : 0, paddingTop: 4 }}>
                      <p style={{
                        margin: '0 0 2px', fontSize: 13, fontWeight: active ? 600 : 500,
                        color: done ? '#5a5a60' : (active ? '#ededed' : '#3a3a48'),
                        transition: 'color 0.3s',
                      }}>
                        {step.label}
                      </p>
                      {(active || done) && (
                        <p style={{
                          margin: 0, fontSize: 11.5, color: done ? '#3a3a48' : '#5a5a66',
                          lineHeight: 1.5,
                        }}>
                          {step.detail}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Elapsed time */}
            <p style={{ margin: '28px 0 0', fontSize: 11, color: '#2e2e38' }}>
              {Math.floor(elapsed / 60) > 0
                ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed`
                : `${elapsed}s elapsed`}
            </p>
          </div>
        )}

        {/* Result */}
        {hasResult && !busy && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {/* Stats bar */}
            <div style={{
              display: 'flex', gap: 0, marginBottom: 20,
              background: '#141418', border: '1px solid #1f1f23',
              borderRadius: 10, overflow: 'hidden',
            }}>
              <ScoreCell
                label="Tournament win rate"
                value={domain.win_rate !== null ? `${Math.round(domain.win_rate * 100)}%` : '—'}
                color={domain.win_rate !== null && domain.win_rate >= 0.6 ? '#22c55e' : '#f59e0b'}
                tooltip="How often the winning prompt beat rivals in head-to-head trials"
              />
              <div style={{ width: 1, background: '#1f1f23' }} />
              <ScoreCell
                label="Prompts tested"
                value={domain.candidates_tried !== null ? String(domain.candidates_tried) : '—'}
                color="#7c5cff"
                tooltip="Total prompt variants generated and evaluated during optimisation"
              />
              <div style={{ width: 1, background: '#1f1f23' }} />
              <ScoreCell
                label="Head-to-head trials"
                value="40"
                color="#a78bfa"
                tooltip="Number of pairwise duels run using Double Thompson Sampling"
              />
              {domain.dataset?.row_count != null && (
                <>
                  <div style={{ width: 1, background: '#1f1f23' }} />
                  <ScoreCell
                    label="Knowledge sources"
                    value={String(domain.dataset.row_count)}
                    color="#38bdf8"
                    tooltip="Q&A pairs from your PDF used to judge prompt quality"
                  />
                </>
              )}
            </div>

            {/* Two-column: input left, result right */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <PromptPane
                label="INPUT PROMPT"
                content={domain.last_prompt!}
                accent="#2a2a3e"
                labelColor="#6a6a72"
              />
              <PromptPane
                label="PDO OPTIMIZED"
                content={domain.optimized_prompt!}
                accent="rgba(124,92,255,0.15)"
                labelColor="#7c5cff"
                highlight
                copyLabel={copied ? '✓ Copied' : 'Copy'}
                onCopy={copyResult}
              />
            </div>

            <p style={{ margin: '14px 0 0', fontSize: 11, color: '#3a3a48', textAlign: 'center' }}>
              Run another prompt below to replace this result.
            </p>
          </div>
        )}
      </div>

      {/* ── Input form (fixed at bottom) ── */}
      {datasetReady && (
        <div style={{
          padding: '14px 24px 20px',
          borderTop: '1px solid #1a1a1e',
          flexShrink: 0,
          background: '#101014',
        }}>
          <label style={{
            display: 'block', fontSize: 11, color: '#4a4a58', marginBottom: 7,
            fontFamily: 'var(--font-geist-mono, monospace)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {hasResult ? 'Run another prompt' : 'System prompt to optimize'}
          </label>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
            placeholder="Paste your system prompt here… (⌘↵ to run)"
            disabled={busy}
            style={{
              width: '100%', minHeight: 80, maxHeight: 160,
              padding: '10px 12px', borderRadius: 8,
              border: '1px solid #222228', background: busy ? '#0e0e12' : '#141418',
              color: '#d4d4d8', fontSize: 12.5, lineHeight: 1.6,
              resize: 'vertical', outline: 'none', boxSizing: 'border-box',
              fontFamily: 'var(--font-geist-mono, monospace)',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 11, color: '#3a3a48' }}>
              40 tournament rounds · Double Thompson Sampling
            </span>
            <button
              onClick={submit}
              disabled={!canSubmit}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: canSubmit ? '#7c5cff' : '#1e1e26',
                color: canSubmit ? '#fff' : '#3a3a48',
                fontWeight: 600, fontSize: 13,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                transition: 'background 120ms',
              }}
            >
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                background: 'rgba(255,255,255,0.18)', color: canSubmit ? '#fff' : '#3a3a48',
              }}>PREMIUM</span>
              {busy ? 'Running…' : 'Run PDO  ·  10 cr'}
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes ripple{0%{transform:scale(1);opacity:0.6}100%{transform:scale(1.9);opacity:0}}
      `}</style>
    </div>
  );
}

function ScoreCell({ label, value, color, tooltip }: {
  label: string; value: string; color: string; tooltip?: string;
}) {
  return (
    <div
      title={tooltip}
      style={{ flex: 1, padding: '10px 14px', textAlign: 'center', cursor: tooltip ? 'help' : undefined }}
    >
      <div style={{
        fontSize: 18, fontWeight: 700, color,
        fontFamily: 'var(--font-geist-mono, monospace)', lineHeight: 1,
      }}>{value}</div>
      <div style={{ fontSize: 10, color: '#4a4a58', marginTop: 4 }}>{label}</div>
    </div>
  );
}

function PromptPane({ label, content, accent, labelColor, highlight, copyLabel, onCopy }: {
  label: string; content: string; accent: string; labelColor: string;
  highlight?: boolean; copyLabel?: string; onCopy?: () => void;
}) {
  return (
    <div style={{
      background: highlight ? 'rgba(124,92,255,0.04)' : '#0c0c10',
      border: `1px solid ${highlight ? 'rgba(124,92,255,0.18)' : '#1a1a1e'}`,
      borderRadius: 10, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderBottom: `1px solid ${highlight ? 'rgba(124,92,255,0.12)' : '#1a1a1e'}`,
        background: accent,
      }}>
        <span style={{
          fontSize: 10, fontWeight: 700, color: labelColor,
          fontFamily: 'var(--font-geist-mono, monospace)', letterSpacing: '0.06em',
        }}>{label}</span>
        {onCopy && copyLabel && (
          <button onClick={onCopy} style={{
            background: 'none', border: `1px solid ${labelColor}44`,
            borderRadius: 4, padding: '2px 8px', fontSize: 10,
            color: labelColor, cursor: 'pointer',
          }}>{copyLabel}</button>
        )}
      </div>
      <pre style={{
        margin: 0, padding: '12px 14px',
        fontSize: 12, color: '#c4c4cc',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6,
        fontFamily: 'var(--font-geist-mono, monospace)',
        maxHeight: 320, overflowY: 'auto',
      }}>
        {content}
      </pre>
    </div>
  );
}

// ── Dataset Tab ───────────────────────────────────────────────────────────────

function DatasetTab({ domain }: { domain: DomainPrompt }) {
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [editRows, setEditRows] = useState<QAPair[]>([]);
  const [saving, setSaving] = useState(false);
  const [augmentCount, setAugmentCount] = useState(10);
  const [augmenting, setAugmenting] = useState(false);
  const [pollingAugJob, setPollingAugJob] = useState<string | null>(null);

  const { data, isLoading } = useQuery<DatasetRowsResponse>({
    queryKey: ['domain-dataset', domain.id],
    queryFn: async () => {
      const res = await api.get<{ data: DatasetRowsResponse }>(
        `/api/v1/domain-prompts/${domain.id}/dataset`
      );
      return res.data.data;
    },
    enabled: !!domain.dataset?.dataset_key,
  });

  useEffect(() => {
    if (!pollingAugJob) return;
    const iv = setInterval(async () => {
      try {
        const res = await api.get<{ data: { status: string } }>(
          `/api/v1/domain-prompts/jobs/${pollingAugJob}`
        );
        const { status } = res.data.data;
        if (status === 'completed' || status === 'failed') {
          setPollingAugJob(null);
          setAugmenting(false);
          void qc.invalidateQueries({ queryKey: ['domain-dataset', domain.id] });
          void qc.invalidateQueries({ queryKey: ['domain-prompts'] });
        }
      } catch {
        setPollingAugJob(null);
        setAugmenting(false);
      }
    }, 2500);
    return () => clearInterval(iv);
  }, [pollingAugJob, domain.id, qc]);

  const saveMutation = useMutation({
    mutationFn: async (rows: QAPair[]) => {
      const res = await api.put<{ data: DatasetRowsResponse }>(
        `/api/v1/domain-prompts/${domain.id}/dataset`,
        { rows }
      );
      return res.data.data;
    },
    onSuccess: () => {
      setSaving(false);
      setEditMode(false);
      void qc.invalidateQueries({ queryKey: ['domain-dataset', domain.id] });
      void qc.invalidateQueries({ queryKey: ['domain-prompts'] });
    },
    onError: () => setSaving(false),
  });

  async function handleAugment() {
    setAugmenting(true);
    try {
      const res = await api.post<{ data: { job_id: string } }>(
        `/api/v1/domain-prompts/${domain.id}/dataset/augment`,
        { count: augmentCount }
      );
      setPollingAugJob(res.data.data.job_id);
    } catch {
      setAugmenting(false);
    }
  }

  function startEdit() { setEditRows(data?.rows ?? []); setEditMode(true); }
  function cancelEdit() { setEditMode(false); setEditRows([]); }
  function addRow() { setEditRows(r => [...r, { question: '', answer: '' }]); }
  function removeRow(i: number) { setEditRows(r => r.filter((_, idx) => idx !== i)); }
  function updateRow(i: number, field: 'question' | 'answer', v: string) {
    setEditRows(r => r.map((row, idx) => idx === i ? { ...row, [field]: v } : row));
  }

  const rows = data?.rows ?? [];

  if (!domain.dataset?.dataset_key) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a4a58', fontSize: 13 }}>
        Dataset not yet available.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a4a58', fontSize: 13 }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 24px', borderBottom: '1px solid #1a1a1e', flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, color: '#4a4a58', flex: 1 }}>
          {rows.length} data sources used for PDO judging
        </span>
        {!editMode && (
          <>
            <button onClick={startEdit} style={ghostBtnSm}>Edit</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 11, color: '#4a4a58' }}>Generate</span>
              <input
                type="number" min={1} max={50} value={augmentCount}
                onChange={e => setAugmentCount(Math.max(1, Math.min(50, Number(e.target.value))))}
                style={{
                  width: 38, padding: '3px 6px', borderRadius: 5, border: '1px solid #222228',
                  background: '#141418', color: '#ededed', fontSize: 12,
                  textAlign: 'center', outline: 'none',
                }}
              />
              <span style={{ fontSize: 11, color: '#4a4a58' }}>more</span>
              <button
                onClick={handleAugment}
                disabled={augmenting || !!pollingAugJob}
                style={{
                  ...ghostBtnSm,
                  ...(augmenting || pollingAugJob ? { color: '#3a3a48', borderColor: '#1f1f23' } : {}),
                }}
              >
                {augmenting || pollingAugJob ? 'Generating…' : 'Go'}
              </button>
            </div>
          </>
        )}
        {editMode && (
          <>
            <button onClick={addRow} style={ghostBtnSm}>+ Row</button>
            <button
              onClick={() => {
                setSaving(true);
                saveMutation.mutate(editRows.filter(r => r.question.trim() && r.answer.trim()));
              }}
              disabled={saving}
              style={{ ...primaryBtnSm, opacity: saving ? 0.5 : 1 }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={cancelEdit} style={ghostBtnSm}>Cancel</button>
          </>
        )}
      </div>

      {/* Row list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px 20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {(editMode ? editRows : rows).map((row, i) => (
            <div key={i} style={{
              background: '#0e0e12', border: '1px solid #1a1a1e',
              borderRadius: 8, padding: '9px 12px',
            }}>
              {editMode ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 10, color: '#7c5cff', fontWeight: 700, width: 14, paddingTop: 5, flexShrink: 0 }}>Q</span>
                    <textarea value={row.question} onChange={e => updateRow(i, 'question', e.target.value)}
                      style={{ ...editAreaStyle, minHeight: 36 }} placeholder="Question" />
                    <button onClick={() => removeRow(i)} aria-label="Remove row" style={{
                      background: 'none', border: 'none', color: '#4a4a52', cursor: 'pointer',
                      fontSize: 16, padding: '1px 3px', flexShrink: 0,
                    }}>×</button>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 700, width: 14, paddingTop: 5, flexShrink: 0 }}>A</span>
                    <textarea value={row.answer} onChange={e => updateRow(i, 'answer', e.target.value)}
                      style={{ ...editAreaStyle, minHeight: 36 }} placeholder="Answer" />
                    <div style={{ width: 20, flexShrink: 0 }} />
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: '#7c5cff', fontWeight: 700, flexShrink: 0, paddingTop: 2 }}>Q</span>
                    <p style={{ margin: 0, fontSize: 12.5, color: '#c4c4cc', lineHeight: 1.5 }}>{row.question}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 700, flexShrink: 0, paddingTop: 2 }}>A</span>
                    <p style={{ margin: 0, fontSize: 12.5, color: '#6a6a72', lineHeight: 1.5 }}>{row.answer}</p>
                  </div>
                </>
              )}
            </div>
          ))}
          {rows.length === 0 && !editMode && (
            <div style={{ color: '#4a4a58', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
              No data sources yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Shared micro-styles ───────────────────────────────────────────────────────

const ghostBtnSm: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 5, border: '1px solid #222228',
  background: 'transparent', color: '#8a8a94', fontSize: 12,
  cursor: 'pointer', fontWeight: 500,
};

const primaryBtnSm: React.CSSProperties = {
  padding: '4px 12px', borderRadius: 5, border: 'none',
  background: '#7c5cff', color: '#fff', fontSize: 12,
  cursor: 'pointer', fontWeight: 600,
};

const editAreaStyle: React.CSSProperties = {
  flex: 1, padding: '5px 8px', borderRadius: 5, border: '1px solid #222228',
  background: '#141418', color: '#d4d4d8', fontSize: 12, lineHeight: 1.5,
  resize: 'vertical', outline: 'none', fontFamily: 'var(--font-geist-mono, monospace)',
};
