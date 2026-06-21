'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AdminStats, FeatureUsage, TopUser, DailyActivity } from '@/types/api';

/* ── Helpers ────────────────────────────────────────────────────── */
function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
function fmtPct(n: number): string { return `${n.toFixed(1)}%`; }

/* ── Mini icon SVG ───────────────────────────────────────────────── */
function Icon({ d, size = 14, color = 'currentColor' }: { d: string; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/* ── Metric card ─────────────────────────────────────────────────── */
function Card({
  label, value, sub, accent, icon, badge,
}: {
  label: string; value: string; sub?: string; accent?: string; icon: string; badge?: string;
}) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 6,
      boxShadow: '0 1px 3px rgba(0,0,0,.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.07em' }}>
          {label}
        </span>
        <span style={{ width: 28, height: 28, borderRadius: 8, background: `color-mix(in oklab, ${accent ?? 'var(--primary)'} 12%, transparent)`, display: 'grid', placeItems: 'center', color: accent ?? 'var(--primary)' }}>
          <Icon d={icon} size={13} color={accent ?? 'var(--primary)'} />
        </span>
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 26, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{sub}</div>
      )}
      {badge && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, color: 'var(--success)', background: 'color-mix(in oklab, var(--success) 10%, transparent)', padding: '2px 7px', borderRadius: 99 }}>
          ↑ {badge}
        </span>
      )}
    </div>
  );
}

/* ── Line chart ──────────────────────────────────────────────────── */
function LineChart({ data }: { data: DailyActivity[] }) {
  const W = 580, H = 140, PL = 8, PR = 8, PT = 10, PB = 24;
  const iW = W - PL - PR, iH = H - PT - PB;
  const maxV = Math.max(1, ...data.map(d => d.calls));
  const pts = data.map((d, i) => ({
    x: PL + (data.length > 1 ? (i / (data.length - 1)) * iW : 0),
    y: PT + (1 - d.calls / maxV) * iH,
    calls: d.calls,
    date: d.date,
  }));
  const pathD = pts.length > 1 ? 'M ' + pts.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ') : '';
  const fillD = pathD ? `${pathD} L ${pts[pts.length-1].x} ${PT+iH} L ${pts[0].x} ${PT+iH} Z` : '';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
      {/* Gridlines */}
      {[0, 0.5, 1].map(v => (
        <line key={v} x1={PL} x2={W-PR} y1={PT + (1-v)*iH} y2={PT + (1-v)*iH}
          stroke="var(--border)" strokeWidth="1" strokeDasharray={v === 0 || v === 1 ? '' : '3 4'} />
      ))}
      {fillD && (
        <path d={fillD} fill="var(--primary)" opacity="0.08" />
      )}
      {pathD && (
        <path d={pathD} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.calls > 0 ? 3 : 2}
          fill={p.calls > 0 ? 'var(--primary)' : 'var(--border)'} stroke="var(--surface)" strokeWidth="1.5" />
      ))}
      {/* Date labels — show only first, middle, last */}
      {[0, Math.floor(pts.length / 2), pts.length - 1].map(i => pts[i] && (
        <text key={i} x={pts[i].x} y={H - 4} fontSize="9" fill="var(--text-subtle)"
          textAnchor="middle" fontFamily="var(--mono)">
          {pts[i].date.slice(5)}
        </text>
      ))}
    </svg>
  );
}

/* ── Feature usage bars ──────────────────────────────────────────── */
const FEATURE_COLORS: Record<string, string> = {
  optimize:    'var(--primary)',
  domain_pdo:  '#06b6d4',
  domain_gepa: '#8b5cf6',
  bridge:      '#f59e0b',
  health_score:'#10b981',
  advisory:    '#ec4899',
  skill:       '#f43f5e',
};

function FeatureBars({ features }: { features: FeatureUsage[] }) {
  const max = Math.max(1, ...features.map(f => f.calls));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {features.slice(0, 8).map(f => (
        <div key={f.feature}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>{f.label}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-muted)' }}>{f.calls.toLocaleString()}</span>
          </div>
          <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 99, transition: 'width .5s ease',
              width: `${(f.calls / max) * 100}%`,
              background: FEATURE_COLORS[f.feature] ?? 'var(--primary)',
            }} />
          </div>
        </div>
      ))}
      {features.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No usage recorded yet.</div>
      )}
    </div>
  );
}

/* ── Top users table ─────────────────────────────────────────────── */
function TopUsersTable({ users }: { users: TopUser[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 80px 70px', gap: 12, padding: '7px 14px', fontSize: 10.5, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.07em' }}>
        <span>User</span><span>Tokens Used</span><span>Balance</span><span>Calls</span>
      </div>
      {users.map((u, i) => {
        const pct = Math.min(100, (u.tokens_consumed / 3_000_000) * 100);
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 80px 70px', gap: 12, padding: '10px 14px', alignItems: 'center', borderTop: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
              <div style={{ height: 3, background: 'var(--surface-2)', borderRadius: 99, marginTop: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: pct > 80 ? 'var(--danger)' : pct > 50 ? 'var(--warning)' : 'var(--primary)', borderRadius: 99 }} />
              </div>
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)' }}>{fmtNum(u.tokens_consumed)}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: u.token_balance <= 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
              {fmtNum(Math.max(0, u.token_balance))}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-muted)' }}>{u.calls}</div>
          </div>
        );
      })}
      {users.length === 0 && (
        <div style={{ padding: '20px 14px', color: 'var(--text-muted)', fontSize: 13 }}>No user data yet.</div>
      )}
    </div>
  );
}

