'use client';

import { usePathname } from 'next/navigation';
import { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { clearToken } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import Link from 'next/link';
import type { User, SessionsGrouped, SessionSummary } from '@/types/api';

/* ── Logo ─────────────────────────────────────────────────────────── */
function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg width={22} height={22} viewBox="0 0 32 32" fill="none">
        <defs>
          <linearGradient id="lg-mark-sidebar" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="oklch(60% 0.22 290)" />
            <stop offset="100%" stopColor="oklch(72% 0.14 215)" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#lg-mark-sidebar)" />
        <path d="M11 9h6.5a4.5 4.5 0 0 1 0 9H13v5h-2zM13 11v5h4.5a2.5 2.5 0 0 0 0-5z" fill="white" />
      </svg>
      <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-.01em', color: 'var(--text)' }}>promptly</span>
    </div>
  );
}

/* ── Nav groups ─────────────────────────────────────────────────────── */
const NAV_GROUPS = [
  {
    group: 'Core',
    items: [
      { href: '/optimize',      label: 'Optimize',       icon: 'sparkles', primary: true },
      { href: '/domain-prompts', label: 'Domain',         icon: 'flask',    primary: true },
      { href: '/analyze',       label: 'Analyze',         icon: 'activity' },
    ],
  },
  {
    group: 'Library',
    items: [
      { href: '/versions',      label: 'Versions',        icon: 'gitBranch' },
      { href: '/prompt-library', label: 'Prompt Library',  icon: 'heart' },
      { href: '/history',       label: 'History',          icon: 'history' },
    ],
  },
  {
    group: 'Account',
    items: [
      { href: '/settings',      label: 'API Keys',         icon: 'chip' },
      { href: '/billing',       label: 'Billing',          icon: 'creditCard' },
    ],
  },
];

function NavIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    sparkles: 'M12 3v4M12 17v4M3 12h4M17 12h4M5.5 5.5l2.5 2.5M16 16l2.5 2.5M5.5 18.5l2.5-2.5M16 8l2.5-2.5',
    flask: 'M9 2v6.4a2 2 0 01-.34 1.12L4.5 16.5A3 3 0 007 21h10a3 3 0 002.5-4.5l-4.16-6.98A2 2 0 0115 8.4V2M8 2h8M7 16h10',
    activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
    gitBranch: 'M6 3v12M18 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM18 9a9 9 0 01-9 9',
    heart: 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 10-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z',
    history: 'M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8M3 3v5h5M12 7v5l3 2',
    chip: 'M5 5h14v14H5zM9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3',
    creditCard: 'M2 5h20v14H2zM2 10h20',
  };
  const d = paths[name] || '';
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      {d.split('M').filter(Boolean).map((seg, i) => (
        <path key={i} d={`M${seg}`} />
      ))}
    </svg>
  );
}

function deriveDisplayName(email: string): string {
  return email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function deriveInitials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function CreditsCard({ credits }: { credits: number }) {
  const optimizationsLeft = Math.floor(credits / 10);
  const pct = Math.min(100, (credits / 200) * 100);
  return (
    <div className="ply-card" style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, boxShadow: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Credits</span>
        <span className="mono" style={{ fontWeight: 600, color: 'var(--text)' }}>{credits}</span>
      </div>
      <div className="ply-progress">
        <i style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--primary), var(--accent))' }} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
        ≈ {optimizationsLeft} optimizations remaining
      </div>
    </div>
  );
}

