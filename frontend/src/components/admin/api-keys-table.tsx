'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AdminApiKeyList, AdminApiKeyItem } from '@/types/api';

function relTime(dateStr: string | null): string {
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

export function ApiKeysTable() {
  const [page, setPage] = useState(1);
  const [revoking, setRevoking] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery<{ data: AdminApiKeyList }>({
    queryKey: ['admin', 'api-keys', page],
    queryFn: () => api.get(`/api/v1/admin/api-keys?page=${page}&per_page=50`).then(r => r.data),
    staleTime: 30_000,
  });

  const revoke = useMutation({
    mutationFn: (keyId: string) => api.delete(`/api/v1/admin/api-keys/${keyId}`),
    onMutate: (keyId) => setRevoking(keyId),
    onSettled: () => {
      setRevoking(null);
      qc.invalidateQueries({ queryKey: ['admin', 'api-keys'] });
    },
  });

  const list = data?.data;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>API Keys</div>
          {list && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {list.total.toLocaleString()} key{list.total !== 1 ? 's' : ''} total
            </div>
          )}
        </div>
      </div>

      {isLoading && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontSize: 14 }}>
          Loading API keys…
        </div>
      )}

      {error && (
        <div style={{ padding: 16, background: 'color-mix(in oklab, var(--danger) 8%, transparent)', borderRadius: 8, color: 'var(--danger)', fontSize: 13 }}>
          Failed to load API keys.
        </div>
      )}

      {list && (
        <>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            {/* Table header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '2fr 2fr 120px 110px 110px 90px',
              gap: 12, padding: '10px 16px',
              background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
              fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em',
            }}>
              <span>Key name</span>
              <span>Owner</span>
              <span>Status</span>
              <span>Created</span>
              <span>Revoked</span>
              <span>Action</span>
            </div>

            {list.keys.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No API keys found.
              </div>
            )}

            {list.keys.map((key: AdminApiKeyItem) => (
              <div key={key.id} style={{
                display: 'grid',
                gridTemplateColumns: '2fr 2fr 120px 110px 110px 90px',
                gap: 12, padding: '11px 16px', alignItems: 'center',
                borderBottom: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: 13, fontFamily: 'var(--mono)', color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {key.name}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {key.user_email}
                </div>
                <div>
                  {key.is_active ? (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 99, background: 'color-mix(in oklab, var(--success) 10%, transparent)', color: 'var(--success)' }}>
                      Active
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 99, background: 'color-mix(in oklab, var(--danger) 10%, transparent)', color: 'var(--danger)' }}>
                      Revoked
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{relTime(key.created_at)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{key.revoked_at ? relTime(key.revoked_at) : '—'}</div>
                <div>
                  {key.is_active && (
                    <button
                      onClick={() => revoke.mutate(key.id)}
                      disabled={revoking === key.id}
                      style={{
                        fontSize: 11.5, padding: '4px 10px', borderRadius: 6,
                        background: 'color-mix(in oklab, var(--danger) 10%, transparent)',
                        color: 'var(--danger)', border: '1px solid color-mix(in oklab, var(--danger) 25%, transparent)',
                        cursor: revoking === key.id ? 'default' : 'pointer',
                        opacity: revoking === key.id ? 0.6 : 1,
                      }}
                    >
                      {revoking === key.id ? '…' : 'Revoke'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
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
