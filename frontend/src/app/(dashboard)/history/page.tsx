'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { SessionsGrouped, SessionSummary } from '@/types/api';
import { formatDistanceToNow, format } from 'date-fns';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';

const GROUPS: { key: keyof SessionsGrouped; label: string }[] = [
  { key: 'today',        label: 'Today' },
  { key: 'last_7_days',  label: 'Last 7 days' },
  { key: 'last_30_days', label: 'Last 30 days' },
  { key: 'older',        label: 'Older' },
];

function SessionRow({ session }: { session: SessionSummary }) {
  const updated = formatDistanceToNow(new Date(session.updated_at), { addSuffix: true });
  const created = format(new Date(session.created_at), 'MMM d, yyyy');

  return (
    <Link href={`/optimize?session=${session.id}`}
      style={{ display: 'grid', gridTemplateColumns: '1fr auto',
        gap: 20, alignItems: 'center', padding: '14px 18px',
        borderBottom: '1px solid var(--border)', textDecoration: 'none',
        transition: 'background 120ms' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          background: 'var(--primary-soft)', border: '1px solid var(--primary-ring)',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="var(--primary)" strokeWidth="1.6">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.title || 'Untitled conversation'}
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5,
            color: 'var(--text-subtle)', marginTop: 2 }}>
            {created}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>{updated}</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
          stroke="var(--text-subtle)" strokeWidth="1.6"><path d="M9 6l6 6-6 6"/></svg>
      </div>
    </Link>
  );
}

export default function HistoryPage() {
  const { data: grouped, isLoading } = useQuery<SessionsGrouped>({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await api.get<{ data: SessionsGrouped }>('/api/v1/chat/sessions');
      return res.data.data;
    },
    staleTime: 30_000,
  });

  const total = grouped
    ? grouped.today.length + grouped.last_7_days.length +
      grouped.last_30_days.length + grouped.older.length
    : 0;

  const isEmpty = !isLoading && total === 0;

  return (
    <>
      <PageHeader
        title="History"
        subtitle={total > 0 ? `${total} session${total !== 1 ? 's' : ''} total` : 'Your optimization sessions'}
      />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 28px 80px' }}>

        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '80px 0', color: 'var(--text-muted)', gap: 8 }}>
            <span className="ply-dot ply-dot-pulse" style={{ width: 8, height: 8, background: 'var(--primary)' }} />
            <span style={{ fontSize: 13 }}>Loading…</span>
          </div>
        )}

        {isEmpty && (
          <div className="ply-card" style={{ padding: '56px 20px', textAlign: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, margin: '0 auto 14px',
              background: 'var(--primary-soft)', border: '1px solid var(--primary-ring)',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="var(--primary)" strokeWidth="1.6">
                <path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/>
              </svg>
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              No sessions yet.<br />
              <Link href="/optimize" style={{ color: 'var(--primary)', textDecoration: 'none' }}>
                Start your first optimization
              </Link>
            </div>
          </div>
        )}

        {!isLoading && grouped && total > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {GROUPS.map(({ key, label }) => {
              const sessions = grouped[key];
              if (sessions.length === 0) return null;
              return (
                <div key={key}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5,
                    color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.12em',
                    marginBottom: 8 }}>
                    {label} · {sessions.length}
                  </div>
                  <div className="ply-card" style={{ padding: 0, overflow: 'hidden' }}>
                    {sessions.map(s => <SessionRow key={s.id} session={s} />)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
