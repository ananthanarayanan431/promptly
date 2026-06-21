'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AdminUserList, AdminUserItem, AdminUserPromptList, AdminUserPrompt } from '@/types/api';

/* ── Helpers ───────────────────────────────────────────────────────────── */
function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/* ── User card (left panel) ────────────────────────────────────────────── */
function UserCard({ user, selected, onClick }: { user: AdminUserItem; selected: boolean; onClick: () => void }) {
  const initials = (user.full_name ?? user.email)[0].toUpperCase();
  const tokensUsed = 3_000_000 - Math.max(0, user.token_balance);
  const tokensPct = Math.min(100, (tokensUsed / 3_000_000) * 100);

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
        borderRadius: 10, cursor: 'pointer',
        background: selected ? 'color-mix(in oklab, var(--primary) 10%, transparent)' : 'transparent',
        border: `1px solid ${selected ? 'color-mix(in oklab, var(--primary) 30%, transparent)' : 'transparent'}`,
        transition: 'background .1s, border .1s',
      }}
    >
      {/* Avatar */}
      <div style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, overflow: 'hidden' }}>
        {user.avatar_url
          ? <img src={user.avatar_url} alt={initials} style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover' }} />
          : <div style={{ width: 38, height: 38, borderRadius: '50%', background: user.is_admin ? 'linear-gradient(135deg, var(--primary), var(--accent))' : 'var(--surface-2)', color: user.is_admin ? 'white' : 'var(--text-muted)', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700 }}>{initials}</div>
        }
      </div>

      {/* Info */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.full_name ?? user.email.split('@')[0]}
          </div>
          {user.is_admin && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99, background: 'color-mix(in oklab, var(--primary) 12%, transparent)', color: 'var(--primary)', flexShrink: 0 }}>Admin</span>
          )}
          {!user.is_active && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99, background: 'color-mix(in oklab, var(--danger) 10%, transparent)', color: 'var(--danger)', flexShrink: 0 }}>Inactive</span>
          )}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
          {user.email}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <span style={{ fontSize: 10, color: 'var(--text-subtle)', flexShrink: 0 }}>{user.session_count} sessions</span>
          <div style={{ flex: 1, height: 3, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${tokensPct}%`, background: tokensPct > 80 ? 'var(--danger)' : tokensPct > 50 ? 'var(--warning)' : 'var(--primary)', borderRadius: 99 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Session card (right panel) ────────────────────────────────────────── */
function SessionCard({ prompt, index, showContent }: { prompt: AdminUserPrompt; index: number; showContent: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', cursor: 'pointer' }}
      >
        <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--surface-2)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }}>#{index}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)' }}>
            {fmtDate(prompt.created_at)}
          </div>
          {showContent && prompt.original_prompt && (
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {prompt.original_prompt.slice(0, 120)}{prompt.original_prompt.length > 120 ? '…' : ''}
            </div>
          )}
          {!showContent && (
            <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', fontStyle: 'italic', marginTop: 2 }}>
              Content hidden — data sharing not enabled
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-muted)' }}>
            {prompt.tokens_used.toLocaleString()} tok
          </span>
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth="2"
            style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '0 16px 16px' }}>
          {!showContent ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
              🔒 Prompt content is hidden — this user has not enabled data sharing
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 14 }}>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>
                  Original Prompt
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6, background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px', maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {prompt.original_prompt ?? '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>
                  Optimized Prompt
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.6, background: 'color-mix(in oklab, var(--primary) 5%, var(--surface))', borderRadius: 8, border: '1px solid color-mix(in oklab, var(--primary) 15%, transparent)', padding: '10px 12px', maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {prompt.optimized_prompt ?? '—'}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Right panel: full user detail ─────────────────────────────────────── */
function UserDetail({ user }: { user: AdminUserItem }) {
  const [page, setPage] = useState(1);
  const perPage = 15;

  const { data: promptsData, isLoading } = useQuery<AdminUserPromptList>({
    queryKey: ['admin', 'prompts', user.id, page],
    queryFn: async () => {
      const res = await api.get<{ data: AdminUserPromptList }>(
        `/api/v1/admin/users/${user.id}/prompts?page=${page}&per_page=${perPage}`
      );
      return res.data.data;
    },
    staleTime: 30_000,
  });

  const initials = (user.full_name ?? user.email)[0].toUpperCase();
  const totalPages = promptsData ? Math.ceil(promptsData.total / perPage) : 1;
  const tokensUsed = 3_000_000 - Math.max(0, user.token_balance);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflowY: 'auto', paddingRight: 4 }}>

      {/* User profile card */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
            {user.avatar_url
              ? <img src={user.avatar_url} alt={initials} style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: '50%' }} />
              : <div style={{ width: 52, height: 52, borderRadius: '50%', background: user.is_admin ? 'linear-gradient(135deg, var(--primary), var(--accent))' : 'var(--surface-2)', color: user.is_admin ? 'white' : 'var(--text-muted)', display: 'grid', placeItems: 'center', fontSize: 18, fontWeight: 700 }}>{initials}</div>
            }
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>
              {user.full_name ?? user.email.split('@')[0]}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{user.email}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {user.is_admin && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'color-mix(in oklab, var(--primary) 12%, transparent)', color: 'var(--primary)' }}>Admin</span>}
              {!user.is_active && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'color-mix(in oklab, var(--danger) 10%, transparent)', color: 'var(--danger)' }}>Inactive</span>}
              {user.data_sharing_enabled
                ? <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'color-mix(in oklab, var(--success, #22c55e) 10%, transparent)', color: 'var(--success, #22c55e)' }}>Data Sharing ON</span>
                : <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'var(--surface-2)', color: 'var(--text-subtle)' }}>Data Sharing OFF</span>
              }
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {[
            { label: 'Sessions', value: user.session_count.toString() },
            { label: 'Tokens used', value: `${(tokensUsed / 1_000_000).toFixed(2)}M` },
            { label: 'API Keys', value: user.api_key_count.toString() },
            { label: 'Credits left', value: user.credits.toString() },
            { label: 'Joined', value: new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) },
            { label: 'Last login', value: user.last_login_at ? relativeTime(user.last_login_at) : 'Never' },
            { label: 'Last session', value: user.last_session_at ? relativeTime(user.last_session_at) : 'Never' },
            { label: 'Token balance', value: `${(user.token_balance / 1_000_000).toFixed(2)}M` },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600, marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Session list header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Optimization Sessions</div>
        {promptsData && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{promptsData.total} total</span>}
      </div>

      {!user.data_sharing_enabled && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'color-mix(in oklab, var(--warning) 10%, transparent)', border: '1px solid color-mix(in oklab, var(--warning) 25%, transparent)', fontSize: 12.5, color: 'var(--warning)', flexShrink: 0 }}>
          ⚠ Data sharing is OFF — session dates and token counts are visible but prompt content is hidden
        </div>
      )}

      {isLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array(5).fill(0).map((_, i) => (
            <div key={i} style={{ height: 56, background: 'var(--surface-2)', borderRadius: 12, animation: 'pulse 1.5s ease-in-out infinite' }} />
          ))}
        </div>
      )}

      {promptsData && !isLoading && (
        <>
          {promptsData.prompts.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
              No sessions yet.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {promptsData.prompts.map((p, i) => (
              <SessionCard
                key={p.session_id}
                prompt={p}
                index={(page - 1) * perPage + i + 1}
                showContent={promptsData.data_sharing_enabled}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center', paddingTop: 4, flexShrink: 0 }}>
              <button disabled={page === 1} onClick={() => setPage(1)} style={{ padding: '5px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: page === 1 ? 'default' : 'pointer', opacity: page === 1 ? 0.4 : 1 }}>«</button>
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)} style={{ padding: '5px 12px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: page === 1 ? 'default' : 'pointer', opacity: page === 1 ? 0.4 : 1 }}>← Prev</button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 8px' }}>Page {page} of {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{ padding: '5px 12px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: page >= totalPages ? 'default' : 'pointer', opacity: page >= totalPages ? 0.4 : 1 }}>Next →</button>
              <button disabled={page >= totalPages} onClick={() => setPage(totalPages)} style={{ padding: '5px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: page >= totalPages ? 'default' : 'pointer', opacity: page >= totalPages ? 0.4 : 1 }}>»</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Main export ───────────────────────────────────────────────────────── */
export function PromptsView() {
  const [selectedUser, setSelectedUser] = useState<AdminUserItem | null>(null);
  const [search, setSearch] = useState('');

  const { data: usersData, isLoading: usersLoading } = useQuery<AdminUserList>({
    queryKey: ['admin', 'users', 1],
    queryFn: async () => {
      const res = await api.get<{ data: AdminUserList }>('/api/v1/admin/users?page=1&per_page=100');
      return res.data.data;
    },
    staleTime: 30_000,
  });

  const filtered = (usersData?.users ?? []).filter(u =>
    !search ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    (u.full_name ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 200px)', gap: 0, overflow: 'hidden' }}>

      {/* Left panel — user list */}
      <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', paddingRight: 16, marginRight: 24 }}>
        {/* Search */}
        <div style={{ flexShrink: 0, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search users…"
              style={{ border: 0, outline: 'none', background: 'transparent', fontSize: 12.5, color: 'var(--text)', flex: 1 }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--text-subtle)', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
            )}
          </div>
        </div>

        {/* Count */}
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 6, paddingLeft: 2, flexShrink: 0 }}>
          {filtered.length} user{filtered.length !== 1 ? 's' : ''}
        </div>

        {/* Scrollable list */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {usersLoading && Array(6).fill(0).map((_, i) => (
            <div key={i} style={{ height: 66, background: 'var(--surface-2)', borderRadius: 10, animation: 'pulse 1.5s ease-in-out infinite', marginBottom: 2 }} />
          ))}
          {filtered.map(u => (
            <UserCard
              key={u.id}
              user={u}
              selected={selectedUser?.id === u.id}
              onClick={() => setSelectedUser(u)}
            />
          ))}
          {!usersLoading && filtered.length === 0 && (
            <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>
              No users found
            </div>
          )}
        </div>
      </div>

      {/* Right panel — detail */}
      <div style={{ flex: 1, overflow: 'hidden', height: '100%' }}>
        {!selectedUser ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-muted)' }}>
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <div style={{ fontSize: 14, fontWeight: 500 }}>Select a user to view their activity</div>
            <div style={{ fontSize: 12 }}>Sessions, prompts, token usage, and profile details</div>
          </div>
        ) : (
          <UserDetail key={selectedUser.id} user={selectedUser} />
        )}
      </div>
    </div>
  );
}
