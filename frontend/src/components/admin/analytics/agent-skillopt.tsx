'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AnalyticsResponse } from '@/types/analytics';
import { getSeries, getSeriesGroup } from '@/types/analytics';
import { MetricCard } from './metric-card';
import { StaticCard } from './static-card';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

export function AgentSkillOpt() {
  const { data, isLoading, isError } = useQuery<AnalyticsResponse>({
    queryKey: ['admin', 'analytics', 'agent_skillopt'],
    queryFn: async () => {
      const res = await api.get<{ data: AnalyticsResponse }>(
        '/api/v1/admin/analytics?view=agent_skillopt&days=30'
      );
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>;
  if (isError || !data) return <div style={{ color: 'var(--danger)', padding: 24, textAlign: 'center' }}>Failed to load.</div>;

  const st = data.statics;
  const tierSeries = getSeriesGroup(data, 'so_tier_');

  // Build stacked tier data
  const tierDates = (getSeries(data, 'so_runs')?.data ?? []).map(p => p.date.slice(5));
  const tierData = tierDates.map((date, i) => ({
    date,
    ...Object.fromEntries(tierSeries.map(s => [s.label, s.data[i]?.value ?? 0])),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <StaticCard title="Avg Epochs Run"
          value={Number(st.avg_epochs)} subtitle="per completed run" />
        <StaticCard title="Total Examples Processed"
          value={Number(st.total_examples).toLocaleString()} subtitle="all time" />
        <StaticCard title="Overall Avg Score Improvement"
          value={(() => { const imp = Number(st.overall_avg_improvement) * 100; return `${imp >= 0 ? '+' : ''}${imp.toFixed(1)}%`; })()}
          subtitle="score_after − score_before"
          accent="var(--success)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        {(['so_runs', 'so_improvement', 'so_score_test', 'so_edits_accepted',
           'so_acceptance_ratio', 'so_unique_users'] as const).map(key => {
          const s = getSeries(data, key);
          return s ? <MetricCard key={key} series={s} /> : null;
        })}

        {/* Stacked tier breakdown */}
        {tierSeries.length > 0 && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-subtle)',
              textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>
              Runs by Tier per Day
            </div>
            <div style={{ height: 150 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tierData} margin={{ top: 0, right: 4, left: -24, bottom: 0 }}>
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
                  {tierSeries.map((s, i) => (
                    <Bar key={s.key} dataKey={s.label} stackId="t"
                      fill={s.color ?? 'var(--primary)'}
                      radius={i === tierSeries.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
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
