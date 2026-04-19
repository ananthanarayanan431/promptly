'use client';

import { useState, useRef, useEffect } from 'react';
import { api } from '@/lib/api';

interface ChatInputProps {
  onSubmit: (text: string, name?: string) => void;
  isLoading: boolean;
  hasPreviousTurns: boolean;
  defaultValue?: string;
  defaultName?: string;
  autoFocus?: boolean;
}

export function ChatInput({
  onSubmit,
  isLoading,
  hasPreviousTurns,
  defaultValue = '',
  defaultName = '',
  autoFocus = false,
}: ChatInputProps) {
  const [text, setText] = useState(defaultValue);
  const [versionName, setVersionName] = useState(defaultName);
  const [versioning, setVersioning] = useState(!!defaultName);
  const [nameLoading, setNameLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (defaultValue) setText(defaultValue);
  }, [defaultValue]);

  useEffect(() => {
    if (defaultName) { setVersionName(defaultName); setVersioning(true); }
  }, [defaultName]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 300)}px`;
  }, [text]);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    onSubmit(trimmed, versioning ? (versionName.trim() || undefined) : undefined);
    if (hasPreviousTurns) setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const toggleVersioning = async () => {
    if (versioning) {
      setVersioning(false);
      setVersionName('');
      return;
    }

    setVersioning(true);
    const trimmed = text.trim();
    if (!trimmed) return;

    setNameLoading(true);
    try {
      const res = await api.post<{ data: { name: string } }>('/api/v1/chat/suggest-name', { prompt: trimmed });
      setVersionName(res.data.data.name);
    } catch {
      // user can type their own name
    } finally {
      setNameLoading(false);
    }
  };

  const canSubmit = !!text.trim() && !isLoading;

  return (
    <div style={{ width: '100%', fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
      {versioning && (
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px',
            borderRadius: 999, background: 'rgba(124,92,255,0.08)', border: '1px solid rgba(124,92,255,0.25)' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#7c5cff" strokeWidth="1.8">
              <path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
              <path d="M18 9a9 9 0 01-9 9"/>
            </svg>
            {nameLoading ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#7c5cff" strokeWidth="1.8"
                style={{ animation: 'spin 1s linear infinite' }}>
                <path d="M21 12a9 9 0 11-6.219-8.56"/>
              </svg>
            ) : (
              <input value={versionName} onChange={(e) => setVersionName(e.target.value)}
                placeholder="VERSION NAME"
                style={{ background: 'transparent', fontSize: 11, fontWeight: 600,
                  letterSpacing: '0.06em', color: '#7c5cff', outline: 'none', border: 'none',
                  width: 140, fontFamily: 'var(--font-geist-mono, monospace)' }} />
            )}
            <button onClick={() => { setVersioning(false); setVersionName(''); }}
              style={{ marginLeft: 2, background: 'none', border: 'none', cursor: 'pointer',
                color: 'rgba(124,92,255,0.5)', padding: 0, display: 'flex' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, color: '#5a5a60' }}>
            Result will be saved as a versioned prompt
          </span>
        </div>
      )}

      <div style={{ position: 'relative', borderRadius: 12,
        border: `1px solid ${focused ? 'rgba(124,92,255,0.5)' : '#2a2a2e'}`,
        background: '#1a1a1a',
        boxShadow: focused ? '0 0 0 3px rgba(124,92,255,0.1)' : 'none',
        transition: 'border-color 150ms, box-shadow 150ms' }}>
        <textarea ref={textareaRef} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          placeholder={hasPreviousTurns ? 'Give feedback to refine the result...' : 'Paste your prompt here to optimize...'}
          disabled={isLoading} autoFocus={autoFocus} rows={1}
          style={{ width: '100%', resize: 'none', background: 'transparent',
            padding: hasPreviousTurns ? '14px 16px 44px' : '16px 16px 44px',
            minHeight: hasPreviousTurns ? 56 : 128,
            fontSize: 14, lineHeight: 1.6, color: '#ededed', outline: 'none', border: 'none',
            fontFamily: 'inherit', boxSizing: 'border-box',
            opacity: isLoading ? 0.5 : 1 }} />

        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 10px 10px' }}>
          <button type="button" onClick={toggleVersioning}
            title={versioning ? 'Stop versioning' : 'Save as version'}
            style={{ display: 'flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px',
              borderRadius: 999, fontSize: 11.5, fontWeight: 500, cursor: 'pointer',
              border: versioning ? '1px solid rgba(124,92,255,0.3)' : '1px solid transparent',
              background: versioning ? 'rgba(124,92,255,0.08)' : 'transparent',
              color: versioning ? '#7c5cff' : '#5a5a60',
              fontFamily: 'inherit', transition: 'all 120ms' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
              <path d="M18 9a9 9 0 01-9 9"/>
            </svg>
            {versioning ? 'Versioning on' : 'Version'}
          </button>

          <button type="button" onClick={handleSubmit} disabled={!canSubmit}
            style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: canSubmit ? 'pointer' : 'not-allowed',
              background: canSubmit ? '#7c5cff' : '#222226',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: canSubmit ? '#fff' : '#5a5a60',
              transition: 'background 120ms, transform 120ms',
              transform: canSubmit ? 'scale(1)' : 'scale(0.95)' }}>
            {isLoading ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                style={{ animation: 'spin 1s linear infinite' }}>
                <path d="M21 12a9 9 0 11-6.219-8.56"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 19V5M5 12l7-7 7 7"/>
              </svg>
            )}
          </button>
        </div>
      </div>

      {!hasPreviousTurns && (
        <p style={{ marginTop: 8, textAlign: 'center', fontFamily: 'var(--font-geist-mono, monospace)',
          fontSize: 11, color: '#3a3a40' }}>
          Enter to optimize · Shift+Enter for new line · 10 credits per run
        </p>
      )}
    </div>
  );
}
