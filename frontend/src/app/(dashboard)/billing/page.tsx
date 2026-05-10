'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DashboardStats, User } from '@/types/api';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import Link from 'next/link';

const TOPUP_AMOUNTS = [100, 250, 500, 1000];

const USAGE_TYPES = [
  { label: 'Optimize',     cost: 10, color: 'var(--primary)',  key: 'optimize' },
  { label: 'Health score', cost: 5,  color: 'var(--success)',  key: 'health'   },
  { label: 'Advisory',     cost: 5,  color: 'var(--warning)',  key: 'advisory' },
];

export default function BillingPage() {
  const qc = useQueryClient();
  const [topupOpen, setTopupOpen] = useState(false);
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
      setTopupOpen(false);
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

  const optimizeCalls = allTime?.optimize_calls ?? 0;
  const optimizeCredits = allTime?.optimize_credits ?? 0;
  const healthCalls = allTime?.health_score_calls ?? 0;
  const healthCredits = allTime?.health_score_credits ?? 0;
  const advisoryCalls = allTime?.advisory_calls ?? 0;
  const advisoryCredits = allTime?.advisory_credits ?? 0;

  const monthCreditsUsed =
    (thisMonth?.optimize_credits ?? 0)
    + (thisMonth?.health_score_credits ?? 0)
    + (thisMonth?.advisory_credits ?? 0);
  const monthCalls =
    (thisMonth?.optimize_calls ?? 0)
    + (thisMonth?.health_score_calls ?? 0)
    + (thisMonth?.advisory_calls ?? 0);

  const maxCalls = Math.max(optimizeCalls, healthCalls, advisoryCalls, 1);

  return (
    <>
      <PageHeader
        title="Billing"
        subtitle="Credits, usage, and plan details."
        right={
          <div style={{ position: 'relative' }}>
            <button onClick={() => setTopupOpen(v => !v)} className="ply-btn ply-btn-primary">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              Top up credits
            </button>

            {topupOpen && (
              <div style={{ position: 'absolute', top: 42, right: 0, zIndex: 50,
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
                padding: 12, width: 200, boxShadow: 'var(--shadow-lg)' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10,
                  color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
                  Add credits
                </div>
                {TOPUP_AMOUNTS.map(amount => (
                  <button key={amount} onClick={() => handleAdd(amount)}
                    disabled={addMutation.isPending}
                    className="ply-btn"
                    style={{ width: '100%', justifyContent: 'space-between', marginBottom: 6,
                      background: adding === amount ? 'var(--primary)' : 'var(--surface-2)',
                      color: adding === amount ? '#fff' : 'var(--text)',
                      opacity: addMutation.isPending && adding !== amount ? 0.4 : 1 }}>
                    <span>+{amount.toLocaleString()} cr</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11,
                      color: adding === amount ? 'rgba(255,255,255,0.6)' : 'var(--text-subtle)' }}>free</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        }
      />

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 28px 80px' }}>

        {/* 3 stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>

          {/* Balance */}
          <div className="ply-card" style={{ padding: 20,
            borderColor: lowCredits ? 'var(--danger)' : undefined }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>Balance</div>
            <div style={{ fontSize: 48, fontWeight: 600, lineHeight: 1, fontFamily: 'var(--mono)',
              color: lowCredits ? 'var(--danger)' : 'var(--text)', marginTop: 6 }}>
              {credits.toLocaleString()}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 6 }}>
              credits · ≈ {approxRuns} more optimizations
            </div>
            {lowCredits && (
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--danger)', marginTop: 12 }}>
                running low — top up to keep optimizing
              </div>
            )}
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
              credits used · {monthCalls} {monthCalls === 1 ? 'call' : 'calls'}
            </div>
          </div>

          {/* Plan */}
          <div className="ply-card" style={{ padding: 20, borderColor: 'var(--primary-ring)' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--primary)',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>Free plan</div>
            <div style={{ fontSize: 32, fontWeight: 600, lineHeight: 1, color: 'var(--text)', marginTop: 6 }}>
              $0<span style={{ fontSize: 14, color: 'var(--text-subtle)', marginLeft: 4 }}>/mo</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 6 }}>
              100 credits on signup · unlimited runs
            </div>
            <button onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); setTopupOpen(true); }} className="ply-btn"
              style={{ marginTop: 14 }}>
              Top up
            </button>
          </div>
        </div>

        {/* Usage breakdown */}
        <div className="ply-card" style={{ padding: '18px 20px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>Usage breakdown</span>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>
              all time
            </span>
          </div>

          {USAGE_TYPES.map((u, i) => {
            const calls = u.key === 'optimize' ? optimizeCalls : u.key === 'health' ? healthCalls : advisoryCalls;
            const creds = u.key === 'optimize' ? optimizeCredits : u.key === 'health' ? healthCredits : advisoryCredits;
            const widthPct = Math.min(100, (calls / maxCalls) * 100);
            const isLast = i === USAGE_TYPES.length - 1;
            return (
              <div key={u.key} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 100px 80px',
                gap: 14, alignItems: 'center', padding: '10px 0',
                borderBottom: isLast ? 'none' : '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: u.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: 'var(--text)' }}>{u.label}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>
                    {u.cost}/call
                  </span>
                </div>
                <div className="ply-progress" style={{ height: 6 }}>
                  <div className="ply-progress-bar" style={{ width: `${widthPct}%`, background: u.color }} />
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>
                  {calls} {calls === 1 ? 'call' : 'calls'}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)', textAlign: 'right', fontWeight: 500 }}>
                  {creds}
                </div>
              </div>
            );
          })}
        </div>

        {/* API keys quick link */}
        <div className="ply-card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 3 }}>API keys</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              Manage named keys for SDK and script access.
            </div>
          </div>
          <Link href="/settings" className="ply-btn" style={{ textDecoration: 'none', flexShrink: 0 }}>
            Manage keys →
          </Link>
        </div>
      </div>
    </>
  );
}
