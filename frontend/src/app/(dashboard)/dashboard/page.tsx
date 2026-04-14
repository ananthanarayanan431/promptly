'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { DashboardStats } from '@/types/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { buttonVariants } from '@/components/ui/button';
import dynamic from 'next/dynamic';

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
} from 'lucide-react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${accent ? 'text-destructive' : 'text-muted-foreground'}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${accent ? 'text-destructive' : ''}`}>{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function StatCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-32 mb-1" />
        <Skeleton className="h-3 w-20" />
      </CardContent>
    </Card>
  );
}

export default function DashboardHome() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const res = await api.get<{ data: DashboardStats }>('/api/v1/stats');
      return res.data.data;
    },
    refetchInterval: 30_000,
  });

  const lowCredits = stats ? stats.credits_remaining < 20 : false;

  return (
    <PageContainer>
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Your prompt optimization activity at a glance.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              title="Prompts Optimized"
              value={String(stats?.prompts_optimized ?? 0)}
              sub="total runs"
              icon={Wand2}
            />
            <StatCard
              title="Tokens Used"
              value={formatTokens(stats?.total_tokens ?? 0)}
              sub="across all runs"
              icon={Zap}
            />
            <StatCard
              title="Est. Cost"
              value={`$${(stats?.estimated_cost_usd ?? 0).toFixed(4)}`}
              sub="blended model rate"
              icon={DollarSign}
            />
            <StatCard
              title="Versions Saved"
              value={String(stats?.versions_saved ?? 0)}
              sub="prompt families"
              icon={GitBranch}
            />
            <StatCard
              title="Credits Left"
              value={String(stats?.credits_remaining ?? 0)}
              sub={lowCredits ? 'running low' : 'available'}
              icon={CreditCard}
              accent={lowCredits}
            />
          </>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Optimization Activity</CardTitle>
            <p className="text-xs text-muted-foreground">Prompts optimized per day — last 30 days</p>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[220px] w-full" />
            ) : (
              <ActivityChart data={stats?.daily_activity ?? []} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Token Usage by Model</CardTitle>
            <p className="text-xs text-muted-foreground">Council token consumption per LLM</p>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[220px] w-full" />
            ) : stats?.model_breakdown && stats.model_breakdown.length > 0 ? (
              <ModelChart data={stats.model_breakdown} />
            ) : (
              <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
                No model data yet — run your first optimization.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Quick Actions</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Optimize</CardTitle>
              <Wand2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                Submit a prompt to the multi-model council for optimization.
              </p>
              <Link href="/optimize" className={buttonVariants({ className: 'w-full' })}>
                Start Optimizing
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Versions</CardTitle>
              <History className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                View your version history and track prompt improvements.
              </p>
              <Link
                href="/versions"
                className={buttonVariants({ variant: 'outline', className: 'w-full' })}
              >
                View History
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Analyze</CardTitle>
              <ActivitySquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                Check health scores and get advisory feedback on prompts.
              </p>
              <Link
                href="/analyze"
                className={buttonVariants({ variant: 'outline', className: 'w-full' })}
              >
                Analyze Prompts
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
    </PageContainer>
  );
}
