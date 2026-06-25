'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import type { TransferJobSummary, PromptMappingDetail } from '@/types/bridge';

function shortModel(slug: string) {
  const parts = slug.split('/');
  return parts[parts.length - 1];
}

// ── Step definitions ──────────────────────────────────────────────────────────
const FULL_STEPS = [
  { at: 0,   icon: '⏳', label: 'Queued',                    detail: 'Waiting for a worker to pick up this job.' },
  { at: 4,   icon: '🔬', label: 'Calibrating source model',  detail: 'Running MAP-RPE to find the optimal prompt phrasing for the source model.' },
  { at: 60,  icon: '🎯', label: 'Calibrating target model',  detail: 'Doing the same for the target model so we understand its style and behaviour.' },
  { at: 120, icon: '🗺️', label: 'Extracting mapping rules',  detail: 'Analysing the difference between the two optimal prompts to build transfer rules.' },
  { at: 150, icon: '✨', label: 'Adapting your prompt',       detail: 'Applying the mapping to rewrite your prompt for the target model.' },
];

const REUSE_STEPS = [
  { at: 0,  icon: '⚡', label: 'Queued',               detail: 'Waiting for a worker — cached mapping found, this will be fast.' },
  { at: 4,  icon: '📋', label: 'Loading mapping',      detail: 'Fetching your saved calibration rules for this model pair.' },
  { at: 10, icon: '✨', label: 'Adapting your prompt',  detail: 'Applying the cached mapping to rewrite your prompt.' },
];

const STAGE_TO_STEP_FULL: Record<string, number> = {
  queued: 0, calibrating: 1, calibrating_source: 1,
  calibrating_target: 2, extracting_mapping: 3, adapting: 4,
};
const STAGE_TO_STEP_REUSE: Record<string, number> = {
  queued: 0, adapting: 1,
};

// ── Status pill ───────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    queued:             { label: 'Queued',      color: 'var(--text-subtle)' },
    started:            { label: 'Running',     color: 'var(--primary)' },
    calibrating:        { label: 'Calibrating', color: 'var(--primary)' },
    calibrating_source: { label: 'Calibrating', color: 'var(--primary)' },
    calibrating_target: { label: 'Calibrating', color: 'var(--primary)' },
    extracting_mapping: { label: 'Mapping',     color: 'var(--primary)' },
    adapting:           { label: 'Adapting',    color: 'var(--primary)' },
    completed:          { label: 'Transferred', color: 'var(--success)' },
    failed:             { label: 'Failed',      color: 'var(--danger)' },
    cancelled:          { label: 'Cancelled',   color: 'var(--warning)' },
  };
  const { label, color } = map[status] ?? { label: status, color: 'var(--text-subtle)' };
  const running = ['queued','started','calibrating','calibrating_source','calibrating_target','extracting_mapping','adapting'].includes(status);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
      background: `color-mix(in srgb, ${color} 12%, transparent)`, color,
    }}>
      {running && (
        <span style={{
          width: 5, height: 5, borderRadius: '50%', background: color,
          animation: 'tdPulse 1.4s ease-in-out infinite', display: 'inline-block',
        }} />
      )}
      {label}
    </span>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      style={{
        background: 'none',
        border: `1px solid ${copied ? 'var(--success)' : 'var(--primary-ring)'}`,
        borderRadius: 4, padding: '2px 8px', fontSize: 10,
        color: copied ? 'var(--success)' : 'var(--primary)',
        cursor: 'pointer', transition: 'color 180ms, border-color 180ms',
      }}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

