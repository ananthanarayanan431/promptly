'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Copy, CheckCheck, AlertCircle, Sparkles, GitBranch, Loader2 } from 'lucide-react';
import { LoadingWords } from './loading-words';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import type { ChatTurn } from '@/types/api';

// ── User message ─────────────────────────────────────────────────────────────

function UserBubble({ text, isFeedback }: { text: string; isFeedback: boolean }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] space-y-1">
        {isFeedback && (
          <p className="text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 pr-1">
            Feedback
          </p>
        )}
        <div
          className={cn(
            'rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap',
            isFeedback ? 'bg-muted/60 border text-foreground' : 'bg-muted text-foreground'
          )}
        >
          {text}
        </div>
      </div>
    </div>
  );
}

// ── Assistant result ──────────────────────────────────────────────────────────

interface AssistantResultProps {
  turn: ChatTurn;
  isVersioningActive: boolean;
  onVersionSaved: (promptId: string) => void;
}

function AssistantResult({ turn, isVersioningActive, onVersionSaved }: AssistantResultProps) {
  const [copied, setCopied] = useState(false);
  const [versionLoading, setVersionLoading] = useState(false);
  const [savedVersion, setSavedVersion] = useState<{ promptId: string; name: string; version: number } | null>(null);

  if (turn.status === 'loading') {
    return (
      <div className="flex gap-3">
        <PromptlyIcon />
        <div className="flex-1 pt-1">
          <LoadingWords />
        </div>
      </div>
    );
  }

  if (turn.status === 'failed') {
    return (
      <div className="flex gap-3">
        <PromptlyIcon />
        <div className="flex items-start gap-2 pt-1">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-destructive">Optimization failed</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {turn.error || 'Something went wrong. Please try again.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!turn.result) return null;

  const { result } = turn;

  // Version info: from job result (if versioned at submit time) OR from local save-version call
  const versionNum = result.version ?? savedVersion?.version;
  const isVersioned = !!result.prompt_id || !!savedVersion;
  const canSaveVersion = !isVersioningActive && !isVersioned;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(result.optimized_prompt);
    setCopied(true);
    toast.success('Copied');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveVersion = async () => {
    setVersionLoading(true);
    try {
      const res = await api.post<{ data: { prompt_id: string; name: string; version: number } }>(
        '/api/v1/chat/save-version',
        {
          original_prompt: result.original_prompt,
          optimized_prompt: result.optimized_prompt,
        }
      );
      const { prompt_id, name, version } = res.data.data;
      setSavedVersion({ promptId: prompt_id, name, version });
      onVersionSaved(prompt_id);
      toast.success(`Versioning started — "${name}"`);
    } catch {
      toast.error('Failed to save version');
    } finally {
      setVersionLoading(false);
    }
  };

  return (
    <div className="flex gap-3">
      <PromptlyIcon />

      <div className="flex-1 min-w-0 space-y-3">
        {/* Version pill — shown after versioning starts */}
        {(isVersioned || isVersioningActive) && versionNum && (
          <div className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-800 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300">
            <GitBranch className="h-3 w-3" />
            v{versionNum} saved
          </div>
        )}

        {/* Optimized prompt — plain text, no box */}
        <p className="text-sm leading-7 whitespace-pre-wrap text-foreground">
          {result.optimized_prompt}
        </p>

        {/* Action row */}
        <div className="flex items-center gap-1 -ml-1.5 pt-0.5">
          {/* Copy */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {copied ? (
              <><CheckCheck className="h-3.5 w-3.5 text-green-500" /> Copied</>
            ) : (
              <><Copy className="h-3.5 w-3.5" /> Copy</>
            )}
          </button>

          {/* Version button */}
          {canSaveVersion && (
            <button
              onClick={handleSaveVersion}
              disabled={versionLoading}
              title="Save as versioned prompt"
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              {versionLoading ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
              ) : (
                <><GitBranch className="h-3.5 w-3.5" /> Version</>
              )}
            </button>
          )}

          {/* Versioning active indicator (no button - auto-saved by backend) */}
          {isVersioningActive && !versionNum && (
            <span className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-violet-500">
              <GitBranch className="h-3.5 w-3.5" /> Versioning active
            </span>
          )}

          {/* Token count */}
          {result.token_usage?.total_tokens ? (
            <span className="ml-auto text-[11px] text-muted-foreground/50">
              {result.token_usage.total_tokens.toLocaleString()} tokens
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Promptly avatar ───────────────────────────────────────────────────────────

function PromptlyIcon() {
  return (
    <div className="h-7 w-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
      <Sparkles className="h-3.5 w-3.5 text-primary" />
    </div>
  );
}

// ── Combined turn ─────────────────────────────────────────────────────────────

interface ChatMessageProps {
  turn: ChatTurn;
  isVersioningActive: boolean;
  onVersionSaved: (promptId: string) => void;
}

export function ChatMessage({ turn, isVersioningActive, onVersionSaved }: ChatMessageProps) {
  return (
    <div className="space-y-4">
      <UserBubble text={turn.userText} isFeedback={turn.isFeedback} />
      <AssistantResult
        turn={turn}
        isVersioningActive={isVersioningActive}
        onVersionSaved={onVersionSaved}
      />
    </div>
  );
}
