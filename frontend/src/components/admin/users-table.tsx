'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AdminUserList, AdminUserItem, AdminUserPatch } from '@/types/api';

const TOKEN_START = 3_000_000;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 36, height: 20, borderRadius: 10,
        background: value ? 'var(--primary)' : 'var(--border)',
        border: 'none', cursor: 'pointer', position: 'relative', transition: 'background .15s',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: value ? 18 : 2,
        width: 16, height: 16, borderRadius: 8,
        background: 'white', transition: 'left .15s',
        boxShadow: '0 1px 3px rgba(0,0,0,.3)',
      }} />
    </button>
  );
}

function CreditsInput({ userId, current }: { userId: string; current: number }) {
  const [delta, setDelta] = useState('');
  const qc = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: async (d: number) => {
      await api.patch(`/api/v1/admin/users/${userId}`, { credits_delta: d } satisfies AdminUserPatch);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setDelta('');
    },
  });

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <span className="mono" style={{ fontSize: 13 }}>{current}</span>
      <input
        type="number"
        value={delta}
        onChange={e => setDelta(e.target.value)}
        placeholder="±"
        style={{
          width: 52, padding: '2px 6px', fontSize: 12,
          border: '1px solid var(--border)', borderRadius: 4,
          background: 'var(--surface)', color: 'var(--text)',
        }}
      />
      <button
        disabled={!delta || isPending}
        onClick={() => mutate(Number(delta))}
        style={{
          padding: '2px 8px', fontSize: 12, borderRadius: 4,
          background: 'var(--primary)', color: 'white', border: 'none',
          cursor: delta && !isPending ? 'pointer' : 'not-allowed', opacity: !delta ? 0.4 : 1,
        }}
      >
        Add
      </button>
    </div>
  );
}

export function UsersTable() {
  const [page, setPage] = useState(1);
  const perPage = 50;
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<AdminUserList>({
    queryKey: ['admin', 'users', page],
    queryFn: async () => {
      const res = await api.get<{ data: AdminUserList }>(`/api/v1/admin/users?page=${page}&per_page=${perPage}`);
      return res.data.data;
    },
    staleTime: 10_000,
  });

  const { mutate: patchUser } = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: AdminUserPatch }) => {
      await api.patch(`/api/v1/admin/users/${id}`, patch);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  const thStyle: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left', fontSize: 11,
    textTransform: 'uppercase', letterSpacing: '.06em',
    color: 'var(--text-muted)', fontWeight: 600,
    borderBottom: '1px solid var(--border)',
  };
  const tdStyle: React.CSSProperties = {
    padding: '10px 12px', fontSize: 13,
    borderBottom: '1px solid var(--border)',
    color: 'var(--text)',
  };

  if (isLoading) {
    return <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading users…</div>;
  }

  if (!data) return null;

  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-muted)' }}>
        {data.total} users · page {data.page} of {Math.ceil(data.total / perPage)}
      </div>
      <div className="ply-card" style={{ overflow: 'auto', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Email</th>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Credits</th>
              <th style={thStyle}>Tokens</th>
              <th style={thStyle}>Active</th>
              <th style={thStyle}>Admin</th>
              <th style={thStyle}>Last Login</th>
              <th style={thStyle}>Joined</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u: AdminUserItem) => (
              <tr key={u.id} style={{ background: !u.is_active ? 'rgba(255,0,0,.03)' : undefined }}>
                <td style={tdStyle}>{u.email}</td>
                <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{u.full_name ?? '—'}</td>
                <td style={tdStyle}>
                  <CreditsInput userId={u.id} current={u.credits} />
                </td>
                <td style={{ ...tdStyle, fontFamily: 'monospace' }}>
                  {formatTokens(Math.max(0, u.token_balance))}
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)', marginLeft: 4 }}>
                    / {formatTokens(TOKEN_START)}
                  </span>
                </td>
                <td style={tdStyle}>
                  <Toggle value={u.is_active} onChange={v => patchUser({ id: u.id, patch: { is_active: v } })} />
                </td>
                <td style={tdStyle}>
                  <Toggle value={u.is_admin} onChange={v => patchUser({ id: u.id, patch: { is_admin: v } })} />
                </td>
                <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: 12 }}>
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : '—'}
                </td>
                <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: 12 }}>
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.total > perPage && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button
            disabled={page === 1}
            onClick={() => setPage(p => p - 1)}
            style={{
              padding: '6px 14px', fontSize: 13, borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text)', cursor: page === 1 ? 'not-allowed' : 'pointer',
              opacity: page === 1 ? 0.4 : 1,
            }}
          >
            ← Prev
          </button>
          <button
            disabled={page >= Math.ceil(data.total / perPage)}
            onClick={() => setPage(p => p + 1)}
            style={{
              padding: '6px 14px', fontSize: 13, borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text)', cursor: page >= Math.ceil(data.total / perPage) ? 'not-allowed' : 'pointer',
              opacity: page >= Math.ceil(data.total / perPage) ? 0.4 : 1,
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
