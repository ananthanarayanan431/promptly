'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { clearToken } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import Link from 'next/link';
import type { SessionsGrouped, SessionSummary, User } from '@/types/api';

const NAV = [
  { key: 'dashboard', label: 'Dashboard', href: '/dashboard', kbd: 'D' },
  { key: 'optimize',  label: 'Optimize',  href: '/optimize',  kbd: 'O' },
  { key: 'analyze',   label: 'Analyze',   href: '/analyze',   kbd: 'A' },
  { key: 'versions',  label: 'Versions',  href: '/versions',  kbd: 'V' },
  { key: 'history',   label: 'History',   href: '/history' },
  { key: 'billing',   label: 'Billing',   href: '/billing' },
];

function deriveDisplayName(email: string): string {
  return email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function deriveInitials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function SessionItem({ session, isActive }: { session: SessionSummary; isActive: boolean }) {
  return (
    <Link href={`/optimize?session=${session.id}`}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px',
        margin: '0 8px', borderRadius: 6, fontSize: 13, textDecoration: 'none',
        color: isActive ? '#ededed' : '#b5b5ba',
        background: isActive ? '#222226' : 'transparent',
        borderLeft: '2px solid transparent',
        overflow: 'hidden', whiteSpace: 'nowrap' as const }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
        background: isActive ? '#7c5cff' : '#5a5a60' }} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {session.title || 'Untitled'}
      </span>
    </Link>
  );
}

