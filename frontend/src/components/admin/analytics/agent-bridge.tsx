'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AnalyticsResponse, AnalyticsPoint } from '@/types/analytics';
import { getSeries } from '@/types/analytics';
import { MetricCard } from './metric-card';
import { StaticCard } from './static-card';

const COLORS = [
  'var(--primary)', '#06b6d4', '#f59e0b', '#8b5cf6',
  '#f43f5e', '#10b981', '#3b82f6', '#ec4899',
];

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

interface ModelRow {
  model: string;
  count: number;
  tokens: number;
  cost: number;
  countPct: number;
}

function buildRows(
  countData: AnalyticsPoint[],
  tokenData: AnalyticsPoint[],
  costData: AnalyticsPoint[],
): ModelRow[] {
  const tokenMap = new Map(tokenData.map(p => [p.date, p.value]));
  const costMap = new Map(costData.map(p => [p.date, p.value]));
  const totalCount = countData.reduce((s, p) => s + p.value, 0);
  return countData.map(p => ({
    model: p.date,
    count: p.value,
    tokens: tokenMap.get(p.date) ?? 0,
    cost: costMap.get(p.date) ?? 0,
    countPct: totalCount > 0 ? (p.value / totalCount) * 100 : 0,
  }));
}

function ModelBreakdownCard({ title, rows }: { title: string; rows: ModelRow[] }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-subtle)',
        textTransform: 'uppercase', letterSpacing: '.07em' }}>
        {title}
      </div>

      {rows.length === 0 ? (
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No data yet</span>
      ) : (
        <>
          {/* Column headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 56px 72px 64px',
            gap: 8, padding: '0 0 6px',
            borderBottom: '1px solid var(--border)',
          }}>
            {['Model', 'Runs', 'Tokens', 'Cost'].map(h => (
              <span key={h} style={{ fontSize: 10.5, fontWeight: 600,
                color: 'var(--text-subtle)', textTransform: 'uppercase',
                letterSpacing: '.06em', textAlign: h === 'Model' ? 'left' : 'right' }}>
                {h}
              </span>
            ))}
          </div>

          {/* Rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map((row, i) => {
              const color = COLORS[i % COLORS.length];
              const modelShort = row.model.split('/').pop() ?? row.model;
              return (
                <div key={row.model} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 56px 72px 64px',
                    gap: 8, alignItems: 'center',
                  }}>
                    {/* Model name with colour dot */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%',
                        background: color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={row.model}>
                        {modelShort}
                      </span>
                    </div>
                    {/* Count */}
                    <span style={{ fontSize: 12, fontFamily: 'var(--mono)',
                      color: 'var(--text)', textAlign: 'right' }}>
                      {row.count.toLocaleString()}
                    </span>
                    {/* Tokens */}
                    <span style={{ fontSize: 12, fontFamily: 'var(--mono)',
                      color: 'var(--text)', textAlign: 'right' }}>
                      {fmtTokens(row.tokens)}
                    </span>
                    {/* Cost */}
                    <span style={{ fontSize: 12, fontFamily: 'var(--mono)',
                      color: row.cost > 0 ? 'var(--text)' : 'var(--text-muted)',
                      textAlign: 'right' }}>
                      {fmtCost(row.cost)}
                    </span>
                  </div>

                  {/* Share bar */}
                  <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 999,
                    overflow: 'hidden', marginLeft: 14 }}>
                    <div style={{ height: '100%', width: `${row.countPct}%`,
                      background: color, borderRadius: 999, transition: 'width .3s ease' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function AgentBridge() {
  const { data, isLoading, isError } = useQuery<AnalyticsResponse>({
    queryKey: ['admin', 'analytics', 'agent_bridge'],
    queryFn: async () => {
      const res = await api.get<{ data: AnalyticsResponse }>(
        '/api/v1/admin/analytics?view=agent_bridge&days=30'
      );
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>;
  if (isError || !data) return <div style={{ color: 'var(--danger)', padding: 24, textAlign: 'center' }}>Failed to load.</div>;

  const st = data.statics;

  const srcRows = buildRows(
    getSeries(data, 'bridge_source_models')?.data ?? [],
    getSeries(data, 'bridge_source_model_tokens')?.data ?? [],
    getSeries(data, 'bridge_source_model_costs')?.data ?? [],
  );
  const tgtRows = buildRows(
    getSeries(data, 'bridge_target_models')?.data ?? [],
    getSeries(data, 'bridge_target_model_tokens')?.data ?? [],
    getSeries(data, 'bridge_target_model_costs')?.data ?? [],
  );

  const totalSrcCost = Number(st.total_src_cost_usd ?? 0);
  const totalTgtCost = Number(st.total_tgt_cost_usd ?? 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Top-level statics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <StaticCard title="Total Bridges Run" value={Number(st.total_bridges).toLocaleString()} subtitle="all time" />
        <StaticCard title="Source Model Cost" value={fmtCost(totalSrcCost)} subtitle="estimated, all time" />
        <StaticCard title="Target Model Cost" value={fmtCost(totalTgtCost)} subtitle="estimated, all time" />
      </div>

      {/* Time-series */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        {(['bridge_runs', 'bridge_tokens', 'bridge_unique_users'] as const).map(key => {
          const s = getSeries(data, key);
          return s ? <MetricCard key={key} series={s} /> : null;
        })}
      </div>

      {/* Per-model breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        <ModelBreakdownCard title="Source Model Breakdown" rows={srcRows} />
        <ModelBreakdownCard title="Target Model Breakdown" rows={tgtRows} />
      </div>
    </div>
  );
}
