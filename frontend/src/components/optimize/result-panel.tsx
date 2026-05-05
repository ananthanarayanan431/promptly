'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { X, Copy, CheckCheck, ChevronDown, ChevronUp, Sparkles, GitBranch, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { buttonVariants } from '@/components/ui/button';
import type { JobResult } from '@/types/api';
import { LikeButton } from '@/components/optimize/like-button';
import { useFavoriteStatus } from '@/hooks/use-favorites';

const DIMENSION_LABELS: Record<string, string> = {
  role_persona: 'Role / Persona',
  goal_clarity: 'Goal Clarity',
  context_grounding: 'Context Grounding',
  output_format: 'Output Format',
  examples_exemplars: 'Examples / Exemplars',
  constraints_guardrails: 'Constraints',
  tone_audience: 'Tone & Audience',
  conciseness: 'Conciseness',
};

const DIMENSION_ORDER = Object.keys(DIMENSION_LABELS);

function ScoreDot({ score }: { score: string }) {
  const color =
    score === 'strong' ? '#22c55e' :
    score === 'weak' ? '#f59e0b' :
    '#ef4444';
  const label =
    score === 'strong' ? 'Strong' :
    score === 'weak' ? 'Weak' :
    'Missing';
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color,
        display: 'inline-block', flexShrink: 0 }} />
      <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
        color, fontWeight: 600 }}>{label}</span>
    </span>
  );
}

function DimensionBreakdown({ scores, rationale }: {
  scores: Record<string, string>;
  rationale?: string | null;
}) {
  return (
    <div style={{ borderRadius: 10, border: '1px solid rgba(34,197,94,0.2)',
      background: 'rgba(34,197,94,0.04)', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(34,197,94,0.15)',
        display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
          <path d="M20 6L9 17l-5-5"/>
        </svg>
        <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10,
          fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          Quality breakdown
        </span>
      </div>
      <div style={{ padding: '8px 0' }}>
        {DIMENSION_ORDER.map((key) => {
          const score = scores[key] ?? 'missing';
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', padding: '5px 14px' }}>
              <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
                color: '#8a8a90', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {DIMENSION_LABELS[key]}
              </span>
              <ScoreDot score={score} />
            </div>
          );
        })}
      </div>
      {rationale && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(34,197,94,0.15)',
          fontFamily: 'var(--font-geist, ui-sans-serif)', fontSize: 12,
          color: '#8a8a90', fontStyle: 'italic', lineHeight: 1.6 }}>
          {rationale}
        </div>
      )}
    </div>
  );
}

interface ResultPanelProps {
  result: JobResult;
  onClose: () => void;
  onForceOptimize?: () => void;
}

