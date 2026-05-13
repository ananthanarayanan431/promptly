'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { TransferJobSummary } from '@/types/bridge';

function shortModel(slug: string) {
  const parts = slug.split('/');
  return parts[parts.length - 1];
}

// Full calibration: 5 stages (index 0-4)
const FULL_STAGES = [
  { key: 'queued',             label: 'Queued' },
  { key: 'calibrating_source', label: 'Calibrating source' },
  { key: 'calibrating_target', label: 'Calibrating target' },
  { key: 'extracting_mapping', label: 'Extracting mapping' },
  { key: 'adapting',           label: 'Adapting' },
];
// Cached reuse: 3 stages
const REUSE_STAGES = [
  { key: 'queued',   label: 'Queued' },
  { key: 'adapting', label: 'Loading mapping' },
  { key: 'done',     label: 'Adapting' },
];

const FULL_STAGE_IDX: Record<string, number> = {
  queued: 0, calibrating: 1, calibrating_source: 1,
  calibrating_target: 2, extracting_mapping: 3, adapting: 4,
};
const REUSE_STAGE_IDX: Record<string, number> = {
  queued: 0, adapting: 1,
};

function stageMeta(effectiveStatus: string, liveStage: string | null, reused: boolean) {
  const stageMap = reused ? REUSE_STAGE_IDX : FULL_STAGE_IDX;
  const stages   = reused ? REUSE_STAGES    : FULL_STAGES;
  const isRunning = ['queued','started','calibrating','calibrating_source','calibrating_target','extracting_mapping','adapting'].includes(effectiveStatus);

  const idx   = isRunning ? (liveStage ? (stageMap[liveStage] ?? 0) : 0) : -1;
  const total = stages.length;

  let label = 'Queued';
  let color = 'var(--text-subtle)';
  if (!isRunning) {
    if (effectiveStatus === 'completed') { label = 'Transferred'; color = 'var(--success)'; }
    else if (effectiveStatus === 'failed')    { label = 'Failed';      color = 'var(--danger)';  }
    else if (effectiveStatus === 'cancelled') { label = 'Cancelled';   color = 'var(--warning)'; }
  } else {
    if (idx > 0) { label = stages[idx]?.label ?? 'Working…'; color = 'var(--primary)'; }
    else         { label = 'Queued'; color = 'var(--text-subtle)'; }
  }

  return { label, color, running: isRunning, stageIdx: idx, stageTotal: total };
}

