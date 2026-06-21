'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AdminOpenRouterInfo, DailySpend } from '@/types/api';

function fmt(n: number, decimals = 4): string {
  return `$${n.toFixed(decimals)}`;
}

function SparkBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 28, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ width: `${Math.max(2, pct)}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .2s' }} />
    </div>
  );
}

export function OpenRouterCard() {
  const [historyView, setHistoryView] = useState<'chart' | 'table'>('table');

  const { data, isLoading, isError, refetch, isFetching } = useQuery<AdminOpenRouterInfo>({
    queryKey: ['admin', 'openrouter'],
    queryFn: async () => {
      const res = await api.get<{ data: AdminOpenRouterInfo }>('/api/v1/admin/openrouter');
      return res.data.data;
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {Array(8).fill(0).map((_, i) => (
          <div key={i} style={{ height: 90, background: 'var(--surface-2)', borderRadius: 12, animation: 'pulse 1.5s ease-in-out infinite' }} />
        ))}
      </div>
    );
  }

  if (isError) return (
    <div style={{ padding: '32px', textAlign: 'center', color: 'var(--danger)', background: 'color-mix(in oklab, var(--danger) 6%, transparent)', border: '1px solid color-mix(in oklab, var(--danger) 20%, transparent)', borderRadius: 12, fontSize: 13 }}>
      Failed to load OpenRouter data. Check your API key or try refreshing.
    </div>
  );
  if (!data) return null;

  const maxDailyCost = Math.max(...data.daily_history.map(d => d.total_cost_usd), 0.0001);
  // Only show days with any activity in chart view
  const activeDays = data.daily_history.filter(d => d.sessions > 0 || d.total_tokens > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
            {data.label || 'OpenRouter API Key'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {data.is_free_tier ? 'Free tier' : 'Paid account'}
            {' · '}
            <a href="https://openrouter.ai/settings/billing" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>
              openrouter.ai/settings/billing ↗
            </a>
          </div>
        </div>
        <button onClick={() => refetch()} disabled={isFetching}
          style={{ padding: '6px 14px', fontSize: 12, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }}>
          {isFetching ? '…' : '↻ Refresh'}
        </button>
      </div>

      {/* Low balance warning */}
      {data.limit_remaining !== null && data.limit_remaining < 5 && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'color-mix(in oklab, var(--danger) 10%, transparent)', border: '1px solid color-mix(in oklab, var(--danger) 25%, transparent)', fontSize: 13, color: 'var(--danger)' }}>
          ⚠ Low credit balance: {fmt(data.limit_remaining)} remaining
        </div>
      )}

      {/* Spend summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {[
          { label: 'All-time spend', value: fmt(data.all_time_spend) },
          { label: 'This month', value: fmt(data.monthly_spend) },
          { label: 'This week', value: fmt(data.weekly_spend) },
          { label: 'Today', value: fmt(data.daily_spend_today) },
          ...(data.limit_remaining !== null ? [{ label: 'Credits remaining', value: fmt(data.limit_remaining) }] : []),
          ...(data.limit !== null ? [{ label: 'Credit limit', value: fmt(data.limit) }] : []),
        ].map(stat => (
          <div key={stat.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px' }}>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600 }}>{stat.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--mono)' }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* 30-day usage history */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            30-day usage history
            <span style={{ fontSize: 11, color: 'var(--text-subtle)', fontWeight: 400, marginLeft: 8 }}>
              (cost estimated from local API records)
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['table', 'chart'] as const).map(v => (
              <button key={v} onClick={() => setHistoryView(v)} style={{
                padding: '4px 10px', fontSize: 11.5, borderRadius: 6,
                border: `1px solid ${historyView === v ? 'var(--primary)' : 'var(--border)'}`,
                background: historyView === v ? 'color-mix(in oklab, var(--primary) 10%, transparent)' : 'var(--surface)',
                color: historyView === v ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer',
              }}>{v === 'table' ? '☰ Table' : '▦ Chart'}</button>
            ))}
          </div>
        </div>

        {historyView === 'chart' && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px' }}>
            {activeDays.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>No usage in the last 30 days</div>
            ) : (
              <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 80 }}>
                {data.daily_history.map((d: DailySpend) => {
                  const pct = (d.total_cost_usd / maxDailyCost) * 100;
                  const hasActivity = d.sessions > 0;
                  return (
                    <div key={d.date} title={`${d.date}: ${d.sessions} sessions, ${d.total_tokens.toLocaleString()} tokens, ${fmt(d.total_cost_usd)}`}
                      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'default' }}>
                      <div style={{ width: '100%', height: 60, display: 'flex', alignItems: 'flex-end' }}>
                        <div style={{
                          width: '100%',
                          height: `${Math.max(hasActivity ? 4 : 0, pct * 0.6)}%`,
                          background: hasActivity ? 'var(--primary)' : 'var(--surface-2)',
                          borderRadius: '3px 3px 0 0',
                          minHeight: hasActivity ? 4 : 0,
                          transition: 'height .2s',
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: 'var(--text-subtle)' }}>
              <span>{data.daily_history[0]?.date}</span>
              <span>{data.daily_history[data.daily_history.length - 1]?.date}</span>
            </div>
          </div>
        )}

        {historyView === 'table' && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            {/* Table header */}
            <div style={{ display: 'grid', gridTemplateColumns: '130px 80px 120px 110px', gap: 0, padding: '10px 18px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              {['Date', 'Sessions', 'Tokens', 'Est. Cost'].map(h => (
                <div key={h} style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.07em' }}>{h}</div>
              ))}
            </div>
            {/* Table rows — show most recent 14 days by default, reversed to newest-first */}
            {[...data.daily_history].reverse().map((d: DailySpend) => {
              const hasActivity = d.sessions > 0;
              return (
                <div key={d.date} style={{
                  display: 'grid', gridTemplateColumns: '130px 80px 120px 110px', gap: 0,
                  padding: '9px 18px', borderBottom: '1px solid var(--border)',
                  background: hasActivity ? 'var(--surface)' : 'var(--surface-2)',
                  opacity: hasActivity ? 1 : 0.5,
                }}>
                  <div style={{ fontSize: 12.5, fontFamily: 'var(--mono)', color: 'var(--text)' }}>
                    {new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                  <div style={{ fontSize: 12.5, color: hasActivity ? 'var(--text)' : 'var(--text-subtle)', fontWeight: hasActivity ? 600 : 400 }}>
                    {hasActivity ? d.sessions : '—'}
                  </div>
                  <div style={{ fontSize: 12.5, fontFamily: 'var(--mono)', color: 'var(--text-muted)' }}>
                    {hasActivity ? d.total_tokens.toLocaleString() : '—'}
                  </div>
                  <div style={{ fontSize: 12.5, fontFamily: 'var(--mono)', color: hasActivity ? 'var(--text)' : 'var(--text-subtle)', fontWeight: hasActivity ? 600 : 400 }}>
                    {hasActivity ? fmt(d.total_cost_usd) : '—'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Top models */}
      {data.top_models.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>Top models by spend (30 days)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.top_models.map((m, i) => {
              const maxCost = data.top_models[0]?.total_cost_usd ?? 1;
              const barPct = (m.total_cost_usd / maxCost) * 100;
              return (
                <div key={m.model} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '22px 1fr 110px 90px', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 10.5, color: 'var(--text-subtle)', fontWeight: 700 }}>#{i + 1}</span>
                    <div style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.model}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'right' }}>{m.total_tokens.toLocaleString()} tok</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(m.total_cost_usd)}</div>
                  </div>
                  <SparkBar pct={barPct} color="var(--primary)" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.5 }}>
        Costs are estimated from local API usage records using published OpenRouter pricing.
        Actual charges may differ. For invoices and exact billing, visit{' '}
        <a href="https://openrouter.ai/settings/billing" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>
          openrouter.ai/settings/billing
        </a>
      </div>
    </div>
  );
}