// ── Prompt pane ───────────────────────────────────────────────────────────────
function PromptPane({ label, content, highlight, onCopy }: {
  label: string; content: string; highlight?: boolean; onCopy?: () => void;
}) {
  return (
    <div style={{
      background: highlight ? 'color-mix(in srgb, var(--primary) 4%, var(--bg))' : 'var(--surface)',
      border: `1px solid ${highlight ? 'var(--primary-ring)' : 'var(--border)'}`,
      borderRadius: 10, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: `1px solid ${highlight ? 'var(--primary-ring)' : 'var(--border)'}`,
        background: highlight ? 'color-mix(in srgb, var(--primary) 8%, transparent)' : 'var(--surface-2)',
      }}>
        <span style={{
          fontSize: 10, fontWeight: 700,
          color: highlight ? 'var(--primary)' : 'var(--text-subtle)',
          fontFamily: 'var(--font-geist-mono, monospace)', letterSpacing: '0.06em',
        }}>{label}</span>
        {onCopy && <CopyButton text={content} />}
      </div>
      <pre style={{
        margin: 0, padding: '12px 14px',
        fontSize: 12, color: 'var(--text-muted)',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6,
        fontFamily: 'var(--font-geist-mono, monospace)',
        maxHeight: 320, overflowY: 'auto',
      }}>{content}</pre>
    </div>
  );
}

