'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AnalyticsResponse } from '@/types/analytics';
import { getSeries, getSeriesGroup } from '@/types/analytics';
import { MetricCard } from './metric-card';
import { StaticCard } from './static-card';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function Skeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
      {Array(10).fill(0).map((_, i) => (
        <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 12,
          height: 220, animation: 'pulse 1.5s ease-in-out infinite' }} />
      ))}
    </div>
  );
}

export function PlatformEngagement() {
  const { data, isLoading, isError } = useQuery<AnalyticsResponse>({
    queryKey: ['admin', 'analytics', 'platform_engagement'],
    queryFn: async () => {
      const res = await api.get<{ data: AnalyticsResponse }>(
        '/api/v1/admin/analytics?view=platform_engagement&days=30'
      );
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <Skeleton />;
  if (isError || !data) return (
    <div style={{ color: 'var(--danger)', padding: 24, textAlign: 'center' }}>
      Failed to load analytics.
    </div>
  );

  const st = data.statics;
  const adoptionSeries = getSeriesGroup(data, 'adoption_');

  // Build stacked adoption data
  const adoptionDates = (getSeries(data, 'dau')?.data ?? []).map(p => p.date.slice(5));
  const adoptionData = adoptionDates.map((date, i) => ({
    date,
    ...Object.fromEntries(adoptionSeries.map(s => [s.label, s.data[i]?.value ?? 0])),
  }));
  const adoptionColors = ['#6366f1', '#06b6d4', '#f59e0b', '#f43f5e'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Static summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        <StaticCard title="Total Users" value={fmtNum(Number(st.total_users))} subtitle="all time" />
        <StaticCard title="Total Optimizations" value={fmtNum(Number(st.total_optimizations))} subtitle="all time" />
        <StaticCard title="Total Tokens" value={fmtNum(Number(st.total_tokens))} subtitle="consumed" />
        <StaticCard title="Total Credits" value={fmtNum(Number(st.total_credits))} subtitle="charged" />
        <StaticCard title="Budget Used" value={`${st.budget_used_pct}%`} subtitle="of token budget"
          accent={Number(st.budget_used_pct) > 80 ? 'var(--danger)' : undefined} />
      </div>

      {/* 2-col chart grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        {(['dau', 'wau', 'optimizations_per_day', 'feature_calls_per_day',
           'sessions_per_day', 'tokens_per_day',
           'signups_per_day', 'credits_per_day'] as const).map(key => {
          const s = getSeries(data, key);
          return s ? <MetricCard key={key} series={s} /> : null;
        })}

        {/* Stacked adoption chart */}
        {adoptionSeries.length > 0 && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-subtle)',
              textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>
              Feature Adoption — Unique Users per Day
            </div>
            <div style={{ height: 150 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={adoptionData} margin={{ top: 0, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-subtle)' }}
                    tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--text-subtle)' }}
                    tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: 8, fontSize: 11 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {adoptionSeries.map((s, i) => (
                    <Bar key={s.key} dataKey={s.label} stackId="a"
                      fill={adoptionColors[i % adoptionColors.length]}
                      radius={i === adoptionSeries.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
