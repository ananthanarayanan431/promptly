'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AdminStats } from '@/types/api';

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="ply-card" style={{ padding: '20px 24px', flex: 1 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

export function StatsCards() {
  const { data, isLoading } = useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const res = await api.get<{ data: AdminStats }>('/api/v1/admin/stats');
      return res.data.data;
    },
    staleTime: 30_000,
  });

  if (isLoading || !data) {
    return (
      <div style={{ display: 'flex', gap: 16 }}>
        {['Total Users', 'Optimizations', 'Tokens Consumed', 'Active (7d)'].map(label => (
          <div key={label} className="ply-card" style={{ padding: '20px 24px', flex: 1, opacity: 0.4 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{label}</div>
            <div style={{ height: 28, background: 'var(--surface-2)', borderRadius: 4 }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <StatCard label="Total Users" value={data.total_users} />
      <StatCard label="Optimizations" value={data.total_optimizations} />
      <StatCard label="Tokens Consumed" value={data.total_tokens_consumed} />
      <StatCard label="Active (7d)" value={data.active_users_7d} />
    </div>
  );
}
