'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AdminUserList, AdminUserItem, AdminUserPatch, UserActivity } from '@/types/api';

const TOKEN_START = 3_000_000;

/* ── Helpers ───────────────────────────────────────────────────── */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
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

function isInactive(dateStr: string | null): boolean {
  if (!dateStr) return true;
  return Date.now() - new Date(dateStr).getTime() > 30 * 24 * 60 * 60 * 1000;
}

/* ── Inline components ─────────────────────────────────────────── */
function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button onClick={() => !disabled && onChange(!value)} disabled={disabled}
      title={value ? 'Click to disable' : 'Click to enable'}
      style={{
        width: 36, height: 20, borderRadius: 10, padding: 0,
        background: value ? 'var(--primary)' : 'var(--border)',
        border: 'none', cursor: disabled ? 'default' : 'pointer',
        position: 'relative', transition: 'background .15s', flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
      }}>
      <span style={{
        position: 'absolute', top: 2, left: value ? 18 : 2,
        width: 16, height: 16, borderRadius: 8, background: 'white',
        transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.25)',
      }} />
    </button>
  );
}

function TokenAdjust({ userId }: { userId: string }) {
  const [delta, setDelta] = useState('');
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: async (d: number) => {
      const body: AdminUserPatch = { credits_delta: d };
      await api.patch(`/api/v1/admin/users/${userId}`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setDelta('');
      setOpen(false);
    },
  });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{
        padding: '3px 8px', fontSize: 11, borderRadius: 5,
        border: '1px solid var(--border)', background: 'var(--surface-2)',
        color: 'var(--text-muted)', cursor: 'pointer',
      }}>
        ± Adjust
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input
        autoFocus type="number" value={delta} onChange={e => setDelta(e.target.value)}
        placeholder="e.g. 100000"
        style={{
          width: 90, height: 26, padding: '0 6px', fontSize: 11,
          border: '1px solid var(--primary)', borderRadius: 5,
          background: 'var(--surface)', color: 'var(--text)', outline: 'none',
        }}
        onKeyDown={e => e.key === 'Escape' && setOpen(false)}
      />
      <button disabled={!delta || isPending} onClick={() => mutate(Number(delta))}
        style={{
          padding: '0 8px', height: 26, fontSize: 11, borderRadius: 5,
          background: 'var(--primary)', color: 'white', border: 'none',
          cursor: delta && !isPending ? 'pointer' : 'not-allowed', opacity: !delta ? 0.5 : 1,
        }}>
        {isPending ? '…' : '✓'}
      </button>
      <button onClick={() => setOpen(false)} style={{
        padding: '0 6px', height: 26, fontSize: 11, borderRadius: 5,
        border: '1px solid var(--border)', background: 'transparent',
        color: 'var(--text-muted)', cursor: 'pointer',
      }}>✕</button>
    </div>
  );
}

function StatusChip({ user }: { user: AdminUserItem }) {
  if (user.is_admin) return (
    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'color-mix(in oklab, var(--primary) 12%, transparent)', color: 'var(--primary)' }}>Admin</span>
  );
  if (!user.is_active) return (
    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'color-mix(in oklab, var(--danger) 10%, transparent)', color: 'var(--danger)' }}>Inactive</span>
  );
  if (isInactive(user.last_login_at)) return (
    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'color-mix(in oklab, var(--warning) 12%, transparent)', color: 'var(--warning)' }}>Dormant</span>
  );
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'color-mix(in oklab, var(--success) 10%, transparent)', color: 'var(--success)' }}>Active</span>
  );
}

