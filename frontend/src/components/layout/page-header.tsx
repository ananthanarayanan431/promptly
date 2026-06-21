'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { User } from '@/types/api';
import { useTheme } from '@/hooks/use-theme';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  right?: React.ReactNode;
}

function ThemeToggle() {
  const { theme, toggle, mounted } = useTheme();
  return (
    <button
      onClick={toggle}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)',
        background: 'var(--surface)', cursor: 'pointer', display: 'flex',
        alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)',
        transition: 'background .12s, color .12s',
        flexShrink: 0,
      }}
    >
      {/* Render nothing until mounted to avoid server/client icon mismatch */}
      {mounted && (theme === 'dark' ? (
        /* Sun icon */
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
        </svg>
      ) : (
        /* Moon icon */
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
        </svg>
      ))}
    </button>
  );
}

export function PageHeader({ title, subtitle, badge, right }: PageHeaderProps) {
  const { data: user } = useQuery<User>({
    queryKey: ['user', 'me'],
    queryFn: async () => {
      const res = await api.get<{ data: User }>('/api/v1/users/me');
      return res.data.data;
    },
    staleTime: 1000 * 60 * 5,
  });

  return (
    <div style={{
      padding: '20px 28px 16px',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      background: 'var(--bg)', flexShrink: 0,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-.01em', color: 'var(--text)' }}>
            {title}
          </h1>
          {badge}
        </div>
        {subtitle && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, maxWidth: 680 }}>{subtitle}</div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {right}
        <ThemeToggle />
        {user && (
          <span className="ply-pill" style={{ padding: '4px 10px', gap: 5 }}>
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
            <span className="mono" style={{ fontWeight: 600, color: user.token_balance <= 0 ? 'var(--danger)' : user.token_balance < 300_000 ? 'var(--warning)' : 'var(--text)' }}>
              {(() => { const d = Math.max(0, user.token_balance); return d === 0 ? '0' : d >= 1_000_000 ? `${(d / 1_000_000).toFixed(1)}M` : d >= 1_000 ? `${(d / 1_000).toFixed(0)}K` : String(d); })()}
            </span>
            <span style={{ color: 'var(--text-subtle)', marginLeft: 2 }}>tokens</span>
          </span>
        )}
      </div>
    </div>
  );
}
