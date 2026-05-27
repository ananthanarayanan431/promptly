'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useClerk, useUser } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { User, DashboardStats } from '@/types/api';

function deriveDisplayName(email: string): string {
  return email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function deriveInitials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}
function formatMonthYear(d: Date | null | undefined): string {
  return d ? d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '—';
}
function formatDateTime(d: Date | null | undefined): string {
  return d ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
}

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12 }}>
      <span style={{ color: 'var(--text-subtle)' }}>{label}</span>
      <span style={{ color: 'var(--text)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

export function UserMenu() {
  const router = useRouter();
  const { signOut } = useClerk();
  const { user: clerkUser } = useUser();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: fetchedUser } = useQuery<User>({
    queryKey: ['user', 'me'],
    queryFn: async () => {
      const res = await api.get<{ data: User }>('/api/v1/users/me');
      return res.data.data;
    },
    staleTime: 1000 * 60 * 5,
  });

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['stats'],
    queryFn: async () => {
      const res = await api.get<{ data: DashboardStats }>('/api/v1/stats');
      return res.data.data;
    },
    staleTime: 1000 * 60 * 5,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!clerkUser && !fetchedUser) return null;

  const clerkEmail = clerkUser?.primaryEmailAddress?.emailAddress ?? '';
  const displayName =
    clerkUser?.fullName ||
    (fetchedUser ? deriveDisplayName(fetchedUser.email) : clerkEmail ? deriveDisplayName(clerkEmail) : '');
  const initials = deriveInitials(displayName);
  const email = fetchedUser?.email ?? clerkEmail;
  const credits = fetchedUser?.credits ?? 0;
  const optimizations = stats?.prompts_optimized ?? 0;
  const healthChecks = stats?.usage?.all_time?.health_score_calls ?? 0;

  const avatar = (size: number) =>
    clerkUser?.hasImage && clerkUser.imageUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={clerkUser.imageUrl}
        alt={displayName}
        referrerPolicy="no-referrer"
        style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }}
      />
    ) : (
      <div style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: 'linear-gradient(135deg, oklch(70% 0.18 290), oklch(75% 0.13 215))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'white', fontSize: size * 0.4, fontWeight: 600,
      }}>
        {initials}
      </div>
    );

  async function handleLogout() {
    await signOut();
    router.push('/sign-in');
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {open && (
        <div
          style={{
            position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
            boxShadow: 'var(--shadow-md, 0 8px 28px rgba(0,0,0,.18))',
            padding: 6, display: 'flex', flexDirection: 'column', gap: 2, zIndex: 50,
          }}
        >
          {/* Identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 10px' }}>
            {avatar(34)}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayName}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {email}
              </div>
            </div>
          </div>

          {/* Credits & usage */}
          <div style={{ borderTop: '1px solid var(--border)', padding: '8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <InfoRow label="Credits" value={credits} />
            <InfoRow label="Optimizations" value={optimizations} />
            <InfoRow label="Health checks" value={healthChecks} />
          </div>

          {/* Account dates */}
          <div style={{ borderTop: '1px solid var(--border)', padding: '8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <InfoRow label="Member since" value={formatMonthYear(clerkUser?.createdAt)} />
            <InfoRow label="Last sign-in" value={formatDateTime(clerkUser?.lastSignInAt)} />
          </div>

          {/* Quick actions */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px',
                borderRadius: 6, color: 'var(--text-muted)', fontSize: 12.5, textDecoration: 'none',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
                <circle cx="8" cy="15" r="4" /><path d="M10.8 12.2L21 2M16 7l3 3M14 9l3 3" />
              </svg>
              API keys
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px',
                borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer',
                color: 'var(--text-muted)', fontSize: 12.5, fontFamily: 'inherit', textAlign: 'left',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      )}

      {/* Trigger row */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '4px',
          border: '1px solid transparent', borderRadius: 8, background: open ? 'var(--surface-2)' : 'transparent',
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          transition: 'background .12s',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--surface-2)'; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent'; }}
      >
        {avatar(28)}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayName}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {email}
          </div>
        </div>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .12s', flexShrink: 0 }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}
