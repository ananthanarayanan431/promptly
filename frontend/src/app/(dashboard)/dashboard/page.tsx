'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DashboardStats, RecentSessionsResponse } from '@/types/api';
import type { TransferJobSummary, PromptMapping } from '@/types/bridge';
import type { DomainPrompt } from '@/types/domain-prompts';
import type { OpenRouterStats } from '@/types/openrouter';
import { formatDistanceToNow } from 'date-fns';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useUser } from '@clerk/nextjs';

const ActivityChart = dynamic(
  () => import('@/components/dashboard/activity-chart').then((m) => ({ default: m.ActivityChart })),
  { ssr: false },
);
const QualityTrendChart = dynamic(
  () =>
    import('@/components/dashboard/quality-trend-chart').then((m) => ({
      default: m.QualityTrendChart,
    })),
  { ssr: false },
);
const ModelChart = dynamic(
  () => import('@/components/dashboard/model-chart').then((m) => ({ default: m.ModelChart })),
  { ssr: false },
);

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

/* ── Shared primitives ───────────────────────────────────────────────────── */

function SkeletonBlock({ height }: { height: number }) {
  return (
    <div style={{
      height, background: 'var(--surface-2)', borderRadius: 8,
      animation: 'pulse 2s ease-in-out infinite',
    }} />
  );
}

