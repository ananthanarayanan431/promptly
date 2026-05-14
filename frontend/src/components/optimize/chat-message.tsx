'use client';

import { useState } from 'react';

import { LoadingWords } from './loading-words';
import { formatApiErrorDetail } from '@/lib/api-errors';
import type { ChatTurn, JobProgressEvent } from '@/types/api';
import { JobProgress } from './job-progress';

const USER_BUBBLE_COLLAPSE_CHARS = 420;
const USER_BUBBLE_COLLAPSE_LINES = 6;

function UserBubble({ text, isFeedback }: { text: string; isFeedback: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = text.split('\n').length;
  const isLong = !isFeedback && (text.length > USER_BUBBLE_COLLAPSE_CHARS || lineCount > USER_BUBBLE_COLLAPSE_LINES);
  // line-height 1.6 × font-size 13.5 × 6 lines ≈ 130px
  const collapsedHeight = 130;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      {/* YOU / FEEDBACK label */}
      <span style={{
        fontFamily: 'var(--mono)',
        fontSize: 10.5,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: isFeedback ? 'var(--primary)' : 'var(--text-subtle)',
        paddingRight: 2,
      }}>
        {isFeedback ? 'Feedback' : 'YOU'}
      </span>

      {/* Bubble + toggle */}
      <div style={{ maxWidth: '85%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0 }}>
        {/* Bubble */}
        <div style={{
          position: 'relative',
          background: 'var(--surface-2)',
          border: isFeedback ? '1px solid rgba(124,92,255,0.35)' : '1px solid var(--border)',
          borderRadius: isLong && !expanded ? '14px 14px 0 14px' : 14,
          padding: '12px 16px',
          fontSize: 13.5,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          fontFamily: 'var(--mono)',
          color: 'var(--text)',
          overflow: 'hidden',
          maxHeight: isLong && !expanded ? collapsedHeight : undefined,
          transition: 'max-height 0.2s ease, border-radius 0.15s',
        }}>
          {text}
          {/* Fade-out gradient at bottom when collapsed */}
          {isLong && !expanded && (
            <div style={{
              position: 'absolute',
              bottom: 0, left: 0, right: 0,
              height: 40,
              background: 'linear-gradient(to bottom, transparent, var(--surface-2))',
              pointerEvents: 'none',
            }} />
          )}
        </div>

        {/* Toggle pill — only shown for long text */}
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 12px',
              borderRadius: '0 0 10px 10px',
              border: isFeedback ? '1px solid rgba(124,92,255,0.35)' : '1px solid var(--border)',
              borderTop: 'none',
              background: 'var(--surface)',
              color: 'var(--primary)',
              fontSize: 11.5,
              fontFamily: 'var(--mono)',
              fontWeight: 500,
              cursor: 'pointer',
              alignSelf: 'flex-end',
            }}
          >
            {expanded ? (
              <>
                Show less
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'rotate(-90deg)' }}>
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </>
            ) : (
              <>
                Show full ({lineCount} lines, {text.length} chars)
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'rotate(90deg)' }}>
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}


// Compute sections count from markdown headers
function countSections(text: string): number {
  return (text.match(/\n#/g) ?? []).length;
}

// Compute approximate token estimate (rough: 1 token ≈ 4 chars)
function estimateTokens(text: string): number {
  return Math.round(text.length / 4);
}

interface AssistantResultProps {
  turn: ChatTurn;
  isTurnSelected: boolean;
  onSelectTurn: () => void;
  progress?: JobProgressEvent[];
  onRetry?: () => void;
}

function AssistantResult({ turn, isTurnSelected, onSelectTurn, progress, onRetry }: AssistantResultProps) {

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
              <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
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

  // Metadata
  const wordCount = raw.trim().split(/\s+/).filter(Boolean).length;
  const lineCount = raw.split('\n').length;
  const tokenEst = estimateTokens(raw);
  const sectionCount = countSections(raw);
  const metaStr = [
    `${lineCount} lines`,
    `${wordCount} words`,
    `~${tokenEst} tokens`,
    sectionCount > 0 ? `${sectionCount} sections` : null,
  ].filter(Boolean).join(' · ');

  // Teaser: first non-empty line of the optimized prompt
  const teaserLine = raw.split('\n').find(l => l.trim().length > 0) ?? '';
  const teaser = teaserLine.length > 80 ? teaserLine.slice(0, 80).trimEnd() + '…' : teaserLine;

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <PromptlyIcon />
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* ── Artifact card ── */}
        <div
          role="button"
          tabIndex={0}
          onClick={onSelectTurn}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectTurn(); } }}
          style={{
            display: 'grid',
            gridTemplateColumns: '46px 1fr auto',
            gap: 14,
            alignItems: 'center',
            padding: '12px 14px',
            borderRadius: 14,
            background: isTurnSelected ? 'var(--primary-soft)' : 'var(--surface)',
            border: isTurnSelected ? '1.5px solid var(--primary)' : '1px solid var(--border)',
            boxShadow: isTurnSelected ? '0 0 0 4px var(--primary-ring)' : 'var(--shadow-sm)',
            cursor: 'pointer',
            outline: 'none',
            transition: 'border-color 150ms, box-shadow 150ms, background 150ms',
          }}
          onMouseEnter={e => {
            if (!isTurnSelected) {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--text-subtle)';
            }
          }}
          onMouseLeave={e => {
            if (!isTurnSelected) {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
            }
          }}
        >
          {/* Document icon with MD badge */}
          <div style={{ position: 'relative', width: 46, height: 52, flexShrink: 0 }}>
            <div style={{
              width: 46, height: 52, borderRadius: 9,
              background: isTurnSelected
                ? 'linear-gradient(135deg, var(--primary), var(--accent))'
                : 'var(--surface-2)',
              color: isTurnSelected ? 'white' : 'var(--text-muted)',
              border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {/* File text icon */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            {/* MD badge — bottom right */}
            <div style={{
              position: 'absolute', bottom: 0, right: -2,
              fontSize: 8.5, fontWeight: 700,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              padding: '1px 4px',
              borderRadius: 4,
              fontFamily: 'var(--mono)',
              lineHeight: 1.3,
              color: 'var(--text-muted)',
            }}>
              MD
            </div>
          </div>

          {/* Text content */}
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* Row 1: title + ready badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>
                {result.already_optimized ? 'Already optimized' : 'Optimized prompt'}
              </span>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 8px', borderRadius: 999,
                background: 'var(--success-soft)',
                color: 'var(--success)',
                fontSize: 11, fontWeight: 600,
                border: 'none',
              }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
                ready
              </span>
            </div>

            {/* Row 2: teaser line */}
            <p style={{
              margin: 0,
              fontSize: 11.5,
              color: 'var(--text-muted)',
              fontFamily: 'var(--mono)',
              lineHeight: 1.4,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {teaser}
            </p>

            {/* Row 3: meta */}
            <p style={{
              margin: 0,
              fontSize: 10.5,
              color: 'var(--text-subtle)',
              fontFamily: 'var(--mono)',
              lineHeight: 1,
            }}>
              {metaStr}
            </p>
          </div>

          {/* View → button */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelectTurn(); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '7px 11px', borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              fontSize: 12, fontWeight: 500,
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              flexShrink: 0,
              transition: 'border-color 100ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-subtle)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
          >
            View →
          </button>
        </div>

        {/* Always-visible hint */}
        <p style={{
          margin: '6px 0 0', fontSize: 11, color: 'var(--text-subtle)',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4M12 8h.01"/>
          </svg>
          Click the card to view the full prompt
        </p>
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
