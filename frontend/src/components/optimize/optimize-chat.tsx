'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PanelRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useJobStream } from '@/hooks/use-job-stream';
import { api } from '@/lib/api';
import { formatApiErrorDetail } from '@/lib/api-errors';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { useJobStore } from '@/stores/job-store';
import { ChatMessage } from './chat-message';
import { ChatInput } from './chat-input';
import { ResultPanel } from './result-panel';
import type { ChatTurn, JobResult, SessionDetail, TemplateListResponse } from '@/types/api';

function TemplatePickerModal({
  data,
  onSelect,
  onClose,
}: {
  data: TemplateListResponse;
  onSelect: (content: string) => void;
  onClose: () => void;
}) {
  const [activeCategory, setActiveCategory] = useState(data.categories[0]?.category ?? '');

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <div
        style={{ width: 640, maxHeight: '78vh', borderRadius: 14, background: '#141414',
          border: '1px solid #2a2a2e', display: 'flex', flexDirection: 'column',
          overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #1f1f23',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c5cff" strokeWidth="1.6">
              <rect x="3" y="3" width="7" height="8" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/>
              <rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="15" width="7" height="6" rx="1"/>
            </svg>
            <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
              textTransform: 'uppercase', letterSpacing: '0.12em', color: '#7c5cff' }}>
              Prompt Templates
            </span>
            <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
              padding: '1px 6px', borderRadius: 4, background: '#222226',
              border: '1px solid #2a2a2e', color: '#5a5a60' }}>
              {data.total}
            </span>
          </div>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              color: '#5a5a60', width: 24, height: 24, display: 'flex',
              alignItems: 'center', justifyContent: 'center', borderRadius: 4 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Category tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '10px 16px',
          borderBottom: '1px solid #1f1f23', overflowX: 'auto' as const }}>
          {data.categories.map(g => (
            <button key={g.category} onClick={() => setActiveCategory(g.category)}
              style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12,
                border: '1px solid transparent', cursor: 'pointer', whiteSpace: 'nowrap' as const,
                background: activeCategory === g.category ? 'rgba(124,92,255,0.15)' : 'transparent',
                color: activeCategory === g.category ? '#7c5cff' : '#8a8a90',
                borderColor: activeCategory === g.category ? 'rgba(124,92,255,0.3)' : 'transparent',
                fontFamily: 'var(--font-geist-mono, monospace)',
                textTransform: 'capitalize' as const }}>
              {g.category.replace(/-/g, ' ')}
            </button>
          ))}
        </div>

        {/* Template list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12,
          display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(data.categories.find(g => g.category === activeCategory)?.templates ?? []).map(t => (
            <button key={t.id} onClick={() => { onSelect(t.content); onClose(); }}
              style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 8,
                border: '1px solid #1f1f23', background: 'transparent', cursor: 'pointer',
                transition: 'background 120ms, border-color 120ms',
                fontFamily: 'var(--font-geist, ui-sans-serif)' }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(124,92,255,0.06)';
                e.currentTarget.style.borderColor = 'rgba(124,92,255,0.25)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = '#1f1f23';
              }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#ededed', marginBottom: 4 }}>
                {t.name}
              </div>
              <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
                color: '#5a5a60', lineHeight: 1.5 }}>
                {t.description}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

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
  const user = useAuthStore((s) => s.user);
  const setGeneratingSession = useJobStore((s) => s.setGeneratingSession);
  const firstName = user?.email.split('@')[0] ?? 'there';

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

  const [showTemplates, setShowTemplates] = useState(false);
  const [templateDefault, setTemplateDefault] = useState('');

  const { data: templatesData } = useQuery({
    queryKey: ['templates'],
    queryFn: async () => {
      const res = await api.get<{ data: TemplateListResponse }>('/api/v1/templates');
      return res.data.data;
    },
    staleTime: Infinity,
  });

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
  const localSessions = useRef(new Map<string, number>()); // sessionId → created timestamp

  // Reset to empty state when navigating to /optimize with no session (New Chat).
  // Do NOT clear activeJobId here — an in-flight job must be allowed to finish
  // so its completion/failure handlers can run and clean up correctly.
  useEffect(() => {
    if (urlSession) return;
    setTurns([]);
    setSessionId(null);
    setSelectedTurnId(null);
    setDesktopPanelDismissed(false);
    setMobilePanelOpen(false);
    setVersionPromptId(null);
  }, [urlSession]);

  // Load session history when URL has ?session= (sidebar navigation only)
  useEffect(() => {
    if (!urlSession) return;
    // Only skip fetch if the session was *just* created in this navigation (within last 5s).
    // If the user navigated away and came back, we must re-fetch to show conversation history.
    const createdAt = localSessions.current.get(urlSession);
    if (createdAt && Date.now() - createdAt < 5000) return;

    setSessionId(urlSession);
    setTurns([]);
    setIsLoadingSession(true);

    api
      .get<{ data: SessionDetail }>(`/api/v1/chat/sessions/${urlSession}`)
      .then((res) => {
        const { messages } = res.data.data;
        const pendingJobId = sessionStorage.getItem(`pending_job_${urlSession}`);

        const loaded: ChatTurn[] = messages.map((msg) => {
          const hasResult = !!msg.response;
          const isFeedback = !!msg.feedback;
          return {
            tempId: msg.id,
            // For feedback turns show the feedback comment, not the prompt that was re-optimized
            userText: isFeedback ? msg.feedback! : (msg.raw_prompt ?? ''),
            isFeedback,
            // If the message has no response and we have a pending job, mark as loading
            status: !hasResult && pendingJobId ? ('loading' as const) : ('completed' as const),
            jobId: !hasResult && pendingJobId ? pendingJobId : undefined,
            result: hasResult
              ? ({
                  session_id: urlSession,
                  original_prompt: msg.raw_prompt ?? '',
                  optimized_prompt: msg.response!,
                  council_proposals: msg.council_votes ?? [],
                  token_usage: msg.token_usage ?? { total_tokens: 0 },
                  prompt_version_id: msg.prompt_version_id ?? null,
                  prompt_id: msg.prompt_family_id ?? undefined,
                } as JobResult)
              : undefined,
          };
        });

        setTurns(loaded);

        // Resume polling if there's an in-flight job
        const hasPendingTurn = loaded.some((t) => t.status === 'loading');
        if (pendingJobId && hasPendingTurn) {
          setActiveJobId(pendingJobId);
          setGeneratingSession(urlSession);
        } else if (pendingJobId) {
          // Job completed while away — clean up
          sessionStorage.removeItem(`pending_job_${urlSession}`);
        }

        // Restore active version family so feedback turns keep appending
        const lastVersioned = [...loaded].reverse().find((t) => t.result?.prompt_id);
        if (lastVersioned?.result?.prompt_id) {
          setVersionPromptId(lastVersioned.result.prompt_id);
        }

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

  // Stream active job
  const { status: streamStatus, result: streamResult, error: streamError, progress: streamProgress } =
    useJobStream(activeJobId);

  useEffect(() => {
    if (streamStatus === 'completed' && streamResult && activeJobId) {
      const completedJobId = activeJobId;
      const completedResult = streamResult;
      const completedTempId = turnsRef.current.find((t) => t.jobId === completedJobId)?.tempId;

      setTurns((prev) =>
        prev.map((t) =>
          t.jobId === completedJobId ? { ...t, status: 'completed', result: completedResult } : t
        )
      );
      if (completedTempId) {
        setSelectedTurnId(completedTempId);
        setDesktopPanelDismissed(false);
        setMobilePanelOpen(true);
      }
      setActiveJobId(null);
      setGeneratingSession(null);
      if (sessionId) sessionStorage.removeItem(`pending_job_${sessionId}`);
      queryClient.invalidateQueries({ queryKey: ['user', 'me'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['recent-sessions'] });

      // Auto-versioning now happens in the Celery task — prompt_id is returned directly.
      // Only fall back to save-version if the task somehow didn't create a version.
      if (!versionPromptId && !completedResult.prompt_id && !completedResult.prompt_version_id) {
        api
          .post<{ data: { prompt_id: string; name: string; version: number } }>(
            '/api/v1/chat/save-version',
            {
              original_prompt: completedResult.original_prompt,
              optimized_prompt: completedResult.optimized_prompt,
            }
          )
          .then((res) => {
            const { prompt_id, version } = res.data.data;
            setVersionPromptId(prompt_id);
            setTurns((prev) =>
              prev.map((t) =>
                t.jobId === completedJobId && t.result
                  ? { ...t, result: { ...t.result, prompt_id, version } }
                  : t
              )
            );
          })
          .catch(() => {});
      }
      // Seed versionPromptId from the task result so feedback turns append correctly
      if (!versionPromptId && completedResult.prompt_id) {
        setVersionPromptId(completedResult.prompt_id);
      }
    } else if (streamStatus === 'failed' && activeJobId) {
      const errMsg = formatApiErrorDetail(streamError ?? undefined, 'Optimization failed');
      setTurns((prev) =>
        prev.map((t) =>
          t.jobId === activeJobId ? { ...t, status: 'failed', error: errMsg } : t
        )
      );
      setActiveJobId(null);
      setGeneratingSession(null);
      if (sessionId) sessionStorage.removeItem(`pending_job_${sessionId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamStatus, streamResult, streamError]);

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
      localSessions.current.set(sid, Date.now()); // mark as locally created — skip immediate re-fetch
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
      sessionStorage.setItem(`pending_job_${sid}`, jobId);
      setTurns((prev) => prev.map((t) => (t.tempId === tempId ? { ...t, jobId } : t)));
      setActiveJobId(jobId);
      setGeneratingSession(sid);
      // Show session in sidebar immediately (before job completes)
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
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

  const handleRetry = (tempId: string) => {
    const turn = turnsRef.current.find((t) => t.tempId === tempId);
    if (!turn) return;
    // Remove the failed turn then resubmit its original text
    setTurns((prev) => prev.filter((t) => t.tempId !== tempId));
    void handleSubmit(turn.userText);
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
        {hasMessages && (
          <div className="shrink-0 flex justify-between items-center px-4 pt-3 pb-2 border-b border-border/50 bg-background/95 backdrop-blur-sm">
            <button
              type="button"
              onClick={() => router.push('/optimize')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px',
                borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                border: '1px solid rgba(124,92,255,0.4)', background: 'rgba(124,92,255,0.1)',
                color: '#7c5cff', fontFamily: 'inherit',
                transition: 'background 150ms, border-color 150ms' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,92,255,0.18)'; e.currentTarget.style.borderColor = 'rgba(124,92,255,0.6)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(124,92,255,0.1)'; e.currentTarget.style.borderColor = 'rgba(124,92,255,0.4)'; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              New Chat
            </button>
            {canShowPanel && isDesktop && desktopPanelDismissed && (
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
            )}
          </div>
        )}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoadingSession ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Loading conversation…
          </div>
        ) : !hasMessages ? (
          /* Empty state — greeting top, input + chips bottom */
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%',
            fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
            {/* Greeting */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', flex: 1, gap: 12, paddingBottom: 32 }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%',
                background: 'rgba(124,92,255,0.15)', border: '1px solid rgba(124,92,255,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Sparkles style={{ width: 22, height: 22, color: '#7c5cff' }} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
                  color: '#7c5cff', textTransform: 'uppercase', letterSpacing: '0.12em',
                  marginBottom: 8 }}>Hello, {firstName}</div>
                <h1 style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)',
                  fontWeight: 400, fontSize: 36, letterSpacing: '-0.02em', lineHeight: 1.15,
                  margin: 0, color: '#ededed' }}>
                  What prompt can I<br />
                  <em style={{ color: '#7c5cff', fontStyle: 'italic' }}>optimize</em> for you?
                </h1>
              </div>
            </div>

            {/* Input */}
            <div style={{ width: '100%', maxWidth: 680, margin: '0 auto',
              paddingBottom: 32, paddingLeft: 16, paddingRight: 16 }}>
              <ChatInput
                onSubmit={handleSubmit}
                isLoading={isAnyLoading}
                hasPreviousTurns={false}
                defaultValue={templateDefault || prefillText}
                defaultName={prefillName}
                onPresetPrompts={templatesData ? () => setShowTemplates(true) : undefined}
                autoFocus
              />
            </div>
          </div>
        ) : (
          /* Conversation */
          <div className="max-w-2xl mx-auto px-4 py-8 space-y-10">
            {turns.map((turn) => (
              <ChatMessage
                key={turn.tempId}
                turn={turn}
                isTurnSelected={turn.tempId === selectedTurnId}
                onSelectTurn={() => handleSelectTurn(turn.tempId)}
                progress={turn.jobId === activeJobId ? streamProgress : undefined}
                onRetry={turn.status === 'failed' ? () => handleRetry(turn.tempId) : undefined}
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

      {/* ── Template picker modal ── */}
      {showTemplates && templatesData && (
        <TemplatePickerModal
          data={templatesData}
          onSelect={(content) => { setTemplateDefault(content); }}
          onClose={() => setShowTemplates(false)}
        />
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
