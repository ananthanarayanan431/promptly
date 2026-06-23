'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AnalyticsResponse } from '@/types/analytics';
import { getSeries } from '@/types/analytics';
import { MetricCard } from './metric-card';
import { StaticCard } from './static-card';

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {Array(3).fill(0).map((_, i) => (
          <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 12,
            height: 100, animation: 'pulse 1.5s ease-in-out infinite' }} />
        ))}
      </div>
    </div>
  );
}

export function PlatformLogins() {
  const { data, isLoading, isError } = useQuery<AnalyticsResponse>({
    queryKey: ['admin', 'analytics', 'platform_logins'],
    queryFn: async () => {
      const res = await api.get<{ data: AnalyticsResponse }>(
        '/api/v1/admin/analytics?view=platform_logins&days=30'
      );
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <Skeleton />;
  if (isError || !data) return (
    <div style={{ color: 'var(--danger)', padding: 24, textAlign: 'center' }}>
      Failed to load login analytics.
    </div>
  );

  const st = data.statics;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Top KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <StaticCard title="Daily Active Users" value={Number(st.dau_7d)} subtitle="Last 7 Days" />
        <StaticCard title="Weekly Active Users" value={Number(st.wau_7d)} subtitle="Last 7 Days" />
        <StaticCard title="Monthly Active Users" value={Number(st.mau_30d)} subtitle="Last 30 Days" />
      </div>

      {/* Trend charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {(['wau_trend', 'mau_trend', 'qau_trend'] as const).map(key => {
          const s = getSeries(data, key);
          return s ? <MetricCard key={key} series={s} height={130} /> : null;
        })}
      </div>

      {/* Retention + session stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <StaticCard title="D7 Retention"
          value={`${st.d7_retention}%`}
          subtitle="Users who returned within 7 days of signup"
          accent={Number(st.d7_retention) < 20 ? 'var(--danger)' : 'var(--success)'} />
        <StaticCard title="D30 Retention"
          value={`${st.d30_retention}%`}
          subtitle="Users who returned within 30 days of signup"
          accent={Number(st.d30_retention) < 30 ? 'var(--danger)' : 'var(--success)'} />
        <StaticCard title="Avg Sessions / Active User"
          value={Number(st.avg_sessions_per_user)}
          subtitle="Last 30 days" />
      </div>
    </div>
  );
}