/* ── Skeleton loader ─────────────────────────────────────────────── */
function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {Array(8).fill(0).map((_, i) => (
          <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 12, height: 96, animation: 'pulse 1.5s ease-in-out infinite' }} />
        ))}
      </div>
    </div>
  );
}

/* ── Section wrapper ─────────────────────────────────────────────── */
function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{title}</span>
        {right}
      </div>
      <div style={{ padding: '16px 18px' }}>{children}</div>
    </div>
  );
}

/* ── Main export ─────────────────────────────────────────────────── */
export function StatsCards() {
  const { data, isLoading, isError, dataUpdatedAt, refetch } = useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const res = await api.get<{ data: AdminStats }>('/api/v1/admin/stats');
      return res.data.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (isLoading) return <Skeleton />;
  if (isError || !data) return (
    <div style={{ padding: '32px', textAlign: 'center', color: 'var(--danger)', background: 'color-mix(in oklab, var(--danger) 6%, transparent)', border: '1px solid color-mix(in oklab, var(--danger) 20%, transparent)', borderRadius: 12, fontSize: 13 }}>
      Failed to load stats. Check your connection or try refreshing.
    </div>
  );

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—';
  const totalCalls = data.feature_usage.reduce((s, f) => s + f.calls, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Refresh indicator */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, fontSize: 11.5, color: 'var(--text-subtle)' }}>
        <span>Updated {lastUpdated}</span>
        <button onClick={() => refetch()} className="ply-btn ply-btn-sm" style={{ fontSize: 11.5 }}>
          ↺ Refresh
        </button>
      </div>

      {/* Row 1 — 4 primary KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <Card label="Total Users" value={fmtNum(data.total_users)}
          sub={`+${data.new_users_7d} this week · +${data.new_users_30d} this month`}
          icon="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"
          badge={data.new_users_7d > 0 ? `${data.new_users_7d} this week` : undefined} />
        <Card label="Active (7d)" value={fmtNum(data.active_users_7d)}
          sub={`${Math.round((data.active_users_7d / Math.max(1, data.total_users)) * 100)}% of total users`}
          icon="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
          accent="var(--success)" />
        <Card label="Total Optimizations" value={fmtNum(data.total_optimizations)}
          sub={`${totalCalls} API calls logged`}
          icon="M12 3v4M12 17v4M3 12h4M17 12h4M5.5 5.5l2.5 2.5M16 16l2.5 2.5M5.5 18.5l2.5-2.5M16 8l2.5-2.5"
          accent="var(--accent)" />
        <Card label="Tokens Consumed" value={fmtNum(data.total_tokens_consumed)}
          sub={`of ${fmtNum(data.total_token_budget)} total budget`}
          icon="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
          accent={data.token_budget_used_pct > 80 ? 'var(--danger)' : data.token_budget_used_pct > 50 ? 'var(--warning)' : 'var(--primary)'} />
      </div>

      {/* Row 2 — 4 secondary KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <Card label="Avg Tokens / User" value={fmtNum(data.avg_tokens_per_user)}
          sub="per registered account"
          icon="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        <Card label="Budget Used" value={fmtPct(data.token_budget_used_pct)}
          sub={`${fmtNum(data.total_token_budget - data.total_tokens_consumed)} tokens remaining`}
          icon="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
          accent={data.token_budget_used_pct > 80 ? 'var(--danger)' : 'var(--primary)'} />
        <Card label="New Users (7d)" value={fmtNum(data.new_users_7d)}
          sub={`${fmtNum(data.new_users_30d)} in the last 30 days`}
          icon="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 7a4 4 0 118 0 4 4 0 01-8 0M19 8v6M22 11h-6"
          accent="var(--success)"
          badge={data.new_users_7d > 0 ? String(data.new_users_7d) : undefined} />
        <Card label="Feature Variety" value={fmtNum(data.feature_usage.length)}
          sub={`${totalCalls.toLocaleString()} total API calls`}
          icon="M4 6h16M4 10h16M4 14h16M4 18h16"
          accent="var(--accent)" />
      </div>

      {/* Row 3 — Chart + Feature breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 14 }}>
        <Section
          title="Daily API Activity — last 14 days"
          right={<span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>calls per day</span>}
        >
          {data.daily_activity.length > 0
            ? <LineChart data={data.daily_activity} />
            : <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No activity data yet</div>
          }
          <div style={{ marginTop: 8, display: 'flex', gap: 10, fontSize: 11.5, color: 'var(--text-muted)' }}>
            <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <span style={{ width: 10, height: 2, background: 'var(--primary)', display: 'inline-block', borderRadius: 99 }} />
              API calls
            </span>
            <span style={{ marginLeft: 'auto' }}>
              Peak: {Math.max(0, ...data.daily_activity.map(d => d.calls)).toLocaleString()} calls/day
            </span>
          </div>
        </Section>

        <Section title="Usage by Feature">
          <FeatureBars features={data.feature_usage} />
        </Section>
      </div>

      {/* Row 4 — Top consumers */}
      <Section
        title="Top Token Consumers"
        right={<span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>ranked by tokens burned</span>}
      >
        <TopUsersTable users={data.top_users} />
      </Section>
    </div>
  );
}
