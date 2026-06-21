'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { GlitchTipIssueList, GlitchTipIssue } from '@/types/api';

const GLITCHTIP_URL = process.env.NEXT_PUBLIC_GLITCHTIP_URL ?? 'http://localhost:8080';

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    unresolved: 'var(--danger)',
    resolved: 'var(--success, #22c55e)',
    ignored: 'var(--text-muted)',
  };
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 4,
      background: `${colors[status] ?? 'var(--text-muted)'}22`,
      color: colors[status] ?? 'var(--text-muted)',
      fontWeight: 600, textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

export function ErrorsTable() {
  const { data, isLoading, refetch } = useQuery<GlitchTipIssueList>({
    queryKey: ['admin', 'errors'],
    queryFn: async () => {
      const res = await api.get<{ data: GlitchTipIssueList }>('/api/v1/admin/errors');
      return res.data.data;
    },
    staleTime: 30_000,
  });

  const thStyle: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left', fontSize: 11,
    textTransform: 'uppercase', letterSpacing: '.06em',
    color: 'var(--text-muted)', fontWeight: 600,
    borderBottom: '1px solid var(--border)',
  };
  const tdStyle: React.CSSProperties = {
    padding: '10px 12px', fontSize: 13,
    borderBottom: '1px solid var(--border)',
    color: 'var(--text)',
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          Recent errors from GlitchTip — top 50 issues.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => refetch()}
            style={{
              padding: '6px 14px', fontSize: 12, borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text)', cursor: 'pointer',
            }}
          >
            Refresh
          </button>
          <a
            href={GLITCHTIP_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '6px 14px', fontSize: 12, borderRadius: 6,
              background: 'var(--primary)', color: 'white', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            Open in GlitchTip →
          </a>
        </div>
      </div>

      {isLoading && <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading…</div>}

      {data && data.issues.length === 0 && (
        <div className="ply-card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          No issues found. Either GlitchTip is not configured or there are no errors yet.
        </div>
      )}

      {data && data.issues.length > 0 && (
        <div className="ply-card" style={{ overflow: 'auto', padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Issue</th>
                <th style={thStyle}>Occurrences</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>First Seen</th>
                <th style={thStyle}>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {data.issues.map((issue: GlitchTipIssue) => (
                <tr key={issue.id}>
                  <td style={{ ...tdStyle, maxWidth: 420 }}>
                    <span style={{
                      display: 'block', overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      fontFamily: 'monospace', fontSize: 12,
                    }}>
                      {issue.title}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span className="mono" style={{ fontWeight: 600, color: issue.occurrences > 100 ? 'var(--danger)' : 'var(--text)' }}>
                      {issue.occurrences.toLocaleString()}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <StatusBadge status={issue.status} />
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: 12 }}>
                    {issue.first_seen ? new Date(issue.first_seen).toLocaleDateString() : '—'}
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: 12 }}>
                    {issue.last_seen ? new Date(issue.last_seen).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
