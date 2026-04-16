'use client';

import { useState, useRef, useEffect } from 'react';
import { ArrowUp, Loader2, GitBranch, X } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (defaultValue) setText(defaultValue);
  }, [defaultValue]);

  useEffect(() => {
    if (defaultName) { setVersionName(defaultName); setVersioning(true); }
  }, [defaultName]);

  // Auto-resize textarea
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

    // If we have prompt text, generate a name automatically
    const trimmed = text.trim();
    if (!trimmed) return;

    setNameLoading(true);
    try {
      const res = await api.post<{ data: { name: string } }>('/api/v1/chat/suggest-name', {
        prompt: trimmed,
      });
      setVersionName(res.data.data.name);
    } catch {
      // silently fall back to empty — user can type their own
    } finally {
      setNameLoading(false);
    }
  };

  const canSubmit = !!text.trim() && !isLoading;

  return (
    <div className="w-full">
      {/* Version name badge — shown above the textarea when versioning is on */}
      {versioning && (
        <div className="mb-2 flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/25 px-3 py-1">
            <GitBranch className="h-3 w-3 text-primary shrink-0" />
            {nameLoading ? (
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
            ) : (
              <input
                value={versionName}
                onChange={(e) => setVersionName(e.target.value)}
                placeholder="VERSION NAME"
                className="bg-transparent text-xs font-semibold tracking-wide text-primary outline-none placeholder:text-primary/50 w-40"
              />
            )}
            <button
              onClick={() => { setVersioning(false); setVersionName(''); }}
              className="ml-1 text-primary/50 hover:text-primary transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <span className="text-[11px] text-muted-foreground">Result will be saved as a versioned prompt</span>
        </div>
      )}

      {/* Input box */}
      <div className={cn(
        'relative rounded-2xl border bg-card transition-all duration-200',
        'focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_oklch(0.67_0.22_285_/_0.12)]',
        'shadow-sm hover:border-primary/30'
      )}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            hasPreviousTurns
              ? 'Give feedback to refine the result...'
              : 'Paste your prompt here to optimize...'
          }
          disabled={isLoading}
          autoFocus={autoFocus}
          rows={1}
          className={cn(
            'w-full resize-none bg-transparent px-4 pt-4 pb-12 text-sm leading-relaxed',
            'outline-none placeholder:text-muted-foreground/50 disabled:opacity-50',
            hasPreviousTurns ? 'min-h-[56px]' : 'min-h-[128px]'
          )}
        />

        {/* Toolbar inside the box — bottom bar */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 py-2.5">
          {/* Left: versioning toggle */}
          <button
            type="button"
            onClick={toggleVersioning}
            title={versioning ? 'Stop versioning' : 'Start versioning'}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
              versioning
                ? 'bg-primary/10 text-primary border border-primary/30'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent border border-transparent'
            )}
          >
            <GitBranch className="h-3.5 w-3.5" />
            {versioning ? 'Versioning on' : 'Version'}
          </button>

          {/* Right: submit */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200',
              canSubmit
                ? 'bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-sm shadow-primary/30 hover:shadow-primary/50 hover:scale-105'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            )}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {!hasPreviousTurns && (
        <p className="mt-2 text-center text-xs text-muted-foreground/50">
          Press Enter to optimize · Shift+Enter for new line · 10 credits per run
        </p>
      )}
    </div>
  );
}
