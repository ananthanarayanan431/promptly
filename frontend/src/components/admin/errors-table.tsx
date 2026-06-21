'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { GlitchTipIssueList, GlitchTipIssue } from '@/types/api';

const GLITCHTIP_URL = process.env.NEXT_PUBLIC_GLITCHTIP_URL ?? 'http://localhost:8080';

/* ── Helpers ───────────────────────────────────────────────────── */
function relativeTime(dateStr: string): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function errorSeverity(occ: number): { label: string; color: string; icon: string } {
  if (occ >= 100) return { label: 'Critical', color: 'var(--danger)', icon: '🔴' };
  if (occ >= 10) return { label: 'High', color: '#f97316', icon: '🟠' };
  if (occ >= 3) return { label: 'Medium', color: 'var(--warning)', icon: '🟡' };
  return { label: 'Low', color: 'var(--text-muted)', icon: '⚪' };
}

/* ── Status badge ──────────────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { color: string; bg: string }> = {
    unresolved: { color: 'var(--danger)', bg: 'color-mix(in oklab, var(--danger) 10%, transparent)' },
    resolved:   { color: 'var(--success)', bg: 'color-mix(in oklab, var(--success) 10%, transparent)' },
    ignored:    { color: 'var(--text-muted)', bg: 'var(--surface-2)' },
  };
  const c = cfg[status] ?? cfg.unresolved;
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: c.bg, color: c.color, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

/* ── Error card ────────────────────────────────────────────────── */
function ErrorCard({ issue, maxOcc }: { issue: GlitchTipIssue; maxOcc: number }) {
  const [expanded, setExpanded] = useState(false);
  const sev = errorSeverity(issue.occurrences);
  const pct = Math.min(100, (issue.occurrences / Math.max(1, maxOcc)) * 100);
  const isNew = issue.first_seen && (Date.now() - new Date(issue.first_seen).getTime()) < 24 * 60 * 60 * 1000;

  return (
    <div style={{
      background: 'var(--surface)', border: `1px solid ${issue.status === 'unresolved' ? sev.color + '40' : 'var(--border)'}`,
      borderRadius: 10, overflow: 'hidden',
      opacity: issue.status === 'ignored' ? 0.6 : 1,
    }}>
      <button onClick={() => setExpanded(e => !e)} style={{
        width: '100%', padding: '14px 16px', display: 'grid',
        gridTemplateColumns: '32px 1fr 100px 100px 100px 28px',
        gap: 12, alignItems: 'center', background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left',
      }}>
        {/* Severity dot */}
        <div style={{ fontSize: 20, lineHeight: 1 }}>{sev.icon}</div>

        {/* Title */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>
              {issue.title}
            </span>
            {isNew && (
              <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'color-mix(in oklab, var(--primary) 12%, transparent)', color: 'var(--primary)', flexShrink: 0 }}>
                NEW
              </span>
            )}
          </div>
          {/* Occurrence bar */}
          <div style={{ height: 3, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden', maxWidth: 320 }}>
            <div style={{ height: '100%', width: `${pct}%`, background: sev.color, borderRadius: 99 }} />
          </div>
        </div>

        {/* Occurrences */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700, color: sev.color }}>{issue.occurrences.toLocaleString()}</div>
          <div style={{ fontSize: 10, color: 'var(--text-subtle)' }}>occurrences</div>
        </div>

        {/* Status */}
        <div style={{ textAlign: 'center' }}><StatusBadge status={issue.status} /></div>

        {/* Last seen */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{relativeTime(issue.last_seen)}</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-subtle)' }}>last seen</div>
        </div>

        <span style={{ fontSize: 14, color: 'var(--text-subtle)' }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div style={{ padding: '12px 16px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {[
              { label: 'First seen', value: relativeTime(issue.first_seen) + ` (${new Date(issue.first_seen).toLocaleDateString()})` },
              { label: 'Last seen', value: relativeTime(issue.last_seen) + ` (${new Date(issue.last_seen).toLocaleDateString()})` },
              { label: 'Severity', value: `${sev.label} — ${issue.occurrences} occurrences` },
            ].map(f => (
              <div key={f.label} style={{ background: 'var(--surface-2)', borderRadius: 7, padding: '8px 12px' }}>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>{f.label}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text)' }}>{f.value}</div>
              </div>
            ))}
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 7, wordBreak: 'break-all' }}>
            Issue #{issue.id}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <a href={`${GLITCHTIP_URL}/issues/${issue.id}`} target="_blank" rel="noopener noreferrer"
              style={{ padding: '6px 12px', fontSize: 12, borderRadius: 6, background: 'var(--primary)', color: 'white', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              View in GlitchTip →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main component ────────────────────────────────────────────── */
export function ErrorsTable() {
  const [statusFilter, setStatusFilter] = useState<'all' | 'unresolved' | 'resolved' | 'ignored'>('all');

  const { data, isLoading, refetch, dataUpdatedAt } = useQuery<GlitchTipIssueList>({
    queryKey: ['admin', 'errors'],
    queryFn: async () => {
      const res = await api.get<{ data: GlitchTipIssueList }>('/api/v1/admin/errors');
      return res.data.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const filtered = (data?.issues ?? []).filter(i =>
    statusFilter === 'all' ? true : i.status === statusFilter
  );
  const unresolved = (data?.issues ?? []).filter(i => i.status === 'unresolved').length;
  const resolved = (data?.issues ?? []).filter(i => i.status === 'resolved').length;
  const critical = (data?.issues ?? []).filter(i => i.occurrences >= 100).length;
  const maxOcc = Math.max(1, ...((data?.issues ?? []).map(i => i.occurrences)));
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—';

  const noGlitchTip = !isLoading && data?.issues.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 10 }}>
          {[
            { label: 'Total issues', value: data?.issues.length ?? 0, color: 'var(--text)' },
            { label: 'Unresolved', value: unresolved, color: unresolved > 0 ? 'var(--danger)' : 'var(--success)' },
            { label: 'Resolved', value: resolved, color: 'var(--success)' },
            { label: 'Critical (≥100)', value: critical, color: critical > 0 ? 'var(--danger)' : 'var(--text-muted)' },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', minWidth: 110 }}>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Updated {lastUpdated}</span>
          <button onClick={() => refetch()} className="ply-btn ply-btn-sm">↺ Refresh</button>
          <a href={GLITCHTIP_URL} target="_blank" rel="noopener noreferrer"
            className="ply-btn ply-btn-sm ply-btn-primary" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Open GlitchTip ↗
          </a>
        </div>
      </div>

      {/* Filter chips */}
      {!noGlitchTip && (
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { id: 'all', label: `All ${data?.issues.length ?? 0}` },
            { id: 'unresolved', label: `🔴 Unresolved ${unresolved}` },
            { id: 'resolved', label: `✓ Resolved ${resolved}` },
            { id: 'ignored', label: `— Ignored ${(data?.issues ?? []).filter(i => i.status === 'ignored').length}` },
          ].map(f => (
            <button key={f.id} onClick={() => setStatusFilter(f.id as typeof statusFilter)} style={{
              padding: '5px 12px', fontSize: 12, fontWeight: statusFilter === f.id ? 700 : 500, borderRadius: 99,
              border: `1px solid ${statusFilter === f.id ? 'var(--primary)' : 'var(--border)'}`,
              background: statusFilter === f.id ? 'color-mix(in oklab, var(--primary) 10%, transparent)' : 'var(--surface)',
              color: statusFilter === f.id ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer',
            }}>{f.label}</button>
          ))}
        </div>
      )}

      {isLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array(4).fill(0).map((_, i) => <div key={i} style={{ height: 68, background: 'var(--surface-2)', borderRadius: 10 }} />)}
        </div>
      )}

      {/* No GlitchTip configured */}
      {noGlitchTip && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '40px', textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>No errors detected</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 480, margin: '0 auto' }}>
            Either GlitchTip is not configured yet, or no errors have been captured. Set <code style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>GLITCHTIP_API_URL</code> and <code style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>GLITCHTIP_API_TOKEN</code> in your <code style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>.env</code> to enable error tracking.
          </div>
          <div style={{ marginTop: 16 }}>
            <a href="https://glitchtip.com" target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 13, color: 'var(--primary)', textDecoration: 'none' }}>
              Learn about GlitchTip →
            </a>
          </div>
        </div>
      )}

      {/* Errors list */}
      {!noGlitchTip && filtered.length === 0 && !isLoading && (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
          No {statusFilter !== 'all' ? statusFilter : ''} issues found.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map((issue: GlitchTipIssue) => (
          <ErrorCard key={issue.id} issue={issue} maxOcc={maxOcc} />
        ))}
      </div>

      {filtered.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', textAlign: 'center' }}>
          Showing {filtered.length} issue{filtered.length !== 1 ? 's' : ''} · Click any row to expand details · Auto-refreshes every 60s
        </div>
      )}
    </div>
  );
}
