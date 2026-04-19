'use client';

import { useAuthStore } from '@/stores/auth-store';
import { useQuery } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import type { User } from '@/types/api';

const CRUMBS: Record<string, string[]> = {
  '/optimize':  ['Workspace', 'Optimize'],
  '/analyze':   ['Workspace', 'Analyze'],
  '/versions':  ['Workspace', 'Versions'],
  '/history':   ['Workspace', 'History'],
  '/billing':   ['Workspace', 'Billing'],
  '/dashboard': ['Workspace', 'Dashboard'],
};

function getBreadcrumbs(pathname: string): string[] {
  if (pathname.startsWith('/versions/')) return ['Workspace', 'Versions', 'Detail'];
  return CRUMBS[pathname] ?? ['Workspace'];
}

export function Header() {
  const pathname = usePathname();
  const { setUser } = useAuthStore();
  const crumbs = getBreadcrumbs(pathname);

  const { data: fetchedUser } = useQuery<User>({
    queryKey: ['user', 'me'],
    queryFn: async () => {
      const res = await api.get<{ data: User }>('/api/v1/users/me');
      return res.data.data;
    },
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (fetchedUser) setUser(fetchedUser);
  }, [fetchedUser, setUser]);

  const credits = fetchedUser?.credits ?? 0;
  const maxCredits = 1000;
  const pct = Math.min(100, Math.round((credits / maxCredits) * 100));

  return (
    <header style={{ height: 52, padding: '0 20px', display: 'flex', alignItems: 'center', gap: 16,
      borderBottom: '1px solid #1f1f23', background: 'rgba(20,20,20,0.7)',
      backdropFilter: 'blur(10px)', flexShrink: 0,
      fontFamily: 'var(--font-geist, ui-sans-serif)' }}>

      {/* Breadcrumbs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#b5b5ba' }}>
        {crumbs.map((c, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {i > 0 && <span style={{ color: '#5a5a60' }}>/</span>}
            <span style={{ color: i === crumbs.length - 1 ? '#ededed' : '#b5b5ba' }}>{c}</span>
          </span>
        ))}
      </div>

      {/* Right slot */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>

        {/* Credits chip */}
        {fetchedUser && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8,
            height: 28, padding: '0 10px 0 8px', borderRadius: 999,
            background: '#222226', border: '1px solid #2a2a2e',
            fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12 }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: '#2a2a2e', position: 'relative', overflow: 'hidden' }}>
              <span style={{ position: 'absolute', inset: '0 auto 0 0', width: `${pct}%`,
                background: '#7c5cff', borderRadius: 2 }} />
            </div>
            <span style={{ color: '#ededed' }}>{credits}</span>
            <span style={{ color: '#5a5a60' }}>credits</span>
          </div>
        )}

        <button style={{ height: 28, padding: '0 10px', borderRadius: 6, border: '1px solid #2a2a2e',
          background: 'transparent', fontSize: 12, color: '#b5b5ba', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L21 2M16 7l3 3M14 9l3 3"/>
          </svg>
          API keys
        </button>

        <button style={{ height: 28, padding: '0 10px', borderRadius: 6, border: '1px solid #2a2a2e',
          background: 'transparent', fontSize: 12, color: '#b5b5ba', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/>
          </svg>
          Share
        </button>
      </div>
    </header>
  );
}
