'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase';
import { api } from '@/lib/api';
import type { User, DashboardStats } from '@/types/api';

function deriveDisplayName(email: string): string {
  return email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function deriveInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}
function formatMonthYear(iso: string | undefined): string {
  return iso
    ? new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : '—';
}
function formatDateTime(iso: string | undefined): string {
  return iso
    ? new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';
}

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        fontSize: 12,
      }}
    >
      <span style={{ color: 'var(--text-subtle)' }}>{label}</span>
      <span style={{ color: 'var(--text)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

export function UserMenu() {
  const supabase = useMemo(() => createClient(), []);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [open, setOpen] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setSupabaseUser(user));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => {
      setSupabaseUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (!supabaseUser && !fetchedUser) return null;

  const supabaseEmail = supabaseUser?.email ?? '';
  const fullName =
    (supabaseUser?.user_metadata?.full_name as string | undefined) ||
    (fetchedUser
      ? deriveDisplayName(fetchedUser.email)
      : supabaseEmail
        ? deriveDisplayName(supabaseEmail)
        : '');
  const initials = deriveInitials(fullName);
  const avatarUrl =
    (supabaseUser?.user_metadata?.avatar_url as string | undefined) ||
    (supabaseUser?.user_metadata?.picture as string | undefined) ||
    null;
  const email = fetchedUser?.email ?? supabaseEmail;
  const credits = fetchedUser?.credits ?? 0;
  const optimizations = stats?.prompts_optimized ?? 0;
  const healthChecks = stats?.usage?.all_time?.health_score_calls ?? 0;

  const avatar = (size: number) => (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        overflow: 'hidden',
        background: 'linear-gradient(135deg, oklch(70% 0.18 290), oklch(75% 0.13 215))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontSize: size * 0.4,
        fontWeight: 600,
      }}
    >
      {/* Initials stay underneath as the fallback if the image is missing or fails to load */}
      {initials}
      {avatarUrl && !avatarError && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt={fullName}
          // Google avatar URLs 403 without this when sent a referrer
          referrerPolicy="no-referrer"
          onError={() => setAvatarError(true)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      )}
    </div>
  );

  async function handleLogout() {
    await supabase.auth.signOut();
    // Hard redirect so middleware re-evaluates with cleared cookies.
    // router.push() would go through Next.js router while cookies are still
    // being cleared, causing middleware to redirect back to /optimize.
    window.location.href = '/sign-in';
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: 0,
            right: 0,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: 'var(--shadow-md, 0 8px 28px rgba(0,0,0,.18))',
            padding: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            zIndex: 50,
          }}
        >
          {/* Identity */}
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 10px' }}
          >
            {avatar(34)}
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {fullName}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-subtle)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {email}
              </div>
            </div>
          </div>

          {/* Credits & usage */}
          <div
            style={{
              borderTop: '1px solid var(--border)',
              padding: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <InfoRow label="Credits" value={credits} />
            <InfoRow label="Optimizations" value={optimizations} />
            <InfoRow label="Health checks" value={healthChecks} />
          </div>

          {/* Account dates */}
          <div
            style={{
              borderTop: '1px solid var(--border)',
              padding: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <InfoRow label="Member since" value={formatMonthYear(supabaseUser?.created_at)} />
            <InfoRow
              label="Last sign-in"
              value={formatDateTime(supabaseUser?.last_sign_in_at)}
            />
          </div>

          {/* Quick actions */}
          <div
            style={{
              borderTop: '1px solid var(--border)',
              paddingTop: 4,
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px',
                borderRadius: 6,
                color: 'var(--text-muted)',
                fontSize: 12.5,
                textDecoration: 'none',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <svg
                width={14}
                height={14}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
              >
                <circle cx="8" cy="15" r="4" />
                <path d="M10.8 12.2L21 2M16 7l3 3M14 9l3 3" />
              </svg>
              API keys
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px',
                borderRadius: 6,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                fontSize: 12.5,
                fontFamily: 'inherit',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <svg
                width={14}
                height={14}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
              >
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
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '4px',
          border: '1px solid transparent',
          borderRadius: 8,
          background: open ? 'var(--surface-2)' : 'transparent',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
          transition: 'background .12s',
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = 'var(--surface-2)';
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = 'transparent';
        }}
      >
        {avatar(28)}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 500,
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {fullName}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-subtle)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {email}
          </div>
        </div>
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-subtle)"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform .12s',
            flexShrink: 0,
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}
