'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PanelRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useJobPoller } from '@/hooks/use-job-poller';
import { api } from '@/lib/api';
import { formatApiErrorDetail } from '@/lib/api-errors';
import { cn } from '@/lib/utils';
import { ChatMessage } from './chat-message';
import { ChatInput } from './chat-input';
import { ResultPanel } from './result-panel';
import type { ChatTurn, JobResult, SessionDetail } from '@/types/api';

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mq.matches);
    const fn = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return isDesktop;
}

export function OptimizeChat() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();

  const urlSession = searchParams.get('session');

  const [sessionId, setSessionId] = useState<string | null>(urlSession);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  // Track active versioning prompt family — set when user clicks "Version" on a response
  const [versionPromptId, setVersionPromptId] = useState<string | null>(null);

  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  /** When true on desktop, the result column is hidden but the selection is kept (user can reopen with “View result”). */
  const [desktopPanelDismissed, setDesktopPanelDismissed] = useState(false);
  const isDesktop = useIsDesktop();

  // Prefill from sessionStorage (set by versions page "Optimize This Version")
  const [prefillText] = useState(() => {
    if (typeof window === 'undefined') return '';
    return sessionStorage.getItem('prefill_prompt') || '';
  });
  const [prefillName] = useState(() => {
    if (typeof window === 'undefined') return '';
    return sessionStorage.getItem('prefill_name') || '';
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  // Sessions created in this tab — never fetch these from the API
  // (the session doesn't exist in the DB yet when the URL is first updated)
  const localSessions = useRef(new Set<string>());

  // Load session history when URL has ?session= (sidebar navigation only)
  useEffect(() => {
    if (!urlSession) return;
    if (localSessions.current.has(urlSession)) return; // just created — skip fetch

    setSessionId(urlSession);
    setTurns([]);
    setIsLoadingSession(true);

    api
      .get<{ data: SessionDetail }>(`/api/v1/chat/sessions/${urlSession}`)
      .then((res) => {
        const { messages } = res.data.data;
        const loaded: ChatTurn[] = messages.map((msg) => ({
          tempId: msg.id,
          userText: msg.raw_prompt ?? '',
          isFeedback: false,
          status: 'completed' as const,
          result: msg.response
            ? ({
                session_id: urlSession,
                original_prompt: msg.raw_prompt ?? '',
                optimized_prompt: msg.response,
                council_proposals: msg.council_votes ?? [],
                token_usage: msg.token_usage ?? { total_tokens: 0 },
              } as JobResult)
            : undefined,
        }));
        setTurns(loaded);
        const lastWithResult = [...loaded].reverse().find((t) => t.result);
        if (lastWithResult) {
          setSelectedTurnId(lastWithResult.tempId);
          setDesktopPanelDismissed(false);
        }
      })
      .catch(() => {
        // Session not found or network error — show empty state silently
        setTurns([]);
      })
      .finally(() => setIsLoadingSession(false));
  }, [urlSession]);

  // Poll active job
  const { data: jobData } = useJobPoller(activeJobId);

  useEffect(() => {
    if (!jobData) return;

    if (jobData.status === 'completed' && jobData.result) {
      const completedTempId = turnsRef.current.find((t) => t.jobId === activeJobId)?.tempId;
      setTurns((prev) =>
        prev.map((t) =>
          t.jobId === activeJobId ? { ...t, status: 'completed', result: jobData.result! } : t
        )
      );
      if (completedTempId) {
        setSelectedTurnId(completedTempId);
        setDesktopPanelDismissed(false);
        setMobilePanelOpen(true);
      }
      setActiveJobId(null);
      queryClient.invalidateQueries({ queryKey: ['user', 'me'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    } else if (jobData.status === 'failed') {
      const errMsg = formatApiErrorDetail(jobData.error, 'Optimization failed');
      setTurns((prev) =>
        prev.map((t) =>
          t.jobId === activeJobId ? { ...t, status: 'failed', error: errMsg } : t
        )
      );
      setActiveJobId(null);
    }
  }, [jobData, activeJobId, queryClient]);

  // Auto-scroll on new turns or status changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const handleSubmit = async (text: string, name?: string) => {
    // Clear sessionStorage prefill on first submit
    sessionStorage.removeItem('prefill_prompt');
    sessionStorage.removeItem('prefill_name');
    sessionStorage.removeItem('prefill_prompt_id');

    const isFeedback = turns.length > 0;
    const sid = sessionId ?? crypto.randomUUID();

    if (!sessionId) {
      setSessionId(sid);
      localSessions.current.add(sid); // mark as locally created — don't re-fetch from API
      router.replace(`/optimize?session=${sid}`, { scroll: false });
    }

    // For feedback: re-optimize the latest successful result using new guidance
    const latestResult = [...turns].reverse().find((t) => t.status === 'completed' && t.result);
    const promptToSend = isFeedback
      ? (latestResult?.result?.optimized_prompt ?? text)
      : text;
    const feedbackToSend = isFeedback ? text : undefined;

    const tempId = crypto.randomUUID();
    setTurns((prev) => [
      ...prev,
      { tempId, userText: text, isFeedback, status: 'loading' },
    ]);

    try {
      const res = await api.post<{ data: { job_id: string } }>('/api/v1/chat/', {
        prompt: promptToSend,
        ...(feedbackToSend && { feedback: feedbackToSend }),
        session_id: sid,
        // If versioning is active, append the result to the existing family (v3, v4, …)
        ...(versionPromptId && !name ? { prompt_id: versionPromptId } : {}),
        ...(name && { name }),
      });

      const jobId = res.data.data.job_id;
      setTurns((prev) => prev.map((t) => (t.tempId === tempId ? { ...t, jobId } : t)));
      setActiveJobId(jobId);
    } catch (err: unknown) {
      const rawDetail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data
        ?.detail;
      const detail = formatApiErrorDetail(rawDetail, 'Failed to submit prompt');
      setTurns((prev) =>
        prev.map((t) =>
          t.tempId === tempId ? { ...t, status: 'failed', error: detail } : t
        )
      );
      toast.error(detail);
    }
  };

  const isAnyLoading = turns.some((t) => t.status === 'loading');
  const hasMessages = turns.length > 0;

  const selectedResult = turns.find((t) => t.tempId === selectedTurnId)?.result;
  const canShowPanel = Boolean(selectedTurnId && selectedResult);
  const panelVisible =
    canShowPanel && (isDesktop ? !desktopPanelDismissed : mobilePanelOpen);

  const handleClosePanel = () => {
    if (isDesktop) setDesktopPanelDismissed(true);
    else setMobilePanelOpen(false);
  };

  const handleSelectTurn = (tempId: string) => {
    setSelectedTurnId(tempId);
    setDesktopPanelDismissed(false);
    setMobilePanelOpen(true);
  };

  return (
    <div
      className={cn(
        'flex flex-1 min-h-0 h-full flex-col',
        panelVisible && isDesktop && 'lg:flex-row'
      )}
    >
      {/* ── Messages area (50% when split on desktop) ── */}
      <div
        className={cn(
          'flex flex-col min-w-0 min-h-0',
          panelVisible && isDesktop ? 'lg:w-1/2 lg:shrink-0' : 'flex-1'
        )}
      >
        {hasMessages && canShowPanel && isDesktop && desktopPanelDismissed && (
          <div className="shrink-0 flex justify-end px-4 pt-3 pb-2 border-b border-border/50 bg-background/95 backdrop-blur-sm">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setDesktopPanelDismissed(false)}
            >
              <PanelRight className="h-4 w-4" />
              View result
            </Button>
          </div>
        )}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoadingSession ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Loading conversation…
          </div>
        ) : !hasMessages ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full px-4 pb-16">
            <div className="w-full max-w-2xl space-y-6">
              <div className="text-center space-y-3">
                <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-gradient-to-br from-primary to-primary/60 shadow-lg shadow-primary/20 mb-2">
                  <Sparkles className="h-6 w-6 text-primary-foreground" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-br from-foreground to-foreground/60 bg-clip-text text-transparent">
                  What prompt can I optimize?
                </h1>
              </div>

              <ChatInput
                onSubmit={handleSubmit}
                isLoading={isAnyLoading}
                hasPreviousTurns={false}
                defaultValue={prefillText}
                defaultName={prefillName}
                autoFocus
              />

              <div className="grid grid-cols-3 gap-3 pt-1">
                {[
                  { label: '4 AI models', desc: 'Optimize in parallel' },
                  { label: 'Peer critique', desc: 'Models review each other' },
                  { label: 'Best result', desc: 'Synthesized by a chairman' },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-border/50 bg-card/50 px-3 py-2.5 text-center">
                    <p className="text-xs font-semibold text-foreground">{item.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Conversation */
          <div className="max-w-2xl mx-auto px-4 py-8 space-y-10">
            {turns.map((turn) => (
              <ChatMessage
                key={turn.tempId}
                turn={turn}
                isVersioningActive={!!versionPromptId}
                onVersionSaved={(pid) => setVersionPromptId(pid)}
                isTurnSelected={turn.tempId === selectedTurnId}
                onSelectTurn={() => handleSelectTurn(turn.tempId)}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── Sticky bottom input ── */}
      {hasMessages && (
        <div className="shrink-0 px-4 py-4 bg-gradient-to-t from-background via-background to-transparent">
          <div className="max-w-2xl mx-auto">
            <ChatInput
              onSubmit={handleSubmit}
              isLoading={isAnyLoading}
              hasPreviousTurns
            />
          </div>
        </div>
      )}
      </div>

      {/* Mobile: reopen result when overlay is closed */}
      {hasMessages && canShowPanel && !isDesktop && !mobilePanelOpen && (
        <div className="fixed bottom-24 right-4 z-30 lg:hidden">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="gap-2 shadow-lg"
            onClick={() => setMobilePanelOpen(true)}
          >
            <PanelRight className="h-4 w-4" />
            View result
          </Button>
        </div>
      )}

      {/* ── Result panel (50% width on desktop when open) ── */}
      {panelVisible && selectedResult && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
            aria-label="Dismiss panel"
            onClick={() => setMobilePanelOpen(false)}
          />
          <div
            className={cn(
              'fixed inset-y-0 right-0 z-50 flex h-full min-h-0 lg:static lg:z-auto',
              'animate-in slide-in-from-right-4 duration-200 lg:animate-none lg:slide-in-from-right-0',
              'lg:w-1/2 lg:min-w-0 lg:shrink-0'
            )}
          >
            <ResultPanel result={selectedResult} onClose={handleClosePanel} />
          </div>
        </>
      )}
    </div>
  );
}
