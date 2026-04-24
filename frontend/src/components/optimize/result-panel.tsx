'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { X, Copy, CheckCheck, ChevronDown, ChevronUp, Sparkles, GitBranch } from 'lucide-react';
import { toast } from 'sonner';
import { buttonVariants } from '@/components/ui/button';
import type { JobResult } from '@/types/api';
import { LikeButton } from '@/components/optimize/like-button';
import { useFavoriteStatus } from '@/hooks/use-favorites';

interface ResultPanelProps {
  result: JobResult;
  onClose: () => void;
}

export function ResultPanel({ result, onClose }: ResultPanelProps) {
  const [copied, setCopied] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

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
      {/* Sage-tinted header */}
      <div className="shrink-0 bg-primary px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-7 w-7 rounded-full bg-primary-foreground/20 flex items-center justify-center shrink-0">
              <Sparkles className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary-foreground truncate">Optimized prompt</p>
              {result.token_usage?.total_tokens ? (
                <p className="text-[11px] text-primary-foreground/60 mt-0.5">
                  {result.token_usage.total_tokens.toLocaleString()} tokens
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {result.version && (
              <div className="inline-flex items-center gap-1 rounded-full bg-primary-foreground/15 px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
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
              className="h-7 w-7 flex items-center justify-center rounded-md text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/15 transition-colors"
              aria-label="Close panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-5">
        <p className="text-sm leading-7 whitespace-pre-wrap text-foreground">{result.optimized_prompt}</p>

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
        {result.prompt_id && (
          <Link
            href={`/versions/${result.prompt_id}`}
            className={buttonVariants({ variant: 'outline', size: 'sm', className: 'h-8 text-xs' })}
          >
            Version history
          </Link>
        )}
      </div>
    </div>
  );
}