// ── Stat cell ─────────────────────────────────────────────────────────────────
function StatCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: 1, padding: '10px 14px', textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: 'var(--font-geist-mono, monospace)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function TransferDetail({
  job,
  mapping,
  liveStatus,
  liveProgress,
  onClose,
  onRerun,
  onTryAnotherPrompt,
  onCancelled,
  onDeleted,
}: {
  job: TransferJobSummary;
  mapping: PromptMappingDetail | null;
  liveStatus?: string | null;
  liveProgress?: Record<string, unknown> | null;
  onClose: () => void;
  onRerun: () => void;
  onTryAnotherPrompt?: (sourceModel: string, targetModel: string) => void;
  onCancelled?: (jobId: string) => void;
  onDeleted?: (jobId: string) => void;
}) {
  const [stopping, setStopping]           = useState(false);
  const [deleting, setDeleting]           = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [elapsed, setElapsed]             = useState(0);
  const startRef                          = useRef<number | null>(null);

  const effectiveStatus = liveStatus ?? job.status;
  const liveStage = typeof liveProgress?.stage === 'string' ? liveProgress.stage : null;

  const isRunning = ['queued','started','calibrating','calibrating_source','calibrating_target','extracting_mapping','adapting']
    .includes(effectiveStatus);
  const isDone    = !isRunning;
  const hasResult = effectiveStatus === 'completed' && !!job.adapted_prompt;

  const steps    = job.reused_mapping ? REUSE_STEPS : FULL_STEPS;
  const stageMap = job.reused_mapping ? STAGE_TO_STEP_REUSE : STAGE_TO_STEP_FULL;
  const activeStep = isRunning
    ? (liveStage ? (stageMap[liveStage] ?? 0) : 0)
    : steps.length - 1;

  // Elapsed timer while running
  useEffect(() => {
    if (!isRunning) { startRef.current = null; setElapsed(0); return; }
    if (startRef.current === null) startRef.current = Date.now();
    const iv = setInterval(() => {
      setElapsed(Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [isRunning]);

  // Escape to close
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const src = shortModel(job.source_model);
  const tgt = shortModel(job.target_model);

  const elapsedLabel = Math.floor(elapsed / 60) > 0
    ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed`
    : `${elapsed}s elapsed`;

  async function handleStop() {
    setStopping(true);
    try {
      await api.post(`/api/v1/prompt-bridge/jobs/${job.id}/cancel-by-id`);
      onCancelled?.(String(job.id));
      onClose();
    } catch { setStopping(false); }
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      await api.delete(`/api/v1/prompt-bridge/jobs/${job.id}`);
      onDeleted?.(String(job.id));
      onClose();
    } catch { setDeleting(false); setConfirmDelete(false); }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(3px)',
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          width: '100%', maxWidth: 720, height: '88vh',
          fontFamily: 'var(--font-geist, ui-sans-serif)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: 'var(--shadow-lg, 0 24px 60px rgba(0,0,0,0.3))',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{
                  fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                  background: job.reused_mapping
                    ? 'linear-gradient(135deg, #0ea5e9, #6366f1)'
                    : 'linear-gradient(135deg, var(--primary), #a855f7)',
                  color: '#fff', letterSpacing: '0.04em',
                }}>
                  {job.reused_mapping ? 'CACHED' : 'FULL RUN'}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--text-subtle)', fontFamily: 'var(--font-geist-mono, monospace)' }}>
                  {src} → {tgt}
                </span>
                <StatusPill status={effectiveStatus} />
              </div>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                Transfer Detail
              </h2>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 16 }}>
              {isRunning && (
                <button
                  onClick={handleStop}
                  disabled={stopping}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 14px', borderRadius: 7,
                    border: '1px solid var(--warning)',
                    background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
                    color: 'var(--warning)', fontWeight: 600, fontSize: 12,
                    cursor: stopping ? 'not-allowed' : 'pointer',
                    opacity: stopping ? 0.6 : 1, transition: 'opacity 150ms',
                  }}
                >
                  {stopping
                    ? <span style={{ width: 10, height: 10, borderRadius: '50%', border: '1.5px solid var(--warning)', borderTopColor: 'transparent', animation: 'tdSpin 0.6s linear infinite', display: 'inline-block' }} />
                    : <svg width={9} height={9} viewBox="0 0 24 24" fill="var(--warning)"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
                  }
                  {stopping ? 'Stopping…' : 'Stop transfer'}
                </button>
              )}

              {isDone && (
                confirmDelete ? (
                  <>
                    <span style={{ fontSize: 12, color: 'var(--danger)' }}>Delete this job?</span>
                    <button
                      onClick={handleDelete} disabled={deleting}
                      style={{
                        padding: '5px 12px', borderRadius: 6, border: 'none',
                        background: 'var(--danger)', color: '#fff', fontSize: 12,
                        fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer',
                        opacity: deleting ? 0.6 : 1,
                      }}
                    >{deleting ? 'Deleting…' : 'Confirm'}</button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      style={{
                        padding: '5px 10px', borderRadius: 6,
                        border: '1px solid var(--border)',
                        background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
                      }}
                    >Cancel</button>
                  </>
                ) : (
                  <button
                    onClick={handleDelete}
                    style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }}
                    title="Delete job"
                    onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--danger)')}
                    onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--text-subtle)')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                      <path d="M10 11v6M14 11v6M9 6V4h6v2" />
                    </svg>
                  </button>
                )
              )}

              {isDone && effectiveStatus === 'completed' && onTryAnotherPrompt && (
                <button
                  onClick={() => { onTryAnotherPrompt(job.source_model, job.target_model); onClose(); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '6px 14px', borderRadius: 7,
                    border: '1px solid var(--primary-ring)',
                    background: 'color-mix(in srgb, var(--primary) 10%, transparent)',
                    color: 'var(--primary)', fontWeight: 600, fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
                    <path d="M14 5l7 7-7 7M3 12h18" />
                  </svg>
                  Try another prompt
                </button>
              )}

              {isDone && (
                <button
                  onClick={onRerun}
                  style={{
                    padding: '6px 14px', borderRadius: 7, border: 'none',
                    background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  New transfer
                </button>
              )}

              <button
                onClick={onClose}
                style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 2px' }}
              >×</button>
            </div>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* Running: step tracker */}
          {isRunning && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', minHeight: '100%', padding: '12px 0',
            }}>
              <div style={{ textAlign: 'center', marginBottom: 32 }}>
                <p style={{ margin: '0 0 6px', fontSize: 15, color: 'var(--primary)', fontWeight: 700 }}>
                  {job.reused_mapping ? 'Adapting via cached mapping…' : 'Calibrating model pair…'}
                </p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-subtle)' }}>
                  {job.reused_mapping
                    ? 'Using your saved mapping — this only takes a few seconds.'
                    : 'This usually takes 2–5 minutes. Feel free to leave and come back.'}
                </p>
              </div>

              {/* Live score chip */}
              {typeof liveProgress?.best_score === 'number' && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24,
                  background: 'color-mix(in srgb, var(--primary) 10%, transparent)',
                  border: '1px solid var(--primary-ring)',
                  borderRadius: 8, padding: '6px 14px',
                }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Best score so far</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)', fontFamily: 'var(--font-geist-mono, monospace)' }}>
                    {(liveProgress.best_score as number).toFixed(3)}
                  </span>
                  {typeof liveProgress.step === 'number' && typeof liveProgress.total === 'number' && (
                    <span style={{ fontSize: 11, color: 'var(--text-subtle)', fontFamily: 'var(--font-geist-mono, monospace)' }}>
                      · round {liveProgress.step as number}/{liveProgress.total as number}
                    </span>
                  )}
                </div>
              )}

              {/* Step list */}
              <div style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 0 }}>
                {steps.map((step, i) => {
                  const done    = i < activeStep;
                  const active  = i === activeStep;
                  const pending = i > activeStep;
                  return (
                    <div key={i} style={{ display: 'flex', gap: 0, alignItems: 'stretch' }}>
                      {/* Icon + connector line */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 40, flexShrink: 0 }}>
                        <div style={{
                          width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: done ? 14 : (active ? 16 : 13),
                          background: done
                            ? 'color-mix(in srgb, var(--success) 12%, transparent)'
                            : active
                            ? 'color-mix(in srgb, var(--primary) 15%, transparent)'
                            : 'var(--surface-2)',
                          border: `1.5px solid ${done ? 'color-mix(in srgb, var(--success) 40%, transparent)' : active ? 'var(--primary-ring)' : 'var(--border)'}`,
                          transition: 'all 0.4s ease',
                          position: 'relative',
                        }}>
                          {done
                            ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                            : <span style={{ opacity: pending ? 0.25 : 1 }}>{step.icon}</span>
                          }
                          {active && (
                            <span style={{
                              position: 'absolute', inset: -4, borderRadius: '50%',
                              border: '1.5px solid var(--primary-ring)',
                              animation: 'tdRipple 2s ease-out infinite',
                            }} />
                          )}
                        </div>
                        {i < steps.length - 1 && (
                          <div style={{
                            width: 1.5, flex: 1, minHeight: 18,
                            background: done ? 'color-mix(in srgb, var(--success) 35%, transparent)' : 'var(--border)',
                            transition: 'background 0.4s ease',
                          }} />
                        )}
                      </div>

                      {/* Text */}
                      <div style={{ paddingLeft: 14, paddingBottom: i < steps.length - 1 ? 22 : 0, paddingTop: 6 }}>
                        <p style={{
                          margin: '0 0 2px', fontSize: 13,
                          fontWeight: active ? 600 : 500,
                          color: done ? 'var(--text-subtle)' : active ? 'var(--text)' : 'var(--text-subtle)',
                          opacity: pending ? 0.5 : 1,
                          transition: 'color 0.3s, opacity 0.3s',
                        }}>
                          {step.label}
                        </p>
                        {(active || done) && (
                          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.5 }}>
                            {step.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <p style={{ margin: '28px 0 0', fontSize: 11, color: 'var(--text-subtle)', opacity: 0.5 }}>
                {elapsedLabel}
              </p>
            </div>
          )}

          {/* Completed: stats + result */}
          {hasResult && job.adapted_prompt && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Stats bar */}
              <div style={{
                display: 'flex', gap: 0,
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 10, overflow: 'hidden',
              }}>
                <StatCell label="Credits used" value={`${job.credits_charged}`} color="var(--primary)" />
                <div style={{ width: 1, background: 'var(--border)' }} />
                <StatCell label="Transfer type" value={job.reused_mapping ? 'Cached' : 'Full'} color={job.reused_mapping ? 'var(--primary)' : 'var(--text-muted)'} />
                <div style={{ width: 1, background: 'var(--border)' }} />
                <StatCell label="Mapping" value={mapping ? `${mapping.pair_count} pair${mapping.pair_count !== 1 ? 's' : ''}` : 'New'} color="var(--success)" />
                {mapping?.avg_target_score != null && (
                  <>
                    <div style={{ width: 1, background: 'var(--border)' }} />
                    <StatCell label="Target score" value={mapping.avg_target_score.toFixed(3)} color="var(--warning)" />
                  </>
                )}
              </div>

              {/* Source prompt */}
              <PromptPane
                label={`ORIGINAL — ${shortModel(job.source_model).toUpperCase()}`}
                content={job.source_prompt}
              />

              {/* Arrow divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 10px', borderRadius: 20,
                  background: 'color-mix(in srgb, var(--primary) 10%, transparent)',
                  border: '1px solid var(--primary-ring)',
                }}>
                  <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth={2.2} strokeLinecap="round">
                    <path d="M12 5v14M5 18l7 7 7-7" />
                  </svg>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary)', letterSpacing: '0.05em' }}>
                    BRIDGED
                  </span>
                </div>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>

              {/* Bridged prompt */}
              <PromptPane
                label={`BRIDGED FOR ${shortModel(job.target_model).toUpperCase()}`}
                content={job.adapted_prompt}
                highlight
                onCopy={() => navigator.clipboard.writeText(job.adapted_prompt!).catch(() => undefined)}
              />

              {mapping && <MappingPanel mapping={mapping} />}
            </div>
          )}

          {/* Failed */}
          {effectiveStatus === 'failed' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{
                background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
                border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
                borderRadius: 10, padding: '16px 18px',
                display: 'flex', alignItems: 'flex-start', gap: 12,
              }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth={1.8} strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
                  <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                </svg>
                <div>
                  <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: 'var(--danger)' }}>Transfer failed</p>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    {job.error_message ?? 'An unexpected error occurred during the transfer.'}
                  </p>
                </div>
              </div>
              <button
                onClick={onRerun}
                style={{
                  alignSelf: 'flex-start', padding: '8px 20px', borderRadius: 8, border: 'none',
                  background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
                }}
              >
                Try again
              </button>
            </div>
          )}

          {/* Cancelled */}
          {effectiveStatus === 'cancelled' && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', minHeight: '60%', gap: 14, textAlign: 'center',
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth={1.8} strokeLinecap="round">
                  <path d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10" />
                </svg>
              </div>
              <div>
                <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Transfer stopped</p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-subtle)', maxWidth: 340 }}>
                  Credits have been refunded. You can start a new transfer any time.
                </p>
              </div>
              <button
                onClick={onRerun}
                style={{
                  padding: '8px 20px', borderRadius: 8, border: 'none',
                  background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
                }}
              >
                Start new transfer
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes tdPulse  { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes tdSpin   { to{transform:rotate(360deg)} }
        @keyframes tdRipple { 0%{transform:scale(1);opacity:0.6} 100%{transform:scale(1.9);opacity:0} }
      `}</style>
    </div>
  );
}

// ── Mapping panel ─────────────────────────────────────────────────────────────
function MappingPanel({ mapping }: { mapping: PromptMappingDetail }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth={2} strokeLinecap="round"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 180ms', flexShrink: 0 }}>
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span style={{ fontSize: 11, color: 'var(--text-subtle)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          Mapping rules
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--primary)', fontFamily: 'var(--font-geist-mono, monospace)' }}>
          {shortModel(mapping.source_model)} → {shortModel(mapping.target_model)} · {mapping.pair_count} pairs
        </span>
      </button>
      {expanded && (
        <pre style={{
          margin: 0, padding: '12px 14px',
          borderTop: '1px solid var(--border)',
          fontSize: 11.5, color: 'var(--text-muted)',
          lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          fontFamily: 'var(--font-geist-mono, monospace)',
          maxHeight: 240, overflowY: 'auto',
        }}>{mapping.mapping_text}</pre>
      )}
    </div>
  );
}
