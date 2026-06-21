'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AuditLogList, AuditLogEntry } from '@/types/api';

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  patch_user:         { label: 'Edit User',      color: 'var(--primary)' },
  revoke_api_key:     { label: 'Revoke Key',     color: 'var(--warning)' },
  bulk_grant_tokens:  { label: 'Bulk Tokens',    color: 'var(--success)' },
};

function ActionBadge({ action }: { action: string }) {
  const cfg = ACTION_LABELS[action] ?? { label: action, color: 'var(--text-muted)' };
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 99,
      background: `color-mix(in oklab, ${cfg.color} 12%, transparent)`,
      color: cfg.color,
    }}>
      {cfg.label}
    </span>
  );
}

function DetailsPopover({ details }: { details: Record<string, unknown> | null }) {
  const [open, setOpen] = useState(false);
  if (!details) return <span style={{ color: 'var(--text-subtle)', fontSize: 12 }}>—</span>;
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          fontSize: 11.5, padding: '2px 8px', borderRadius: 5,
          background: 'var(--surface-2)', color: 'var(--text-muted)',
          border: '1px solid var(--border)', cursor: 'pointer',
        }}
      >
        {open ? 'Hide' : 'View'}
      </button>
      {open && (
        <div style={{
          position: 'absolute', left: 0, top: 26, zIndex: 50,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 12, minWidth: 260, maxWidth: 400,
          boxShadow: '0 4px 20px rgba(0,0,0,.15)',
        }}>
          <pre style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text)', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify(details, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function AuditLogTable() {
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery<{ data: AuditLogList }>({
    queryKey: ['admin', 'audit-log', page],
    queryFn: () => api.get(`/api/v1/admin/audit-log?page=${page}&per_page=50`).then(r => r.data),
    staleTime: 30_000,
  });

  const list = data?.data;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Audit Log</div>
          {list && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {list.total.toLocaleString()} action{list.total !== 1 ? 's' : ''} recorded
            </div>
          )}
        </div>
      </div>

      {isLoading && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontSize: 14 }}>
          Loading audit log…
        </div>
      )}

      {error && (
        <div style={{ padding: 16, background: 'color-mix(in oklab, var(--danger) 8%, transparent)', borderRadius: 8, color: 'var(--danger)', fontSize: 13 }}>
          Failed to load audit log.
        </div>
      )}

      {list && (
        <>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '2fr 2fr 140px 2fr 110px',
              gap: 12, padding: '10px 16px',
              background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
              fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em',
            }}>
              <span>Admin</span>
              <span>Target</span>
              <span>Action</span>
              <span>Details</span>
              <span>Time</span>
            </div>

            {list.entries.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No actions recorded yet.
              </div>
            )}

            {list.entries.map((entry: AuditLogEntry) => (
              <div key={entry.id} style={{
                display: 'grid',
                gridTemplateColumns: '2fr 2fr 140px 2fr 110px',
                gap: 12, padding: '10px 16px', alignItems: 'center',
                borderBottom: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.admin_email}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.target_email ?? '—'}
                </div>
                <div><ActionBadge action={entry.action} /></div>
                <div><DetailsPopover details={entry.details} /></div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {new Date(entry.created_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                </div>
              </div>
            ))}
          </div>

          {list.total > 50 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16, alignItems: 'center' }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                style={{ padding: '5px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: page === 1 ? 'default' : 'pointer', opacity: page === 1 ? 0.4 : 1, fontSize: 13 }}
              >
                ←
              </button>
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                Page {page} of {Math.ceil(list.total / 50)}
              </span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page >= Math.ceil(list.total / 50)}
                style={{ padding: '5px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: page >= Math.ceil(list.total / 50) ? 'default' : 'pointer', opacity: page >= Math.ceil(list.total / 50) ? 0.4 : 1, fontSize: 13 }}
              >
                →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
