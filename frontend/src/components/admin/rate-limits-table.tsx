'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { RateLimitList, RateLimitEntry } from '@/types/api';

export function RateLimitsTable() {
  const { data, isLoading, refetch } = useQuery<RateLimitList>({
    queryKey: ['admin', 'rate-limits'],
    queryFn: async () => {
      const res = await api.get<{ data: RateLimitList }>('/api/v1/admin/rate-limits');
      return res.data.data;
    },
    staleTime: 15_000,
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
          Current Redis rate limit counters — sorted by hit count. Refreshes every 15s.
        </p>
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
      </div>

      {isLoading && <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading…</div>}

      {data && data.entries.length === 0 && (
        <div className="ply-card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          No active rate limit entries.
        </div>
      )}

      {data && data.entries.length > 0 && (
        <div className="ply-card" style={{ overflow: 'auto', padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>User ID</th>
                <th style={thStyle}>Route</th>
                <th style={thStyle}>Hit Count</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e: RateLimitEntry, i: number) => (
                <tr key={`${e.user_id}-${e.route}-${i}`}>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>
                    {e.user_id}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{e.route}</td>
                  <td style={tdStyle}>
                    <span className="mono" style={{
                      fontWeight: 600,
                      color: e.hit_count > 50 ? 'var(--danger)' : e.hit_count > 20 ? 'var(--warning)' : 'var(--text)',
                    }}>
                      {e.hit_count}
                    </span>
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
