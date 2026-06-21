'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { JobsMonitor, JobEntry } from '@/types/api';

const STATUS_CFG: Record<string, { color: string; label: string }> = {
  queued:    { color: 'var(--warning)',    label: 'Queued' },
  started:   { color: 'var(--primary)',    label: 'Running' },
  completed: { color: 'var(--success)',    label: 'Done' },
  failed:    { color: 'var(--danger)',     label: 'Failed' },
};

function StatusDot({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { color: 'var(--text-muted)', label: status };
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
    </span>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: 'var(--mono)' }}>{value}</div>
    </div>
  );
}

export function JobsMonitorTab() {
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | 'chat' | 'domain'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'queued' | 'started' | 'completed' | 'failed'>('all');

  const { data, isLoading, error, refetch, isFetching } = useQuery<{ data: JobsMonitor }>({
    queryKey: ['admin', 'jobs'],
    queryFn: () => api.get('/api/v1/admin/jobs').then(r => r.data),
    refetchInterval: autoRefresh ? 5_000 : false,
    staleTime: 3_000,
  });

  const monitor = data?.data;

  const filtered = monitor?.jobs.filter(j =>
    (typeFilter === 'all' || j.type === typeFilter) &&
    (statusFilter === 'all' || j.status === statusFilter)
  ) ?? [];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Jobs Monitor</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            Auto-refresh (5s)
          </label>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            style={{
              fontSize: 12.5, padding: '6px 14px', borderRadius: 7,
              background: 'var(--primary)', color: 'white', border: 'none',
              cursor: isFetching ? 'default' : 'pointer', opacity: isFetching ? 0.6 : 1,
            }}
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {isLoading && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontSize: 14 }}>
          Loading jobs…
        </div>
      )}

      {error && (
        <div style={{ padding: 16, background: 'color-mix(in oklab, var(--danger) 8%, transparent)', borderRadius: 8, color: 'var(--danger)', fontSize: 13 }}>
          Failed to load jobs.
        </div>
      )}

      {monitor && (
        <>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            <SummaryCard label="Queued"    value={monitor.summary.queued}    color="var(--warning)" />
            <SummaryCard label="Running"   value={monitor.summary.running}   color="var(--primary)" />
            <SummaryCard label="Completed" value={monitor.summary.completed} color="var(--success)" />
            <SummaryCard label="Failed"    value={monitor.summary.failed}    color="var(--danger)" />
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['all', 'chat', 'domain'] as const).map(t => (
                <button key={t} onClick={() => setTypeFilter(t)}
                  style={{
                    fontSize: 12, padding: '4px 12px', borderRadius: 6,
                    background: typeFilter === t ? 'var(--primary)' : 'var(--surface)',
                    color: typeFilter === t ? 'white' : 'var(--text-muted)',
                    border: '1px solid var(--border)', cursor: 'pointer',
                  }}>
                  {t === 'all' ? 'All types' : t}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['all', 'queued', 'started', 'completed', 'failed'] as const).map(s => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  style={{
                    fontSize: 12, padding: '4px 12px', borderRadius: 6,
                    background: statusFilter === s ? 'var(--primary)' : 'var(--surface)',
                    color: statusFilter === s ? 'white' : 'var(--text-muted)',
                    border: '1px solid var(--border)', cursor: 'pointer',
                  }}>
                  {s === 'all' ? 'All statuses' : s}
                </button>
              ))}
            </div>
          </div>

          {/* Jobs table */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '2fr 100px 120px 2fr',
              gap: 12, padding: '10px 16px',
              background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
              fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em',
            }}>
              <span>Job ID</span>
              <span>Type</span>
              <span>Status</span>
              <span>User</span>
            </div>

            {filtered.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No jobs match the current filters.
              </div>
            )}

            {filtered.map((job: JobEntry) => (
              <div key={job.job_id} style={{
                display: 'grid', gridTemplateColumns: '2fr 100px 120px 2fr',
                gap: 12, padding: '10px 16px', alignItems: 'center',
                borderBottom: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: 11.5, fontFamily: 'var(--mono)', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {job.job_id}
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                  background: job.type === 'chat' ? 'color-mix(in oklab, var(--primary) 10%, transparent)' : 'color-mix(in oklab, var(--success) 10%, transparent)',
                  color: job.type === 'chat' ? 'var(--primary)' : 'var(--success)',
                  justifySelf: 'start',
                }}>
                  {job.type}
                </span>
                <StatusDot status={job.status} />
                <div style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {job.user_id ?? '—'}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--text-subtle)', textAlign: 'right' }}>
            Showing {filtered.length} of {monitor.jobs.length} recent jobs (last 100)
          </div>
        </>
      )}
    </div>
  );
}
