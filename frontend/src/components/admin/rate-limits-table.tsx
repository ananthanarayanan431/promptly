'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { RateLimitList, RateLimitEntry } from '@/types/api';

/* ── Helpers ───────────────────────────────────────────────────── */
function routeLabel(raw: string): string {
  return raw.replace(/^api\/v1\//, '').replace(/\//g, ' › ').replace(/_/g, ' ');
}

function severityOf(count: number): { label: string; color: string; bg: string } {
  if (count >= 50) return { label: 'High', color: 'var(--danger)', bg: 'color-mix(in oklab, var(--danger) 10%, transparent)' };
  if (count >= 20) return { label: 'Medium', color: 'var(--warning)', bg: 'color-mix(in oklab, var(--warning) 12%, transparent)' };
  return { label: 'Low', color: 'var(--success)', bg: 'color-mix(in oklab, var(--success) 10%, transparent)' };
}

/* ── Route aggregation card ────────────────────────────────────── */
function RouteCard({ route, entries, maxHits }: { route: string; entries: RateLimitEntry[]; maxHits: number }) {
  const total = entries.reduce((s, e) => s + e.hit_count, 0);
  const sev = severityOf(Math.max(...entries.map(e => e.hit_count)));
  const pct = Math.min(100, (total / Math.max(1, maxHits)) * 100);
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${sev.color}33`, borderRadius: 10, overflow: 'hidden' }}>
      {/* Route header */}
      <button onClick={() => setExpanded(e => !e)} style={{
        width: '100%', padding: '12px 16px', display: 'grid',
        gridTemplateColumns: '1fr 80px 80px 90px 28px',
        gap: 12, alignItems: 'center', background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12.5, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {routeLabel(route)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
            {entries.length} user{entries.length !== 1 ? 's' : ''} hitting this endpoint
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Total hits</div>
          <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 14, color: sev.color }}>{total}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Peak / user</div>
          <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
            {Math.max(...entries.map(e => e.hit_count))}
          </div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 99, background: sev.bg, color: sev.color }}>
          {sev.label}
        </span>
        <span style={{ fontSize: 14, color: 'var(--text-subtle)' }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Relative bar */}
      <div style={{ height: 3, background: 'var(--surface-2)' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: sev.color, transition: 'width .4s' }} />
      </div>

      {/* Expanded per-user breakdown */}
      {expanded && (
        <div style={{ padding: '10px 16px 14px', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10.5, color: 'var(--text-subtle)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>
            Per-user breakdown
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {entries.map((e, i) => {
              const uSev = severityOf(e.hit_count);
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)', minWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.user_id}
                  </span>
                  <div style={{ flex: 1, height: 5, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(e.hit_count / Math.max(1, total)) * 100}%`, background: uSev.color, borderRadius: 99 }} />
                  </div>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: uSev.color, minWidth: 32, textAlign: 'right' }}>
                    {e.hit_count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main component ────────────────────────────────────────────── */
export function RateLimitsTable() {
  const { data, isLoading, refetch, dataUpdatedAt } = useQuery<RateLimitList>({
    queryKey: ['admin', 'rate-limits'],
    queryFn: async () => {
      const res = await api.get<{ data: RateLimitList }>('/api/v1/admin/rate-limits');
      return res.data.data;
    },
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  // Group by route
  const byRoute = useMemo(() => {
    if (!data) return {};
    const map: Record<string, RateLimitEntry[]> = {};
    for (const e of data.entries) {
      if (!map[e.route]) map[e.route] = [];
      map[e.route].push(e);
    }
    return map;
  }, [data]);

  const routes = Object.keys(byRoute).sort((a, b) => {
    const totalA = byRoute[a].reduce((s, e) => s + e.hit_count, 0);
    const totalB = byRoute[b].reduce((s, e) => s + e.hit_count, 0);
    return totalB - totalA;
  });

  const totalHits = data?.entries.reduce((s, e) => s + e.hit_count, 0) ?? 0;
  const maxRouteHits = routes.length > 0
    ? Math.max(...routes.map(r => byRoute[r].reduce((s, e) => s + e.hit_count, 0)))
    : 1;
  const highRisk = data?.entries.filter(e => e.hit_count >= 50).length ?? 0;
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header + stats */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 12 }}>
          {[
            { label: 'Total hits', value: totalHits, color: 'var(--text)' },
            { label: 'Unique endpoints', value: routes.length, color: 'var(--primary)' },
            { label: 'Unique users', value: new Set(data?.entries.map(e => e.user_id) ?? []).size, color: 'var(--accent)' },
            { label: 'High-risk', value: highRisk, color: highRisk > 0 ? 'var(--danger)' : 'var(--success)' },
          ].map(stat => (
            <div key={stat.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', minWidth: 110 }}>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>{stat.label}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700, color: stat.color }}>{stat.value}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--text-muted)' }}>
          <span>Updated {lastUpdated}</span>
          <button onClick={() => refetch()} className="ply-btn ply-btn-sm">↺ Refresh</button>
        </div>
      </div>

      {/* Explanation */}
      <div style={{ padding: '10px 14px', background: 'color-mix(in oklab, var(--primary) 6%, transparent)', border: '1px solid color-mix(in oklab, var(--primary) 20%, transparent)', borderRadius: 8, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--text)' }}>What you're seeing:</strong> These are live Redis counters for each user × endpoint pair. Hit counts are windowed — they reset every 60 seconds per route. <span style={{ color: 'var(--danger)', fontWeight: 600 }}>High ≥50</span>, <span style={{ color: 'var(--warning)', fontWeight: 600 }}>Medium ≥20</span>. Click any route to see per-user breakdown.
      </div>

      {isLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array(3).fill(0).map((_, i) => <div key={i} style={{ height: 64, background: 'var(--surface-2)', borderRadius: 10 }} />)}
        </div>
      )}

      {!isLoading && routes.length === 0 && (
        <div style={{ padding: '48px', textAlign: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>No active rate-limit pressure</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No Redis rate-limit keys found. Users are within normal request windows.</div>
        </div>
      )}

      {routes.map(route => (
        <RouteCard
          key={route}
          route={route}
          entries={byRoute[route]}
          maxHits={maxRouteHits}
        />
      ))}
    </div>
  );
}