function StageBar({ running, stageIdx, stageTotal, color }: {
  running: boolean; stageIdx: number; stageTotal: number; color: string;
}) {
  if (!running) {
    // Static single bar for done/failed/cancelled — no segments
    return (
      <div style={{ height: 3, borderRadius: 2, background: `color-mix(in srgb, ${color} 25%, transparent)` }} />
    );
  }
  // Segmented bar: one segment per stage
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center', padding: '2px 0' }}>
      {Array.from({ length: stageTotal }).map((_, i) => {
        const done   = i < stageIdx;
        const active = i === stageIdx;
        return (
          <div
            key={i}
            style={{
              flex: 1, height: 3, borderRadius: 2,
              background: done
                ? `color-mix(in srgb, ${color} 60%, transparent)`
                : active
                ? color
                : 'var(--border)',
              overflow: 'hidden',
              position: 'relative',
              transition: 'background 400ms',
            }}
          >
            {active && (
              <div style={{
                position: 'absolute', inset: 0,
                background: `linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)`,
                animation: 'brgShimmer 1.4s ease-in-out infinite',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function BridgeCard({
  job,
  liveStatus,
  liveStage,
  onClick,
  onCancelled,
  onDeleted,
}: {
  job: TransferJobSummary;
  liveStatus?: string | null;
  liveStage?: string | null;
  onClick: () => void;
  onCancelled: (jobId: string) => void;
  onDeleted: (jobId: string) => void;
}) {
  const effectiveStatus = liveStatus ?? job.status;
  const { label, color, running, stageIdx, stageTotal } = stageMeta(effectiveStatus, liveStage ?? null, job.reused_mapping);
  const src = shortModel(job.source_model);
  const tgt = shortModel(job.target_model);

  const [hovered, setHovered] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const canStop = running;
  const canDelete = !running;

  async function handleStop(e: React.MouseEvent) {
    e.stopPropagation();
    setStopping(true);
    try {
      await api.post(`/api/v1/prompt-bridge/jobs/${job.id}/cancel-by-id`);
      onCancelled(job.id);
    } catch {
      // silently ignore — polling will eventually reflect the true state
    } finally {
      setStopping(false);
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      await api.delete(`/api/v1/prompt-bridge/jobs/${job.id}`);
      onDeleted(job.id);
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setConfirmDelete(false); }}
      style={{
        background: hovered ? 'var(--surface-2)' : 'var(--surface)',
        border: `1px solid ${hovered ? 'var(--primary-ring)' : 'var(--border)'}`,
        borderRadius: 11,
        padding: '14px 16px',
        cursor: 'pointer',
        transition: 'border-color 160ms, background 160ms',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
          background: job.reused_mapping
            ? 'linear-gradient(135deg, #0ea5e9, #6366f1)'
            : 'linear-gradient(135deg, var(--primary), #a855f7)',
          color: '#fff', letterSpacing: '0.05em', flexShrink: 0,
        }}>
          {job.reused_mapping ? 'CACHED' : 'FULL'}
        </span>
        <span style={{
          flex: 1, fontSize: 12, color: 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontFamily: 'var(--font-geist-mono, monospace)',
        }}>
          {src} → {tgt}
        </span>
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 20, flexShrink: 0,
          background: 'var(--surface-2)', color,
          display: 'flex', alignItems: 'center', gap: 4,
          border: '1px solid var(--border)',
        }}>
          {running && (
            <span style={{
              width: 5, height: 5, borderRadius: '50%', background: color,
              animation: 'brgPulse 1.4s ease-in-out infinite',
              display: 'inline-block', flexShrink: 0,
            }} />
          )}
          {label}
        </span>
      </div>

      <StageBar running={running} stageIdx={stageIdx} stageTotal={stageTotal} color={color} />

      {/* Footer: credits + action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: 11, color: 'var(--text-subtle)',
          fontFamily: 'var(--font-geist-mono, monospace)', flex: 1,
        }}>
          {job.credits_charged} credit{job.credits_charged !== 1 ? 's' : ''}
        </span>

        {/* Actions — fade in on hover */}
        <div style={{
          display: 'flex', gap: 6,
          opacity: hovered ? 1 : 0,
          transition: 'opacity 150ms',
          pointerEvents: hovered ? 'auto' : 'none',
        }}>
          {canStop && (
            <button
              onClick={handleStop}
              disabled={stopping}
              title="Stop transfer"
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '3px 9px', borderRadius: 6,
                border: '1px solid var(--warning)', background: 'var(--warning-soft)',
                color: 'var(--warning)', fontSize: 11, fontWeight: 600,
                cursor: stopping ? 'not-allowed' : 'pointer',
                opacity: stopping ? 0.6 : 1,
              }}
            >
              {stopping
                ? <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', border: '1.5px solid var(--warning)', borderTopColor: 'transparent', animation: 'brgSpin 0.6s linear infinite' }} />
                : <svg width={9} height={9} viewBox="0 0 24 24" fill="var(--warning)"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
              }
              {stopping ? 'Stopping…' : 'Stop'}
            </button>
          )}

          {canDelete && (
            confirmDelete ? (
              <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  style={{
                    padding: '3px 9px', borderRadius: 6,
                    border: '1px solid var(--danger)', background: 'var(--danger)',
                    color: '#fff', fontSize: 11, fontWeight: 600,
                    cursor: deleting ? 'not-allowed' : 'pointer',
                    opacity: deleting ? 0.6 : 1,
                  }}
                >
                  {deleting ? 'Deleting…' : 'Confirm'}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); setConfirmDelete(false); }}
                  style={{
                    padding: '3px 8px', borderRadius: 6,
                    border: '1px solid var(--border)', background: 'var(--surface-3)',
                    color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={handleDelete}
                title="Delete job"
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '3px 9px', borderRadius: 6,
                  border: '1px solid var(--border)', background: 'var(--surface-3)',
                  color: 'var(--text-muted)', fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  transition: 'border-color 120ms, color 120ms',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--danger)';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--danger)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
                }}
              >
                <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                </svg>
                Delete
              </button>
            )
          )}
        </div>

        {job.status === 'failed' && !hovered && job.error_message && (
          <span style={{ fontSize: 11, color: 'var(--danger)' }}>
            {job.error_message.slice(0, 40)}
          </span>
        )}
      </div>

      <style>{`
        @keyframes brgPulse   { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes brgShimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(200%)} }
        @keyframes brgSpin    { to{transform:rotate(360deg)} }
      `}</style>
    </div>
  );
}
