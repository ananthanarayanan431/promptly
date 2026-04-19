'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PromptFamily } from '@/types/api';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';

export default function VersionsPage() {
  const { data: families, isLoading } = useQuery({
    queryKey: ['prompt-families'],
    queryFn: async () => {
      const res = await api.get<{ data: { families: PromptFamily[] } }>('/api/v1/prompts/versions');
      return res.data.data.families;
    },
  });

  return (
    <div style={{ padding: '28px 40px 120px', maxWidth: 1180, margin: '0 auto',
      fontFamily: 'var(--font-geist, ui-sans-serif)' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        marginBottom: 40, gap: 24 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
            color: '#7c5cff', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>
            / versions
          </div>
          <h1 style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontWeight: 400,
            fontSize: 42, letterSpacing: '-0.02em', lineHeight: 1.12, margin: 0, color: '#ededed' }}>
            Every prompt,<br /><em style={{ color: '#7c5cff', fontStyle: 'italic' }}>every version</em>.
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8, paddingTop: 8 }}>
          <button style={{ height: 28, padding: '0 10px', borderRadius: 6,
            border: '1px solid #2a2a2e', background: 'transparent', fontSize: 12,
            color: '#b5b5ba', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'inherit' }}>
            Filter
          </button>
          <Link href="/optimize"
            style={{ height: 28, padding: '0 12px', borderRadius: 6,
              background: '#7c5cff', border: '1px solid #7c5cff', fontSize: 12,
              color: '#fff', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
            + New family
          </Link>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: '#1a1a1a', border: '1px solid #1f1f23', borderRadius: 10, overflow: 'hidden' }}>
        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto',
          padding: '10px 20px', borderBottom: '1px solid #1f1f23',
          background: 'rgba(255,255,255,0.015)',
          fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
          color: '#5a5a60', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          <span>Family · latest version</span>
          <span style={{ display: 'flex', gap: 40 }}>
            <span>Versions</span>
            <span>Updated</span>
          </span>
        </div>

        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '48px 0', color: '#8a8a90', gap: 8 }}>
            <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13 }}>Loading…</span>
          </div>
        )}

        {!isLoading && (!families || families.length === 0) && (
          <div style={{ padding: '48px 20px', textAlign: 'center', color: '#8a8a90', fontSize: 13 }}>
            No prompt versions yet. Save a prompt during optimization to start tracking versions.
          </div>
        )}

        {families?.map(f => {
          const latestVersion = f.versions[f.versions.length - 1];
          const updated = latestVersion?.created_at
            ? formatDistanceToNow(new Date(latestVersion.created_at), { addSuffix: true })
            : 'Unknown';
          const snip = latestVersion?.content?.slice(0, 100) ?? '';

          return (
            <Link key={f.prompt_id} href={`/versions/${f.prompt_id}`}
              style={{ display: 'grid', gridTemplateColumns: '1fr auto',
                gap: 20, alignItems: 'center', padding: '18px 20px',
                borderBottom: '1px solid #1f1f23', textDecoration: 'none',
                cursor: 'pointer', transition: 'background 120ms' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.015)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 15, fontWeight: 500, color: '#ededed',
                    letterSpacing: '-0.005em' }}>{f.name}</span>
                  <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
                    padding: '2px 6px', borderRadius: 4, background: '#222226',
                    border: '1px solid #2a2a2e', color: '#8a8a90' }}>
                    {f.prompt_id.slice(0, 8)}
                  </span>
                </div>
                <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11.5,
                  color: '#8a8a90', overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap', maxWidth: 520 }}>
                  {snip}
                </div>
              </div>

              <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
                color: '#5a5a60', display: 'flex', gap: 40, alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {/* Version strip */}
                  <div style={{ display: 'flex', gap: 3 }}>
                    {Array.from({ length: f.versions.length }).map((_, i) => (
                      <div key={i} style={{ width: 18, height: 4, borderRadius: 2,
                        background: i === f.versions.length - 1 ? '#7c5cff' : 'rgba(124,92,255,0.2)' }} />
                    ))}
                  </div>
                  <span style={{ minWidth: 30 }}>v{f.versions.length}</span>
                </div>
                <span style={{ minWidth: 80, textAlign: 'right' }}>{updated}</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                  stroke="#5a5a60" strokeWidth="1.6"><path d="M9 6l6 6-6 6"/></svg>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