function RecentSessions() {
  const { data } = useQuery<SessionsGrouped>({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await api.get<{ data: SessionsGrouped }>('/api/v1/chat/sessions');
      return res.data.data;
    },
    staleTime: 60_000,
  });

  const sessions: SessionSummary[] = data
    ? [...data.today, ...data.last_7_days, ...data.last_30_days, ...data.older].slice(0, 5)
    : [];

  if (sessions.length === 0) return null;

  return (
    <div>
      <div style={{
        padding: '4px 10px 6px', fontSize: 10.5, letterSpacing: '.08em',
        textTransform: 'uppercase', color: 'var(--text-subtle)', fontWeight: 600,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>Recent</span>
        <Link href="/history" style={{ color: 'var(--text-subtle)', fontSize: 10.5, textDecoration: 'none' }}>
          view all
        </Link>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {sessions.map(s => (
          <Link key={s.id} href={`/optimize?session=${s.id}`}
            style={{
              padding: '6px 10px', borderRadius: 6, border: '1px solid transparent',
              background: 'transparent', color: 'var(--text-muted)',
              fontSize: 12, lineHeight: 1.4,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              textDecoration: 'none', display: 'block',
              transition: 'background .12s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {s.title || 'Untitled conversation'}
          </Link>
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
  const initials = deriveInitials(displayName);
  const credits = fetchedUser?.credits ?? displayUser?.credits ?? 0;

  const handleLogout = async () => {
    logout();
    await clearToken();
    router.push('/login');
    router.refresh();
  };

  return (
    <aside style={{
      width: 260, flexShrink: 0, height: '100vh', position: 'sticky', top: 0,
      borderRight: '1px solid var(--border)', background: 'var(--bg-2)',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--sans)',
    }}>
      {/* Logo */}
      <div style={{ padding: '18px 16px 14px' }}>
        <Logo />
      </div>

      {/* New optimization button */}
      <div style={{ padding: '0 12px 12px' }}>
        <Link href="/optimize" style={{
          display: 'flex', alignItems: 'center', gap: 6,
          height: 32, padding: '0 12px', borderRadius: 8,
          background: 'var(--primary)', color: 'white', border: 'none',
          fontWeight: 500, fontSize: 13, textDecoration: 'none',
          boxShadow: '0 1px 0 rgba(255,255,255,.18) inset',
          justifyContent: 'flex-start',
        }}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span style={{ whiteSpace: 'nowrap' }}>New optimization</span>
          <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, opacity: .7 }}>⌘K</span>
        </Link>
      </div>

      {/* Search */}
      <div style={{ padding: '0 12px 8px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
          color: 'var(--text-subtle)',
        }}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <span style={{ flex: 1, fontSize: 12.5 }}>Search sessions…</span>
          <span className="mono" style={{ fontSize: 11, opacity: .6 }}>/</span>
        </div>
      </div>

      {/* Nav groups */}
      <nav style={{ padding: '8px 8px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {NAV_GROUPS.map(group => (
          <div key={group.group}>
            <div style={{
              padding: '4px 10px 6px', fontSize: 10.5, letterSpacing: '.08em',
              textTransform: 'uppercase', color: 'var(--text-subtle)', fontWeight: 600,
            }}>
              {group.group}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {group.items.map(item => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <Link key={item.href} href={item.href} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '7px 10px', height: 32,
                    borderRadius: 7, border: '1px solid transparent',
                    background: active ? 'var(--surface)' : 'transparent',
                    color: active ? 'var(--text)' : 'var(--text-muted)',
                    fontWeight: active ? 500 : 400,
                    boxShadow: active ? 'var(--shadow-sm)' : 'none',
                    borderColor: active ? 'var(--border)' : 'transparent',
                    fontSize: 13, textDecoration: 'none',
                    transition: 'background .12s, color .12s',
                    whiteSpace: 'nowrap',
                  }}>
                    <NavIcon name={item.icon} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        {/* Recent sessions */}
        <RecentSessions />
      </nav>

      {/* Bottom: credits + user */}
      <div style={{ padding: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <CreditsCard credits={credits} />

        {displayUser && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 4px' }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, oklch(70% 0.18 290), oklch(75% 0.13 215))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontSize: 11, fontWeight: 600,
            }}>
              {initials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayName}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                {displayUser.email}
              </div>
            </div>
            <button
              onClick={handleLogout}
              title="Log out"
              style={{
                width: 28, height: 28, borderRadius: 6, border: 'none',
                background: 'transparent', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-subtle)',
              }}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