export function ResultPanel({ result, onClose, onForceOptimize }: ResultPanelProps) {
  const [copied, setCopied] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  const isAlreadyOptimized = Boolean(result.already_optimized);

  // Query the real favorite status from the backend so the heart reflects
  // the true state even when switching between result panel versions.
  const { data: statusData } = useFavoriteStatus(result.prompt_version_id ?? null);
  const [isFavorited, setIsFavorited] = useState(false);
  const [favoriteId, setFavoriteId] = useState<string | null>(null);

  // Sync local state whenever the backend status resolves or the version changes
  useEffect(() => {
    if (statusData) {
      setIsFavorited(statusData.is_favorited);
      setFavoriteId(statusData.prompt_store_id ?? null);
    }
  }, [statusData]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.optimized_prompt);
      setCopied(true);
      toast.success('Copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 w-full max-w-[min(100vw,440px)] lg:max-w-none lg:w-full shrink-0 border-l border-border bg-card">
      {/* Header */}
      <div
        className="shrink-0 px-5 py-4"
        style={{ background: isAlreadyOptimized ? 'rgba(34,197,94,0.12)' : 'hsl(var(--primary))' }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="h-7 w-7 rounded-full flex items-center justify-center shrink-0"
              style={{ background: isAlreadyOptimized ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.2)' }}
            >
              {isAlreadyOptimized ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-primary-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <p
                className="text-sm font-semibold truncate"
                style={{ color: isAlreadyOptimized ? '#22c55e' : 'hsl(var(--primary-foreground))' }}
              >
                {isAlreadyOptimized ? 'Already optimized' : 'Optimized prompt'}
              </p>
              {result.token_usage?.total_tokens ? (
                <p
                  className="text-[11px] mt-0.5"
                  style={{ color: isAlreadyOptimized ? 'rgba(34,197,94,0.7)' : 'hsl(var(--primary-foreground) / 0.6)' }}
                >
                  {result.token_usage.total_tokens.toLocaleString()} tokens
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {result.version && (
              <div
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  background: isAlreadyOptimized ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.15)',
                  color: isAlreadyOptimized ? '#22c55e' : 'hsl(var(--primary-foreground))',
                }}
              >
                <GitBranch className="h-2.5 w-2.5" />
                v{result.version}
              </div>
            )}
            <LikeButton
              promptVersionId={result.prompt_version_id ?? ''}
              isFavorited={isFavorited}
              favoriteId={favoriteId}
              size="sm"
              disabled={!result.prompt_version_id}
              onToggled={(nowFavorited, newFavoriteId) => {
                setIsFavorited(nowFavorited);
                setFavoriteId(newFavoriteId);
              }}
            />
            <button
              type="button"
              onClick={onClose}
              className="h-7 w-7 flex items-center justify-center rounded-md transition-colors"
              style={{
                color: isAlreadyOptimized ? 'rgba(34,197,94,0.7)' : 'hsl(var(--primary-foreground) / 0.7)',
              }}
              aria-label="Close panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-5">
        {/* Already-optimized message */}
        {isAlreadyOptimized && (
          <p className="text-sm text-muted-foreground">
            Your prompt is already in great shape — no changes made.
          </p>
        )}

        {/* The prompt text (original when already_optimized, optimized otherwise) */}
        <p className="text-sm leading-7 whitespace-pre-wrap text-foreground">{result.optimized_prompt}</p>

        {/* Dimension breakdown — shown only when already_optimized */}
        {isAlreadyOptimized && result.gate_dimension_scores && (
          <DimensionBreakdown
            scores={result.gate_dimension_scores}
            rationale={result.gate_rationale}
          />
        )}

        {/* Show original toggle — only visible when NOT already_optimized */}
        {!isAlreadyOptimized && (
          <div>
            <button
              type="button"
              onClick={() => setShowOriginal((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-medium"
            >
              {showOriginal ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showOriginal ? 'Hide' : 'Show'} original prompt
            </button>
            {showOriginal && (
              <div className="mt-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {result.original_prompt}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-border bg-muted/20 px-5 py-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {copied ? (
            <><CheckCheck className="h-3.5 w-3.5" /> Copied</>
          ) : (
            <><Copy className="h-3.5 w-3.5" /> Copy</>
          )}
        </button>
        {result.prompt_id && !isAlreadyOptimized && (
          <Link
            href={`/versions/${result.prompt_id}`}
            className={buttonVariants({ variant: 'outline', size: 'sm', className: 'h-8 text-xs' })}
          >
            Version history
          </Link>
        )}
        {isAlreadyOptimized && onForceOptimize && (
          <button
            type="button"
            onClick={onForceOptimize}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ border: '1px solid rgba(124,92,255,0.4)', background: 'rgba(124,92,255,0.08)',
              color: '#7c5cff', cursor: 'pointer' }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(124,92,255,0.15)';
              e.currentTarget.style.borderColor = 'rgba(124,92,255,0.6)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(124,92,255,0.08)';
              e.currentTarget.style.borderColor = 'rgba(124,92,255,0.4)';
            }}
          >
            <Zap className="h-3.5 w-3.5" />
            Force optimize anyway
          </button>
        )}
      </div>
    </div>
  );
}
