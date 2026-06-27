'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AnalyticsResponse, AnalyticsPoint } from '@/types/analytics';
import { getSeries } from '@/types/analytics';
import { MetricCard } from './metric-card';
import { StaticCard } from './static-card';
import { IssuesTable } from './issues-table';
import { ReleasesCard } from './releases-card';
import { IssueDetailPanel } from './issue-detail-panel';
import { EndpointErrorPanel } from './endpoint-error-panel';
import type { SentryIssue, SentryRelease, EndpointLatency } from '@/types/analytics';

// ── Colors ────────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  completed: '#10b981',
  failed: '#f43f5e',
  queued: '#f59e0b',
  calibrating: '#06b6d4',
  extracting_mapping: '#8b5cf6',
  adapting: '#3b82f6',
  cancelled: '#6b7280',
};

const SESSION_COLORS: Record<string, string> = {
  healthy: '#10b981',
  crashed: '#f43f5e',
  errored: '#f59e0b',
  abnormal: '#6b7280',
  unhandled: '#f97316',
};

const LEVEL_COLORS: Record<string, string> = {
  error: '#f43f5e',
  warning: '#f59e0b',
  info: '#06b6d4',
  debug: '#6b7280',
};

// ── Section divider ───────────────────────────────────────────────────────────

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

// ── KPI stat card (color-coded) ───────────────────────────────────────────────

function HttpStatCard({
  label, value, sub, thresholds,
}: {
  label: string;
  value: string | number;
  sub: string;
  thresholds?: { good: number; ok: number; inverse?: boolean };
}) {
  let color = 'var(--text)';
  if (thresholds) {
    const n = typeof value === 'number' ? value : parseFloat(String(value));
    if (!isFinite(n)) {
      color = 'var(--text)';
    } else if (thresholds.inverse) {
      color = n <= thresholds.good ? '#10b981' : n <= thresholds.ok ? '#f59e0b' : '#f43f5e';
    } else {
      color = n >= thresholds.good ? '#10b981' : n >= thresholds.ok ? '#f59e0b' : '#f43f5e';
    }
  }
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '16px 18px',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-subtle)',
        textTransform: 'uppercase', letterSpacing: '.1em' }}>
        {label}
      </span>
      <span style={{ fontSize: 26, fontWeight: 800, fontFamily: 'var(--mono)',
        color, lineHeight: 1 }}>
        {value}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</span>
    </div>
  );
}

// ── Sentry configure tip ──────────────────────────────────────────────────────