/* ── User drill-down side panel ────────────────────────────────── */
function DrilldownPanel({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery<{ data: UserActivity }>({
    queryKey: ['admin', 'user-activity', userId],
    queryFn: () => api.get(`/api/v1/admin/users/${userId}/activity`).then(r => r.data),
    staleTime: 60_000,
  });
  const activity = data?.data;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200, display: 'flex',
    }}>
      {/* Backdrop */}
      <div onClick={onClose} style={{ flex: 1, background: 'rgba(0,0,0,.35)' }} />
      {/* Panel */}
      <div style={{
        width: 420, background: 'var(--bg)', borderLeft: '1px solid var(--border)',
        overflowY: 'auto', display: 'flex', flexDirection: 'column',
        boxShadow: '-4px 0 24px rgba(0,0,0,.15)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>User Activity</div>
            {activity && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{activity.email}</div>}
          </div>
          <button onClick={onClose} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>

        {isLoading && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        )}

        {activity && (
          <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {[
                { label: 'Sessions', value: activity.session_count },
                { label: 'Tokens used', value: activity.total_tokens_consumed >= 1_000_000 ? `${(activity.total_tokens_consumed / 1_000_000).toFixed(1)}M` : activity.total_tokens_consumed >= 1_000 ? `${(activity.total_tokens_consumed / 1_000).toFixed(0)}K` : String(activity.total_tokens_consumed) },
                { label: 'Since', value: new Date(activity.first_seen).toLocaleDateString() },
              ].map(s => (
                <div key={s.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>{s.label}</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--mono)', marginTop: 3 }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Feature usage */}
            {Object.keys(activity.feature_counts).length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Feature usage</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {Object.entries(activity.feature_counts).map(([feature, count]) => (
                    <div key={feature} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', background: 'var(--surface)', borderRadius: 6 }}>
                      <span style={{ fontSize: 12.5, color: 'var(--text)' }}>{feature.replace(/_/g, ' ')}</span>
                      <span style={{ fontSize: 12.5, fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--primary)' }}>{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent sessions */}
            {activity.sessions.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                  Recent sessions ({activity.sessions.length} shown)
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {activity.sessions.map(sess => (
                    <div key={sess.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sess.title ?? 'Untitled session'}
                      </div>
                      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                        <span>{sess.message_count} msgs</span>
                        <span>{sess.token_count >= 1_000 ? `${(sess.token_count / 1_000).toFixed(0)}K` : sess.token_count} tokens</span>
                        <span>{new Date(sess.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Bulk action bar ───────────────────────────────────────────── */
function BulkActionsBar({ selectedIds, onClear }: { selectedIds: string[]; onClear: () => void }) {
  const [amount, setAmount] = useState('');
  const [done, setDone] = useState(false);
  const qc = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post('/api/v1/admin/users/bulk-tokens', { user_ids: selectedIds, amount: Number(amount) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setDone(true);
      setTimeout(() => { setDone(false); onClear(); }, 1500);
    },
  });

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
      background: 'color-mix(in oklab, var(--primary) 8%, transparent)',
      border: '1px solid color-mix(in oklab, var(--primary) 25%, transparent)',
      borderRadius: 10, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
        {selectedIds.length} user{selectedIds.length !== 1 ? 's' : ''} selected
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Grant tokens:</span>
        <input
          type="number" value={amount} onChange={e => setAmount(e.target.value)}
          placeholder="e.g. 500000" min="1"
          style={{ width: 110, height: 28, padding: '0 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text)', outline: 'none' }}
        />
        <button
          onClick={() => mutate()}
          disabled={!amount || isPending || done || Number(amount) <= 0}
          style={{
            height: 28, padding: '0 12px', fontSize: 12, borderRadius: 6,
            background: done ? 'var(--success)' : 'var(--primary)', color: 'white', border: 'none',
            cursor: !amount || isPending ? 'default' : 'pointer',
            opacity: !amount || Number(amount) <= 0 ? 0.5 : 1,
          }}
        >
          {done ? '✓ Done' : isPending ? '…' : 'Grant'}
        </button>
      </div>
      <button onClick={onClear} style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
        Clear selection
      </button>
    </div>
  );
}

/* ── Main component ────────────────────────────────────────────── */
export function UsersTable() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'admin' | 'dormant'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drilldownId, setDrilldownId] = useState<string | null>(null);
  const perPage = 50;
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<AdminUserList>({
    queryKey: ['admin', 'users', page],
    queryFn: async () => {
      const res = await api.get<{ data: AdminUserList }>(`/api/v1/admin/users?page=${page}&per_page=${perPage}`);
      return res.data.data;
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { mutate: patchUser } = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: AdminUserPatch }) => {
      await api.patch(`/api/v1/admin/users/${id}`, patch);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.users.filter(u => {
      const matchSearch = !search || u.email.toLowerCase().includes(search.toLowerCase()) || (u.full_name ?? '').toLowerCase().includes(search.toLowerCase());
      const matchStatus =
        statusFilter === 'all' ? true :
        statusFilter === 'admin' ? u.is_admin :
        statusFilter === 'inactive' ? !u.is_active :
        statusFilter === 'dormant' ? (u.is_active && isInactive(u.last_login_at)) :
        u.is_active && !isInactive(u.last_login_at) && !u.is_admin;
      return matchSearch && matchStatus;
    });
  }, [data, search, statusFilter]);

  const totalPages = data ? Math.ceil(data.total / perPage) : 1;

  // Summary counts
  const counts = useMemo(() => {
    if (!data) return { active: 0, inactive: 0, admin: 0, dormant: 0 };
    return {
      admin: data.users.filter(u => u.is_admin).length,
      active: data.users.filter(u => u.is_active && !isInactive(u.last_login_at) && !u.is_admin).length,
      dormant: data.users.filter(u => u.is_active && isInactive(u.last_login_at)).length,
      inactive: data.users.filter(u => !u.is_active).length,
    };
  }, [data]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {Array(5).fill(0).map((_, i) => (
          <div key={i} style={{ height: 60, background: 'var(--surface-2)', borderRadius: 10, animation: 'pulse 1.5s ease-in-out infinite' }} />
        ))}
      </div>
    );
  }

  const allFilteredIds = filtered.map(u => u.id);
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedIds.has(id));

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(prev => { const next = new Set(prev); allFilteredIds.forEach(id => next.delete(id)); return next; });
    } else {
      setSelectedIds(prev => { const next = new Set(prev); allFilteredIds.forEach(id => next.add(id)); return next; });
    }
  }

  return (
    <>
      {drilldownId && <DrilldownPanel userId={drilldownId} onClose={() => setDrilldownId(null)} />}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Summary chips */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          { id: 'all', label: `All ${data?.total ?? 0}`, color: 'var(--text)' },
          { id: 'active', label: `✓ Active ${counts.active}`, color: 'var(--success)' },
          { id: 'admin', label: `★ Admin ${counts.admin}`, color: 'var(--primary)' },
          { id: 'dormant', label: `⚠ Dormant ${counts.dormant}`, color: 'var(--warning)' },
          { id: 'inactive', label: `✕ Inactive ${counts.inactive}`, color: 'var(--danger)' },
        ].map(f => (
          <button key={f.id} onClick={() => setStatusFilter(f.id as typeof statusFilter)} style={{
            padding: '5px 12px', fontSize: 12, fontWeight: statusFilter === f.id ? 700 : 500, borderRadius: 99,
            border: `1px solid ${statusFilter === f.id ? f.color : 'var(--border)'}`,
            background: statusFilter === f.id ? `color-mix(in oklab, ${f.color} 10%, transparent)` : 'var(--surface)',
            color: statusFilter === f.id ? f.color : 'var(--text-muted)', cursor: 'pointer',
          }}>{f.label}</button>
        ))}
        <div style={{ flex: 1 }} />
        {/* Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, minWidth: 220 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search email or name…"
            style={{ border: 0, outline: 'none', background: 'transparent', fontSize: 12.5, color: 'var(--text)', flex: 1 }} />
          {search && <button onClick={() => setSearch('')} style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--text-subtle)', fontSize: 12 }}>✕</button>}
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <BulkActionsBar selectedIds={Array.from(selectedIds)} onClear={() => setSelectedIds(new Set())} />
      )}

      {/* Select all + count */}
      {filtered.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5, color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
            Select all on page
          </label>
          {selectedIds.size > 0 && (
            <span style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>
              {selectedIds.size} selected
            </span>
          )}
        </div>
      )}

      {/* User rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
            No users match your filter.
          </div>
        )}
        {filtered.map((u: AdminUserItem) => {
          const tokenPct = Math.min(100, Math.max(0, ((TOKEN_START - Math.max(0, u.token_balance)) / TOKEN_START) * 100));
          const lastLoginWarning = isInactive(u.last_login_at);

          const isSelected = selectedIds.has(u.id);
          return (
            <div key={u.id} style={{
              background: isSelected ? 'color-mix(in oklab, var(--primary) 5%, var(--surface))' : 'var(--surface)',
              border: `1px solid ${isSelected ? 'color-mix(in oklab, var(--primary) 30%, transparent)' : 'var(--border)'}`,
              borderRadius: 12,
              padding: '14px 18px', display: 'grid',
              gridTemplateColumns: '32px 1fr 100px 80px 180px 140px 130px 100px 110px',
              gap: 16, alignItems: 'center',
              opacity: u.is_active ? 1 : 0.65,
            }}>
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => setSelectedIds(prev => {
                  const next = new Set(prev);
                  if (next.has(u.id)) next.delete(u.id); else next.add(u.id);
                  return next;
                })}
                style={{ cursor: 'pointer' }}
              />
              {/* Identity */}
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
                    {u.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={u.avatar_url}
                        alt={(u.full_name ?? u.email)[0].toUpperCase()}
                        width={30}
                        height={30}
                        style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover' }}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; (e.currentTarget.nextSibling as HTMLElement).style.display = 'grid'; }}
                      />
                    ) : null}
                    <div style={{
                      width: 30, height: 30, borderRadius: '50%',
                      background: u.is_admin ? 'linear-gradient(135deg, var(--primary), var(--accent))' : 'var(--surface-2)',
                      color: u.is_admin ? 'white' : 'var(--text-muted)',
                      display: u.avatar_url ? 'none' : 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700,
                      position: 'absolute', inset: 0,
                    }}>
                      {(u.full_name ?? u.email)[0].toUpperCase()}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <button
                      onClick={() => setDrilldownId(u.id)}
                      title="View activity drill-down"
                      style={{ fontSize: 13, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text)', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}
                    >
                      {u.full_name ?? '—'}
                    </button>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {u.email}
                    </div>
                  </div>
                  <StatusChip user={u} />
                  {u.data_sharing_enabled && (
                    <span title="Data sharing enabled" style={{ fontSize: 10, color: 'var(--success)', marginLeft: 4 }}>◉</span>
                  )}
                </div>
              </div>

              {/* Sessions */}
              <div style={{ fontSize: 12 }}>
                <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>{u.session_count}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>sessions</div>
                {u.last_session_at && (
                  <div style={{ fontSize: 10.5, color: 'var(--text-subtle)', marginTop: 2 }}>
                    {relativeTime(u.last_session_at)}
                  </div>
                )}
              </div>

              {/* API Keys */}
              <div style={{ fontSize: 12 }}>
                <div style={{ fontWeight: 600, color: u.api_key_count > 0 ? 'var(--text)' : 'var(--text-subtle)', fontSize: 14 }}>{u.api_key_count}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>api keys</div>
              </div>

              {/* Token balance */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Tokens</span>
                  <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: u.token_balance <= 0 ? 'var(--danger)' : 'var(--text)' }}>
                    {fmtTokens(Math.max(0, u.token_balance))}
                  </span>
                </div>
                <div style={{ height: 5, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 99, transition: 'width .4s',
                    width: `${tokenPct}%`,
                    background: tokenPct > 80 ? 'var(--danger)' : tokenPct > 50 ? 'var(--warning)' : 'var(--primary)',
                  }} />
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-subtle)', marginTop: 3 }}>
                  {tokenPct.toFixed(0)}% consumed
                </div>
              </div>

              {/* Last login */}
              <div style={{ fontSize: 12 }}>
                <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Last login</div>
                <div style={{ fontWeight: 500, color: lastLoginWarning ? 'var(--warning)' : 'var(--text)' }}>
                  {relativeTime(u.last_login_at)}
                  {lastLoginWarning && u.last_login_at && <span style={{ fontSize: 10, marginLeft: 5 }}>⚠</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                  Joined {new Date(u.created_at).toLocaleDateString()}
                </div>
              </div>

              {/* Token adjust */}
              <div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 5 }}>Adjust tokens</div>
                <TokenAdjust userId={u.id} />
              </div>

              {/* Active toggle */}
              <div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 5 }}>Active</div>
                <Toggle value={u.is_active} onChange={v => patchUser({ id: u.id, patch: { is_active: v } })} />
              </div>

              {/* Admin toggle */}
              <div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 5 }}>Admin</div>
                <Toggle value={u.is_admin} onChange={v => patchUser({ id: u.id, patch: { is_admin: v } })} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center', paddingTop: 4 }}>
          <button disabled={page === 1} onClick={() => setPage(1)} className="ply-btn ply-btn-sm" style={{ opacity: page === 1 ? 0.4 : 1 }}>«</button>
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="ply-btn ply-btn-sm" style={{ opacity: page === 1 ? 0.4 : 1 }}>‹ Prev</button>
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '0 8px' }}>Page {page} of {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="ply-btn ply-btn-sm" style={{ opacity: page >= totalPages ? 0.4 : 1 }}>Next ›</button>
          <button disabled={page >= totalPages} onClick={() => setPage(totalPages)} className="ply-btn ply-btn-sm" style={{ opacity: page >= totalPages ? 0.4 : 1 }}>»</button>
        </div>
      )}

      <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', textAlign: 'center' }}>
        Showing {filtered.length} of {data?.total ?? 0} users · Auto-refreshes every 30s · Click a name to drill down
      </div>
    </div>
    </>
  );
}
