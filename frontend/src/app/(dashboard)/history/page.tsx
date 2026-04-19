'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { SessionsGrouped, SessionSummary } from '@/types/api';
import { formatDistanceToNow, format } from 'date-fns';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';

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
        gap: 20, alignItems: 'center', padding: '14px 20px',
        borderBottom: '1px solid #1f1f23', textDecoration: 'none',
        transition: 'background 120ms' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.015)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          background: 'rgba(124,92,255,0.1)', border: '1px solid rgba(124,92,255,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="#7c5cff" strokeWidth="1.6">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: '#ededed',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.title || 'Untitled conversation'}
          </div>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
            color: '#5a5a60', marginTop: 2 }}>
            {created}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
        <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
          color: '#5a5a60' }}>{updated}</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
          stroke="#5a5a60" strokeWidth="1.6"><path d="M9 6l6 6-6 6"/></svg>
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
    <div style={{ padding: '28px 40px 120px', maxWidth: 1180, margin: '0 auto',
      fontFamily: 'var(--font-geist, ui-sans-serif)' }}>

      {/* Header */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
          color: '#7c5cff', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>
          / history
        </div>
        <h1 style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontWeight: 400,
          fontSize: 42, letterSpacing: '-0.02em', lineHeight: 1.12, margin: 0, color: '#ededed' }}>
          Every session,<br /><em style={{ color: '#7c5cff', fontStyle: 'italic' }}>every conversation</em>.
        </h1>
        {total > 0 && (
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11.5,
            color: '#5a5a60', marginTop: 12 }}>
            {total} session{total !== 1 ? 's' : ''} total
          </div>
        )}
      </div>

      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '80px 0', color: '#8a8a90', gap: 8 }}>
          <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} />
          <span style={{ fontSize: 13 }}>Loading…</span>
        </div>
      )}

      {isEmpty && (
        <div style={{ background: '#1a1a1a', border: '1px solid #1f1f23', borderRadius: 10,
          padding: '60px 20px', textAlign: 'center' }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, margin: '0 auto 16px',
            background: 'rgba(124,92,255,0.1)', border: '1px solid rgba(124,92,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="#7c5cff" strokeWidth="1.6">
              <path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/>
            </svg>
          </div>
          <div style={{ fontSize: 14, color: '#8a8a90', lineHeight: 1.6 }}>
            No sessions yet.<br />
            <Link href="/optimize" style={{ color: '#7c5cff', textDecoration: 'none' }}>
              Start your first optimization
            </Link>
          </div>
        </div>
      )}

      {!isLoading && grouped && total > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {GROUPS.map(({ key, label }) => {
            const sessions = grouped[key];
            if (sessions.length === 0) return null;
            return (
              <div key={key}>
                <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
                  color: '#5a5a60', textTransform: 'uppercase', letterSpacing: '0.12em',
                  marginBottom: 8 }}>
                  {label} · {sessions.length}
                </div>
                <div style={{ background: '#1a1a1a', border: '1px solid #1f1f23',
                  borderRadius: 10, overflow: 'hidden' }}>
                  {sessions.map(s => <SessionRow key={s.id} session={s} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
