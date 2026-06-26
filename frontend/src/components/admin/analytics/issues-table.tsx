'use client';

import type { SentryIssue } from '@/types/analytics';

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const LEVEL_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  error:   { bg: 'color-mix(in oklab, #f43f5e 12%, transparent)', text: '#f43f5e',  label: 'ERROR' },
  warning: { bg: 'color-mix(in oklab, #f59e0b 12%, transparent)', text: '#f59e0b',  label: 'WARN' },
  info:    { bg: 'color-mix(in oklab, #06b6d4 12%, transparent)', text: '#06b6d4',  label: 'INFO' },
  debug:   { bg: 'color-mix(in oklab, #6b7280 12%, transparent)', text: '#6b7280',  label: 'DEBUG' },
};

function LevelBadge({ level }: { level: string }) {
  const s = LEVEL_STYLE[level] ?? LEVEL_STYLE.error;
  return (
    <span style={{
      background: s.bg, color: s.text,
      fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
      padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {s.label}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function IssuesTable({
  issues,
  onSelectIssue,
}: {
  issues: SentryIssue[];
  onSelectIssue: (id: string) => void;
}) {
  if (!issues || issues.length === 0) {
    return (
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '24px', textAlign: 'center',
        color: 'var(--text-muted)', fontSize: 13,
      }}>
        No unresolved issues
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 18px', borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)',
          textTransform: 'uppercase', letterSpacing: '.08em' }}>
          Unresolved Issues
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {issues.length} issues · last 14 days · click for details
        </span>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 70px 70px 80px 90px 90px',
        padding: '8px 18px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface-2)',
      }}>
        {['Issue', 'Events', 'Users', 'Level', 'First Seen', 'Last Seen'].map(h => (
          <span key={h} style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '.07em' }}>
            {h}
          </span>
        ))}
      </div>

      {/* Rows */}
      <div style={{ maxHeight: 480, overflowY: 'auto' }}>
        {issues.map((issue, idx) => (
          <div
            key={issue.id}
            onClick={() => onSelectIssue(issue.id)}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onSelectIssue(issue.id)}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 70px 70px 80px 90px 90px',
              padding: '11px 18px',
              borderBottom: idx < issues.length - 1 ? '1px solid var(--border)' : 'none',
              background: 'transparent',
              transition: 'background 0.12s',
              cursor: 'pointer',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {/* Title + culprit */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {issue.is_unhandled && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, color: '#f97316',
                    background: 'color-mix(in oklab, #f97316 12%, transparent)',
                    padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                  }}>
                    UNHANDLED
                  </span>
                )}
                <span style={{
                  fontSize: 12.5, fontWeight: 500, color: 'var(--text)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {issue.title}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 10.5, color: 'var(--text-muted)',
                  fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap' }}>
                  {issue.short_id}
                </span>
                {issue.culprit && (
                  <span style={{ fontSize: 10.5, color: 'var(--text-subtle)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {issue.culprit}
                  </span>
                )}
              </div>
            </div>

            {/* Event count */}
            <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--mono)',
              color: 'var(--text)', alignSelf: 'center' }}>
              {issue.count.toLocaleString()}
            </span>

            {/* User count */}
            <span style={{ fontSize: 13, fontFamily: 'var(--mono)',
              color: issue.user_count > 0 ? '#f43f5e' : 'var(--text-muted)',
              fontWeight: issue.user_count > 0 ? 700 : 400,
              alignSelf: 'center' }}>
              {issue.user_count > 0 ? issue.user_count.toLocaleString() : '—'}
            </span>

            {/* Level badge */}
            <div style={{ alignSelf: 'center' }}>
              <LevelBadge level={issue.level} />
            </div>

            {/* First seen */}
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)', alignSelf: 'center' }}>
              {relativeTime(issue.first_seen)}
            </span>

            {/* Last seen */}
            <span style={{ fontSize: 11.5,
              color: Date.now() - new Date(issue.last_seen).getTime() < 86_400_000
                ? '#f43f5e' : 'var(--text-muted)',
              fontWeight: Date.now() - new Date(issue.last_seen).getTime() < 86_400_000 ? 600 : 400,
              alignSelf: 'center',
            }}>
              {relativeTime(issue.last_seen)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
