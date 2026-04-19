'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DashboardStats, RecentSessionsResponse } from '@/types/api';
import { formatDistanceToNow } from 'date-fns';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useAuthStore } from '@/stores/auth-store';

const ActivityChart = dynamic(
  () => import('@/components/dashboard/activity-chart').then((m) => ({ default: m.ActivityChart })),
  { ssr: false }
);
const QualityTrendChart = dynamic(
  () =>
    import('@/components/dashboard/quality-trend-chart').then((m) => ({
      default: m.QualityTrendChart,
    })),
  { ssr: false }
);

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  low?: boolean;
  icon: React.ReactNode;
}

function StatCard({ label, value, sub, low, icon }: StatCardProps) {
  return (
    <div style={{ background: '#1a1a1a', border: `1px solid ${low ? 'rgba(255,107,122,0.3)' : '#1f1f23'}`,
      borderRadius: 10, padding: '20px 20px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ width: 34, height: 34, borderRadius: 8,
        background: low ? 'rgba(255,107,122,0.1)' : 'rgba(124,92,255,0.1)',
        border: `1px solid ${low ? 'rgba(255,107,122,0.2)' : 'rgba(124,92,255,0.2)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: low ? '#ff6b7a' : '#7c5cff' }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1,
          color: low ? '#ff6b7a' : '#ededed', fontFamily: 'var(--font-geist-mono, monospace)',
          marginBottom: 6 }}>
          {value}
        </div>
        <div style={{ fontSize: 12.5, color: '#8a8a90' }}>{label}</div>
        {sub && <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
          color: '#5a5a60', marginTop: 3 }}>{sub}</div>}
      </div>
    </div>
  );
}

export default function DashboardHome() {
  const user = useAuthStore((s) => s.user);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const res = await api.get<{ data: DashboardStats }>('/api/v1/stats');
      return res.data.data;
    },
    refetchInterval: 30_000,
  });

  const { data: recentData } = useQuery<RecentSessionsResponse>({
    queryKey: ['recent-sessions'],
    queryFn: async () => {
      const res = await api.get<{ data: RecentSessionsResponse }>('/api/v1/chat/sessions/recent?limit=3');
      return res.data.data;
    },
    staleTime: 30_000,
  });

  const lowCredits = stats ? stats.credits_remaining < 20 : false;
  const firstName = user?.email?.split('@')[0] ?? 'there';
  const recentSessions = recentData?.sessions ?? [];

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '28px 40px 80px',
      fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 36 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
              color: '#7c5cff', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>
              / dashboard
            </div>
            <h1 style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontWeight: 400,
              fontSize: 42, letterSpacing: '-0.02em', lineHeight: 1.12, margin: '0 0 6px', color: '#ededed' }}>
              Hey, <em style={{ color: '#7c5cff', fontStyle: 'italic' }}>{firstName}</em>.
            </h1>
            <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11.5, color: '#5a5a60' }}>
              Last active {timeAgo(stats?.last_optimized_at ?? null)}
              {stats && stats.streak_days > 0 && (
                <span style={{ marginLeft: 12, color: '#f59e0b' }}>
                  ⚡ {stats.streak_days}-day streak
                </span>
              )}
            </div>
          </div>
          <Link href="/optimize"
            style={{ height: 34, padding: '0 16px', borderRadius: 8, background: '#7c5cff',
              border: '1px solid #7c5cff', fontSize: 13, color: '#fff', textDecoration: 'none',
              display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginTop: 8,
              fontWeight: 500 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>
            </svg>
            New optimization
          </Link>
        </div>

        {/* Stat cards */}
        {statsLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ background: '#1a1a1a', border: '1px solid #1f1f23',
                borderRadius: 10, height: 130, animation: 'pulse 2s ease-in-out infinite' }} />
            ))}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            <StatCard label="Prompts optimized" value={String(stats?.prompts_optimized ?? 0)}
              sub="total runs"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>} />
            <StatCard label="Sessions started" value={String(stats?.total_sessions ?? 0)}
              sub="conversations"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>} />
            <StatCard label="Versions saved" value={String(stats?.versions_saved ?? 0)}
              sub={stats && stats.total_versions > 0 ? `${stats.total_versions} total` : 'prompt families'}
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>} />
            <StatCard label="Tokens used" value={formatTokens(stats?.total_tokens ?? 0)}
              sub={stats?.avg_tokens_per_run ? `~${formatTokens(stats.avg_tokens_per_run)} avg` : 'across all runs'}
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>} />
            <StatCard label="Estimated cost" value={`$${(stats?.estimated_cost_usd ?? 0).toFixed(4)}`}
              sub="blended model rate"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>} />
            <StatCard label="Credits remaining" value={String(stats?.credits_remaining ?? 0)}
              sub={lowCredits ? 'running low' : '10 per optimization'} low={lowCredits}
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>} />
          </div>
        )}

        {/* Charts */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={{ background: '#1a1a1a', border: '1px solid #1f1f23', borderRadius: 10, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#ededed', marginBottom: 3 }}>
                  Optimization activity
                </div>
                <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, color: '#5a5a60' }}>
                  Prompts per day — last 30 days
                </div>
              </div>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(124,92,255,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7c5cff' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
                </svg>
              </div>
            </div>
            {statsLoading ? (
              <div style={{ height: 220, background: '#222226', borderRadius: 8 }} />
            ) : (
              <ActivityChart data={stats?.daily_activity ?? []} />
            )}
          </div>

          <div style={{ background: '#1a1a1a', border: '1px solid #1f1f23', borderRadius: 10, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#ededed', marginBottom: 3 }}>
                  Prompt quality trend
                </div>
                <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, color: '#5a5a60' }}>
                  Avg health score per day — last 30 days
                </div>
              </div>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(124,92,255,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7c5cff' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M3 3v18h18"/><path d="M7 14v4M12 10v8M17 6v12"/>
                </svg>
              </div>
            </div>
            {statsLoading ? (
              <div style={{ height: 220, background: '#222226', borderRadius: 8 }} />
            ) : stats?.quality_trend && stats.quality_trend.length > 0 ? (
              <QualityTrendChart data={stats.quality_trend} />
            ) : (
              <div style={{ height: 220, display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 8, color: '#5a5a60', textAlign: 'center' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <path d="M3 3v18h18"/><path d="M7 14v4M12 10v8M17 6v12"/>
                </svg>
                <div style={{ fontSize: 13 }}>No quality data yet</div>
                <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5 }}>
                  Scores appear after your first optimization
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Continue where you left off */}
        {recentSessions.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
                color: '#5a5a60', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                Continue where you left off
              </div>
              <Link href="/history" style={{ fontFamily: 'var(--font-geist-mono, monospace)',
                fontSize: 11, color: '#7c5cff', textDecoration: 'none' }}>
                View all →
              </Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recentSessions.map((session) => (
                <div key={session.id}
                  style={{ background: '#1a1a1a', border: '1px solid #1f1f23', borderRadius: 10,
                    padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                    background: 'rgba(124,92,255,0.1)', border: '1px solid rgba(124,92,255,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7c5cff' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#ededed', marginBottom: 4,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {session.title || 'Untitled conversation'}
                    </div>
                    {session.last_prompt && (
                      <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
                        color: '#5a5a60', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {session.last_prompt}
                      </div>
                    )}
                    <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
                      color: '#3a3a40', marginTop: 3 }}>
                      {formatDistanceToNow(new Date(session.updated_at), { addSuffix: true })}
                    </div>
                  </div>
                  <Link href={`/optimize?session=${session.id}`}
                    style={{ height: 30, padding: '0 14px', borderRadius: 7, flexShrink: 0,
                      background: 'rgba(124,92,255,0.12)', border: '1px solid rgba(124,92,255,0.25)',
                      fontSize: 12, color: '#7c5cff', textDecoration: 'none', fontWeight: 500,
                      display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                    Resume
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick actions */}
        <div>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
            color: '#5a5a60', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>
            Quick actions
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {[
              {
                href: '/optimize',
                title: 'Optimize a prompt',
                desc: 'Run any prompt through 4 AI models and get a sharper result.',
                cta: 'Start optimizing',
                primary: true,
                icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>,
              },
              {
                href: '/versions',
                title: 'Browse versions',
                desc: 'Review past prompt iterations and build on what worked.',
                cta: 'View history',
                primary: false,
                icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>,
              },
              {
                href: '/analyze',
                title: 'Analyze quality',
                desc: 'Score any prompt across 8 dimensions with a full advisory.',
                cta: 'Analyze prompt',
                primary: false,
                icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 3v18h18"/><path d="M7 14v4M12 10v8M17 6v12"/></svg>,
              },
            ].map((action) => (
              <div key={action.href}
                style={{ background: '#1a1a1a', border: '1px solid #1f1f23', borderRadius: 10, padding: 20,
                  display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ width: 34, height: 34, borderRadius: 8,
                  background: action.primary ? 'rgba(124,92,255,0.15)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${action.primary ? 'rgba(124,92,255,0.3)' : '#2a2a2e'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: action.primary ? '#7c5cff' : '#8a8a90' }}>
                  {action.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: '#ededed', marginBottom: 6 }}>
                    {action.title}
                  </div>
                  <div style={{ fontSize: 12.5, color: '#5a5a60', lineHeight: 1.55 }}>
                    {action.desc}
                  </div>
                </div>
                <Link href={action.href}
                  style={{ height: 32, borderRadius: 6, border: `1px solid ${action.primary ? '#7c5cff' : '#2a2a2e'}`,
                    background: action.primary ? '#7c5cff' : 'transparent', fontSize: 12.5,
                    color: action.primary ? '#fff' : '#b5b5ba', textDecoration: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0 12px', fontWeight: action.primary ? 500 : 400 }}>
                  {action.cta}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M9 6l6 6-6 6"/>
                  </svg>
                </Link>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
