'use client';

import { useState, useEffect } from 'react';
import { useFavorites } from '@/hooks/use-favorites';
import type { ListFavoritesParams } from '@/lib/favorites';
import type { FavoriteResponse, FavoriteCategory } from '@/types/api';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { Heart, Pin } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';

const CATEGORY_OPTIONS: Array<{ value: FavoriteCategory | ''; label: string }> = [
  { value: '', label: 'All categories' },
  { value: 'Work', label: 'Work' },
  { value: 'Personal', label: 'Personal' },
  { value: 'Research', label: 'Research' },
  { value: 'Creative', label: 'Creative' },
  { value: 'Other', label: 'Other' },
];

const SORT_OPTIONS: Array<{ value: ListFavoritesParams['sort']; label: string }> = [
  { value: 'recently_liked', label: 'Recently liked' },
  { value: 'recently_used', label: 'Recently used' },
  { value: 'most_used', label: 'Most used' },
  { value: 'name', label: 'Name (A–Z)' },
];

const CATEGORY_COLORS: Record<FavoriteCategory, { bg: string; color: string }> = {
  Work:     { bg: 'var(--primary-soft)',  color: 'var(--primary)'  },
  Personal: { bg: 'var(--danger-soft)',   color: 'var(--danger)'   },
  Research: { bg: 'var(--accent-soft)',   color: 'var(--accent)'   },
  Creative: { bg: 'var(--warning-soft)',  color: 'var(--warning)'  },
  Other:    { bg: 'var(--surface-2)',     color: 'var(--text-muted)' },
};

function FavoriteCard({ item }: { item: FavoriteResponse }) {
  const preview = item.content.slice(0, 120);
  const hasMore = item.content.length > 120;
  const visibleTags = item.tags.slice(0, 3);
  const catColor = CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.Other;
  const likedAgo = formatDistanceToNow(new Date(item.liked_at), { addSuffix: true });

  return (
    <Link
      href={`/prompt-library/${item.id}`}
      className="ply-card"
      style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 18px',
        textDecoration: 'none', cursor: 'pointer', minHeight: 160,
        transition: 'border-color 120ms, background 120ms' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {item.is_pinned && (
            <Pin style={{ width: 11, height: 11, color: 'var(--warning)', flexShrink: 0 }} fill="var(--warning)" />
          )}
          <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.005em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.family_name}
          </span>
          <span className="ply-pill" style={{ fontFamily: 'var(--mono)', fontSize: 10, flexShrink: 0 }}>
            v{item.version}
          </span>
        </div>
        <Heart style={{ width: 12, height: 12, color: 'var(--danger)', flexShrink: 0 }} fill="var(--danger)" />
      </div>

      <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.55,
        overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
        {preview}{hasMore ? '…' : ''}
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {visibleTags.map(tag => (
          <span key={tag} className="ply-pill" style={{ fontFamily: 'var(--mono)', fontSize: 10,
            color: 'var(--primary)', background: 'var(--primary-soft)' }}>
            {tag}
          </span>
        ))}
        <span className="ply-pill" style={{ fontFamily: 'var(--mono)', fontSize: 10,
          background: catColor.bg, color: catColor.color }}>
          {item.category}
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-subtle)' }}>
          {likedAgo}
        </span>
      </div>
    </Link>
  );
}

export default function PromptLibraryPage() {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [category, setCategory] = useState<FavoriteCategory | ''>('');
  const [sort, setSort] = useState<NonNullable<ListFavoritesParams['sort']>>('recently_liked');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const params: ListFavoritesParams = {
    q: debouncedQ || undefined,
    category: category || undefined,
    sort,
    limit: 50,
    offset: 0,
  };

  const { data, isLoading } = useFavorites(params);

  const selectStyle: React.CSSProperties = {
    height: 34, padding: '0 28px 0 10px', borderRadius: 6,
    border: '1px solid var(--border)', background: 'var(--surface-2)',
    color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', outline: 'none',
    appearance: 'none', WebkitAppearance: 'none',
  };

  return (
    <>
      <PageHeader
        title="Library"
        subtitle="Your saved prompts."
        badge={data ? (
          <span className="ply-pill" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
            {data.total} {data.total === 1 ? 'prompt' : 'prompts'}
          </span>
        ) : undefined}
      />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 28px 80px' }}>

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 340 }}>
            <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
              width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input type="text" value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search prompts…"
              style={{ width: '100%', height: 34, paddingLeft: 30, paddingRight: 10, borderRadius: 6,
                border: '1px solid var(--border)', background: 'var(--surface-2)',
                color: 'var(--text)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ position: 'relative' }}>
            <select value={category} onChange={e => setCategory(e.target.value as FavoriteCategory | '')}
              style={selectStyle}>
              {CATEGORY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <svg style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
              width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth="2.5">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
          <div style={{ position: 'relative' }}>
            <select value={sort} onChange={e => setSort(e.target.value as NonNullable<ListFavoritesParams['sort']>)}
              style={selectStyle}>
              {SORT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <svg style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
              width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth="2.5">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>

        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '64px 0', color: 'var(--text-muted)', gap: 8 }}>
            <span className="ply-dot ply-dot-pulse" style={{ width: 8, height: 8, background: 'var(--primary)' }} />
            <span style={{ fontSize: 13 }}>Loading…</span>
          </div>
        )}

        {!isLoading && data && data.items.length === 0 && (
          <div className="ply-card" style={{ padding: '56px 20px', textAlign: 'center',
            color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
            <Heart style={{ width: 22, height: 22, color: 'var(--border-strong)', margin: '0 auto 12px', display: 'block' }} />
            No saved prompts yet. Like a result after optimizing to save it here.
          </div>
        )}

        {!isLoading && data && data.items.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {data.items.map(item => <FavoriteCard key={item.id} item={item} />)}
          </div>
        )}
      </div>
    </>
  );
}
