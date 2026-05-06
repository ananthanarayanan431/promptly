'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { useJobStore } from '@/stores/job-store';
import { clearToken } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import Link from 'next/link';
import type { SessionsGrouped, SessionSummary, User } from '@/types/api';

const NAV = [
  { key: 'dashboard',      label: 'Dashboard',      href: '/dashboard',      kbd: 'D' },
  { key: 'optimize',       label: 'Optimize',       href: '/optimize',       kbd: 'O' },
  { key: 'analyze',        label: 'Analyze',        href: '/analyze',        kbd: 'A' },
  { key: 'versions',       label: 'Versions',       href: '/versions',       kbd: 'V' },
  { key: 'prompt-library', label: 'Prompt Library', href: '/prompt-library', kbd: 'S' },
  { key: 'prompts-media',  label: 'Prompts Media',  href: '/prompts-media' },
  { key: 'prompt-project', label: 'Prompt Project', href: '/prompt-project' },
  { key: 'history',        label: 'History',        href: '/history' },
  { key: 'billing',        label: 'Billing',        href: '/billing' },
  { key: 'settings',       label: 'Settings',       href: '/settings' },
];

function deriveDisplayName(email: string): string {
  return email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function deriveInitials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function SessionItem({ session, isActive, isGenerating }: { session: SessionSummary; isActive: boolean; isGenerating: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(session.title ?? '');
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [menuOpen]);

  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/v1/chat/sessions/${session.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      if (isActive) router.push('/optimize');
    },
  });

  const renameMutation = useMutation({
    mutationFn: (title: string) =>
      api.patch(`/api/v1/chat/sessions/${session.id}`, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setRenaming(false);
    },
  });

  function commitRename() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== session.title) {
      renameMutation.mutate(trimmed);
    } else {
      setRenaming(false);
    }
  }

  if (renaming) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 14px',
        margin: '0 8px' }}>
        <input
          ref={inputRef}
          value={renameValue}
          onChange={e => setRenameValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setRenaming(false);
          }}
          onBlur={commitRename}
          style={{
            flex: 1, height: 26, padding: '0 8px', borderRadius: 5,
            border: '1px solid #7c5cff', background: '#1a1a1e',
            color: '#ededed', fontSize: 12.5, outline: 'none',
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}
      onMouseLeave={() => setMenuOpen(false)}>
      {/* Row: Link and menu button are siblings — no interactive element nested inside <a> */}
      <Link href={`/optimize?session=${session.id}`}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px',
          paddingRight: 38, margin: '0 8px', borderRadius: 6, fontSize: 13,
          textDecoration: 'none',
          color: isActive ? '#ededed' : '#b5b5ba',
          background: isActive ? '#222226' : 'transparent',
          overflow: 'hidden', whiteSpace: 'nowrap' as const }}>
        {isGenerating ? (
          <span style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: '#7c5cff',
            boxShadow: '0 0 0 0 rgba(124,92,255,0.5)',
            animation: 'sidebarPulse 1.4s ease-in-out infinite',
          }} />
        ) : (
          <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: isActive ? '#7c5cff' : '#5a5a60' }} />
        )}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {session.title || 'Untitled'}
        </span>
      </Link>

      {/* Three-dot button — sibling of Link, absolutely positioned over the right edge */}
      <button
        onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
        aria-haspopup="true"
        aria-expanded={menuOpen}
        aria-label="More options"
        style={{
          position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)',
          width: 20, height: 20, borderRadius: 4, border: 'none',
          background: 'transparent', cursor: 'pointer', padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#5a5a60', opacity: menuOpen ? 1 : undefined,
          zIndex: 1,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
        </svg>
      </button>

      {/* Dropdown menu */}
      {menuOpen && (
        <div ref={menuRef} style={{
          position: 'absolute', right: 12, top: '100%', zIndex: 100,
          background: '#1a1a1e', border: '1px solid #2a2a2e', borderRadius: 8,
          padding: '4px 0', minWidth: 140,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          <button
            onClick={() => { setMenuOpen(false); setRenaming(true); setRenameValue(session.title ?? ''); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '8px 12px', border: 'none',
              background: 'transparent', color: '#b5b5ba', fontSize: 12.5,
              cursor: 'pointer', textAlign: 'left',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#222226')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Rename
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              if (window.confirm('Delete this session? This cannot be undone.')) {
                deleteMutation.mutate();
              }
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '8px 12px', border: 'none',
              background: 'transparent', color: '#f43f5e', fontSize: 12.5,
              cursor: 'pointer', textAlign: 'left',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(244,63,94,0.08)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
            </svg>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function SessionHistory() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentSessionId = searchParams.get('session');
  const generatingSessionId = useJobStore((s) => s.generatingSessionId);
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
      <style>{`
        @keyframes sidebarPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(124,92,255,0.5); }
          50% { box-shadow: 0 0 0 4px rgba(124,92,255,0); }
        }
      `}</style>
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
          <SessionItem
            key={s.id}
            session={s}
            isActive={s.id === currentSessionId}
            isGenerating={s.id === generatingSessionId}
          />
        ))}
      </div>
    </div>
  );
}

export function Sidebar({ width, onWidthChange }: { width: number; onWidthChange: (w: number) => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout, user } = useAuthStore();
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

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

  const onDragStart = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(ev: MouseEvent) {
      if (!dragging.current) return;
      const next = Math.min(400, Math.max(180, startW.current + ev.clientX - startX.current));
      onWidthChange(next);
    }
    function onUp() {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [width, onWidthChange]);

  return (
    <aside style={{ width, background: '#101014', borderRight: '1px solid #1f1f23',
      display: 'flex', flexDirection: 'column', height: '100vh', flexShrink: 0,
      fontFamily: 'var(--font-geist, ui-sans-serif)', position: 'relative' }}>

      {/* Logo */}
      <div style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between' }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 9,
          textDecoration: 'none', fontSize: 14, fontWeight: 600, color: '#ededed' }}>
          <LogoMark />
          promptly
        </Link>
        <Link href="/optimize"
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px',
            borderRadius: 7, border: '1px solid rgba(124,92,255,0.4)',
            background: 'rgba(124,92,255,0.1)', color: '#7c5cff', textDecoration: 'none',
            fontSize: 12, fontWeight: 500, lineHeight: 1,
            transition: 'background 150ms, border-color 150ms' }}
          title="New chat">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          New Chat
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
            (n.href !== '/versions' && n.href !== '/dashboard' && n.href !== '/prompt-project' && pathname.startsWith(n.href));
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

      {/* Drag handle */}
      <div
        onMouseDown={onDragStart}
        style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: 4,
          cursor: 'col-resize', zIndex: 10,
          background: 'transparent',
          transition: 'background 150ms',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(124,92,255,0.35)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      />
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
    'prompt-project': (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M8 12h8M8 8h5M8 16h6"/>
      </svg>
    ),
    'prompt-library': (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
    ),
    'prompts-media': (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6">
        <rect x="3" y="3" width="7" height="5" rx="1"/>
        <rect x="14" y="3" width="7" height="5" rx="1"/>
        <rect x="3" y="11" width="7" height="5" rx="1"/>
        <rect x="14" y="11" width="7" height="5" rx="1"/>
        <rect x="3" y="19" width="18" height="2" rx="1"/>
      </svg>
    ),
    billing: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6">
        <rect x="2" y="5" width="20" height="14" rx="2"/>
        <path d="M2 10h20"/>
      </svg>
    ),
    settings: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
      </svg>
    ),
  };
  return <>{icons[name]}</>;
}
