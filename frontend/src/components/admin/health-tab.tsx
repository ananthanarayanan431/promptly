'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { SystemHealth } from '@/types/api';

function StatusBadge({ status }: { status: string }) {
  const ok = status === 'ok';
  const degraded = status === 'degraded';
  const color = ok ? 'var(--success)' : degraded ? 'var(--warning)' : 'var(--danger)';
  const bg = ok
    ? 'color-mix(in oklab, var(--success) 10%, transparent)'
    : degraded
    ? 'color-mix(in oklab, var(--warning) 12%, transparent)'
    : 'color-mix(in oklab, var(--danger) 10%, transparent)';
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99,
      background: bg, color, textTransform: 'uppercase', letterSpacing: '.04em',
    }}>
      {status}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 14 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 13, fontFamily: 'var(--mono)', color: 'var(--text)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

export function HealthTab() {
  const [autoRefresh, setAutoRefresh] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useQuery<{ data: SystemHealth }>({
    queryKey: ['admin', 'health'],
    queryFn: () => api.get('/api/v1/admin/health').then(r => r.data),
    refetchInterval: autoRefresh ? 10_000 : false,
    staleTime: 5_000,
  });

  const h = data?.data;

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>System Health</div>
          {h && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Last checked: {new Date(h.checked_at).toLocaleTimeString()}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            Auto-refresh (10s)
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
            {isFetching ? 'Refreshing…' : 'Refresh now'}
          </button>
        </div>
      </div>

      {isLoading && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontSize: 14 }}>
          Loading health data…
        </div>
      )}

      {error && (
        <div style={{ padding: 20, background: 'color-mix(in oklab, var(--danger) 8%, transparent)', borderRadius: 8, color: 'var(--danger)', fontSize: 13 }}>
          Failed to load health data. Check that the backend is running.
        </div>
      )}

      {h && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {/* Redis */}
          <Card title="Redis">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <StatusBadge status={h.redis.status} />
            </div>
            <Row label="Memory used" value={h.redis.used_memory_human} />
            <Row label="Connected clients" value={h.redis.connected_clients} />
            <Row label="Total keys" value={h.redis.total_keys.toLocaleString()} />
          </Card>

          {/* Database */}
          <Card title="Database">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <StatusBadge status={h.database.status} />
            </div>
            <Row label="Response time" value={`${h.database.response_time_ms.toFixed(1)} ms`} />
          </Card>

          {/* Workers */}
          <Card title="Celery Workers">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <StatusBadge status={h.workers.status} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {h.workers.worker_names.length} worker{h.workers.worker_names.length !== 1 ? 's' : ''}
              </span>
            </div>
            <Row label="Active tasks" value={h.workers.active_count} />
            {h.workers.worker_names.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Workers</div>
                {h.workers.worker_names.map(name => (
                  <div key={name} style={{ fontSize: 11.5, fontFamily: 'var(--mono)', color: 'var(--text-subtle)', padding: '2px 0' }}>
                    • {name}
                  </div>
                ))}
              </div>
            )}
            {h.workers.worker_names.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>
                No workers detected — start the Celery worker process.
              </div>
            )}
          </Card>

          {/* Job Queues */}
          <Card title="Job Queues">
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Chat jobs</div>
              <Row label="Pending" value={h.queue.pending_chat} />
              <Row label="Active" value={h.queue.active_chat} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, marginTop: 10 }}>Domain jobs</div>
              <Row label="Pending" value={h.queue.pending_domain} />
              <Row label="Active" value={h.queue.active_domain} />
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
