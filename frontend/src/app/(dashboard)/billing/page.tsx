'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DashboardStats, User } from '@/types/api';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

const TOPUP_AMOUNTS = [100, 250, 500, 1000];

const USAGE_TYPES = [
  { label: 'Optimize',     cost: 10, color: '#7c5cff', key: 'optimize'      },
  { label: 'Health score', cost: 5,  color: '#5cffb1', key: 'health'        },
  { label: 'Advisory',     cost: 5,  color: '#ffb85c', key: 'advisory'      },
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
  const maxCredits = 1000;
  const pct = Math.min(100, Math.round((credits / maxCredits) * 100));
  const approxRuns = Math.floor(credits / 10);
  const lowCredits = credits < 20;

  // Derive usage stats from dashboard data
  const optimizeRuns = stats?.prompts_optimized ?? 0;
  const totalCalls = stats ? stats.prompts_optimized + stats.total_sessions : 0;
  const totalCreditsUsed = optimizeRuns * 10; // approximation from known data

  // Normalize bar widths relative to the biggest usage
  const maxRuns = Math.max(optimizeRuns, 1);

  return (
    <div style={{ padding: '28px 40px 120px', maxWidth: 1180, margin: '0 auto',
      fontFamily: 'var(--font-geist, ui-sans-serif)' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        marginBottom: 40, gap: 24 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
            color: '#7c5cff', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>
            / billing
          </div>
          <h1 style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontWeight: 400,
            fontSize: 42, letterSpacing: '-0.02em', lineHeight: 1.12, margin: 0, color: '#ededed' }}>
            <em style={{ fontStyle: 'italic', color: '#7c5cff' }}>Credits,</em> usage,<br />and receipts.
          </h1>
        </div>
        <div style={{ paddingTop: 8, position: 'relative' }}>
          <button onClick={() => setTopupOpen(v => !v)}
            style={{ height: 34, padding: '0 14px', borderRadius: 6,
              background: '#7c5cff', border: '1px solid #7c5cff', fontSize: 13,
              color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
              fontWeight: 500, fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Top up credits
          </button>

          {topupOpen && (
            <div style={{ position: 'absolute', top: 42, right: 0, zIndex: 50,
              background: '#1a1a1a', border: '1px solid #2a2a2e', borderRadius: 10,
              padding: 12, width: 200, boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }}>
              <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10,
                color: '#5a5a60', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
                Add credits
              </div>
              {TOPUP_AMOUNTS.map(amount => (
                <button key={amount} onClick={() => handleAdd(amount)}
                  disabled={addMutation.isPending}
                  style={{ width: '100%', height: 34, borderRadius: 6, border: '1px solid #2a2a2e',
                    background: adding === amount ? '#7c5cff' : '#222226',
                    color: adding === amount ? '#fff' : '#ededed',
                    fontSize: 13, fontWeight: 500, cursor: addMutation.isPending ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0 12px', marginBottom: 6,
                    fontFamily: 'var(--font-geist, ui-sans-serif)',
                    opacity: addMutation.isPending && adding !== amount ? 0.4 : 1 }}>
                  <span>+{amount.toLocaleString()} cr</span>
                  {addMutation.isPending && adding === amount
                    ? <Loader2 style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} />
                    : <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
                        color: adding === amount ? 'rgba(255,255,255,0.6)' : '#5a5a60' }}>free</span>
                  }
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 3 stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>

        {/* Balance */}
        <div style={{ background: '#1a1a1a', border: `1px solid ${lowCredits ? 'rgba(255,107,122,0.4)' : '#1f1f23'}`,
          borderRadius: 10, padding: 22 }}>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
            color: '#5a5a60', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>
            Balance
          </div>
          <div style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontSize: 54,
            letterSpacing: '-0.02em', lineHeight: 1, color: lowCredits ? '#ff6b7a' : '#ededed',
            marginTop: 8 }}>{credits.toLocaleString()}</div>
          <div style={{ fontSize: 12.5, color: '#8a8a90', marginTop: 6 }}>
            credits · ≈ {approxRuns} more optimizations
          </div>
          <div style={{ height: 4, background: '#2a2a2e', borderRadius: 2, marginTop: 14, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, borderRadius: 2,
              background: lowCredits ? '#ff6b7a' : '#7c5cff', transition: 'width 300ms' }} />
          </div>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
            color: '#5a5a60', marginTop: 6 }}>
            {credits} / {maxCredits} · {lowCredits ? 'running low' : 'healthy'}
          </div>
        </div>

        {/* This month */}
        <div style={{ background: '#1a1a1a', border: '1px solid #1f1f23', borderRadius: 10, padding: 22 }}>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
            color: '#5a5a60', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>
            This month
          </div>
          <div style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontSize: 54,
            letterSpacing: '-0.02em', lineHeight: 1, color: '#ededed', marginTop: 8 }}>
            {totalCreditsUsed.toLocaleString()}
          </div>
          <div style={{ fontSize: 12.5, color: '#8a8a90', marginTop: 6 }}>
            credits used · {totalCalls} calls
          </div>
        </div>

        {/* Plan */}
        <div style={{ background: '#1a1a1a', border: '1px solid rgba(124,92,255,0.35)',
          borderRadius: 10, padding: 22,
          boxShadow: '0 0 0 1px rgba(124,92,255,0.1)' }}>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
            color: '#7c5cff', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>
            Free plan
          </div>
          <div style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontSize: 38,
            letterSpacing: '-0.02em', lineHeight: 1, color: '#ededed', marginTop: 8 }}>
            $0<span style={{ fontSize: 16, fontFamily: 'var(--font-geist, ui-sans-serif)',
              color: '#5a5a60', marginLeft: 4 }}> / mo</span>
          </div>
          <div style={{ fontSize: 12.5, color: '#8a8a90', marginTop: 6 }}>
            100 credits on signup · unlimited runs
          </div>
          <button onClick={() => setTopupOpen(true)}
            style={{ marginTop: 14, height: 28, padding: '0 10px', borderRadius: 6,
              border: '1px solid #2a2a2e', background: 'transparent', fontSize: 12,
              color: '#b5b5ba', cursor: 'pointer',
              fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
            Top up
          </button>
        </div>
      </div>

      {/* Usage breakdown */}
      <div style={{ background: '#1a1a1a', border: '1px solid #1f1f23', borderRadius: 10,
        padding: 22, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 15, fontWeight: 500, color: '#ededed',
            letterSpacing: '-0.005em' }}>Usage breakdown</span>
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-geist-mono, monospace)',
            fontSize: 11, color: '#5a5a60' }}>all time</span>
        </div>

        {/* Optimize */}
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 100px 80px',
          gap: 14, alignItems: 'center', padding: '10px 0',
          borderBottom: '1px solid #1f1f23' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#7c5cff', flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: '#ededed' }}>Optimize</span>
            <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
              color: '#5a5a60' }}>10/call</span>
          </div>
          <div style={{ height: 6, background: '#2a2a2e', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(100, (optimizeRuns / Math.max(maxRuns, 1)) * 100)}%`,
              background: '#7c5cff', borderRadius: 3 }} />
          </div>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12,
            color: '#8a8a90', textAlign: 'right' }}>{optimizeRuns} calls</div>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12,
            color: '#ededed', textAlign: 'right' }}>{optimizeRuns * 10}</div>
        </div>

        {/* Health score — we don't have a separate counter, show placeholder */}
        {USAGE_TYPES.slice(1).map((u, i) => (
          <div key={u.key} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 100px 80px',
            gap: 14, alignItems: 'center', padding: '10px 0',
            borderBottom: i === 0 ? '1px solid #1f1f23' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: u.color, flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: '#ededed' }}>{u.label}</span>
              <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
                color: '#5a5a60' }}>{u.cost}/call</span>
            </div>
            <div style={{ height: 6, background: '#2a2a2e', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '0%', background: u.color, borderRadius: 3 }} />
            </div>
            <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12,
              color: '#8a8a90', textAlign: 'right' }}>0 calls</div>
            <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12,
              color: '#ededed', textAlign: 'right' }}>0</div>
          </div>
        ))}
      </div>

      {/* API keys */}
      <div style={{ background: '#1a1a1a', border: '1px solid #1f1f23', borderRadius: 10, padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 15, fontWeight: 500, color: '#ededed',
            letterSpacing: '-0.005em' }}>API keys</span>
          <button style={{ marginLeft: 'auto', height: 28, padding: '0 10px', borderRadius: 6,
            border: '1px solid #2a2a2e', background: 'transparent', fontSize: 12,
            color: '#b5b5ba', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            New key
          </button>
        </div>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 100px 30px',
          gap: 14, padding: '8px 0', marginBottom: 4,
          fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10,
          color: '#5a5a60', textTransform: 'uppercase', letterSpacing: '0.1em',
          borderBottom: '1px solid #1f1f23' }}>
          <span>Name</span>
          <span>Key</span>
          <span style={{ textAlign: 'right' }}>Last used</span>
          <span />
        </div>

        <div style={{ padding: '14px 0', borderBottom: '1px solid #1f1f23',
          display: 'grid', gridTemplateColumns: '120px 1fr 100px 30px',
          gap: 14, alignItems: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px',
            borderRadius: 999, fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
            background: '#222226', border: '1px solid #2a2a2e', color: '#8a8a90' }}>
            default
          </span>
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12,
            color: '#b5b5ba' }}>
            qac_••••••••••••••••
          </span>
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
            color: '#5a5a60', textAlign: 'right' }}>—</span>
          <button style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none', cursor: 'pointer', color: '#5a5a60' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="9" y="9" width="13" height="13" rx="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
        </div>

        <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
          color: '#5a5a60', marginTop: 12, lineHeight: 1.5 }}>
          Use <span style={{ color: '#ededed' }}>Authorization: Bearer qac_...</span> or pass as a header.
          Keys inherit your credit balance.
        </div>
      </div>
    </div>
  );
}
