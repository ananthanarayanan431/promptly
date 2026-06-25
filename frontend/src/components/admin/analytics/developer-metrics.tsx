'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AnalyticsResponse, AnalyticsPoint } from '@/types/analytics';
import { getSeries } from '@/types/analytics';
import { MetricCard } from './metric-card';
import { StaticCard } from './static-card';

// ── Colors for status distribution ───────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  completed: '#10b981',
  failed: '#f43f5e',
  queued: '#f59e0b',
  calibrating: '#06b6d4',
  extracting_mapping: '#8b5cf6',
  adapting: '#3b82f6',
  cancelled: '#6b7280',
};

// ── Section divider ──────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
      <span style={{
        fontSize: 10.5, fontWeight: 700, color: 'var(--text-subtle)',
        textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap',
      }}>
        {title}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

// ── Rate badge — green/yellow/red indicator ───────────────────────────────────

function RateBadge({ rate, inverse = false }: { rate: number; inverse?: boolean }) {
  const isGood = inverse ? rate < 5 : rate >= 95;
  const isMid = inverse ? rate < 15 : rate >= 80;
  const color = isGood ? '#10b981' : isMid ? '#f59e0b' : '#f43f5e';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 99,
      background: `color-mix(in oklab, ${color} 14%, transparent)`,
      color, fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--mono)',
    }}>
      {rate}%
    </span>
  );
}

// ── Distribution card (categorical labels, no date parsing) ──────────────────

interface DistItem {
  label: string;
  value: number;
  color: string;
}