function SentryConfigTip() {
  return (
    <div style={{
      background: 'color-mix(in oklab, #f59e0b 6%, transparent)',
      border: '1px solid color-mix(in oklab, #f59e0b 25%, transparent)',
      borderRadius: 10, padding: '14px 18px',
      display: 'flex', alignItems: 'flex-start', gap: 12,
    }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" style={{ marginTop: 2, flexShrink: 0 }}>
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          Sentry not configured
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Add <code style={{ fontFamily: 'var(--mono)', fontSize: 11.5,
            background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4 }}>
            SENTRY_AUTH_TOKEN</code>,{' '}
          <code style={{ fontFamily: 'var(--mono)', fontSize: 11.5,
            background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4 }}>
            SENTRY_ORG_SLUG</code>, and{' '}
          <code style={{ fontFamily: 'var(--mono)', fontSize: 11.5,
            background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4 }}>
            SENTRY_PROJECT_SLUG</code>{' '}
          to <code style={{ fontFamily: 'var(--mono)', fontSize: 11.5,
            background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4 }}>
            qa-chatbot/.env</code> to pull live error data into this view.
        </span>
      </div>
    </div>
  );
}

// ── Endpoint latency table ────────────────────────────────────────────────────

function EndpointLatencyTable({ rows }: { rows: EndpointLatency[] }) {
  if (rows.length === 0) return null;

  const latencyColor = (ms: number) =>
    ms <= 200 ? '#10b981' : ms <= 500 ? '#f59e0b' : '#f43f5e';

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, overflow: 'hidden',
    }}>
      <div style={{ padding: '14px 18px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-subtle)',
          textTransform: 'uppercase', letterSpacing: '.07em' }}>
          Endpoint Latency
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>top 10 by volume · last 30 days</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
            {(['Endpoint', 'Requests', 'P50', 'P95'] as const).map(h => (
              <th key={h} style={{
                padding: '7px 18px', textAlign: h === 'Endpoint' ? 'left' : 'right',
                fontSize: 10.5, fontWeight: 700, color: 'var(--text-subtle)',
                textTransform: 'uppercase', letterSpacing: '.07em',
                background: 'var(--surface-2)',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.path} style={{
              borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <td style={{ padding: '9px 18px', fontFamily: 'var(--mono)', fontSize: 12,
                color: 'var(--text)', maxWidth: 360, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.path}
              </td>
              <td style={{ padding: '9px 18px', textAlign: 'right',
                fontFamily: 'var(--mono)', color: 'var(--text)' }}>
                {row.count.toLocaleString()}
              </td>
              <td style={{ padding: '9px 18px', textAlign: 'right',
                fontFamily: 'var(--mono)', color: latencyColor(row.p50_ms), fontWeight: 600 }}>
                {row.p50_ms}ms
              </td>
              <td style={{ padding: '9px 18px', textAlign: 'right',
                fontFamily: 'var(--mono)', color: latencyColor(row.p95_ms), fontWeight: 600 }}>
                {row.p95_ms}ms
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DeveloperMetrics() {
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [selectedEndpointPath, setSelectedEndpointPath] = useState<string | null>(null);

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

  // HTTP metrics
  const httpTotal       = Number(st.http_total_requests_30d ?? 0);
  const httpErrorRate   = Number(st.http_error_rate_pct     ?? 0);
  const httpP95         = Number(st.http_p95_latency_ms     ?? 0);
  const http5xxCount    = Number(st.http_5xx_count_30d      ?? 0);

  // Sentry metrics (-1 = not configured)
  const sentryErrors       = Number(st.sentry_total_errors       ?? -1);
  const sentryIssues       = Number(st.sentry_unresolved_issues  ?? -1);
  const sentryCrashFree    = Number(st.sentry_crash_free_rate    ?? -1);
  const sentryTotalSess    = Number(st.sentry_total_sessions     ?? -1);
  const sentryHealthy      = Number(st.sentry_healthy_sessions   ?? -1);
  const sentryCrashed      = Number(st.sentry_crashed_sessions   ?? -1);
  const sentryAccepted     = Number(st.sentry_accepted_total     ?? -1);
  const sentryDiscarded    = Number(st.sentry_discarded_total    ?? -1);
  const sentryFiltered     = Number(st.sentry_filtered_total     ?? -1);
  const sentryConfigured   = sentryErrors >= 0;

  // Bridge metrics
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

  const topFailItems: DistItem[] = (s('dev_http_top_failing_paths')?.data ?? []).map((p, i) => ({
    label: p.date,
    value: p.value,
    color: ['#f43f5e', '#f97316', '#f59e0b', '#eab308', '#84cc16'][i] ?? '#6b7280',
  }));

  const endpointLatency: EndpointLatency[] = (data.raw?.endpoint_latency ?? []) as EndpointLatency[];
  const richIssues: SentryIssue[] = (data.raw?.sentry_issues ?? []) as SentryIssue[];
  const releases: SentryRelease[] = (data.raw?.sentry_releases ?? []) as SentryRelease[];

  // Fallback list from series data when rich_issues not yet loaded (before server restart)
  const fallbackIssueItems: DistItem[] = richIssues.length === 0
    ? (s('dev_sentry_top_issues')?.data ?? []).map((p, i) => ({
        label: p.date,
        value: p.value,
        color: ['#f43f5e', '#f97316', '#f59e0b', '#eab308', '#84cc16',
                '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899', '#6b7280'][i] ?? '#6b7280',
      }))
    : [];

  const sessionHealthItems: DistItem[] = (s('dev_sentry_session_health')?.data ?? []).map(p => ({
    label: p.date.charAt(0).toUpperCase() + p.date.slice(1),
    value: p.value,
    color: SESSION_COLORS[p.date] ?? '#6b7280',
  }));

  const issueLevelItems: DistItem[] = (s('dev_sentry_issue_levels')?.data ?? []).map(p => ({
    label: p.date.charAt(0).toUpperCase() + p.date.slice(1),
    value: p.value,
    color: LEVEL_COLORS[p.date] ?? '#6b7280',
  }));

  const httpHasData = httpTotal > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── HTTP Health statics ──────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <HttpStatCard
          label="HTTP Total Requests"
          value={httpHasData ? httpTotal.toLocaleString() : '—'}
          sub={httpHasData ? `last 30 days` : 'collecting…'}
        />
        <HttpStatCard
          label="HTTP Error Rate"
          value={httpHasData ? `${httpErrorRate}%` : '—'}
          sub={httpHasData ? `${(Number(st.http_error_count_30d ?? 0)).toLocaleString()} errors` : 'collecting…'}
          thresholds={{ good: 0, ok: 1, inverse: true }}
        />
        <HttpStatCard
          label="P95 Latency"
          value={httpHasData ? `${httpP95}ms` : '—'}
          sub={httpHasData ? 'last 30 days' : 'collecting…'}
          thresholds={{ good: 200, ok: 500, inverse: true }}
        />
        <HttpStatCard
          label="Server Errors (5xx)"
          value={httpHasData ? http5xxCount.toLocaleString() : '—'}
          sub={httpHasData ? 'last 30 days' : 'collecting…'}
          thresholds={{ good: 0, ok: 5, inverse: true }}
        />
      </div>

      {/* ── HTTP Health section ──────────────────────────────────────────── */}
      <SectionHeader title="HTTP Health" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {s('dev_http_requests_daily') && <MetricCard series={s('dev_http_requests_daily')!} />}
        {s('dev_http_errors_daily') && <MetricCard series={s('dev_http_errors_daily')!} />}
        {s('dev_http_5xx_daily') && <MetricCard series={s('dev_http_5xx_daily')!} />}
      </div>

      {topFailItems.length > 0 && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 18px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-subtle)',
              textTransform: 'uppercase', letterSpacing: '.07em' }}>
              Top Failing Endpoints
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              click a row for details · last 30 days
            </span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                {(['Endpoint', 'Errors'] as const).map(h => (
                  <th key={h} style={{
                    padding: '7px 18px', textAlign: h === 'Errors' ? 'right' : 'left',
                    fontSize: 10.5, fontWeight: 700, color: 'var(--text-subtle)',
                    textTransform: 'uppercase', letterSpacing: '.07em',
                    background: 'var(--surface-2)',
                  }}>{h}</th>
                ))}
                <th style={{
                  padding: '7px 18px', fontSize: 10.5, fontWeight: 700,
                  color: 'var(--text-subtle)', textTransform: 'uppercase',
                  letterSpacing: '.07em', background: 'var(--surface-2)',
                }} />
              </tr>
            </thead>
            <tbody>
              {topFailItems.map((item, i) => (
                <tr
                  key={item.label}
                  tabIndex={0}
                  aria-label={`View error details for ${item.label}`}
                  onClick={() => setSelectedEndpointPath(item.label)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedEndpointPath(item.label); } }}
                  style={{
                    borderBottom: i < topFailItems.length - 1 ? '1px solid var(--border)' : 'none',
                    cursor: 'pointer',
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <td style={{ padding: '9px 18px', fontFamily: 'var(--mono)', fontSize: 12,
                    color: 'var(--text)', maxWidth: 420, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.label}
                  </td>
                  <td style={{ padding: '9px 18px', textAlign: 'right',
                    fontFamily: 'var(--mono)', fontWeight: 700,
                    color: item.color }}>
                    {item.value.toLocaleString()}
                  </td>
                  <td style={{ padding: '9px 18px', textAlign: 'right',
                    fontSize: 11, color: '#a78bfa', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    View details →
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EndpointLatencyTable rows={endpointLatency} />

      {/* ── Sentry ──────────────────────────────────────────────────────── */}
      <SectionHeader title="Sentry Error Tracking" />

      {!sentryConfigured ? (
        <SentryConfigTip />
      ) : (
        <>
          {/* Row 1: Error volume KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <HttpStatCard
              label="Sentry Errors (30d)"
              value={sentryErrors.toLocaleString()}
              sub="total error events received"
              thresholds={{ good: 0, ok: 10, inverse: true }}
            />
            <HttpStatCard
              label="Unresolved Issues"
              value={sentryIssues.toLocaleString()}
              sub="open issues right now"
              thresholds={{ good: 0, ok: 5, inverse: true }}
            />
            <HttpStatCard
              label="Accepted Events"
              value={sentryAccepted >= 0 ? sentryAccepted.toLocaleString() : '—'}
              sub="processed by Sentry (30d)"
              thresholds={{ good: 0, ok: 50, inverse: true }}
            />
            <HttpStatCard
              label="Discarded Events"
              value={sentryDiscarded >= 0 ? sentryDiscarded.toLocaleString() : '—'}
              sub="rate-limited or sampled out"
              thresholds={{ good: 0, ok: 20, inverse: true }}
            />
          </div>

          {/* Row 2: Session health KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <HttpStatCard
              label="Crash-Free Rate"
              value={sentryCrashFree >= 0 ? `${sentryCrashFree}%` : '—'}
              sub="session-level stability"
              thresholds={{ good: 99.5, ok: 95, inverse: false }}
            />
            <HttpStatCard
              label="Total Sessions"
              value={sentryTotalSess >= 0 ? sentryTotalSess.toLocaleString() : '—'}
              sub="last 30 days"
            />
            <HttpStatCard
              label="Healthy Sessions"
              value={sentryHealthy >= 0 ? sentryHealthy.toLocaleString() : '—'}
              sub="completed without crash"
              thresholds={{ good: 90, ok: 50, inverse: false }}
            />
            <HttpStatCard
              label="Crashed Sessions"
              value={sentryCrashed >= 0 ? sentryCrashed.toLocaleString() : '—'}
              sub="sessions with unhandled error"
              thresholds={{ good: 0, ok: 10, inverse: true }}
            />
          </div>

          {/* Error volume + crash-free trend */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
            {s('dev_sentry_errors_daily') && (
              <MetricCard series={s('dev_sentry_errors_daily')!} />
            )}
            {s('dev_sentry_crash_free_daily') && (
              <MetricCard series={s('dev_sentry_crash_free_daily')!} />
            )}
          </div>

          {/* Accepted / discarded / filtered trends */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {s('dev_sentry_accepted_daily') && (
              <MetricCard series={s('dev_sentry_accepted_daily')!} />
            )}
            {s('dev_sentry_discarded_daily') && (
              <MetricCard series={s('dev_sentry_discarded_daily')!} />
            )}
            {sentryFiltered > 0 && s('dev_sentry_filtered_daily') && (
              <MetricCard series={s('dev_sentry_filtered_daily')!} />
            )}
          </div>

          {/* Session health + issue levels side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
            {sessionHealthItems.length > 0 && (
              <DistributionCard
                title="Session Health"
                items={sessionHealthItems}
                subtitle="last 30 days"
              />
            )}
            {issueLevelItems.length > 0 && (
              <DistributionCard
                title="Issues by Level"
                items={issueLevelItems}
                subtitle="last 14 days"
              />
            )}
          </div>

          {/* Full issues table — click opens inline detail panel */}
          {richIssues.length > 0
            ? <IssuesTable issues={richIssues} onSelectIssue={setSelectedIssueId} />
            : fallbackIssueItems.length > 0 && (
              <DistributionCard
                title="Top Unresolved Issues"
                items={fallbackIssueItems}
                subtitle="by frequency · restart server for full table with links"
              />
            )
          }

          {/* Release stability */}
          {releases.length > 0 && <ReleasesCard releases={releases} />}
        </>
      )}

      {/* ── Bridge pipeline statics ──────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>

        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '16px 18px',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-subtle)',
            textTransform: 'uppercase', letterSpacing: '.1em' }}>
            Bridge Success Rate
          </span>
          <span style={{ fontSize: 26, fontWeight: 800, fontFamily: 'var(--mono)',
            color: bridgeSuccessRate >= 95 ? '#10b981' : bridgeSuccessRate >= 80 ? '#f59e0b' : '#f43f5e',
            lineHeight: 1 }}>
            {bridgeSuccessRate}%
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {(totalBridgeJobs - bridgeFailedTotal).toLocaleString()} / {totalBridgeJobs.toLocaleString()} jobs
          </span>
        </div>

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

      {/* Inline issue detail panel — position:fixed, renders over everything */}
      {selectedIssueId && (
        <IssueDetailPanel
          issueId={selectedIssueId}
          onClose={() => setSelectedIssueId(null)}
        />
      )}

      {/* Endpoint error detail panel */}
      {selectedEndpointPath && (
        <EndpointErrorPanel
          path={selectedEndpointPath}
          onClose={() => setSelectedEndpointPath(null)}
        />
      )}
    </div>
  );
}
