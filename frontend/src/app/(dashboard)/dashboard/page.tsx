'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { DashboardStats, SessionsGrouped } from '@/types/api';
import { Skeleton } from '@/components/ui/skeleton';
import { buttonVariants } from '@/components/ui/button';
import dynamic from 'next/dynamic';
import { formatDistanceToNow } from 'date-fns';

const ActivityChart = dynamic(
  () => import('@/components/dashboard/activity-chart').then((m) => ({ default: m.ActivityChart })),
  { ssr: false }
);
const ModelChart = dynamic(
  () => import('@/components/dashboard/model-chart').then((m) => ({ default: m.ModelChart })),
  { ssr: false }
);

import {
  Wand2,
  History,
  ActivitySquare,
  Zap,
  DollarSign,
  GitBranch,
  CreditCard,
  ArrowRight,
  TrendingUp,
  MessageSquare,
  Flame,
  Clock,
} from 'lucide-react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';

/* ── helpers ──────────────────────────────────────────────────────────────── */

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

/* ── components ───────────────────────────────────────────────────────────── */

interface StatCardProps {
  title: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  iconClass: string;
  accent?: boolean;
  badge?: React.ReactNode;
}

function StatCard({ title, value, sub, icon: Icon, iconClass, accent, badge }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 hover:border-primary/20 hover:shadow-sm transition-all duration-200">
      <div className="flex items-start justify-between mb-4">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${iconClass}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        {badge}
      </div>
      <div className={`text-3xl font-black tracking-tight tabular-nums ${accent ? 'text-destructive' : 'text-foreground'}`}>
        {value}
      </div>
      <p className="text-sm text-muted-foreground mt-1 font-medium">{title}</p>
      {sub && <p className="text-[11px] text-muted-foreground/60 mt-0.5">{sub}</p>}
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5">
      <Skeleton className="h-10 w-10 rounded-xl mb-4" />
      <Skeleton className="h-8 w-20 mb-2" />
      <Skeleton className="h-4 w-28 mb-1" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */

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

  const { data: sessions } = useQuery<SessionsGrouped>({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await api.get<{ data: SessionsGrouped }>('/api/v1/chat/sessions');
      return res.data.data;
    },
    staleTime: 30_000,
  });

  const lowCredits = stats ? stats.credits_remaining < 20 : false;
  const firstName = user?.email?.split('@')[0] ?? 'there';

  // Flatten + sort sessions for recent activity list
  const recentSessions = sessions
    ? [
        ...sessions.today,
        ...sessions.last_7_days,
        ...sessions.last_30_days,
        ...sessions.older,
      ]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 6)
    : [];

  return (
    <PageContainer>
      <div className="space-y-8">

        {/* ── Welcome header ── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1">Overview</p>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-black tracking-tight">Hey, {firstName} 👋</h1>
              {/* Streak badge */}
              {stats && stats.streak_days > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-semibold">
                  <Flame className="h-3.5 w-3.5" />
                  {stats.streak_days}-day streak
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1.5 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span>Last active {timeAgo(stats?.last_optimized_at ?? null)}</span>
            </div>
          </div>
          <Link
            href="/optimize"
            className={buttonVariants({ className: 'gap-2 shadow-sm shadow-primary/20 shrink-0' })}
          >
            <Wand2 className="h-4 w-4" />
            New optimization
          </Link>
        </div>

        {/* ── Stat cards — 2 rows of 3 ── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {statsLoading ? (
            Array.from({ length: 6 }).map((_, i) => <StatCardSkeleton key={i} />)
          ) : (
            <>
              <StatCard
                title="Prompts Optimized"
                value={String(stats?.prompts_optimized ?? 0)}
                sub="total runs"
                icon={Wand2}
                iconClass="bg-gradient-to-br from-primary to-primary/70"
              />
              <StatCard
                title="Sessions Started"
                value={String(stats?.total_sessions ?? 0)}
                sub="conversations"
                icon={MessageSquare}
                iconClass="bg-gradient-to-br from-blue-500 to-blue-600"
              />
              <StatCard
                title="Versions Saved"
                value={String(stats?.versions_saved ?? 0)}
                sub={
                  stats && stats.total_versions > 0
                    ? `${stats.total_versions} total version${stats.total_versions !== 1 ? 's' : ''} across all families`
                    : 'prompt families'
                }
                icon={GitBranch}
                iconClass="bg-gradient-to-br from-violet-500 to-violet-600"
              />
              <StatCard
                title="Tokens Used"
                value={formatTokens(stats?.total_tokens ?? 0)}
                sub={
                  stats && stats.avg_tokens_per_run > 0
                    ? `~${formatTokens(stats.avg_tokens_per_run)} avg per run${stats.top_model ? ` · ${stats.top_model} leads` : ''}`
                    : 'across all runs'
                }
                icon={Zap}
                iconClass="bg-gradient-to-br from-amber-500 to-amber-600"
              />
              <StatCard
                title="Estimated Cost"
                value={`$${(stats?.estimated_cost_usd ?? 0).toFixed(4)}`}
                sub="blended model rate"
                icon={DollarSign}
                iconClass="bg-gradient-to-br from-emerald-500 to-emerald-600"
              />
              <StatCard
                title="Credits Left"
                value={String(stats?.credits_remaining ?? 0)}
                sub={lowCredits ? 'running low — use wisely' : '10 credits per optimization'}
                icon={CreditCard}
                iconClass={
                  lowCredits
                    ? 'bg-gradient-to-br from-destructive to-destructive/70'
                    : 'bg-gradient-to-br from-primary/80 to-primary/50'
                }
                accent={lowCredits}
                badge={
                  lowCredits ? (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-destructive bg-destructive/10 border border-destructive/20 rounded-full px-2 py-0.5">
                      Low
                    </span>
                  ) : undefined
                }
              />
            </>
          )}
        </div>

        {/* ── Charts ── */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Activity line chart */}
          <div className="rounded-2xl border border-border/60 bg-card p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm font-semibold">Optimization Activity</p>
                <p className="text-xs text-muted-foreground mt-0.5">Prompts per day — last 30 days</p>
              </div>
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
            </div>
            {statsLoading ? (
              <Skeleton className="h-[220px] w-full rounded-xl" />
            ) : (
              <ActivityChart data={stats?.daily_activity ?? []} />
            )}
          </div>

          {/* Model bar chart */}
          <div className="rounded-2xl border border-border/60 bg-card p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm font-semibold">Token Usage by Model</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Council consumption per LLM
                  {stats?.top_model && (
                    <span className="ml-1.5 inline-flex items-center gap-1 text-primary font-medium">
                      · {stats.top_model} leads
                    </span>
                  )}
                </p>
              </div>
              <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Zap className="h-4 w-4 text-amber-500" />
              </div>
            </div>
            {statsLoading ? (
              <Skeleton className="h-[220px] w-full rounded-xl" />
            ) : stats?.model_breakdown && stats.model_breakdown.length > 0 ? (
              <ModelChart data={stats.model_breakdown} />
            ) : (
              <div className="h-[220px] flex flex-col items-center justify-center gap-2 text-center">
                <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center">
                  <Zap className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">No model data yet</p>
                <p className="text-xs text-muted-foreground/60">Run your first optimization to see stats here</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Recent Sessions ── */}
        {recentSessions.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
                Recent Sessions
              </p>
              <Link
                href="/optimize"
                className="text-xs font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
              >
                New chat <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="rounded-2xl border border-border/60 bg-card divide-y divide-border/50 overflow-hidden">
              {recentSessions.map((session) => (
                <Link
                  key={session.id}
                  href={`/optimize?session=${session.id}`}
                  className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/40 transition-colors group"
                >
                  <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <MessageSquare className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                      {session.title || 'Untitled conversation'}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground/60 shrink-0">
                    {formatDistanceToNow(new Date(session.updated_at), { addSuffix: true })}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 group-hover:text-primary transition-colors" />
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ── Quick Actions ── */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-4">Quick Actions</p>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                title: 'Optimize a Prompt',
                desc: 'Run any prompt through 4 AI models and get back a polished, sharper version.',
                href: '/optimize',
                icon: Wand2,
                iconClass: 'bg-gradient-to-br from-primary to-primary/70',
                cta: 'Start optimizing',
                primary: true,
              },
              {
                title: 'Browse Versions',
                desc: 'Review past prompt iterations, compare improvements, and build on what worked.',
                href: '/versions',
                icon: History,
                iconClass: 'bg-gradient-to-br from-blue-500 to-blue-600',
                cta: 'View history',
                primary: false,
              },
              {
                title: 'Analyze Quality',
                desc: 'Score any prompt across 8 dimensions and get a plain-English advisory breakdown.',
                href: '/analyze',
                icon: ActivitySquare,
                iconClass: 'bg-gradient-to-br from-emerald-500 to-emerald-600',
                cta: 'Analyze prompt',
                primary: false,
              },
            ].map((action) => (
              <div
                key={action.title}
                className="rounded-2xl border border-border/60 bg-card p-5 flex flex-col gap-4 hover:border-primary/20 hover:shadow-sm transition-all duration-200"
              >
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${action.iconClass}`}>
                  <action.icon className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-sm mb-1">{action.title}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{action.desc}</p>
                </div>
                <Link
                  href={action.href}
                  className={cn(
                    buttonVariants({
                      variant: action.primary ? 'default' : 'outline',
                      size: 'sm',
                    }),
                    'w-full justify-between'
                  )}
                >
                  {action.cta}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ))}
          </div>
        </div>

      </div>
    </PageContainer>
  );
}
