'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DashboardStats, User } from '@/types/api';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';

const TOPUP_AMOUNTS = [100, 250, 500, 1000];

const USAGE_TYPES = [
  { label: 'Council Optimizer', cost: 10, color: '#6366f1', key: 'optimize'   },
  { label: 'Domain PDO',        cost: 10, color: '#06b6d4', key: 'domain_pdo' },
  { label: 'Bridge',            cost: 5,  color: '#a855f7', key: 'bridge'     },
  { label: 'Health Score',      cost: 5,  color: '#f87171', key: 'health'     },
  { label: 'Advisory',          cost: 5,  color: '#f59e0b', key: 'advisory'   },
];

export default function BillingPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState<number | null>(null);

  const { data: user } = useQuery<User>({
    queryKey: ['user', 'me'],
    queryFn: async () => {
      const res = await api.get<{ data: User }>('/api/v1/users/me');
      return res.data.data;
    },
    staleTime: 1000 * 60 * 5,
  });

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const res = await api.get<{ data: DashboardStats }>('/api/v1/stats');
      return res.data.data;
    },
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: async (amount: number) => {
      const res = await api.post<{ data: { credits: number } }>('/api/v1/users/credits/add', { amount });
      return res.data.data;
    },
    onSuccess: (data, amount) => {
      toast.success(`+${amount} credits — balance: ${data.credits}`);
      qc.invalidateQueries({ queryKey: ['user', 'me'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      setAdding(null);
    },
    onError: () => {
      toast.error('Failed to add credits');
      setAdding(null);
    },
  });

  const handleAdd = (amount: number) => {
    setAdding(amount);
    addMutation.mutate(amount);
  };

  const credits = user?.credits ?? 0;
  const approxRuns = Math.floor(credits / 10);
  const lowCredits = credits < 20;

  const allTime = stats?.usage.all_time;
  const thisMonth = stats?.usage.this_month;

  const callsMap: Record<string, number> = {
    optimize:   allTime?.optimize_calls        ?? 0,
    domain_pdo: allTime?.domain_pdo_calls      ?? 0,
    bridge:     allTime?.bridge_calls          ?? 0,
    health:     allTime?.health_score_calls    ?? 0,
    advisory:   allTime?.advisory_calls        ?? 0,
  };
  const creditsMap: Record<string, number> = {
    optimize:   allTime?.optimize_credits      ?? 0,
    domain_pdo: allTime?.domain_pdo_credits    ?? 0,
    bridge:     allTime?.bridge_credits        ?? 0,
    health:     allTime?.health_score_credits  ?? 0,
    advisory:   allTime?.advisory_credits      ?? 0,
  };

  const monthCreditsUsed =
    (thisMonth?.optimize_credits      ?? 0)
    + (thisMonth?.domain_pdo_credits  ?? 0)
    + (thisMonth?.bridge_credits      ?? 0)
    + (thisMonth?.health_score_credits ?? 0)
    + (thisMonth?.advisory_credits    ?? 0);

  const monthCalls =
    (thisMonth?.optimize_calls      ?? 0)
    + (thisMonth?.domain_pdo_calls  ?? 0)
    + (thisMonth?.bridge_calls      ?? 0)
    + (thisMonth?.health_score_calls ?? 0)
    + (thisMonth?.advisory_calls    ?? 0);

  const maxCalls = Math.max(...Object.values(callsMap), 1);

  return (
    <>
      <PageHeader
        title="Billing"
        subtitle="Credits, usage, and your plan."
      />

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 28px 80px' }}>

        {/* 3 stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>

          {/* Balance */}
          <div className="ply-card" style={{ padding: 20, borderColor: lowCredits ? 'var(--danger)' : undefined }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>Balance</div>
            <div style={{ fontSize: 48, fontWeight: 600, lineHeight: 1, fontFamily: 'var(--mono)',
              color: lowCredits ? 'var(--danger)' : 'var(--text)', marginTop: 6 }}>
              {credits.toLocaleString()}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 6, marginBottom: 16 }}>
              ≈ {approxRuns} optimizations remaining
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {TOPUP_AMOUNTS.map(amount => (
                <button
                  key={amount}
                  onClick={() => handleAdd(amount)}
                  disabled={addMutation.isPending}
                  className="ply-btn"
                  style={{
                    padding: '4px 12px',
                    fontSize: 12,
                    background: adding === amount ? 'var(--primary)' : 'var(--surface-2)',
                    color: adding === amount ? '#fff' : 'var(--text)',
                    opacity: addMutation.isPending && adding !== amount ? 0.4 : 1,
                  }}
                >
                  + {amount.toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          {/* This month */}
          <div className="ply-card" style={{ padding: 20 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>This month</div>
            <div style={{ fontSize: 48, fontWeight: 600, lineHeight: 1, fontFamily: 'var(--mono)',
              color: 'var(--text)', marginTop: 6 }}>
              {monthCreditsUsed.toLocaleString()}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 6 }}>
              credits spent · {monthCalls} API calls
            </div>
          </div>

          {/* Plan */}
          <div className="ply-card" style={{ padding: 20 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>Plan</div>
            <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2, color: 'var(--text)', marginTop: 6 }}>
              Free{' '}
              <span style={{ fontWeight: 400 }}>
                · $0<span style={{ fontSize: 14, color: 'var(--text-subtle)', fontWeight: 400 }}>/mo</span>
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 6, marginBottom: 16 }}>
              100 credits on signup · unlimited runs
            </div>
            <button className="ply-btn ply-btn-primary">
              Upgrade
            </button>
          </div>
        </div>

        {/* Usage breakdown */}
        <div className="ply-card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>Usage breakdown</span>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>
              all time
            </span>
          </div>

          {USAGE_TYPES.map((u, i) => {
            const calls = callsMap[u.key] ?? 0;
            const creds = creditsMap[u.key] ?? 0;
            const widthPct = Math.min(100, (calls / maxCalls) * 100);
            const isLast = i === USAGE_TYPES.length - 1;
            return (
              <div key={u.key} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 100px 80px',
                gap: 14, alignItems: 'center', padding: '10px 0',
                borderBottom: isLast ? 'none' : '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: u.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: 'var(--text)' }}>{u.label}</span>
                </div>
                <div className="ply-progress" style={{ height: 6 }}>
                  <div className="ply-progress-bar" style={{ width: `${widthPct}%`, background: u.color }} />
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>
                  {calls} calls
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)', textAlign: 'right', fontWeight: 500 }}>
                  {creds}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
