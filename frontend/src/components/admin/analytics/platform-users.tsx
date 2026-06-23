'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AdminStats } from '@/types/api';
import type { AnalyticsResponse } from '@/types/analytics';
import { getSeries } from '@/types/analytics';
import { MetricCard } from './metric-card';
import { StaticCard } from './static-card';

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {Array(4).fill(0).map((_, i) => (
          <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 12,
            height: 100, animation: 'pulse 1.5s ease-in-out infinite' }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {Array(3).fill(0).map((_, i) => (
          <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 12,
            height: 220, animation: 'pulse 1.5s ease-in-out infinite' }} />
        ))}
      </div>
    </div>
  );
}

export function PlatformUsers() {
  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const res = await api.get<{ data: AdminStats }>('/api/v1/admin/stats');
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: engagement, isLoading: engLoading } = useQuery<AnalyticsResponse>({
    queryKey: ['admin', 'analytics', 'platform_engagement'],
    queryFn: async () => {
      const res = await api.get<{ data: AnalyticsResponse }>(
        '/api/v1/admin/analytics?view=platform_engagement&days=30'
      );
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (statsLoading || engLoading) return <Skeleton />;
  if (!stats || !engagement) return (
    <div style={{ color: 'var(--danger)', padding: 24, textAlign: 'center' }}>
      Failed to load user metrics.
    </div>
  );

  const signups = getSeries(engagement, 'signups_per_day');
  const dau     = getSeries(engagement, 'dau');
  const wau     = getSeries(engagement, 'wau');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StaticCard title="Total Users"    value={stats.total_users}    subtitle="all time" />
        <StaticCard title="New Users"      value={stats.new_users_7d}   subtitle="last 7 days" />
        <StaticCard title="New Users"      value={stats.new_users_30d}  subtitle="last 30 days" />
        <StaticCard title="Active Users"   value={stats.active_users_7d} subtitle="last 7 days" />
      </div>

      {/* Trend charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {signups && <MetricCard series={signups} height={130} />}
        {dau     && <MetricCard series={dau}     height={130} />}
        {wau     && <MetricCard series={wau}     height={130} />}
      </div>
    </div>
  );
}
