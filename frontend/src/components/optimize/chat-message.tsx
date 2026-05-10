'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { LoadingWords } from './loading-words';
import { formatApiErrorDetail } from '@/lib/api-errors';
import type { ChatTurn, JobProgressEvent } from '@/types/api';
import { JobProgress } from './job-progress';

const USER_BUBBLE_COLLAPSE_CHARS = 280;

function UserBubble({ text, isFeedback }: { text: string; isFeedback: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = !isFeedback && text.length > USER_BUBBLE_COLLAPSE_CHARS;

  if (isLong && !expanded) {
    const preview = text.slice(0, 160).trimEnd();
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={() => setExpanded(true)}
          style={{
            maxWidth: 320, textAlign: 'left', cursor: 'pointer',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '10px 13px', display: 'flex', flexDirection: 'column', gap: 7,
          }}
        >
          <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.55, color: 'var(--text-muted)',
            fontFamily: 'var(--font-geist-mono, monospace)', whiteSpace: 'pre-wrap',
            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical' }}>
            {preview}…
          </p>
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 9.5,
            fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
            color: 'var(--text-subtle)', background: 'var(--surface-2)',
            border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', alignSelf: 'flex-start' }}>
            PASTED
          </span>
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ maxWidth: '75%', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
        <p style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.12em', color: isFeedback ? 'var(--primary)' : 'var(--text-subtle)',
          paddingRight: 4 }}>
          {isFeedback ? 'Feedback' : 'You'}
        </p>
        <div style={{ borderRadius: '14px 14px 4px 14px', padding: '10px 14px', fontSize: 13.5,
          lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: 'var(--font-geist, ui-sans-serif)',
          background: isFeedback ? 'var(--primary)' : 'var(--surface-3)',
          color: isFeedback ? '#fff' : 'var(--text)' }}>
          {text}
        </div>
      </div>
    </div>
  );
}

const PREVIEW_MAX_CHARS = 360;

interface AssistantResultProps {
  turn: ChatTurn;
  isTurnSelected: boolean;
  onSelectTurn: () => void;
  progress?: JobProgressEvent[];
  onRetry?: () => void;
}

