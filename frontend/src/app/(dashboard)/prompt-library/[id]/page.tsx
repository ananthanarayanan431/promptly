'use client';

import { useState, useEffect, KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

import {
  useFavorite,
  useUpdateFavoriteMutation,
  useUnlikeMutation,
  useIncrementUseMutation,
} from '@/hooks/use-favorites';
import type { FavoriteCategory } from '@/types/api';

const CATEGORY_OPTIONS: FavoriteCategory[] = [
  'Work',
  'Personal',
  'Research',
  'Creative',
  'Other',
];

export default function PromptLibraryDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const { data, isLoading } = useFavorite(params.id);
  const updateMutation = useUpdateFavoriteMutation();
  const unlikeMutation = useUnlikeMutation();
  const incrementUseMutation = useIncrementUseMutation();

  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [category, setCategory] = useState<FavoriteCategory>('Other');
  const [isPinned, setIsPinned] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setNote(data.note ?? '');
      setTags(data.tags ?? []);
      setCategory(data.category);
      setIsPinned(data.is_pinned);
    }
  }, [data]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateMutation.mutateAsync({
        id: params.id,
        note: note || undefined,
        tags,
        category,
        is_pinned: isPinned,
      });
      toast.success('Saved');
    } catch {
      toast.error('Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUnstar = async () => {
    if (!window.confirm('Remove this prompt from your library?')) return;
    try {
      await unlikeMutation.mutateAsync(params.id);
      router.push('/prompt-library');
    } catch {
      toast.error('Failed to remove from library');
    }
  };

  const handleCopy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Copied to clipboard');
      await incrementUseMutation.mutateAsync(params.id);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const trimmed = tagInput.trim().slice(0, 30);
    if (!trimmed) return;
    if (tags.includes(trimmed)) {
      setTagInput('');
      return;
    }
    if (tags.length >= 10) {
      toast.error('Maximum 10 tags');
      return;
    }
    setTags(prev => [...prev, trimmed]);
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setTags(prev => prev.filter(t => t !== tag));
  };

  // ── Loading / error states ───────────────────────────────────────────────

  if (isLoading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--text-muted)', gap: 8,
        fontFamily: 'var(--font-geist, ui-sans-serif)',
      }}>
        <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: 13 }}>Loading…</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--text-muted)', fontSize: 13,
        fontFamily: 'var(--font-geist, ui-sans-serif)',
      }}>
        Prompt not found.
      </div>
    );
  }

  const prompt_version = { name: data.family_name, version: data.version, content: data.content };

  // ── Page ─────────────────────────────────────────────────────────────────

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      fontFamily: 'var(--font-geist, ui-sans-serif)',
    }}>

      {/* ── Header ── */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 24px', height: 52,
        borderBottom: '1px solid var(--border)',
      }}>
        {/* Back button */}
        <Link
          href="/prompt-library"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 6,
            border: '1px solid var(--border)', background: 'transparent',
            textDecoration: 'none', color: 'var(--text-muted)',
            transition: 'background 120ms', flexShrink: 0,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.6">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>

        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <span style={{
            fontSize: 15, fontWeight: 500, color: 'var(--text)',
            letterSpacing: '-0.005em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {prompt_version.name}
          </span>
          <span style={{
            fontFamily: 'var(--font-geist-mono, monospace)',
            fontSize: 10.5, padding: '2px 7px', borderRadius: 999,
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            color: 'var(--primary)', flexShrink: 0,
          }}>
            v{prompt_version.version}
          </span>
        </div>

        {/* Unstar button */}
        <button
          type="button"
          onClick={handleUnstar}
          disabled={unlikeMutation.isPending}
          style={{
            height: 28, padding: '0 12px', borderRadius: 6,
            border: '1px solid var(--danger-soft)',
            background: 'transparent', fontSize: 12, color: 'var(--danger)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'var(--font-geist, ui-sans-serif)',
            opacity: unlikeMutation.isPending ? 0.5 : 1, flexShrink: 0,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24"
            fill="var(--danger)" stroke="var(--danger)" strokeWidth="1.5">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          Unstar
        </button>
      </div>

      {/* ── Split panel ── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

        {/* Left: prompt content */}
        <div style={{
          flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
          borderRight: '1px solid var(--border)', overflow: 'hidden',
        }}>
          {/* Copy button row */}
          <div style={{
            flexShrink: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'flex-end', padding: '0 16px', height: 44,
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
          }}>
            <button
              type="button"
              onClick={handleCopy}
              style={{
                height: 28, padding: '0 12px', borderRadius: 6,
                border: '1px solid var(--border)', background: 'transparent',
                fontSize: 12, color: copied ? 'var(--accent)' : 'var(--text-muted)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                fontFamily: 'var(--font-geist, ui-sans-serif)',
                transition: 'color 120ms',
              }}
            >
              {copied ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="1.6">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="1.6">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copy
                </>
              )}
            </button>
          </div>

          {/* Prompt content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
            <pre style={{
              fontFamily: 'var(--font-geist-mono, monospace)',
              fontSize: 13, lineHeight: 1.8, color: 'var(--text)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
            }}>
              {prompt_version.content}
            </pre>
          </div>
        </div>

        {/* Right: edit panel */}
        <div style={{
          width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column',
          overflowY: 'auto', padding: '20px 20px 32px', gap: 20,
        }}>

          {/* Note */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{
              fontSize: 11, fontWeight: 500, color: 'var(--text-subtle)',
              textTransform: 'uppercase', letterSpacing: '0.08em',
            }}>
              Note
            </label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Add a note…"
              rows={4}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 6,
                border: '1px solid var(--border)', background: 'var(--surface)',
                color: 'var(--text)', fontSize: 13,
                fontFamily: 'var(--font-geist, ui-sans-serif)',
                lineHeight: 1.55, resize: 'vertical', outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'rgba(124,92,255,0.5)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
          </div>

          {/* Tags */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{
              fontSize: 11, fontWeight: 500, color: 'var(--text-subtle)',
              textTransform: 'uppercase', letterSpacing: '0.08em',
            }}>
              Tags
            </label>

            {tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
                {tags.map(tag => (
                  <span key={tag} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontFamily: 'var(--font-geist-mono, monospace)',
                    fontSize: 11, padding: '2px 8px', borderRadius: 4,
                    background: 'var(--primary-soft)', border: '1px solid rgba(124,92,255,0.2)',
                    color: 'var(--primary)',
                  }}>
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'none', border: 'none', padding: 0, marginLeft: 2,
                        cursor: 'pointer', color: 'var(--primary)', lineHeight: 1, fontSize: 13,
                      }}
                      aria-label={`Remove tag ${tag}`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}

            <input
              type="text"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder="Add tag, press Enter…"
              maxLength={30}
              style={{
                width: '100%', height: 32, padding: '0 10px', borderRadius: 6,
                border: '1px solid var(--border)', background: 'var(--surface)',
                color: 'var(--text)', fontSize: 12,
                fontFamily: 'var(--font-geist, ui-sans-serif)',
                outline: 'none', boxSizing: 'border-box',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'rgba(124,92,255,0.5)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
            <span style={{
              fontSize: 10.5, color: 'var(--text-subtle)',
              fontFamily: 'var(--font-geist-mono, monospace)',
            }}>
              {tags.length}/10 tags
            </span>
          </div>

          {/* Category */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{
              fontSize: 11, fontWeight: 500, color: 'var(--text-subtle)',
              textTransform: 'uppercase', letterSpacing: '0.08em',
            }}>
              Category
            </label>
            <div style={{ position: 'relative' }}>
              <select
                value={category}
                onChange={e => setCategory(e.target.value as FavoriteCategory)}
                style={{
                  width: '100%', height: 34, padding: '0 28px 0 10px', borderRadius: 6,
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  color: 'var(--text-muted)', fontSize: 12,
                  fontFamily: 'var(--font-geist, ui-sans-serif)',
                  cursor: 'pointer', outline: 'none',
                  appearance: 'none', WebkitAppearance: 'none',
                  boxSizing: 'border-box',
                }}
              >
                {CATEGORY_OPTIONS.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <svg style={{
                position: 'absolute', right: 8, top: '50%',
                transform: 'translateY(-50%)', pointerEvents: 'none',
              }} width="10" height="10" viewBox="0 0 24 24" fill="none"
                stroke="var(--text-subtle)" strokeWidth="2.5">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </div>
          </div>

          {/* Pin toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              id="is-pinned"
              checked={isPinned}
              onChange={e => setIsPinned(e.target.checked)}
              style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#7c5cff' }}
            />
            <label htmlFor="is-pinned" style={{
              fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none',
            }}>
              Pin to top
            </label>
          </div>

          {/* Save button */}
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            style={{
              width: '100%', height: 36, borderRadius: 6,
              background: 'var(--primary)', border: '1px solid var(--primary)',
              color: '#fff', fontSize: 13, fontWeight: 500,
              fontFamily: 'var(--font-geist, ui-sans-serif)',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              opacity: isSaving ? 0.6 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'opacity 120ms',
            }}
          >
            {isSaving ? (
              <>
                <Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} />
                Saving…
              </>
            ) : (
              'Save changes'
            )}
          </button>

          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border)' }} />

          {/* Usage stats */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              {
                label: 'Use count',
                value: String(data.use_count),
                valueColor: 'var(--text)',
              },
              {
                label: 'Last used',
                value: data.last_used_at
                  ? formatDistanceToNow(new Date(data.last_used_at), { addSuffix: true })
                  : 'Never',
                valueColor: data.last_used_at ? 'var(--text-muted)' : 'var(--text-subtle)',
              },
              {
                label: 'Liked',
                value: formatDistanceToNow(new Date(data.liked_at), { addSuffix: true }),
                valueColor: 'var(--text-muted)',
              },
            ].map(row => (
              <div key={row.label} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span style={{
                  fontSize: 11, color: 'var(--text-subtle)',
                  fontFamily: 'var(--font-geist-mono, monospace)',
                }}>
                  {row.label}
                </span>
                <span style={{
                  fontSize: 12, color: row.valueColor,
                  fontFamily: 'var(--font-geist-mono, monospace)', fontWeight: 500,
                }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
