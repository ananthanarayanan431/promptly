'use client';

import type { SentryRelease } from '@/types/analytics';

function shortHash(version: string): string {
  return version.length > 12 ? version.slice(0, 8) : version;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ReleasesCard({ releases }: { releases: SentryRelease[] }) {
  if (!releases || releases.length === 0) {
    return null;
  }

  const withIssues = releases.filter(r => r.new_groups > 0);
  const totalNewIssues = releases.reduce((s, r) => s + r.new_groups, 0);

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 18px', borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)',
          textTransform: 'uppercase', letterSpacing: '.08em' }}>
          Recent Releases
        </span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {releases.length} releases
          </span>
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: totalNewIssues > 0 ? '#f59e0b' : '#10b981',
            background: totalNewIssues > 0
              ? 'color-mix(in oklab, #f59e0b 10%, transparent)'
              : 'color-mix(in oklab, #10b981 10%, transparent)',
            padding: '2px 8px', borderRadius: 10,
          }}>
            {totalNewIssues} new issues introduced
          </span>
        </div>
      </div>

      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {releases.map((r, idx) => (
          <div key={r.version + idx} style={{
            display: 'grid', gridTemplateColumns: '120px 1fr 100px 80px',
            padding: '10px 18px', alignItems: 'center',
            borderBottom: idx < releases.length - 1 ? '1px solid var(--border)' : 'none',
            background: r.new_groups > 0
              ? 'color-mix(in oklab, #f59e0b 4%, transparent)' : 'transparent',
          }}>
            {/* Version hash */}
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)',
              fontWeight: 600 }}>
              {shortHash(r.version)}
            </span>

            {/* Date */}
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {formatDate(r.date_created)}
            </span>

            {/* New issues badge */}
            <div>
              {r.new_groups > 0 ? (
                <span style={{
                  fontSize: 11, fontWeight: 700,
                  color: '#f59e0b',
                  background: 'color-mix(in oklab, #f59e0b 12%, transparent)',
                  padding: '2px 8px', borderRadius: 10,
                }}>
                  +{r.new_groups} new issue{r.new_groups !== 1 ? 's' : ''}
                </span>
              ) : (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>clean</span>
              )}
            </div>

            {/* Commit count */}
            <span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
              {r.commit_count > 0 ? `${r.commit_count} commits` : ''}
            </span>
          </div>
        ))}
      </div>

      {withIssues.length > 0 && (
        <div style={{
          padding: '10px 18px',
          borderTop: '1px solid var(--border)',
          background: 'var(--surface-2)',
          fontSize: 11, color: 'var(--text-muted)',
        }}>
          {withIssues.length} of {releases.length} releases introduced new issues
        </div>
      )}
    </div>
  );
}