function AssistantResult({ turn, isTurnSelected, onSelectTurn, progress, onRetry }: AssistantResultProps) {
  const [copied, setCopied] = useState(false);

  if (turn.status === 'loading') {
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <PromptlyIcon />
        <div style={{ flex: 1, background: 'var(--surface)', borderRadius: '4px 14px 14px 14px',
          border: '1px solid var(--border)', padding: '14px 16px' }}>
          {progress && progress.length > 0 ? (
            <JobProgress progress={progress} />
          ) : (
            <LoadingWords />
          )}
        </div>
      </div>
    );
  }

  if (turn.status === 'failed') {
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <PromptlyIcon />
        <div style={{ borderRadius: '4px 14px 14px 14px', border: '1px solid rgba(255,107,122,0.3)',
          background: 'var(--danger-soft)', padding: '12px 16px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="1.7"
              style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
            </svg>
            <div>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--danger)', marginBottom: 3 }}>
                Optimization failed
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-geist-mono, monospace)' }}>
                {formatApiErrorDetail(turn.error, 'Something went wrong. Please try again.')}
              </p>
            </div>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 500,
                border: '1px solid rgba(255,107,122,0.35)', background: 'var(--danger-soft)',
                color: 'var(--danger)', cursor: 'pointer', fontFamily: 'inherit',
                transition: 'background 150ms, border-color 150ms' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,107,122,0.15)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--danger-soft)'; }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
              </svg>
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!turn.result) return null;

  const { result } = turn;
  const raw = result.optimized_prompt;
  const isLong = raw.length > PREVIEW_MAX_CHARS;
  const previewText = isLong ? `${raw.slice(0, PREVIEW_MAX_CHARS).trimEnd()}…` : raw;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      toast.success('Copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <PromptlyIcon />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div role="button" tabIndex={0} onClick={onSelectTurn}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectTurn(); } }}
          style={{ borderRadius: '4px 14px 14px 14px', background: 'var(--surface)',
            border: `1px solid ${isTurnSelected ? 'rgba(124,92,255,0.5)' : 'var(--border)'}`,
            boxShadow: isTurnSelected ? '0 0 0 2px rgba(124,92,255,0.15)' : 'none',
            cursor: 'pointer', overflow: 'hidden', transition: 'border-color 150ms, box-shadow 150ms',
            outline: 'none' }}>
          {/* Header strip */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 14px', borderBottom: '1px solid var(--border)',
            background: result.already_optimized ? 'rgba(34,197,94,0.04)' : 'rgba(124,92,255,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.8">
                <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 00-4.4-4.4A5.21 5.21 0 0012 3z"/>
              </svg>
              <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10,
                fontWeight: 600, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Promptly
              </span>
              {result.already_optimized && (
                <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10,
                  fontWeight: 600, padding: '1px 7px', borderRadius: 999,
                  background: 'rgba(34,197,94,0.15)', color: '#22c55e',
                  display: 'flex', alignItems: 'center', gap: 4, border: '1px solid rgba(34,197,94,0.3)' }}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                  Already optimized
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {result.version && (
                <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10,
                  fontWeight: 600, padding: '1px 7px', borderRadius: 999,
                  background: 'rgba(124,92,255,0.12)', color: 'var(--primary)',
                  display: 'flex', alignItems: 'center', gap: 4 }}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
                    <path d="M18 9a9 9 0 01-9 9"/>
                  </svg>
                  v{result.version}
                </span>
              )}
              {result.token_usage?.total_tokens ? (
                <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10, color: 'var(--text-subtle)' }}>
                  {result.token_usage.total_tokens.toLocaleString()} tokens
                </span>
              ) : null}
            </div>
          </div>

          {/* Content */}
          <div style={{ padding: '12px 14px' }}>
            <p style={{ fontSize: 13.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--text)',
              fontFamily: 'var(--font-geist, ui-sans-serif)', margin: 0 }}>{previewText}</p>
            {isLong && (
              <p style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8,
                fontSize: 11.5, color: 'var(--primary)', fontWeight: 500 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12h6M12 9v6"/>
                </svg>
                Click to open full result in the side panel
              </p>
            )}
          </div>

          {/* Action row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px',
            borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}
            onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <button type="button" onClick={handleCopy}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
                borderRadius: 6, fontSize: 12, border: 'none', background: 'transparent',
                cursor: 'pointer', color: 'var(--text-muted)', fontFamily: 'inherit',
                transition: 'color 100ms, background 100ms' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.background = 'var(--surface-3)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}>
              {copied ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                  </svg>
                  Copy
                </>
              )}
            </button>
            {!isLong && (
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-geist-mono, monospace)',
                fontSize: 10.5, color: 'var(--text-subtle)', fontStyle: 'italic' }}>
                Click card to open side panel
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PromptlyIcon() {
  return (
    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--primary)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2,
      boxShadow: '0 1px 0 rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.15)' }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8">
        <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 00-4.4-4.4A5.21 5.21 0 0012 3z"/>
      </svg>
    </div>
  );
}

interface ChatMessageProps {
  turn: ChatTurn;
  isTurnSelected: boolean;
  onSelectTurn: () => void;
  progress?: JobProgressEvent[];
  onRetry?: () => void;
}

export function ChatMessage({ turn, isTurnSelected, onSelectTurn, progress, onRetry }: ChatMessageProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <UserBubble text={turn.userText} isFeedback={turn.isFeedback} />
      <AssistantResult
        turn={turn}
        isTurnSelected={isTurnSelected}
        onSelectTurn={onSelectTurn}
        progress={progress}
        onRetry={onRetry}
      />
    </div>
  );
}
