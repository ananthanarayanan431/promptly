'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PaginatedPromptFamilyList, PromptFamily } from '@/types/api';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';

const PAGE_SIZE = 20;

type Bucket = 'today' | 'last7' | 'last30' | 'older';

const BUCKET_LABELS: Record<Bucket, string> = {
  today: 'Today',
  last7: 'Last 7 days',
  last30: 'Last 30 days',
  older: 'Older',
};
const BUCKET_ORDER: Bucket[] = ['today', 'last7', 'last30', 'older'];

function getBucket(dateStr: string): Bucket {
  const now = Date.now();
  const diff = now - new Date(dateStr).getTime();
  if (diff < 86_400_000) return 'today';
  if (diff < 7 * 86_400_000) return 'last7';
  if (diff < 30 * 86_400_000) return 'last30';
  return 'older';
}

function FamilyRow({ f }: { f: PromptFamily }) {
  const latestVersion = f.versions[f.versions.length - 1];
  const starredCount = f.versions.filter(v => v.is_favorited).length;
  const updated = latestVersion?.created_at
    ? formatDistanceToNow(new Date(latestVersion.created_at), { addSuffix: true })
    : 'Unknown';
  const snip = latestVersion?.content?.slice(0, 100) ?? '';

  return (
    <Link href={`/versions/${f.prompt_id}`}
      style={{ display: 'grid', gridTemplateColumns: '1fr auto',
        gap: 20, alignItems: 'center', padding: '16px 20px',
        borderBottom: '1px solid var(--border)', textDecoration: 'none',
        cursor: 'pointer', transition: 'background 120ms' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)',
            letterSpacing: '-0.005em' }}>{f.name}</span>
          <span className="ply-pill" style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>
            {f.prompt_id.slice(0, 8)}
          </span>
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5,
          color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', maxWidth: 520 }}>
          {snip}
        </div>
      </div>

      <div style={{ fontFamily: 'var(--mono)', fontSize: 11,
        color: 'var(--text-subtle)', display: 'flex', gap: 32, alignItems: 'center' }}>
        {starredCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="var(--danger)" stroke="var(--danger)" strokeWidth="1.6">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            <span style={{ color: 'var(--danger)' }}>{starredCount}</span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ display: 'flex', gap: 3 }}>
            {Array.from({ length: f.versions.length }).map((_, i) => (
              <div key={i} style={{ width: 18, height: 4, borderRadius: 2,
                background: i === f.versions.length - 1 ? 'var(--primary)' : 'var(--border-strong)' }} />
            ))}
          </div>
          <span style={{ minWidth: 30 }}>v{f.versions.length}</span>
        </div>
        <span style={{ minWidth: 80, textAlign: 'right' }}>{updated}</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
          stroke="var(--text-subtle)" strokeWidth="1.6"><path d="M9 6l6 6-6 6"/></svg>
      </div>
    </Link>
  );
}

export default function VersionsPage() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['prompt-families', page],
    queryFn: async () => {
      const res = await api.get<{ data: PaginatedPromptFamilyList }>('/api/v1/prompts/versions', {
        params: { page, page_size: PAGE_SIZE },
      });
      return res.data.data;
    },
  });

  const families = data?.families ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 0;

  const grouped = (() => {
    if (!families.length) return null;
    const buckets: Record<Bucket, PromptFamily[]> = { today: [], last7: [], last30: [], older: [] };
    for (const f of families) {
      const latest = f.versions[f.versions.length - 1];
      const bucket = latest?.created_at ? getBucket(latest.created_at) : 'older';
      buckets[bucket].push(f);
    }
    return buckets;
  })();

  return (
    <>
      <PageHeader
        title="Versions"
        subtitle="Every prompt you've optimized, tracked across versions."
        right={
          <Link href="/optimize" className="ply-btn ply-btn-primary" style={{ textDecoration: 'none' }}>
            + New family
          </Link>
        }
      />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 28px 80px' }}>

        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '48px 0', color: 'var(--text-muted)', gap: 8 }}>
            <span className="ply-dot ply-dot-pulse" style={{ width: 8, height: 8, background: 'var(--primary)' }} />
            <span style={{ fontSize: 13 }}>Loading…</span>
          </div>
        )}

        {!isLoading && families.length === 0 && (
          <div className="ply-card" style={{ padding: '48px 20px', textAlign: 'center',
            color: 'var(--text-muted)', fontSize: 13 }}>
            No prompt versions yet. Save a prompt during optimization to start tracking versions.
          </div>
        )}

        {grouped && BUCKET_ORDER.map(bucket => {
          const items = grouped[bucket];
          if (items.length === 0) return null;
          return (
            <div key={bucket} style={{ marginBottom: 28 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5,
                color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.12em',
                marginBottom: 10, paddingLeft: 2 }}>
                {BUCKET_LABELS[bucket]}
              </div>
              <div className="ply-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto',
                  padding: '10px 20px', borderBottom: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  fontFamily: 'var(--mono)', fontSize: 10.5,
                  color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                  <span>Family · latest version</span>
                  <span style={{ display: 'flex', gap: 40 }}>
                    <span>Versions</span>
                    <span>Updated</span>
                  </span>
                </div>
                {items.map(f => <FamilyRow key={f.prompt_id} f={f} />)}
              </div>
            </div>
          );
        })}

        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>
              {total} families · page {page} of {totalPages}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setPage(p => p - 1)} disabled={page === 1} className="ply-btn"
                style={{ opacity: page === 1 ? 0.4 : 1, cursor: page === 1 ? 'not-allowed' : 'pointer' }}>
                Prev
              </button>
              <button onClick={() => setPage(p => p + 1)} disabled={page === totalPages} className="ply-btn"
                style={{ opacity: page === totalPages ? 0.4 : 1, cursor: page === totalPages ? 'not-allowed' : 'pointer' }}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