function SessionHistory() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentSessionId = searchParams.get('session');
  const isNewChat = pathname === '/optimize' && !currentSessionId;

  const { data: grouped } = useQuery<SessionsGrouped>({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await api.get<{ data: SessionsGrouped }>('/api/v1/chat/sessions');
      return res.data.data;
    },
    staleTime: 30_000,
  });

  const hasHistory = grouped && (
    grouped.today.length > 0 || grouped.last_7_days.length > 0 ||
    grouped.last_30_days.length > 0 || grouped.older.length > 0
  );

  if (!hasHistory && !isNewChat) return null;

  const total =
    (grouped?.today.length ?? 0) + (grouped?.last_7_days.length ?? 0) +
    (grouped?.last_30_days.length ?? 0) + (grouped?.older.length ?? 0);

  const allSessions = [
    ...(grouped?.today ?? []),
    ...(grouped?.last_7_days ?? []),
    ...(grouped?.last_30_days ?? []),
    ...(grouped?.older ?? []),
  ];

  return (
    <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
      <div style={{ padding: '14px 16px 6px', fontFamily: 'var(--font-geist-mono, monospace)',
        fontSize: 10, color: '#5a5a60', textTransform: 'uppercase', letterSpacing: '0.08em',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Recent sessions</span>
        <span>{total}</span>
      </div>
      <div style={{ paddingBottom: 8 }}>
        {isNewChat && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px',
            margin: '0 8px', borderRadius: 6, fontSize: 13, color: '#7c5cff',
            background: 'rgba(124,92,255,0.1)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#7c5cff' }} />
            <span>New chat</span>
          </div>
        )}
        {allSessions.map(s => (
          <SessionItem key={s.id} session={s} isActive={s.id === currentSessionId} />
        ))}
      </div>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { logout, user } = useAuthStore();

  const { data: fetchedUser } = useQuery<User>({
    queryKey: ['user', 'me'],
    queryFn: async () => {
      const res = await api.get<{ data: User }>('/api/v1/users/me');
      return res.data.data;
    },
    staleTime: 1000 * 60 * 5,
  });

  const displayUser = fetchedUser ?? user;
  const displayName = displayUser ? deriveDisplayName(displayUser.email) : '';

  const handleLogout = async () => {
    logout();
    await clearToken();
    router.push('/login');
    router.refresh();
  };

  return (
    <aside style={{ width: 248, background: '#101014', borderRight: '1px solid #1f1f23',
      display: 'flex', flexDirection: 'column', height: '100vh', flexShrink: 0,
      fontFamily: 'var(--font-geist, ui-sans-serif)' }}>

      {/* Logo */}
      <div style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between' }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 9,
          textDecoration: 'none', fontSize: 14, fontWeight: 600, color: '#ededed' }}>
          <LogoMark />
          promptly
        </Link>
        <Link href="/optimize"
          style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #2a2a2e',
            background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#8a8a90', textDecoration: 'none', fontSize: 16, lineHeight: 1 }}
          title="New chat">
          +
        </Link>
      </div>

      {/* Search */}
      <div style={{ margin: '0 12px 10px', height: 30, padding: '0 10px', borderRadius: 6,
        background: '#222226', border: '1px solid #1f1f23',
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#5a5a60' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
        </svg>
        <span>Search</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
          {['⌘', 'K'].map(k => (
            <span key={k} style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10,
              padding: '1px 4px', background: '#2a2a2e', border: '1px solid #2a2a2e',
              borderRadius: 3, color: '#8a8a90' }}>{k}</span>
          ))}
        </span>
      </div>

      {/* Nav */}
      <div style={{ padding: '4px 0' }}>
        {NAV.map(n => {
          const isActive = pathname === n.href ||
            (n.href !== '/versions' && n.href !== '/dashboard' && pathname.startsWith(n.href));
          return (
            <Link key={n.key} href={n.href}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px',
                margin: '0 8px', borderRadius: 6, fontSize: 13, textDecoration: 'none',
                color: isActive ? '#ededed' : '#b5b5ba',
                background: isActive ? '#222226' : 'transparent',
                borderLeft: '2px solid transparent', transition: 'background 120ms, color 120ms' }}>
              <NavIcon name={n.key} active={isActive} />
              <span style={{ flex: 1 }}>{n.label}</span>
              {n.kbd && (
                <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
                  color: '#5a5a60' }}>{n.kbd}</span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Session history */}
      <div style={{ height: 1, background: '#1f1f23', margin: '8px 0' }} />
      <Suspense fallback={<div style={{ flex: 1 }} />}>
        <SessionHistory />
      </Suspense>

      {/* User footer */}
      {displayUser && (
        <div style={{ borderTop: '1px solid #1f1f23', padding: 12, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Avatar */}
            <div style={{ width: 28, height: 28, borderRadius: '50%',
              background: 'linear-gradient(135deg, #7c5cff, #3a1eff)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 600, color: '#fff', flexShrink: 0 }}>
              {deriveInitials(displayName)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: '#ededed',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {displayName}
              </div>
              <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, color: '#5a5a60' }}>
                {displayUser.credits} cr.
              </div>
            </div>
            <button onClick={handleLogout}
              style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#5a5a60' }}
              title="Log out">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function LogoMark() {
  return (
    <div style={{ width: 22, height: 22, borderRadius: 6, background: '#7c5cff',
      position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3), 0 1px 0 rgba(0,0,0,0.3)' }}>
      <div style={{ position: 'absolute', inset: 5, border: '1.5px solid #fff',
        borderRight: '1.5px solid transparent', borderBottom: '1.5px solid transparent',
        borderRadius: 2, transform: 'rotate(45deg)' }} />
    </div>
  );
}

function NavIcon({ name, active }: { name: string; active: boolean }) {
  const color = active ? '#7c5cff' : '#8a8a90';
  const icons: Record<string, React.ReactNode> = {
    dashboard: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    ),
    optimize: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6">
        <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>
      </svg>
    ),
    analyze: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6">
        <path d="M3 3v18h18"/><path d="M7 14v4M12 10v8M17 6v12"/>
      </svg>
    ),
    versions: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>
      </svg>
    ),
    history: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6">
        <path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/>
      </svg>
    ),
    billing: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6">
        <rect x="2" y="5" width="20" height="14" rx="2"/>
        <path d="M2 10h20"/>
      </svg>
    ),
  };
  return <>{icons[name]}</>;
}
