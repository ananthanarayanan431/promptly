'use client';

import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  type Category,
} from '@/hooks/use-categories';

const STORAGE_KEY = 'promptly:selected-category-slug';

interface CategoryPickerProps {
  selectedSlug: string;
  onChange: (slug: string) => void;
}

export function CategoryPicker({ selectedSlug, onChange }: CategoryPickerProps) {
  const { data: categories = [], isLoading } = useCategories();
  const createMutation = useCreateCategory();
  const deleteMutation = useDeleteCategory();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = categories.find(c => c.slug === selectedSlug);
  const selectedLabel = selected?.name ?? 'General';

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setAdding(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = (slug: string) => {
    onChange(slug);
    try {
      localStorage.setItem(STORAGE_KEY, slug);
    } catch {
      // ignore — localStorage may be disabled
    }
    setOpen(false);
    setAdding(false);
  };

  const handleAdd = async () => {
    const name = newName.trim();
    const description = newDescription.trim();
    if (!name || !description) {
      toast.error('Name and description are required');
      return;
    }
    try {
      const cat = await createMutation.mutateAsync({ name, description });
      toast.success(`Added "${cat.name}"`);
      handleSelect(cat.slug);
      setNewName('');
      setNewDescription('');
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Failed to add category';
      toast.error(typeof detail === 'string' ? detail : 'Failed to add category');
    }
  };

  const handleDelete = async (cat: Category, e: React.MouseEvent) => {
    e.stopPropagation();
    if (cat.is_predefined) return;
    if (!window.confirm(`Delete "${cat.name}"?`)) return;
    try {
      await deleteMutation.mutateAsync(cat.slug);
      toast.success(`Deleted "${cat.name}"`);
      if (selectedSlug === cat.slug) {
        handleSelect('general');
      }
    } catch {
      toast.error('Failed to delete category');
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Choose a prompt category"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          height: 26,
          padding: '0 10px',
          borderRadius: 999,
          fontSize: 11.5,
          fontWeight: 500,
          cursor: 'pointer',
          border: '1px solid rgba(124,92,255,0.3)',
          background: 'rgba(124,92,255,0.08)',
          color: '#7c5cff',
          fontFamily: 'inherit',
          transition: 'all 120ms',
          maxWidth: 180,
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 6h18M6 12h12M10 18h4" />
        </svg>
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {isLoading ? 'Loading…' : selectedLabel}
        </span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            zIndex: 40,
            width: 320,
            maxHeight: 380,
            overflowY: 'auto',
            background: '#141414',
            border: '1px solid #2a2a2e',
            borderRadius: 10,
            boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
            fontFamily: 'var(--font-geist, ui-sans-serif)',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '10px 14px 6px',
              fontFamily: 'var(--font-geist-mono, monospace)',
              fontSize: 10.5,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              color: '#5a5a60',
            }}
          >
            Prompt category
          </div>

          {/* List */}
          <div style={{ display: 'flex', flexDirection: 'column' }} role="listbox">
            {categories.map(cat => {
              const isSelected = cat.slug === selectedSlug;
              return (
                <div
                  key={cat.slug}
                  style={{
                    position: 'relative',
                    background: isSelected ? 'rgba(124,92,255,0.10)' : 'transparent',
                    borderLeft: isSelected
                      ? '2px solid #7c5cff'
                      : '2px solid transparent',
                    transition: 'background 120ms',
                  }}
                  onMouseEnter={e => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.025)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(cat.slug)}
                    onKeyDown={e => {
                      if (e.key === 'Escape') {
                        setOpen(false);
                        setAdding(false);
                      }
                    }}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      textAlign: 'left',
                      gap: 2,
                      padding: '8px 14px',
                      paddingRight: !cat.is_predefined ? 36 : 14,
                      cursor: 'pointer',
                      background: 'transparent',
                      border: 'none',
                      fontFamily: 'inherit',
                      color: 'inherit',
                      width: '100%',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12.5,
                        fontWeight: 500,
                        color: isSelected ? '#c4b5fd' : '#ededed',
                      }}
                    >
                      {cat.name}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: '#7a7a82',
                        lineHeight: 1.45,
                      }}
                    >
                      {cat.description}
                    </span>
                  </button>
                  {!cat.is_predefined && (
                    <button
                      type="button"
                      onClick={e => handleDelete(cat, e)}
                      title="Delete custom category"
                      style={{
                        position: 'absolute',
                        top: 8,
                        right: 10,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#5a5a60',
                        padding: 2,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#f43f5e')}
                      onMouseLeave={e => (e.currentTarget.style.color = '#5a5a60')}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add new — divider + form */}
          <div
            style={{
              borderTop: '1px solid #1f1f23',
              padding: '8px 14px 12px',
              marginTop: 4,
            }}
          >
            {!adding ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: '#7c5cff',
                  padding: 0,
                  fontFamily: 'inherit',
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add category
              </button>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Name (e.g. RAG QA)"
                  maxLength={60}
                  autoFocus
                  style={{
                    height: 30,
                    padding: '0 10px',
                    borderRadius: 6,
                    border: '1px solid #2a2a2e',
                    background: '#0e0e10',
                    color: '#ededed',
                    fontSize: 12,
                    outline: 'none',
                    fontFamily: 'inherit',
                  }}
                />
                <textarea
                  value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                  placeholder="One-line meaning — what does this category cover?"
                  rows={3}
                  maxLength={500}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid #2a2a2e',
                    background: '#0e0e10',
                    color: '#ededed',
                    fontSize: 12,
                    outline: 'none',
                    resize: 'vertical',
                    minHeight: 60,
                    fontFamily: 'inherit',
                    lineHeight: 1.5,
                  }}
                />
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false);
                      setNewName('');
                      setNewDescription('');
                    }}
                    style={{
                      height: 28,
                      padding: '0 12px',
                      borderRadius: 6,
                      border: '1px solid #2a2a2e',
                      background: 'transparent',
                      color: '#8a8a90',
                      fontSize: 11.5,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={createMutation.isPending}
                    style={{
                      height: 28,
                      padding: '0 12px',
                      borderRadius: 6,
                      border: '1px solid #7c5cff',
                      background: '#7c5cff',
                      color: '#fff',
                      fontSize: 11.5,
                      cursor: createMutation.isPending ? 'not-allowed' : 'pointer',
                      opacity: createMutation.isPending ? 0.6 : 1,
                      fontFamily: 'inherit',
                    }}
                  >
                    {createMutation.isPending ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function loadStoredCategorySlug(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? 'general';
  } catch {
    return 'general';
  }
}
