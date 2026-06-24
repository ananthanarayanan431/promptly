'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AnalyticsResponse } from '@/types/analytics';
import { getSeries } from '@/types/analytics';
import { MetricCard } from './metric-card';
import { StaticCard } from './static-card';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

export function AgentDomain() {
  const { data, isLoading, isError } = useQuery<AnalyticsResponse>({
    queryKey: ['admin', 'analytics', 'agent_domain'],
    queryFn: async () => {
      const res = await api.get<{ data: AnalyticsResponse }>(
        '/api/v1/admin/analytics?view=agent_domain&days=30'
      );
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>;
  if (isError || !data) return <div style={{ color: 'var(--danger)', padding: 24, textAlign: 'center' }}>Failed to load.</div>;

  const st = data.statics;
  const pdoSeries = getSeries(data, 'domain_pdo');
  const gepaSeries = getSeries(data, 'domain_gepa');

  // Build PDO vs GEPA split data
  const splitDates = (pdoSeries?.data ?? []).map(p => p.date.slice(5));
  const splitData = splitDates.map((date, i) => ({
    date,
    PDO: pdoSeries?.data[i]?.value ?? 0,
    GEPA: gepaSeries?.data[i]?.value ?? 0,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(1, 1fr)', gap: 12 }}>
        <StaticCard title="Total Domain Runs" value={Number(st.total_runs).toLocaleString()} subtitle="all time" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        {(['domain_runs', 'domain_augment', 'domain_tokens', 'domain_unique_users'] as const).map(key => {
          const s = getSeries(data, key);
          return s ? <MetricCard key={key} series={s} /> : null;
        })}

        {/* PDO vs GEPA stacked */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '18px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-subtle)',
            textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>
            PDO vs GEPA Split
          </div>
          <div style={{ height: 150 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={splitData} margin={{ top: 0, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-subtle)' }}
                  tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9, fill: 'var(--text-subtle)' }}
                  tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 8, fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="PDO" stackId="s" fill="#06b6d4" />
                <Bar dataKey="GEPA" stackId="s" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
