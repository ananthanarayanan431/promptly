'use client';

import { useState, useEffect } from 'react';
import { useFavorites } from '@/hooks/use-favorites';
import type { ListFavoritesParams } from '@/lib/favorites';
import type { FavoriteResponse, FavoriteCategory } from '@/types/api';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { Loader2, Heart, Pin } from 'lucide-react';

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
  Work: { bg: 'rgba(124,92,255,0.15)', color: '#a78bfa' },
  Personal: { bg: 'rgba(244,63,94,0.12)', color: '#fb7185' },
  Research: { bg: 'rgba(59,130,246,0.12)', color: '#60a5fa' },
  Creative: { bg: 'rgba(234,179,8,0.12)', color: '#fbbf24' },
  Other: { bg: 'rgba(138,138,144,0.15)', color: '#8a8a90' },
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
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '18px 20px',
        background: '#1a1a1a',
        border: '1px solid #1f1f23',
        borderRadius: 10,
        textDecoration: 'none',
        cursor: 'pointer',
        transition: 'border-color 120ms, background 120ms',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = '#2e2e34';
        e.currentTarget.style.background = 'rgba(255,255,255,0.018)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = '#1f1f23';
        e.currentTarget.style.background = '#1a1a1a';
      }}
    >
      {/* Top row: name + version + pin + heart */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {item.is_pinned && (
            <Pin
              style={{ width: 12, height: 12, color: '#fbbf24', flexShrink: 0 }}
              fill="#fbbf24"
            />
          )}
          <span
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: '#ededed',
              letterSpacing: '-0.005em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.family_name}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-geist-mono, monospace)',
              fontSize: 10,
              padding: '1px 5px',
              borderRadius: 4,
              background: '#222226',
              border: '1px solid #2a2a2e',
              color: '#8a8a90',
              flexShrink: 0,
            }}
          >
            v{item.version}
          </span>
        </div>
        <Heart
          style={{ width: 13, height: 13, color: '#f43f5e', flexShrink: 0 }}
          fill="#f43f5e"
        />
      </div>

      {/* Content preview */}
      <div
        style={{
          fontFamily: 'var(--font-geist-mono, monospace)',
          fontSize: 11.5,
          color: '#6a6a70',
          lineHeight: 1.55,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {preview}{hasMore ? '…' : ''}
      </div>

      {/* Bottom row: tags + category + date */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          marginTop: 2,
        }}
      >
        {visibleTags.map(tag => (
          <span
            key={tag}
            style={{
              fontFamily: 'var(--font-geist-mono, monospace)',
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 4,
              background: 'rgba(124,92,255,0.1)',
              border: '1px solid rgba(124,92,255,0.2)',
              color: '#9d7ff5',
            }}
          >
            {tag}
          </span>
        ))}
        <span
          style={{
            fontFamily: 'var(--font-geist-mono, monospace)',
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 4,
            background: catColor.bg,
            color: catColor.color,
          }}
        >
          {item.category}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontFamily: 'var(--font-geist-mono, monospace)',
            fontSize: 10,
            color: '#5a5a60',
          }}
        >
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

  // Debounce search input 300ms
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
    height: 34,
    padding: '0 10px',
    borderRadius: 6,
    border: '1px solid #2a2a2e',
    background: '#111113',
    color: '#b5b5ba',
    fontSize: 12,
    fontFamily: 'var(--font-geist, ui-sans-serif)',
    cursor: 'pointer',
    outline: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
    paddingRight: 28,
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
    <div
      style={{
        padding: '28px 40px 120px',
        maxWidth: 1180,
        margin: '0 auto',
        fontFamily: 'var(--font-geist, ui-sans-serif)',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 36 }}>
        <div
          style={{
            fontFamily: 'var(--font-geist-mono, monospace)',
            fontSize: 11,
            color: '#7c5cff',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            marginBottom: 8,
          }}
        >
          / prompt-library
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-instrument-serif, Georgia, serif)',
            fontWeight: 400,
            fontSize: 42,
            letterSpacing: '-0.02em',
            lineHeight: 1.12,
            margin: 0,
            color: '#ededed',
          }}
        >
          Prompt Library
        </h1>
        <p
          style={{
            margin: '10px 0 0',
            fontSize: 13,
            color: '#8a8a90',
            lineHeight: 1.5,
          }}
        >
          Your saved prompts.
          {data && (
            <span
              style={{
                fontFamily: 'var(--font-geist-mono, monospace)',
                fontSize: 11,
                color: '#5a5a60',
                marginLeft: 10,
              }}
            >
              {data.total} {data.total === 1 ? 'prompt' : 'prompts'}
            </span>
          )}
        </p>
      </div>

      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 24,
          flexWrap: 'wrap',
        }}
      >
        {/* Search */}
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 360 }}>
          <svg
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
            }}
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#5a5a60"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search prompts…"
            style={{
              width: '100%',
              height: 34,
              paddingLeft: 30,
              paddingRight: 10,
              borderRadius: 6,
              border: '1px solid #2a2a2e',
              background: '#111113',
              color: '#ededed',
              fontSize: 12,
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Category dropdown */}
        <div style={{ position: 'relative' }}>
          <select
            value={category}
            onChange={e => setCategory(e.target.value as FavoriteCategory | '')}
            style={selectStyle}
          >
            {CATEGORY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <svg
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
            }}
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#5a5a60"
            strokeWidth="2.5"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>

        {/* Sort dropdown */}
        <div style={{ position: 'relative' }}>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as NonNullable<ListFavoritesParams['sort']>)}
            style={selectStyle}
          >
            {SORT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <svg
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
            }}
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#5a5a60"
            strokeWidth="2.5"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '64px 0',
            color: '#8a8a90',
            gap: 8,
          }}
        >
          <Loader2
            style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }}
          />
          <span style={{ fontSize: 13 }}>Loading…</span>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && data && data.items.length === 0 && (
        <div
          style={{
            background: '#1a1a1a',
            border: '1px solid #1f1f23',
            borderRadius: 10,
            padding: '56px 20px',
            textAlign: 'center',
            color: '#8a8a90',
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          <Heart
            style={{
              width: 24,
              height: 24,
              color: '#2a2a2e',
              margin: '0 auto 14px',
              display: 'block',
            }}
          />
          No saved prompts yet. Like a result after optimizing to save it here.
        </div>
      )}

      {/* Grid */}
      {!isLoading && data && data.items.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 12,
          }}
        >
          {data.items.map(item => (
            <FavoriteCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
    </div>
  );
}
