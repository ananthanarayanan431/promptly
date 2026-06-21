'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { RateLimitList, RateLimitEntry } from '@/types/api';

/* ── Constants ─────────────────────────────────────────────────── */
const THRESHOLD_HIGH = 50;
const THRESHOLD_MED = 20;
const WINDOW_SECS = 60;

/* ── Helpers ───────────────────────────────────────────────────── */
function cleanPath(raw: string): string {
  return '/' + raw.replace(/^api\/v1\//, '').replace(/{[^}]+}/g, '{id}');
}

function endpointIcon(path: string): string {
  if (path.includes('chat')) return '💬';
  if (path.includes('admin')) return '🔒';
  if (path.includes('openrouter')) return '🤖';
  if (path.includes('api-keys') || path.includes('api_keys')) return '🔑';
  if (path.includes('users')) return '👤';
  if (path.includes('templates')) return '📋';
  if (path.includes('domain-prompt') || path.includes('domain_prompt')) return '📝';
  if (path.includes('categories')) return '🏷️';
  if (path.includes('auth')) return '🔐';
  return '⚡';
}

function severityOf(count: number): { label: string; color: string; bg: string; border: string } {
  if (count >= THRESHOLD_HIGH) return {
    label: 'HIGH', color: 'var(--danger)',
    bg: 'color-mix(in oklab, var(--danger) 8%, transparent)',
    border: 'color-mix(in oklab, var(--danger) 40%, transparent)',
  };
  if (count >= THRESHOLD_MED) return {
    label: 'MEDIUM', color: 'var(--warning)',
    bg: 'color-mix(in oklab, var(--warning) 8%, transparent)',
    border: 'color-mix(in oklab, var(--warning) 40%, transparent)',
  };
  return {
    label: 'LOW', color: 'var(--success)',
    bg: 'color-mix(in oklab, var(--success) 6%, transparent)',
    border: 'color-mix(in oklab, var(--success) 30%, transparent)',
  };
}

/* ── Usage bar with threshold markers ─────────────────────────── */
function UsageBar({ hits, peak }: { hits: number; peak: number }) {
  const fillPct = Math.min(100, (hits / THRESHOLD_HIGH) * 100);
  const medPct = (THRESHOLD_MED / THRESHOLD_HIGH) * 100;   // 40%
  const sev = severityOf(peak);

  return (
    <div style={{ position: 'relative', marginTop: 10 }}>
      {/* Track */}
      <div style={{ height: 10, background: 'var(--surface-2)', borderRadius: 99, overflow: 'visible', position: 'relative' }}>
        {/* Fill */}
        <div style={{
          position: 'absolute', left: 0, top: 0, height: '100%',
          width: `${fillPct}%`, background: sev.color, borderRadius: 99,
          transition: 'width .4s',
        }} />
        {/* Medium threshold marker */}
        <div style={{
          position: 'absolute', left: `${medPct}%`, top: -4, bottom: -4,
          width: 2, background: 'color-mix(in oklab, var(--warning) 60%, transparent)',
          borderRadius: 1,
        }} />
        {/* High threshold marker */}
        <div style={{
          position: 'absolute', left: '100%', top: -4, bottom: -4,
          width: 2, background: 'color-mix(in oklab, var(--danger) 60%, transparent)',
          borderRadius: 1,
        }} />
      </div>

      {/* Threshold labels */}
      <div style={{ position: 'relative', height: 16, marginTop: 4 }}>
        <span style={{
          position: 'absolute', left: `${medPct}%`, transform: 'translateX(-50%)',
          fontSize: 9.5, color: 'var(--warning)', fontWeight: 700, letterSpacing: '.04em',
        }}>med</span>
        <span style={{
          position: 'absolute', right: 0, transform: 'translateX(50%)',
          fontSize: 9.5, color: 'var(--danger)', fontWeight: 700, letterSpacing: '.04em',
        }}>high</span>
        <span style={{
          position: 'absolute', left: `${Math.min(fillPct, 85)}%`,
          fontSize: 10, color: sev.color, fontWeight: 700,
          transform: fillPct > 60 ? 'translateX(-100%)' : 'translateX(4px)',
          whiteSpace: 'nowrap',
        }}>
          {hits} hit{hits !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}

/* ── Route card ────────────────────────────────────────────────── */
function RouteCard({ route, entries, maxHits, userMap }: {
  route: string;
  entries: RateLimitEntry[];
  maxHits: number;
  userMap: Record<string, { email: string; full_name: string | null }>;
}) {
  const totalHits = entries.reduce((s, e) => s + e.hit_count, 0);
  const peakPerUser = Math.max(...entries.map(e => e.hit_count));
  const sev = severityOf(peakPerUser);
  const [expanded, setExpanded] = useState(peakPerUser >= THRESHOLD_MED);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const qc = useQueryClient();
  const path = cleanPath(route);
  const icon = endpointIcon(route);

  const resetMutation = useMutation({
    mutationFn: ({ userId, r }: { userId: string; r: string }) =>
      api.delete(`/api/v1/admin/rate-limits/${userId}/${r}`),
    onMutate: ({ userId }) => setResettingId(userId),
    onSettled: () => {
      setResettingId(null);
      qc.invalidateQueries({ queryKey: ['admin', 'rate-limits'] });
    },
  });

  return (
    <div style={{
      background: sev.bg,
      border: `1px solid ${sev.border}`,
      borderLeft: `4px solid ${sev.color}`,
      borderRadius: 12, overflow: 'hidden',
    }}>
      {/* Header row */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', padding: '14px 18px', display: 'flex', alignItems: 'center',
          gap: 14, background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left',
        }}
      >
        {/* Icon */}
        <span style={{ fontSize: 20, flexShrink: 0 }}>{icon}</span>

        {/* Path + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 13.5, fontWeight: 700, color: 'var(--text)', letterSpacing: '-.01em' }}>
              {path}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 99,
              background: sev.color, color: 'white', letterSpacing: '.06em', flexShrink: 0,
            }}>
              {sev.label}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 11.5, color: 'var(--text-muted)' }}>
            <span>{entries.length} user{entries.length !== 1 ? 's' : ''} active</span>
            <span>window: {WINDOW_SECS}s</span>
            <span>total: <strong style={{ color: 'var(--text)' }}>{totalHits}</strong></span>
            <span>peak/user: <strong style={{ color: sev.color }}>{peakPerUser}</strong></span>
          </div>
        </div>

        {/* Right: big count + expand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 28, fontWeight: 800, color: sev.color, lineHeight: 1 }}>
              {peakPerUser}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>peak</div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', minWidth: 40 }}>
            <div style={{ fontSize: 13 }}>{expanded ? '▲' : '▼'}</div>
            <div>{expanded ? 'collapse' : 'expand'}</div>
          </div>
        </div>
      </button>

      {/* Usage bar — always visible */}
      <div style={{ padding: '0 18px 14px' }}>
        <UsageBar hits={totalHits} peak={peakPerUser} />
      </div>

      {/* Per-user breakdown */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${sev.border}`, padding: '14px 18px' }}>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }}>
            Per-user breakdown ({entries.length} user{entries.length !== 1 ? 's' : ''})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entries
              .sort((a, b) => b.hit_count - a.hit_count)
              .map((e, i) => {
                const uSev = severityOf(e.hit_count);
                const uPct = Math.min(100, (e.hit_count / THRESHOLD_HIGH) * 100);
                return (
                  <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {userMap[e.user_id] ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                              {userMap[e.user_id].email}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              {userMap[e.user_id].full_name && (
                                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                                  {userMap[e.user_id].full_name}
                                </span>
                              )}
                              <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)', letterSpacing: '.03em' }}>
                                {e.user_id.slice(0, 8)}…{e.user_id.slice(-6)}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                            {e.user_id.slice(0, 8)}…{e.user_id.slice(-6)}
                          </span>
                        )}
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
                        background: uSev.bg, color: uSev.color, border: `1px solid ${uSev.border}`,
                        flexShrink: 0,
                      }}>
                        {e.hit_count} {e.hit_count === 1 ? 'hit' : 'hits'}
                      </span>
                      <button
                        onClick={ev => { ev.stopPropagation(); resetMutation.mutate({ userId: e.user_id, r: route }); }}
                        disabled={resettingId === e.user_id}
                        style={{
                          fontSize: 11, padding: '3px 10px', borderRadius: 6, flexShrink: 0,
                          background: 'transparent', color: 'var(--warning)',
                          border: '1px solid color-mix(in oklab, var(--warning) 40%, transparent)',
                          cursor: resettingId === e.user_id ? 'default' : 'pointer',
                          opacity: resettingId === e.user_id ? 0.5 : 1,
                        }}
                      >
                        {resettingId === e.user_id ? '…' : '↺ Reset'}
                      </button>
                    </div>
                    <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${uPct}%`, background: uSev.color, borderRadius: 99, transition: 'width .4s' }} />
                    </div>
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
  const { data, isLoading, refetch, dataUpdatedAt, isFetching } = useQuery<RateLimitList>({
    queryKey: ['admin', 'rate-limits'],
    queryFn: async () => {
      const res = await api.get<{ data: RateLimitList }>('/api/v1/admin/rate-limits');
      return res.data.data;
    },
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  // Fetch users for identity lookup — large page to cover all
  const { data: usersData } = useQuery<{ users: { id: string; email: string; full_name: string | null }[] }>({
    queryKey: ['admin', 'users-lookup'],
    queryFn: async () => {
      const res = await api.get<{ data: { users: { id: string; email: string; full_name: string | null }[] } }>(
        '/api/v1/admin/users?page=1&per_page=500',
      );
      return res.data.data;
    },
    staleTime: 60_000,
  });

  const userMap = useMemo<Record<string, { email: string; full_name: string | null }>>(() => {
    if (!usersData?.users) return {};
    return Object.fromEntries(usersData.users.map(u => [u.id, { email: u.email, full_name: u.full_name }]));
  }, [usersData]);

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
    const peakA = Math.max(...byRoute[a].map(e => e.hit_count));
    const peakB = Math.max(...byRoute[b].map(e => e.hit_count));
    return peakB - peakA;
  });

  const totalHits    = data?.entries.reduce((s, e) => s + e.hit_count, 0) ?? 0;
  const uniqueUsers  = new Set(data?.entries.map(e => e.user_id) ?? []).size;
  const highCount    = routes.filter(r => Math.max(...byRoute[r].map(e => e.hit_count)) >= THRESHOLD_HIGH).length;
  const medCount     = routes.filter(r => {
    const p = Math.max(...byRoute[r].map(e => e.hit_count));
    return p >= THRESHOLD_MED && p < THRESHOLD_HIGH;
  }).length;
  const lastUpdated  = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Summary bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {[
          { label: 'Total hits', value: totalHits, color: 'var(--text)', mono: true },
          { label: 'Endpoints', value: routes.length, color: 'var(--primary)', mono: false },
          { label: 'Active users', value: uniqueUsers, color: 'var(--accent)', mono: false },
          { label: 'High risk', value: highCount, color: highCount > 0 ? 'var(--danger)' : 'var(--success)', mono: false },
          { label: 'Medium risk', value: medCount, color: medCount > 0 ? 'var(--warning)' : 'var(--text-subtle)', mono: false },
        ].map(stat => (
          <div key={stat.label} style={{
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
            padding: '12px 18px', minWidth: 100,
          }}>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600 }}>
              {stat.label}
            </div>
            <div style={{ fontFamily: stat.mono ? 'var(--mono)' : 'inherit', fontSize: 22, fontWeight: 800, color: stat.color }}>
              {stat.value}
            </div>
          </div>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
            Updated {lastUpdated}
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            style={{
              padding: '7px 14px', fontSize: 12, borderRadius: 8, cursor: isFetching ? 'default' : 'pointer',
              border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)',
              opacity: isFetching ? 0.5 : 1,
            }}
          >
            {isFetching ? '…' : '↺ Refresh'}
          </button>
        </div>
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 20, padding: '10px 16px',
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
        fontSize: 12, color: 'var(--text-muted)',
      }}>
        <span style={{ fontWeight: 600, color: 'var(--text)' }}>Thresholds</span>
        <span>Counters reset every <strong style={{ color: 'var(--text)' }}>{WINDOW_SECS}s</strong> per route</span>
        <div style={{ display: 'flex', gap: 16, marginLeft: 'auto' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--success)', display: 'inline-block' }} />
            Low <span style={{ color: 'var(--text-subtle)' }}>&lt;{THRESHOLD_MED} hits</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--warning)', display: 'inline-block' }} />
            Medium <span style={{ color: 'var(--text-subtle)' }}>≥{THRESHOLD_MED} hits</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--danger)', display: 'inline-block' }} />
            High <span style={{ color: 'var(--text-subtle)' }}>≥{THRESHOLD_HIGH} hits</span>
          </span>
        </div>
      </div>

      {/* Loading skeletons */}
      {isLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array(4).fill(0).map((_, i) => (
            <div key={i} style={{ height: 90, background: 'var(--surface-2)', borderRadius: 12, animation: 'pulse 1.5s ease-in-out infinite' }} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && routes.length === 0 && (
        <div style={{
          padding: '60px 32px', textAlign: 'center', background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 14,
        }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
            No rate-limit pressure
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 380, margin: '0 auto' }}>
            All users are within normal request windows. Counters auto-reset every {WINDOW_SECS} seconds.
          </div>
        </div>
      )}

      {/* Route cards — sorted by peak hit count (highest risk first) */}
      {routes.map(route => (
        <RouteCard
          key={route}
          route={route}
          entries={byRoute[route]}
          maxHits={Math.max(1, totalHits)}
          userMap={userMap}
        />
      ))}
    </div>
  );
}