function DistributionCard({
  title, items, subtitle,
}: {
  title: string;
  items: DistItem[];
  subtitle?: string;
}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '18px 20px',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-subtle)',
          textTransform: 'uppercase', letterSpacing: '.07em' }}>
          {title}
        </span>
        {subtitle && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{subtitle}</span>
        )}
      </div>

      {items.length === 0 ? (
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No data yet</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {items.map(item => {
            const pct = total > 0 ? (item.value / total) * 100 : 0;
            return (
              <div key={item.label} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%',
                      background: item.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 500,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.label}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text)' }}>
                      {item.value.toLocaleString()}
                    </span>
                    <span style={{ fontSize: 10.5, color: 'var(--text-muted)',
                      minWidth: 34, textAlign: 'right' }}>
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 999,
                  overflow: 'hidden', marginLeft: 15 }}>
                  <div style={{
                    height: '100%', width: `${pct}%`,
                    background: item.color, borderRadius: 999, transition: 'width .3s ease',
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function buildStatusItems(points: AnalyticsPoint[]): DistItem[] {
  return points.map(p => ({
    label: p.date.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    value: p.value,
    color: STATUS_COLORS[p.date] ?? '#6b7280',
  }));
}

// ── Main component ────────────────────────────────────────────────────────────

export function DeveloperMetrics() {
  const { data, isLoading, isError } = useQuery<AnalyticsResponse>({
    queryKey: ['admin', 'analytics', 'developer_metrics'],
    queryFn: async () => {
      const res = await api.get<{ data: AnalyticsResponse }>(
        '/api/v1/admin/analytics?view=developer_metrics&days=30'
      );
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>;
  }
  if (isError || !data) {
    return <div style={{ color: 'var(--danger)', padding: 24, textAlign: 'center' }}>Failed to load.</div>;
  }

  const st = data.statics;
  const s = (key: string) => getSeries(data, key);

  const bridgeSuccessRate   = Number(st.bridge_success_rate_pct   ?? 0);
  const bridgeFailureRate   = Number(st.bridge_failure_rate_pct   ?? 0);
  const bridgeReuseRate     = Number(st.bridge_reuse_rate_pct     ?? 0);
  const queueDepth          = Number(st.bridge_queue_depth        ?? 0);
  const totalBridgeJobs     = Number(st.total_bridge_jobs         ?? 0);
  const bridgeFailedTotal   = Number(st.bridge_failed_all_time    ?? 0);
  const totalOptSessions    = Number(st.total_optimizer_sessions  ?? 0);
  const incompleteSessions  = Number(st.optimizer_incomplete_sessions ?? 0);
  const optCompletionRate   = Number(st.optimizer_completion_rate_pct ?? 0);

  const bridgeStatusItems = buildStatusItems(s('dev_bridge_status_dist')?.data ?? []);
  const bridgeReuseItems: DistItem[] = (s('dev_bridge_reuse_dist')?.data ?? []).map(p => ({
    label: p.date,
    value: p.value,
    color: p.date === 'Reused' ? '#06b6d4' : '#8b5cf6',
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Top statics ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>

        {/* Bridge success rate with badge */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '16px 18px',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-subtle)',
            textTransform: 'uppercase', letterSpacing: '.1em' }}>
            Bridge Success Rate
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 26, fontWeight: 800, fontFamily: 'var(--mono)',
              color: bridgeSuccessRate >= 95 ? '#10b981' : bridgeSuccessRate >= 80 ? '#f59e0b' : '#f43f5e',
              lineHeight: 1 }}>
              {bridgeSuccessRate}%
            </span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {(totalBridgeJobs - bridgeFailedTotal).toLocaleString()} / {totalBridgeJobs.toLocaleString()} jobs
          </span>
        </div>

        {/* Failure rate */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '16px 18px',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-subtle)',
            textTransform: 'uppercase', letterSpacing: '.1em' }}>
            Bridge Failure Rate
          </span>
          <span style={{ fontSize: 26, fontWeight: 800, fontFamily: 'var(--mono)',
            color: bridgeFailureRate < 5 ? '#10b981' : bridgeFailureRate < 15 ? '#f59e0b' : '#f43f5e',
            lineHeight: 1 }}>
            {bridgeFailureRate}%
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {bridgeFailedTotal.toLocaleString()} failed all time
          </span>
        </div>

        {/* Queue depth */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '16px 18px',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-subtle)',
            textTransform: 'uppercase', letterSpacing: '.1em' }}>
            Bridge Queue Depth
          </span>
          <span style={{ fontSize: 26, fontWeight: 800, fontFamily: 'var(--mono)',
            color: queueDepth === 0 ? 'var(--text-muted)' : queueDepth > 10 ? '#f43f5e' : '#f59e0b',
            lineHeight: 1 }}>
            {queueDepth}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            non-terminal jobs right now
          </span>
        </div>

        {/* Optimizer completion rate */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '16px 18px',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-subtle)',
            textTransform: 'uppercase', letterSpacing: '.1em' }}>
            Optimizer Completion
          </span>
          <span style={{ fontSize: 26, fontWeight: 800, fontFamily: 'var(--mono)',
            color: optCompletionRate >= 95 ? '#10b981' : optCompletionRate >= 80 ? '#f59e0b' : '#f43f5e',
            lineHeight: 1 }}>
            {optCompletionRate}%
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {incompleteSessions.toLocaleString()} incomplete of {totalOptSessions.toLocaleString()}
          </span>
        </div>

      </div>

      {/* Secondary statics: reuse rate + totals */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <StaticCard
          title="Mapping Reuse Rate"
          value={`${bridgeReuseRate}%`}
          subtitle="calibration skipped (cheaper job)"
          accent="#06b6d4"
        />
        <StaticCard
          title="Total Bridge Jobs"
          value={totalBridgeJobs.toLocaleString()}
          subtitle="all time"
        />
        <StaticCard
          title="Optimizer Sessions"
          value={totalOptSessions.toLocaleString()}
          subtitle="all time"
        />
      </div>

      {/* ── Bridge Pipeline ──────────────────────────────────────────────── */}
      <SectionHeader title="Bridge Pipeline" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {s('dev_bridge_jobs_daily') && <MetricCard series={s('dev_bridge_jobs_daily')!} />}
        {s('dev_bridge_completed_daily') && <MetricCard series={s('dev_bridge_completed_daily')!} />}
        {s('dev_bridge_failed_daily') && <MetricCard series={s('dev_bridge_failed_daily')!} />}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        <DistributionCard
          title="Job Status Distribution"
          items={bridgeStatusItems}
          subtitle="all time"
        />
        <DistributionCard
          title="Mapping Reuse vs Fresh Calibration"
          items={bridgeReuseItems}
          subtitle={`${bridgeReuseRate}% reuse rate`}
        />
      </div>

      {/* ── Optimizer Pipeline ───────────────────────────────────────────── */}
      <SectionHeader title="Optimizer Pipeline" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        {s('dev_optimizer_sessions_daily') && <MetricCard series={s('dev_optimizer_sessions_daily')!} />}
        {s('dev_incomplete_sessions_daily') && <MetricCard series={s('dev_incomplete_sessions_daily')!} />}
      </div>

      {/* ── API Call Volume ──────────────────────────────────────────────── */}
      <SectionHeader title="API Call Volume" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {s('dev_optimize_events_daily') && <MetricCard series={s('dev_optimize_events_daily')!} />}
        {s('dev_health_score_daily') && <MetricCard series={s('dev_health_score_daily')!} />}
        {s('dev_advisory_daily') && <MetricCard series={s('dev_advisory_daily')!} />}
      </div>

      {/* ── External Tools note ──────────────────────────────────────────── */}
      <div style={{
        background: 'color-mix(in oklab, var(--primary) 6%, transparent)',
        border: '1px solid color-mix(in oklab, var(--primary) 20%, transparent)',
        borderRadius: 10, padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="var(--primary)" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
        </svg>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          HTTP-level metrics (4xx/5xx rates, request latency, auth failures) are available in your{' '}
          <strong style={{ color: 'var(--text)' }}>Sentry</strong> and{' '}
          <strong style={{ color: 'var(--text)' }}>Grafana</strong> dashboards.
          This view covers application-layer pipeline health not visible in those tools.
        </span>
      </div>

    </div>
  );
}