interface StatCardProps {
  label: string; value: string; sub?: string; low?: boolean; icon: React.ReactNode;
}
function StatCard({ label, value, sub, low, icon }: StatCardProps) {
  return (
    <div style={{
      background: 'var(--surface)', border: `1px solid ${low ? 'rgba(255,107,122,0.3)' : 'var(--border)'}`,
      borderRadius: 10, padding: '20px 20px 18px', display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 8,
        background: low ? 'rgba(255,107,122,0.1)' : 'var(--primary-soft)',
        border: `1px solid ${low ? 'rgba(255,107,122,0.2)' : 'var(--primary-border)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: low ? '#ff6b7a' : 'var(--primary)',
      }}>
        {icon}
      </div>
      <div>
        <div style={{
          fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1,
          color: low ? '#ff6b7a' : 'var(--text)', fontFamily: 'var(--font-geist-mono, monospace)', marginBottom: 6,
        }}>
          {value}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{label}</div>
        {sub && <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, color: 'var(--text-subtle)', marginTop: 3 }}>{sub}</div>}
      </div>
    </div>
  );
}

function ChartCard({ title, sub, icon, children, minHeight = 220 }: {
  title: string; sub: string; icon: React.ReactNode; children: React.ReactNode; minHeight?: number;
}) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 3 }}>{title}</div>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, color: 'var(--text-subtle)' }}>{sub}</div>
        </div>
        <div style={{
          width: 28, height: 28, borderRadius: 7, background: 'var(--primary-soft)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)',
        }}>{icon}</div>
      </div>
      <div style={{ minHeight }}>{children}</div>
    </div>
  );
}

function UsageRow({ label, calls, credits, color }: { label: string; calls: number; credits: number; color: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 0', borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <div style={{ display: 'flex', gap: 24 }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{calls}</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-subtle)' }}>calls</div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 48 }}>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{credits}</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-subtle)' }}>credits</div>
        </div>
      </div>
    </div>
  );
}

/* ── Status badge ────────────────────────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    completed: { bg: 'rgba(16,185,129,0.12)', text: '#10b981' },
    failed:    { bg: 'rgba(255,107,122,0.12)', text: '#ff6b7a' },
    queued:    { bg: 'rgba(245,158,11,0.12)',  text: '#f59e0b' },
    optimizing:{ bg: 'rgba(124,92,255,0.12)', text: 'var(--primary)' },
    pending:   { bg: 'rgba(245,158,11,0.12)',  text: '#f59e0b' },
    preparing_dataset: { bg: 'rgba(59,130,246,0.12)', text: '#3b82f6' },
  };
  const c = colors[status] ?? { bg: 'var(--surface-2)', text: 'var(--text-subtle)' };
  return (
    <span style={{
      fontSize: 10.5, fontFamily: 'var(--font-geist-mono, monospace)', fontWeight: 600,
      padding: '2px 7px', borderRadius: 4, background: c.bg, color: c.text,
      textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

/* ── Bridge panel ────────────────────────────────────────────────────────── */
function BridgePanel({ jobs, mappings, loading }: {
  jobs: TransferJobSummary[]; mappings: PromptMapping[]; loading: boolean;
}) {
  const completed = jobs.filter((j) => j.status === 'completed').length;
  const totalCredits = jobs.reduce((s, j) => s + j.credits_charged, 0);
  const reusedCount = jobs.filter((j) => j.reused_mapping).length;

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7, background: 'rgba(59,130,246,0.1)',
              border: '1px solid rgba(59,130,246,0.2)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: '#3b82f6',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M4 12h4M16 12h4M8 12a4 4 0 008 0M8 12V8M16 12V8M8 8h8" />
              </svg>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Bridge</span>
          </div>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, color: 'var(--text-subtle)' }}>
            Cross-model prompt transfers
          </div>
        </div>
        <Link href="/bridge" style={{ fontSize: 11.5, color: '#3b82f6', textDecoration: 'none', fontFamily: 'var(--font-geist-mono, monospace)' }}>
          Open →
        </Link>
      </div>

      {/* Summary stats */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SkeletonBlock height={28} />
          <SkeletonBlock height={28} />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {[
            { label: 'Transfers', value: String(completed) },
            { label: 'Mappings', value: String(mappings.length) },
            { label: 'Credits used', value: String(totalCredits) },
          ].map(({ label, value }) => (
            <div key={label} style={{
              background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px',
              border: '1px solid var(--border)',
            }}>
              <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 18, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Mappings list */}
      {!loading && mappings.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono, monospace)', color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Saved mappings
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {mappings.slice(0, 3).map((m) => (
              <div key={m.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 7,
                border: '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.source_model.split('/').pop()} → {m.target_model.split('/').pop()}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 12, flexShrink: 0, marginLeft: 8 }}>
                  {m.avg_source_score != null && (
                    <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, color: '#10b981' }}>
                      src {fmt(m.avg_source_score)}
                    </span>
                  )}
                  {m.avg_target_score != null && (
                    <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, color: '#3b82f6' }}>
                      tgt {fmt(m.avg_target_score)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent transfers */}
      {!loading && jobs.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono, monospace)', color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Recent transfers
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {jobs.slice(0, 3).map((j) => (
              <div key={j.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 7,
                border: '1px solid var(--border)',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {j.source_model.split('/').pop()} → {j.target_model.split('/').pop()}
                  </div>
                  <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10, color: 'var(--text-subtle)', marginTop: 2 }}>
                    {j.reused_mapping ? '1 cr · reused mapping' : '5 cr · full calibration'} · {timeAgo(j.created_at)}
                  </div>
                </div>
                <StatusBadge status={j.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && jobs.length === 0 && (
        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-subtle)', fontSize: 13 }}>
          No transfers yet
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, marginTop: 4 }}>
            Transfer a prompt between models to get started
          </div>
        </div>
      )}

      {/* Reuse rate footer */}
      {!loading && jobs.length > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          paddingTop: 8, borderTop: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>Mapping reuse rate</span>
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 13, fontWeight: 700, color: '#3b82f6' }}>
            {Math.round((reusedCount / jobs.length) * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}

/* ── Domain panel ────────────────────────────────────────────────────────── */
function DomainPanel({ domains, loading }: { domains: DomainPrompt[]; loading: boolean }) {
  const completed = domains.filter((d) => d.status === 'completed');
  const avgImprovement = completed.length > 0
    ? completed.reduce((s, d) => {
        const before = d.score_before ?? 0;
        const after = d.score_after ?? 0;
        return s + (before > 0 ? ((after - before) / before) * 100 : 0);
      }, 0) / completed.length
    : null;
  const avgWinRate = completed.length > 0
    ? completed.reduce((s, d) => s + (d.win_rate ?? 0), 0) / completed.length
    : null;

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7, background: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.2)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: '#f59e0b',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M9 2v6.4a2 2 0 01-.34 1.12L4.5 16.5A3 3 0 007 21h10a3 3 0 002.5-4.5l-4.16-6.98A2 2 0 0115 8.4V2M8 2h8M7 16h10" />
              </svg>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Domain</span>
          </div>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, color: 'var(--text-subtle)' }}>
            Dataset-driven prompt optimization
          </div>
        </div>
        <Link href="/domain-prompts" style={{ fontSize: 11.5, color: '#f59e0b', textDecoration: 'none', fontFamily: 'var(--font-geist-mono, monospace)' }}>
          Open →
        </Link>
      </div>

      {/* Summary stats */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SkeletonBlock height={28} />
          <SkeletonBlock height={28} />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {[
            { label: 'Domains', value: String(domains.length) },
            { label: 'Completed', value: String(completed.length) },
            {
              label: 'Avg win rate',
              value: avgWinRate != null ? `${fmt(avgWinRate * 100, 0)}%` : '—',
            },
          ].map(({ label, value }) => (
            <div key={label} style={{
              background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px',
              border: '1px solid var(--border)',
            }}>
              <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 18, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Domains list */}
      {!loading && domains.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono, monospace)', color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Recent domains
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {domains.slice(0, 4).map((d) => (
              <div key={d.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 7,
                border: '1px solid var(--border)',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                    {d.name}
                  </div>
                  {d.status === 'completed' && d.score_before != null && d.score_after != null && (
                    <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10, color: 'var(--text-subtle)', marginTop: 2 }}>
                      {fmt(d.score_before)} → <span style={{ color: '#10b981' }}>{fmt(d.score_after)}</span>
                      {d.win_rate != null && <span style={{ marginLeft: 6 }}>{fmt(d.win_rate * 100, 0)}% win rate</span>}
                    </div>
                  )}
                </div>
                <StatusBadge status={d.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && domains.length === 0 && (
        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-subtle)', fontSize: 13 }}>
          No domains yet
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, marginTop: 4 }}>
            Upload a dataset to start domain optimization
          </div>
        </div>
      )}

      {/* Avg improvement footer */}
      {!loading && avgImprovement != null && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          paddingTop: 8, borderTop: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>Avg score improvement</span>
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 13, fontWeight: 700, color: '#10b981' }}>
            +{fmt(avgImprovement, 1)}%
          </span>
        </div>
      )}
    </div>
  );
}

/* ── OpenRouter panel ────────────────────────────────────────────────────── */
function OpenRouterPanel({ data, loading }: { data: OpenRouterStats | undefined; loading: boolean }) {
  const usagePct = data?.key.limit
    ? Math.min(100, (data.key.spend.all_time / data.key.limit) * 100)
    : null;

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7, background: 'rgba(124,92,255,0.1)',
              border: '1px solid var(--primary-border)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: 'var(--primary)',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4l3 3" />
              </svg>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>OpenRouter</span>
            {data?.key.is_free_tier && (
              <span style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono, monospace)', fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Free tier
              </span>
            )}
          </div>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, color: 'var(--text-subtle)' }}>
            {data?.key.label ?? 'API key usage & model spend'}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SkeletonBlock height={52} />
          <SkeletonBlock height={80} />
          <SkeletonBlock height={100} />
        </div>
      ) : !data ? (
        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-subtle)', fontSize: 13 }}>
          Could not load OpenRouter stats
        </div>
      ) : (
        <>
          {/* Spend periods */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {([
              { label: 'Today', value: data.key.spend.daily },
              { label: 'This week', value: data.key.spend.weekly },
              { label: 'This month', value: data.key.spend.monthly },
              { label: 'All time', value: data.key.spend.all_time },
            ] as const).map(({ label, value }) => (
              <div key={label} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
                <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 14, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
                  ${value.toFixed(4)}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-subtle)', marginTop: 4 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Credit limit bar (only when limit is set) */}
          {data.key.limit != null && usagePct != null && (
            <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Credit limit</span>
                <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11.5, color: 'var(--text-subtle)' }}>
                  ${data.key.spend.all_time.toFixed(4)} / ${data.key.limit.toFixed(2)}
                </span>
              </div>
              <div style={{ height: 4, background: 'var(--border)', borderRadius: 99 }}>
                <div style={{
                  height: '100%', borderRadius: 99, width: `${usagePct}%`,
                  background: usagePct > 85 ? '#ff6b7a' : usagePct > 60 ? '#f59e0b' : 'var(--primary)',
                  transition: 'width 0.4s ease',
                }} />
              </div>
              {data.key.limit_remaining != null && (
                <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, color: 'var(--text-subtle)', marginTop: 5 }}>
                  ${data.key.limit_remaining.toFixed(4)} remaining
                </div>
              )}
            </div>
          )}

          {/* Top models by spend */}
          {data.top_models.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono, monospace)', color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                Top models by estimated spend
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.top_models.slice(0, 5).map((m) => {
                  const maxCost = data.top_models[0].total_cost_usd;
                  const barPct = maxCost > 0 ? (m.total_cost_usd / maxCost) * 100 : 0;
                  return (
                    <div key={m.model} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {m.model.split('/').pop()}
                      </div>
                      <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 99 }}>
                        <div style={{ height: '100%', width: `${barPct}%`, background: 'var(--primary)', borderRadius: 99, opacity: 0.7 }} />
                      </div>
                      <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, color: 'var(--text-subtle)', width: 60, textAlign: 'right', flexShrink: 0 }}>
                        ~${m.total_cost_usd.toFixed(4)}
                      </div>
                      <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, color: 'var(--text-subtle)', width: 42, textAlign: 'right', flexShrink: 0 }}>
                        {formatTokens(m.total_tokens)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {data.top_models.length === 0 && (
            <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--text-subtle)', fontSize: 12 }}>
              No generation history yet
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function DashboardHome() {
  const { user: clerkUser } = useUser();

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

  const { data: bridgeJobsData, isLoading: bridgeLoading } = useQuery({
    queryKey: ['dashboard-bridge-jobs'],
    queryFn: async () => {
      const res = await api.get<{ data: { jobs: TransferJobSummary[] } }>('/api/v1/prompt-bridge/jobs');
      return res.data.data.jobs;
    },
    staleTime: 30_000,
  });

  const { data: bridgeMappingsData } = useQuery({
    queryKey: ['dashboard-bridge-mappings'],
    queryFn: async () => {
      const res = await api.get<{ data: { mappings: PromptMapping[] } }>('/api/v1/prompt-bridge/mappings');
      return res.data.data.mappings;
    },
    staleTime: 30_000,
  });

  const { data: domainData, isLoading: domainLoading } = useQuery({
    queryKey: ['dashboard-domains'],
    queryFn: async () => {
      const res = await api.get<{ data: { domains: DomainPrompt[] } }>('/api/v1/domain-prompts/');
      return res.data.data.domains;
    },
    staleTime: 30_000,
  });

  const { data: orStats, isLoading: orLoading } = useQuery({
    queryKey: ['dashboard-openrouter'],
    queryFn: async () => {
      const res = await api.get<{ data: OpenRouterStats }>('/api/v1/openrouter/stats');
      return res.data.data;
    },
    staleTime: 60_000,
    retry: 1,
  });

  const lowCredits = stats ? stats.credits_remaining < 20 : false;
  const firstName = clerkUser?.firstName ?? clerkUser?.primaryEmailAddress?.emailAddress?.split('@')[0] ?? 'there';
  const recentSessions = recentData?.sessions ?? [];
  const usage = stats?.usage;
  const bridgeJobs = bridgeJobsData ?? [];
  const bridgeMappings = bridgeMappingsData ?? [];
  const now = new Date();
  const monthlyBridge = bridgeJobs.filter(j => {
    const d = new Date(j.created_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  const domains = domainData ?? [];

  return (
    <div style={{
      height: '100%', overflowY: 'auto', padding: '28px 40px 80px',
      fontFamily: 'var(--font-geist, ui-sans-serif)',
    }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 36 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
          <div>
            <div style={{
              fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
              color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8,
            }}>
              / dashboard
            </div>
            <h1 style={{
              fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontWeight: 400,
              fontSize: 42, letterSpacing: '-0.02em', lineHeight: 1.12, margin: '0 0 6px',
              color: 'var(--text)',
            }}>
              Hey, <em style={{ color: 'var(--primary)', fontStyle: 'italic' }}>{firstName}</em>.
            </h1>
            <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11.5, color: 'var(--text-subtle)' }}>
              Last active {timeAgo(stats?.last_optimized_at ?? null)}
              {stats && stats.streak_days > 0 && (
                <span style={{ marginLeft: 12, color: '#f59e0b' }}>⚡ {stats.streak_days}-day streak</span>
              )}
            </div>
          </div>
          <Link href="/optimize" style={{
            height: 34, padding: '0 16px', borderRadius: 8, background: 'var(--primary)',
            border: '1px solid var(--primary)', fontSize: 13, color: '#fff', textDecoration: 'none',
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginTop: 8, fontWeight: 500,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
            </svg>
            New optimization
          </Link>
        </div>

        {/* Core stat cards */}
        {statsLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 10, height: 130, animation: 'pulse 2s ease-in-out infinite',
              }} />
            ))}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            <StatCard label="Prompts optimized" value={String(stats?.prompts_optimized ?? 0)} sub="total runs"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" /></svg>} />
            <StatCard label="Sessions started" value={String(stats?.total_sessions ?? 0)} sub="conversations"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>} />
            <StatCard label="Versions saved" value={String(stats?.versions_saved ?? 0)}
              sub={stats && stats.total_versions > 0 ? `${stats.total_versions} total` : 'prompt families'}
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5M2 12l10 5 10-5" /></svg>} />
            <StatCard label="Tokens used" value={formatTokens(stats?.total_tokens ?? 0)}
              sub={stats?.avg_tokens_per_run ? `~${formatTokens(stats.avg_tokens_per_run)} avg` : 'across all runs'}
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>} />
            <StatCard label="Estimated cost" value={`$${(stats?.estimated_cost_usd ?? 0).toFixed(4)}`} sub="blended model rate"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg>} />
            <StatCard label="Credits remaining" value={String(stats?.credits_remaining ?? 0)}
              sub={lowCredits ? 'running low' : '10 per optimization'} low={lowCredits}
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>} />
          </div>
        )}

        {/* Bridge + Domain panels */}
        <div>
          <div style={{
            fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
            color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 14,
          }}>
            Feature activity
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <BridgePanel jobs={bridgeJobs} mappings={bridgeMappings} loading={bridgeLoading} />
            <DomainPanel domains={domains} loading={domainLoading} />
          </div>
        </div>

        {/* OpenRouter account panel */}
        <div>
          <div style={{
            fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
            color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 14,
          }}>
            OpenRouter account
          </div>
          <OpenRouterPanel data={orStats} loading={orLoading} />
        </div>

        {/* Charts row 1 — activity + quality trend */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <ChartCard title="Optimization activity" sub="Prompts per day — last 30 days"
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>}>
            {statsLoading ? <SkeletonBlock height={220} /> : <ActivityChart data={stats?.daily_activity ?? []} />}
          </ChartCard>

          <ChartCard title="Prompt quality trend" sub="Avg health score per day — last 30 days"
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 3v18h18" /><path d="M7 14v4M12 10v8M17 6v12" /></svg>}>
            {statsLoading ? <SkeletonBlock height={220} /> : stats?.quality_trend && stats.quality_trend.length > 0 ? (
              <QualityTrendChart data={stats.quality_trend} />
            ) : (
              <div style={{ height: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-subtle)', textAlign: 'center' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 3v18h18" /><path d="M7 14v4M12 10v8M17 6v12" /></svg>
                <div style={{ fontSize: 13 }}>No quality data yet</div>
                <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5 }}>Scores appear after your first optimization</div>
              </div>
            )}
          </ChartCard>
        </div>

        {/* Charts row 2 — model usage + usage breakdown */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <ChartCard title="Token usage by model" sub="Total tokens consumed per model"
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>}>
            {statsLoading ? <SkeletonBlock height={220} /> : stats?.model_breakdown && stats.model_breakdown.length > 0 ? (
              <ModelChart data={stats.model_breakdown} />
            ) : (
              <div style={{ height: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-subtle)', textAlign: 'center' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
                <div style={{ fontSize: 13 }}>No model data yet</div>
                <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5 }}>Appears after your first optimization</div>
              </div>
            )}
          </ChartCard>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 3 }}>Usage breakdown</div>
                <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, color: 'var(--text-subtle)' }}>Credits spent by feature this month</div>
              </div>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--primary-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 20V10M18 20V4M6 20v-4" /></svg>
              </div>
            </div>
            {statsLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                {[1, 2, 3].map((i) => <SkeletonBlock key={i} height={36} />)}
              </div>
            ) : (
              <div style={{ marginTop: 14 }}>
                <UsageRow label="Optimize" calls={usage?.this_month.optimize_calls ?? 0} credits={usage?.this_month.optimize_credits ?? 0} color="var(--primary)" />
                <UsageRow label="Health Score" calls={usage?.this_month.health_score_calls ?? 0} credits={usage?.this_month.health_score_credits ?? 0} color="#10b981" />
                <UsageRow label="Advisory" calls={usage?.this_month.advisory_calls ?? 0} credits={usage?.this_month.advisory_credits ?? 0} color="#f59e0b" />
                <UsageRow label="Bridge" calls={monthlyBridge.length} credits={monthlyBridge.reduce((s, j) => s + j.credits_charged, 0)} color="#3b82f6" />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, marginTop: 2 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-subtle)', fontFamily: 'var(--font-geist-mono, monospace)' }}>Total this month</span>
                  <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                    {(usage?.this_month.optimize_credits ?? 0) +
                      (usage?.this_month.health_score_credits ?? 0) +
                      (usage?.this_month.advisory_credits ?? 0) +
                      monthlyBridge.reduce((s, j) => s + j.credits_charged, 0)} credits
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Continue where you left off */}
        {recentSessions.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                Continue where you left off
              </div>
              <Link href="/history" style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11, color: 'var(--primary)', textDecoration: 'none' }}>
                View all →
              </Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recentSessions.map((session) => (
                <div key={session.id} style={{
                  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
                  padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16,
                }}>
                  <div style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0, background: 'var(--primary-soft)', border: '1px solid var(--primary-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {session.title || 'Untitled conversation'}
                    </div>
                    {session.last_prompt && (
                      <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {session.last_prompt}
                      </div>
                    )}
                    <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, color: 'var(--text-subtle)', marginTop: 3 }}>
                      {formatDistanceToNow(new Date(session.updated_at), { addSuffix: true })}
                    </div>
                  </div>
                  <Link href={`/optimize?session=${session.id}`} style={{
                    height: 30, padding: '0 14px', borderRadius: 7, flexShrink: 0,
                    background: 'var(--primary-soft)', border: '1px solid var(--primary-border)',
                    fontSize: 12, color: 'var(--primary)', textDecoration: 'none', fontWeight: 500,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                    Resume
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick actions */}
        <div>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>
            Quick actions
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {[
              { href: '/optimize', title: 'Optimize a prompt', primary: true, desc: 'Run any prompt through 4 AI models and get a sharper result.', cta: 'Start optimizing', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" /></svg> },
              { href: '/bridge', title: 'Bridge a prompt', primary: false, desc: 'Transfer a prompt calibrated for one model to work on another.', cta: 'Start transfer', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 12h4M16 12h4M8 12a4 4 0 008 0M8 12V8M16 12V8M8 8h8" /></svg> },
              { href: '/domain-prompts', title: 'Domain optimization', primary: false, desc: 'Upload a dataset and run tournament-based prompt optimization.', cta: 'Open domain', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M9 2v6.4a2 2 0 01-.34 1.12L4.5 16.5A3 3 0 007 21h10a3 3 0 002.5-4.5l-4.16-6.98A2 2 0 0115 8.4V2M8 2h8M7 16h10" /></svg> },
            ].map((action) => (
              <div key={action.href} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: action.primary ? 'var(--primary-soft)' : 'var(--surface-2)', border: `1px solid ${action.primary ? 'var(--primary-border)' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: action.primary ? 'var(--primary)' : 'var(--text-muted)' }}>
                  {action.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>{action.title}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', lineHeight: 1.55 }}>{action.desc}</div>
                </div>
                <Link href={action.href} style={{ height: 32, borderRadius: 6, border: `1px solid ${action.primary ? 'var(--primary)' : 'var(--border)'}`, background: action.primary ? 'var(--primary)' : 'transparent', fontSize: 12.5, color: action.primary ? '#fff' : 'var(--text-muted)', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', fontWeight: action.primary ? 500 : 400 }}>
                  {action.cta}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 6l6 6-6 6" /></svg>
                </Link>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
