'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Copy, CheckCheck, AlertCircle, Sparkles, GitBranch, PanelRight } from 'lucide-react';
import { LoadingWords } from './loading-words';
import { cn } from '@/lib/utils';
import { formatApiErrorDetail } from '@/lib/api-errors';
import type { ChatTurn } from '@/types/api';

// ── User message ─────────────────────────────────────────────────────────────

function UserBubble({ text, isFeedback }: { text: string; isFeedback: boolean }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] space-y-1.5">
        <p className="text-right text-[10px] font-semibold uppercase tracking-widest pr-2 text-primary/60">
          {isFeedback ? 'Feedback' : 'You'}
        </p>
        <div className={cn(
          'rounded-2xl rounded-tr-md px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap',
          isFeedback
            ? 'bg-primary text-primary-foreground'
            : 'bg-foreground/80 text-primary-foreground'
        )}>
          {text}
        </div>
      </div>
    </div>
  );
}

// ── Assistant result ──────────────────────────────────────────────────────────

const PREVIEW_MAX_CHARS = 360;

interface AssistantResultProps {
  turn: ChatTurn;
  isTurnSelected: boolean;
  onSelectTurn: () => void;
}

function AssistantResult({ turn, isTurnSelected, onSelectTurn }: AssistantResultProps) {
  const [copied, setCopied] = useState(false);

  if (turn.status === 'loading') {
    return (
      <div className="flex gap-3">
        <PromptlyIcon />
        <div className="flex-1 pt-1 bg-card rounded-2xl rounded-tl-md border border-border px-4 py-3 shadow-sm">
          <LoadingWords />
        </div>
      </div>
    );
  }

  if (turn.status === 'failed') {
    return (
      <div className="flex gap-3">
        <PromptlyIcon />
        <div className="flex items-start gap-2 rounded-2xl rounded-tl-md border border-destructive/30 bg-destructive/8 px-4 py-3 shadow-sm">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-destructive">Optimization failed</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatApiErrorDetail(turn.error, 'Something went wrong. Please try again.')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!turn.result) return null;

  const { result } = turn;
  const versionNum = result.version;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(result.optimized_prompt);
      setCopied(true);
      toast.success('Copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const raw = result.optimized_prompt;
  const isLong = raw.length > PREVIEW_MAX_CHARS;
  const previewText = isLong ? `${raw.slice(0, PREVIEW_MAX_CHARS).trimEnd()}…` : raw;

  return (
    <div className="flex gap-3">
      <PromptlyIcon />

      <div className="flex-1 min-w-0">
        <div
          role="button"
          tabIndex={0}
          onClick={onSelectTurn}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectTurn();
            }
          }}
          className={cn(
            'rounded-2xl rounded-tl-md bg-card border text-left w-full cursor-pointer transition-all overflow-hidden shadow-sm',
            isTurnSelected
              ? 'border-primary/50 shadow-md shadow-primary/10 ring-1 ring-primary/20'
              : 'border-border/70 hover:border-primary/30 hover:shadow-md hover:shadow-primary/8'
          )}
        >
          {/* Coloured header strip */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-secondary/30 border-b border-border/50">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-primary uppercase tracking-wider">Promptly</span>
            </div>
            <div className="flex items-center gap-2">
              {versionNum && (
                <div className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  <GitBranch className="h-2.5 w-2.5" />
                  v{versionNum}
                </div>
              )}
              {result.token_usage?.total_tokens ? (
                <span className="text-[10px] text-muted-foreground/60">
                  {result.token_usage.total_tokens.toLocaleString()} tokens
                </span>
              ) : null}
            </div>
          </div>

          {/* Content */}
          <div className="px-4 py-3 space-y-3">
            <p className="text-sm leading-7 whitespace-pre-wrap text-foreground">{previewText}</p>

            {isLong && (
              <p className="flex items-center gap-1.5 text-[11px] text-primary/70 font-medium">
                <PanelRight className="h-3.5 w-3.5 shrink-0" />
                Click to open full result in the side panel
              </p>
            )}
          </div>

          {/* Action row */}
          <div
            className="flex items-center gap-1 px-3 py-2 border-t border-border/40 bg-muted/20"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              {copied ? (
                <><CheckCheck className="h-3.5 w-3.5 text-green-600" /> Copied</>
              ) : (
                <><Copy className="h-3.5 w-3.5" /> Copy</>
              )}
            </button>
            {!isLong && (
              <span className="ml-auto text-[10px] text-muted-foreground/50 italic">
                Click card to open side panel
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Promptly avatar ───────────────────────────────────────────────────────────

function PromptlyIcon() {
  return (
    <div className="h-7 w-7 rounded-full bg-primary flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
      <Sparkles className="h-3.5 w-3.5 text-primary-foreground" />
    </div>
  );
}

// ── Combined turn ─────────────────────────────────────────────────────────────

interface ChatMessageProps {
  turn: ChatTurn;
  isTurnSelected: boolean;
  onSelectTurn: () => void;
}

export function ChatMessage({ turn, isTurnSelected, onSelectTurn }: ChatMessageProps) {
  return (
    <div className="space-y-4">
      <UserBubble text={turn.userText} isFeedback={turn.isFeedback} />
      <AssistantResult
        turn={turn}
        isTurnSelected={isTurnSelected}
        onSelectTurn={onSelectTurn}
      />
    </div>
  );
}
