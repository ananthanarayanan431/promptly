'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { X, Copy, CheckCheck, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { buttonVariants } from '@/components/ui/button';
import type { JobResult } from '@/types/api';

interface ResultPanelProps {
  result: JobResult;
  onClose: () => void;
}

export function ResultPanel({ result, onClose }: ResultPanelProps) {
  const [copied, setCopied] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(result.optimized_prompt);
    setCopied(true);
    toast.success('Copied');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full min-h-0 w-full max-w-[min(100vw,440px)] lg:max-w-none lg:w-full shrink-0 border-l bg-card shadow-xl lg:shadow-none">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-4 border-b">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">Optimized prompt</p>
          {result.token_usage?.total_tokens ? (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {result.token_usage.total_tokens.toLocaleString()} tokens
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Final result
          </div>
          <p className="text-sm leading-7 whitespace-pre-wrap text-foreground">{result.optimized_prompt}</p>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowOriginal((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showOriginal ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showOriginal ? 'Hide' : 'Show'} original prompt
          </button>
          {showOriginal && (
            <div className="mt-2 rounded-lg border border-dashed bg-muted/30 px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {result.original_prompt}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t px-5 py-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border border-border"
        >
          {copied ? (
            <>
              <CheckCheck className="h-3.5 w-3.5 text-green-500" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" /> Copy
            </>
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
