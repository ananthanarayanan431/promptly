'use client';

import type { DomainPrompt, DomainPromptStatus } from '@/types/domain-prompts';

const STATUS_LABELS: Record<DomainPromptStatus, string> = {
  pending: 'Queued',
  preparing_dataset: 'Building Dataset…',
  optimizing: 'Optimizing…',
  completed: 'Ready',
  failed: 'Failed',
};

const STATUS_COLORS: Record<DomainPromptStatus, string> = {
  pending: '#8a8a90',
  preparing_dataset: '#f59e0b',
  optimizing: '#7c5cff',
  completed: '#22c55e',
  failed: '#f43f5e',
};

function ScoreBadge({ before, after }: { before: number | null; after: number | null }) {
  if (before === null || after === null) return null;
  const pct = Math.round((after - before) * 100);
  const color = pct >= 0 ? '#22c55e' : '#f43f5e';
  return (
    <span style={{ fontSize: 11, color, fontFamily: 'var(--font-geist-mono, monospace)' }}>
      {pct >= 0 ? '+' : ''}{pct}% score
    </span>
  );
}

export function DomainCard({
  domain,
  onClick,
}: {
  domain: DomainPrompt;
  onClick: () => void;
}) {
  const statusColor = STATUS_COLORS[domain.status];
  const statusLabel = STATUS_LABELS[domain.status];
  const isRunning = domain.status === 'preparing_dataset' || domain.status === 'optimizing';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{
        background: '#141418',
        border: '1px solid #222226',
        borderRadius: 10,
        padding: '16px 18px',
        cursor: 'pointer',
        transition: 'border-color 150ms, background 150ms',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = '#7c5cff44';
        (e.currentTarget as HTMLDivElement).style.background = '#18181c';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = '#222226';
        (e.currentTarget as HTMLDivElement).style.background = '#141418';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          flex: 1, fontWeight: 600, fontSize: 14, color: '#ededed',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {domain.name}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
          background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
          color: '#fff', letterSpacing: '0.04em', flexShrink: 0,
        }}>
          PREMIUM
        </span>
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 20,
          background: `${statusColor}22`, color: statusColor, flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          {isRunning && (
            <span style={{
              width: 5, height: 5, borderRadius: '50%', background: statusColor,
              animation: 'dpPulse 1.4s ease-in-out infinite',
              display: 'inline-block',
            }} />
          )}
          {statusLabel}
        </span>
      </div>

      {domain.description && (
        <p style={{
          fontSize: 12.5, color: '#8a8a90', margin: 0,
          overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
        }}>
          {domain.description}
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
        {domain.dataset?.row_count != null && (
          <span style={{
            fontSize: 11, color: '#5a5a60',
            fontFamily: 'var(--font-geist-mono, monospace)',
          }}>
            {domain.dataset.row_count} data sources
          </span>
        )}
        {domain.optimized_prompt && (
          <ScoreBadge before={domain.score_before} after={domain.score_after} />
        )}
      </div>

      <style>{`
        @keyframes dpPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
