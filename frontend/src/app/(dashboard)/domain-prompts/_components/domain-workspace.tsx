'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DomainPrompt, DomainListResponse, DatasetRowsResponse, QAPair, TournamentState, OptimizationRun, RunListResponse } from '@/types/domain-prompts';
import { NewDomainModal } from '@/components/domain-prompts/new-domain-modal';

/* ── Icons ─────────────────────────────────────────────────────────── */
function Icon({ name, size = 16, color }: { name: string; size?: number; color?: string }) {
  const paths: Record<string, React.ReactNode> = {
    sparkles: <><path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="M5.5 5.5l2.5 2.5"/><path d="M16 16l2.5 2.5"/><path d="M5.5 18.5l2.5-2.5"/><path d="M16 8l2.5-2.5"/></>,
    flask: <><path d="M9 2v6.4a2 2 0 01-.34 1.12L4.5 16.5A3 3 0 007 21h10a3 3 0 002.5-4.5l-4.16-6.98A2 2 0 0115 8.4V2"/><path d="M8 2h8"/><path d="M7 16h10"/></>,
    chevronDown: <path d="m6 9 6 6 6-6"/>,
    plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
    trash: <><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/></>,
    trophy: <><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v6a5 5 0 01-10 0z"/><path d="M7 6H4a2 2 0 000 4h3"/><path d="M17 6h3a2 2 0 010 4h-3"/></>,
    swords: <><path d="m14.5 17.5 4 4"/><path d="m18.5 21.5 1.5-1.5"/><path d="M5 16l-2 2 3 3 2-2"/><path d="m20 4-7 7"/><path d="m4 20 7-7"/><path d="M14 7l3-3 4 4-3 3"/></>,
    file: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></>,
    fileText: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/></>,
    history: <><path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/></>,
    upload: <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></>,
    download: <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></>,
    copy: <><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></>,
    check: <path d="m20 6-11 11-5-5"/>,
    edit: <><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4z"/></>,
    layers: <><path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></>,
    cpu: <><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></>,
    heart: <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 10-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>,
    arrowRight: <><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></>,
    sparkle2: <><path d="m12 3-1.912 5.813a2 2 0 01-1.275 1.275L3 12l5.813 1.912a2 2 0 011.275 1.275L12 21l1.912-5.813a2 2 0 011.275-1.275L21 12l-5.813-1.912a2 2 0 01-1.275-1.275L12 3z"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color || 'currentColor'} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

/* ── Helpers ─────────────────────────────────────────────────────── */
function pdfFilename(pdfKey: string | undefined): string {
  if (!pdfKey) return 'source.pdf';
  return pdfKey.split('/').pop() ?? 'source.pdf';
}

/* ── Status pill ────────────────────────────────────────────────────── */
function StatusPill({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string; pulse: boolean }> = {
    completed:        { cls: 'ply-pill ply-pill-success', label: 'Ready',            pulse: false },
    preparing_dataset:{ cls: 'ply-pill ply-pill-warning', label: 'Building dataset', pulse: true },
    optimizing:       { cls: 'ply-pill ply-pill-primary', label: 'Tournament running', pulse: true },
    failed:           { cls: 'ply-pill',                  label: 'Failed',            pulse: false },
    pending:          { cls: 'ply-pill',                  label: 'Queued',            pulse: false },
  };
  const s = map[status] ?? map['pending'];
  return (
    <span className={s.cls} style={{ fontSize: 11 }}>
      <span className={`ply-dot${s.pulse ? ' ply-dot-pulse' : ''}`} style={{ background: 'currentColor' }} />
      {s.label}
    </span>
  );
}

/* ── Live stats bar (shown during optimizing status) ────────────── */
function LiveStatsBar({ domainId, datasetSize }: { domainId: string; datasetSize: number }) {
  const { data: state } = useQuery<TournamentState | null>({
    queryKey: ['tournament-state', domainId],
    queryFn: async () => {
      try {
        const res = await api.get<{ data: TournamentState }>(`/api/v1/domain-prompts/${domainId}/tournament-state`);
        return res.data.data;
      } catch {
        return null;
      }
    },
    refetchInterval: 2000,
    staleTime: 0,
  });

  const candidates = state?.candidate_count ?? '—';
  const trials = state ? `${state.round}/${state.total_rounds}` : '—';

  return (
    <div className="ply-card" style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 0 }}>
      <Stat label="Phase" value={`Round ${state?.round ?? '—'}`} hint={`of ${state?.total_rounds ?? 40}`} />
      <Stat label="Win rate" value="—" hint="winner head-to-head" />
      <Stat label="Candidates" value={String(candidates)} hint="pool size" />
      <Stat label="Trials" value={trials} hint="head-to-head" />
      <Stat label="Knowledge" value={String(datasetSize || '—')} hint="Q&A pairs" />
    </div>
  );
}

/* ── Tournament running visualization ───────────────────────────── */
type VizMode = 'matrix' | 'bracket';

const C_COLORS = ['#7c5cff', '#06b6d4', '#f59e0b', '#10b981', '#f43f5e', '#8b5cf6', '#ec4899'];

function TournamentRunningViz({ domainId, vizMode, onVizChange }: {
  domainId: string;
  vizMode: VizMode;
  onVizChange: (v: VizMode) => void;
}) {
  const { data: state } = useQuery<TournamentState | null>({
    queryKey: ['tournament-state', domainId],
    queryFn: async () => {
      try {
        const res = await api.get<{ data: TournamentState }>(`/api/v1/domain-prompts/${domainId}/tournament-state`);
        return res.data.data;
      } catch {
        return null;
      }
    },
    refetchInterval: 2000,
    staleTime: 0,
  });

  const n = state?.names.length ?? 0;
  const maxWinRate = state ? Math.max(...state.avg_win_rates) : 1;
  const minWinRate = state ? Math.min(...state.avg_win_rates) : 0;
  const winRateRange = Math.max(maxWinRate - minWinRate, 0.01);

  return (
    <div className="ply-card anim-fade" style={{ overflow: 'hidden' }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '1px solid var(--border)',
        background: 'linear-gradient(135deg, var(--primary-soft), transparent 70%)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="swords" size={16} color="var(--primary)" />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>Prompt Duel Optimizer</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              Double Thompson Sampling{state ? ` · duel: ${state.names[state.duel_i]} vs ${state.names[state.duel_j]}` : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {state && (
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              round {state.round}/{state.total_rounds}
            </span>
          )}
          <div className="ply-progress" style={{ width: 120 }}>
            <i style={{ width: state ? `${(state.round / state.total_rounds) * 100}%` : '0%', display: 'block', height: '100%', background: 'var(--primary)', borderRadius: 999, transition: 'width .5s ease' }} />
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', padding: '0 16px' }}>
        {(['matrix', 'bracket'] as VizMode[]).map(v => (
          <button key={v} onClick={() => onVizChange(v)} style={{
            padding: '8px 14px', border: 0, background: 'transparent', cursor: 'pointer',
            borderBottom: vizMode === v ? '2px solid var(--primary)' : '2px solid transparent',
            color: vizMode === v ? 'var(--primary)' : 'var(--text-muted)',
            fontWeight: vizMode === v ? 600 : 400, fontSize: 12.5, marginBottom: -1,
          }}>
            {v === 'matrix' ? `WIN MATRIX · W[I, J]` : 'WIN RATES'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ display: 'grid', gridTemplateColumns: state ? '1fr 1px 300px' : '1fr', minHeight: 240 }}>
        <div style={{ padding: '16px 18px' }}>
          {!state && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-subtle)', fontSize: 13 }}>
              <span className="ply-dot ply-dot-pulse" style={{ background: 'var(--primary)', width: 7, height: 7 }} />
              Waiting for first round…
            </div>
          )}

          {state && vizMode === 'matrix' && (
            <div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: `60px repeat(${n}, minmax(36px, 1fr))`,
                gap: 3, fontSize: 12,
              }}>
                {/* Column headers */}
                <div />
                {state.names.map((name, ci) => (
                  <div key={ci} style={{
                    textAlign: 'center', fontWeight: 700,
                    color: C_COLORS[ci % C_COLORS.length],
                    fontFamily: 'var(--mono)', fontSize: 11.5, paddingBottom: 4,
                  }}>{name}</div>
                ))}
                {/* Rows */}
                {state.names.map((name, ri) => [
                  <div key={`lbl-${ri}`} style={{
                    fontWeight: 700, color: C_COLORS[ri % C_COLORS.length],
                    fontFamily: 'var(--mono)', fontSize: 11.5,
                    display: 'flex', alignItems: 'center',
                  }}>{name}</div>,
                  ...state.names.map((_, ci) => {
                    const isSelf = ri === ci;
                    const isDuelCell = (ri === state.duel_i && ci === state.duel_j) || (ri === state.duel_j && ci === state.duel_i);
                    const wins = state.W[ri][ci];
                    const bg = isSelf
                      ? 'var(--surface-3)'
                      : isDuelCell
                        ? 'rgba(124,92,255,0.22)'
                        : wins > 2
                          ? `rgba(124,92,255,${Math.min(0.6, wins * 0.08)})`
                          : 'var(--surface-2)';
                    return (
                      <div key={ci} style={{
                        background: bg,
                        borderRadius: 5, padding: '7px 4px',
                        textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 600,
                        color: isSelf ? 'var(--text-subtle)' : wins > 0 ? 'var(--primary)' : 'var(--text-subtle)',
                        fontSize: 13,
                        border: isDuelCell ? '1.5px solid var(--primary)' : '1.5px solid transparent',
                        transition: 'background .4s ease, color .4s ease',
                      }}>
                        {isSelf ? '–' : wins.toFixed(1)}
                      </div>
                    );
                  })
                ])}
              </div>
            </div>
          )}

          {state && vizMode === 'bracket' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {state.names.map((name, i) => {
                const rate = state.avg_win_rates[i];
                const pct = ((rate - minWinRate) / winRateRange) * 80 + 10;
                const isLeading = rate === maxWinRate;
                return (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '56px 1fr 64px', alignItems: 'center', gap: 10 }}>
                    <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: C_COLORS[i % C_COLORS.length] }}>{name}</span>
                    <div style={{ height: 10, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 999,
                        background: isLeading ? 'var(--primary)' : C_COLORS[i % C_COLORS.length],
                        width: `${pct}%`, opacity: 0.85,
                        transition: 'width .6s ease',
                      }} />
                    </div>
                    <span className="mono" style={{ fontSize: 11.5, color: isLeading ? 'var(--primary)' : 'var(--text-muted)', textAlign: 'right', fontWeight: isLeading ? 700 : 400 }}>
                      {(rate * 100).toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Divider + Current duel panel */}
        {state && (
          <>
            <div style={{ background: 'var(--border)' }} />
            <div style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 700 }}>Current duel</div>
              {/* Candidate A */}
              <div className="ply-card" style={{ padding: '10px 12px', borderColor: `${C_COLORS[state.duel_i % C_COLORS.length]}55` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span className="mono" style={{ fontSize: 11, color: C_COLORS[state.duel_i % C_COLORS.length], fontWeight: 700 }}>A · {state.names[state.duel_i]}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                    win rate {(state.avg_win_rates[state.duel_i] * 100).toFixed(0)}%
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', fontStyle: 'italic' }}>answering Q…</div>
                <div style={{ marginTop: 6, height: 2, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden' }}>
                  <div className="ply-progress indet" style={{ height: '100%' }}><i /></div>
                </div>
              </div>
              {/* Candidate B */}
              <div className="ply-card" style={{ padding: '10px 12px', borderColor: `${C_COLORS[state.duel_j % C_COLORS.length]}55` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span className="mono" style={{ fontSize: 11, color: C_COLORS[state.duel_j % C_COLORS.length], fontWeight: 700 }}>B · {state.names[state.duel_j]}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                    copeland {(state.copeland_scores[state.duel_j] * 100).toFixed(0)}%
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', fontStyle: 'italic' }}>answering Q…</div>
                <div style={{ marginTop: 6, height: 2, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden' }}>
                  <div className="ply-progress indet" style={{ height: '100%' }}><i /></div>
                </div>
              </div>
              {/* Question snippet */}
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', lineHeight: 1.5, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Q: </span>
                {state.question.length > 80 ? state.question.slice(0, 80) + '…' : state.question}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Optimize tab ────────────────────────────────────────────────── */

function OptimizeTab({ domain, onReoptimize, reoptimizing, sessionResult, onClearResult }: {
  domain: DomainPrompt;
  onReoptimize: (prompt: string) => void;
  reoptimizing: boolean;
  sessionResult: { optimized_prompt: string; prompt_input: string; win_rate: number | null; candidates_tried: number | null; } | null;
  onClearResult: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [vizMode, setVizMode] = useState<VizMode>('matrix');
  const [runAgainMode, setRunAgainMode] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset local state whenever the domain itself changes
  useEffect(() => {
    setRunAgainMode(false);
    setDraft('');
    setCopied(false);
  }, [domain.id]);

  useEffect(() => {
    if (sessionResult) setRunAgainMode(false);
  }, [sessionResult]);

  const { data: runsData } = useQuery<RunListResponse>({
    queryKey: ['domain-runs', domain.id],
    queryFn: async () => {
      const res = await api.get<{ data: RunListResponse }>(`/api/v1/domain-prompts/${domain.id}/runs`);
      return res.data.data;
    },
  });

  const latestRun = runsData?.runs?.find(r => r.status === 'completed') ?? null;
  const displayResult = sessionResult ?? (!runAgainMode && latestRun ? {
    optimized_prompt: latestRun.optimized_prompt,
    prompt_input: latestRun.prompt_input,
    win_rate: latestRun.win_rate,
    candidates_tried: latestRun.candidates_tried,
  } : null);

  const isRunning = ['pending', 'preparing_dataset', 'optimizing'].includes(domain.status);
  const busy = isRunning || reoptimizing;
  const datasetReady = !!domain.dataset?.dataset_key;
  const hasResult = !!displayResult && !busy;
  const canSubmit = datasetReady && !busy && draft.trim().length >= 10;

  function copyResult() {
    if (!displayResult?.optimized_prompt) return;
    navigator.clipboard.writeText(displayResult.optimized_prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  }

  function runAgain() {
    onClearResult();
    setRunAgainMode(true);
    textareaRef.current?.focus();
  }

  function submit() {
    if (!canSubmit) return;
    const t = draft.trim();
    setDraft('');
    setRunAgainMode(true);
    onClearResult();
    onReoptimize(t);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }}>
      {hasResult && (
        <div className="ply-card" style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0 }}>
          <Stat label="Win rate" value={displayResult?.win_rate != null ? `${Math.round(displayResult.win_rate * 100)}%` : '—'} hint="winner head-to-head" color="var(--success)" />
          <Stat label="Candidates" value={String(displayResult?.candidates_tried ?? '—')} hint="tested in tournament" />
          <Stat label="Trials" value={String(latestRun?.rounds_run ?? 30)} hint="head-to-head" />
          <Stat label="Knowledge" value={String(domain.dataset?.row_count ?? '—')} hint="Q&A pairs" />
        </div>
      )}

      {busy && domain.status === 'preparing_dataset' && (
        <div className="ply-card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="ply-dot ply-dot-pulse" style={{ background: 'var(--primary)', width: 8, height: 8 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>Building knowledge base…</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Extracting Q&A pairs from your PDF.</div>
            </div>
          </div>
          <div className="ply-progress" style={{ width: 160 }}><i /></div>
        </div>
      )}

      {busy && domain.status === 'optimizing' && (
        <LiveStatsBar domainId={domain.id} datasetSize={domain.dataset?.row_count ?? 0} />
      )}

      {busy && domain.status === 'optimizing' && (
        <TournamentRunningViz domainId={domain.id} vizMode={vizMode} onVizChange={setVizMode} />
      )}

      {hasResult && (
        <div className="ply-card anim-fade" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '14px 18px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'linear-gradient(135deg, var(--primary-soft), transparent 70%)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon name="trophy" size={18} color="var(--primary)" />
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>PDO winner · empirically tested</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  Tournament win rate: <span className="mono" style={{ color: 'var(--success)', fontWeight: 600 }}>
                    {displayResult?.win_rate != null ? `${Math.round(displayResult.win_rate * 100)}%` : '—'}
                  </span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="ply-btn ply-btn-sm" onClick={runAgain}>
                <Icon name="sparkles" size={12} /> Run again
              </button>
              <button className="ply-btn ply-btn-sm" onClick={copyResult}>
                <Icon name={copied ? 'check' : 'copy'} size={12} />
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button className="ply-btn ply-btn-sm"><Icon name="heart" size={12} /> Save</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', minHeight: 280 }}>
            <div style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, marginBottom: 8 }}>Input prompt</div>
              <pre className="ply-prompt-block" style={{ margin: 0, color: 'var(--text-muted)' }}>{displayResult?.prompt_input}</pre>
            </div>
            <div style={{ background: 'var(--border)' }} />
            <div style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: 11, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, marginBottom: 8 }}>PDO optimized</div>
              <pre className="ply-prompt-block" style={{ margin: 0 }}>{displayResult?.optimized_prompt}</pre>
            </div>
          </div>
        </div>
      )}

      {!hasResult && !busy && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 380 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--primary-soft)', display: 'grid', placeItems: 'center', margin: '0 auto', color: 'var(--primary)' }}>
              <Icon name="swords" size={22} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Run the PDO tournament</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              {datasetReady
                ? 'Paste your system prompt below. We\'ll run 40 head-to-head trials to find the best version.'
                : 'Dataset is still being built from your PDF. Come back in a moment.'}
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1 }} />

      {datasetReady && (
        <div className="ply-card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
            placeholder={hasResult ? 'Paste a new prompt to run another tournament… (⌘↵ to run)' : 'Paste your system prompt here to optimize against this domain… (⌘↵ to run)'}
            disabled={busy}
            rows={3}
            style={{
              width: '100%', resize: 'vertical', minHeight: 64,
              border: 0, outline: 'none', background: 'transparent',
              color: 'var(--text)', fontSize: 13.5, lineHeight: 1.6,
              fontFamily: 'var(--mono)',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--text-subtle)', fontSize: 11.5 }}>
              <span className="ply-pill"><Icon name="layers" size={11} /> {domain.dataset?.row_count ?? 0} Q&A</span>
              <span className="ply-pill"><Icon name="cpu" size={11} /> 40 rounds D-TS · 5 rankers</span>
            </div>
            <button
              className="ply-btn ply-btn-primary"
              onClick={submit}
              disabled={!canSubmit}
              style={{ opacity: !canSubmit ? 0.5 : 1, cursor: !canSubmit ? 'not-allowed' : 'pointer' }}
            >
              <Icon name="trophy" size={14} />
              {busy ? 'Running PDO…' : hasResult ? 'Run again' : 'Run PDO'}
              <span className="mono" style={{ marginLeft: 6, fontSize: 11, opacity: .75, paddingLeft: 8, borderLeft: '1px solid rgba(255,255,255,.25)' }}>−10 cr</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingRight: 12, paddingLeft: 4 }}>
      <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>{label}</div>
      <div className="mono" style={{ fontSize: 20, fontWeight: 600, color: color ?? 'var(--text)' }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hint}</div>}
    </div>
  );
}

/* ── Dataset tab ─────────────────────────────────────────────────── */
const PAGE_SIZE = 20;

function DatasetTab({ domain }: { domain: DomainPrompt }) {
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [editRows, setEditRows] = useState<QAPair[]>([]);
  const [saving, setSaving] = useState(false);
  const [augmentCount] = useState(10);
  const [augmenting, setAugmenting] = useState(false);
  const [pollingAugJob, setPollingAugJob] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<DatasetRowsResponse>({
    queryKey: ['domain-dataset', domain.id],
    queryFn: async () => {
      const res = await api.get<{ data: DatasetRowsResponse }>(`/api/v1/domain-prompts/${domain.id}/dataset`);
      return res.data.data;
    },
    enabled: !!domain.dataset?.dataset_key,
  });

  useEffect(() => {
    if (!pollingAugJob) return;
    const iv = setInterval(async () => {
      try {
        const res = await api.get<{ data: { status: string } }>(`/api/v1/domain-prompts/jobs/${pollingAugJob}`);
        const { status } = res.data.data;
        if (status === 'completed' || status === 'failed') {
          setPollingAugJob(null);
          setAugmenting(false);
          void qc.invalidateQueries({ queryKey: ['domain-dataset', domain.id] });
          void qc.invalidateQueries({ queryKey: ['domain-prompts'] });
        }
      } catch { setPollingAugJob(null); setAugmenting(false); }
    }, 2500);
    return () => clearInterval(iv);
  }, [pollingAugJob, domain.id, qc]);

  const saveMutation = useMutation({
    mutationFn: async (rows: QAPair[]) => {
      const res = await api.put<{ data: DatasetRowsResponse }>(`/api/v1/domain-prompts/${domain.id}/dataset`, { rows });
      return res.data.data;
    },
    onSuccess: () => { setSaving(false); setEditMode(false); void qc.invalidateQueries({ queryKey: ['domain-dataset', domain.id] }); },
    onError: () => setSaving(false),
  });

  async function handleAugment() {
    setAugmenting(true);
    try {
      const res = await api.post<{ data: { job_id: string } }>(`/api/v1/domain-prompts/${domain.id}/dataset/augment`, { count: augmentCount });
      setPollingAugJob(res.data.data.job_id);
    } catch { setAugmenting(false); }
  }

  function handleExportJsonl() {
    const rows = data?.rows ?? [];
    const lines = rows.map(r => JSON.stringify({ question: r.question, answer: r.answer })).join('\n');
    const blob = new Blob([lines], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pdfFilename(domain.dataset?.pdf_key).replace('.pdf', '')}-dataset.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const rows = data?.rows ?? [];
  const totalRows = editMode ? editRows.length : rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE;
  const sourceRows = editMode ? editRows : rows;
  const displayRows = sourceRows.slice(pageStart, pageEnd);

  function goToPage(p: number) {
    setPage(Math.max(1, Math.min(p, totalPages)));
  }

  if (!domain.dataset?.dataset_key) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
      Dataset not yet available.
    </div>
  );
  if (isLoading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
      Loading…
    </div>
  );

  return (
    <div style={{ padding: '18px 24px 32px' }}>
      <div className="ply-card" style={{ padding: 0, overflow: 'hidden' }}>

        {/* Source info bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="file" size={14} color="var(--text-muted)" />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{pdfFilename(domain.dataset?.pdf_key)}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                {rows.length} Q&A pairs
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {!editMode ? (
              <>
                <button className="ply-btn ply-btn-sm" onClick={handleExportJsonl}>
                  <Icon name="download" size={12} /> Export JSONL
                </button>
                <button
                  className="ply-btn ply-btn-sm"
                  onClick={handleAugment}
                  disabled={augmenting || !!pollingAugJob}
                  style={{ opacity: augmenting || pollingAugJob ? 0.5 : 1 }}
                >
                  <Icon name="sparkle2" size={12} />
                  {augmenting || pollingAugJob ? 'Augmenting…' : `Augment +${augmentCount}`}
                </button>
                <button className="ply-btn ply-btn-sm" onClick={() => { setEditRows(rows); setEditMode(true); }}>
                  <Icon name="edit" size={12} /> Edit
                </button>
              </>
            ) : (
              <>
                <button className="ply-btn ply-btn-sm" onClick={() => setEditMode(false)}>Cancel</button>
                <button className="ply-btn ply-btn-sm ply-btn-primary" disabled={saving}
                  onClick={() => { setSaving(true); saveMutation.mutate(editRows.filter(r => r.question.trim() && r.answer.trim())); }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Column headers */}
        <div style={{
          display: 'grid', gridTemplateColumns: '52px 1fr 1.4fr 40px',
          padding: '9px 16px', borderBottom: '1px solid var(--border)',
          fontSize: 11, color: 'var(--text-subtle)', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '.08em',
          background: 'var(--surface-2)',
        }}>
          <span>#</span><span>Question</span><span>Answer</span><span />
        </div>

        {/* Rows */}
        {displayRows.map((row, i) => {
          const globalIdx = pageStart + i;
          return (
            <div key={globalIdx} style={{
              display: 'grid', gridTemplateColumns: '52px 1fr 1.4fr 40px',
              padding: '14px 16px', borderBottom: '1px solid var(--border)',
              fontSize: 13, alignItems: 'flex-start', gap: 8,
            }}>
              <span className="mono" style={{ color: 'var(--text-subtle)', fontSize: 12, paddingTop: editMode ? 8 : 3 }}>q{globalIdx + 1}</span>
              {editMode ? (
                <textarea value={row.question}
                  onChange={e => setEditRows(r => r.map((x, j) => j === globalIdx ? { ...x, question: e.target.value } : x))}
                  rows={2} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', resize: 'vertical', background: 'var(--surface-2)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, outline: 'none' }} />
              ) : (
                <span style={{ color: 'var(--text)', lineHeight: 1.55 }}>{row.question}</span>
              )}
              {editMode ? (
                <textarea value={row.answer}
                  onChange={e => setEditRows(r => r.map((x, j) => j === globalIdx ? { ...x, answer: e.target.value } : x))}
                  rows={2} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', resize: 'vertical', background: 'var(--surface-2)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, outline: 'none' }} />
              ) : (
                <span style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>{row.answer}</span>
              )}
              <button
                aria-label="Remove row"
                onClick={() => { if (editMode) setEditRows(r => r.filter((_, idx) => idx !== globalIdx)); }}
                style={{
                  background: 'none', border: 'none', color: 'var(--text-subtle)',
                  cursor: editMode ? 'pointer' : 'default',
                  display: 'grid', placeItems: 'center', padding: 4,
                  opacity: editMode ? 0.6 : 0.15,
                }}>
                <Icon name="trash" size={13} />
              </button>
            </div>
          );
        })}

        {rows.length === 0 && !editMode && (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>No Q&A pairs yet.</div>
        )}

        {/* Footer: count + pagination + add row */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', borderTop: '1px solid var(--border)',
          gap: 12,
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {totalRows === 0 ? 'No rows' : `${pageStart + 1}–${Math.min(pageEnd, totalRows)} of ${totalRows}`}
          </span>

          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                className="ply-btn ply-btn-sm"
                onClick={() => goToPage(1)}
                disabled={safePage === 1}
                style={{ padding: '0 7px', opacity: safePage === 1 ? 0.4 : 1 }}
                aria-label="First page"
              >«</button>
              <button
                className="ply-btn ply-btn-sm"
                onClick={() => goToPage(safePage - 1)}
                disabled={safePage === 1}
                style={{ padding: '0 7px', opacity: safePage === 1 ? 0.4 : 1 }}
                aria-label="Previous page"
              >‹</button>

              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                .reduce<(number | '…')[]>((acc, p, idx, arr) => {
                  if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('…');
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, idx) =>
                  p === '…' ? (
                    <span key={`ellipsis-${idx}`} style={{ fontSize: 12, color: 'var(--text-subtle)', padding: '0 4px' }}>…</span>
                  ) : (
                    <button
                      key={p}
                      className="ply-btn ply-btn-sm"
                      onClick={() => goToPage(p as number)}
                      style={{
                        padding: '0 9px', minWidth: 28,
                        background: p === safePage ? 'var(--primary)' : undefined,
                        color: p === safePage ? '#fff' : undefined,
                        borderColor: p === safePage ? 'transparent' : undefined,
                        fontWeight: p === safePage ? 600 : 400,
                      }}
                    >{p}</button>
                  )
                )
              }

              <button
                className="ply-btn ply-btn-sm"
                onClick={() => goToPage(safePage + 1)}
                disabled={safePage === totalPages}
                style={{ padding: '0 7px', opacity: safePage === totalPages ? 0.4 : 1 }}
                aria-label="Next page"
              >›</button>
              <button
                className="ply-btn ply-btn-sm"
                onClick={() => goToPage(totalPages)}
                disabled={safePage === totalPages}
                style={{ padding: '0 7px', opacity: safePage === totalPages ? 0.4 : 1 }}
                aria-label="Last page"
              >»</button>
            </div>
          )}

          <button
            className="ply-btn ply-btn-sm"
            style={{ gap: 5, whiteSpace: 'nowrap' }}
            onClick={() => {
              if (!editMode) {
                const newRows = [...rows, { question: '', answer: '' }];
                setEditRows(newRows);
                setEditMode(true);
                setPage(Math.ceil(newRows.length / PAGE_SIZE));
              } else {
                setEditRows(r => {
                  const updated = [...r, { question: '', answer: '' }];
                  setPage(Math.ceil(updated.length / PAGE_SIZE));
                  return updated;
                });
              }
            }}
          >
            <Icon name="plus" size={12} /> Add row
          </button>
        </div>

      </div>
    </div>
  );
}

/* ── History tab ───────────────────────────────────────────────────── */
function HistoryTab({ domain }: { domain: DomainPrompt }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<RunListResponse>({
    queryKey: ['domain-runs', domain.id],
    queryFn: async () => {
      const res = await api.get<{ data: RunListResponse }>(`/api/v1/domain-prompts/${domain.id}/runs`);
      return res.data.data;
    },
  });

  const runs = data?.runs ?? [];

  if (isLoading) {
    return (
      <div className="ply-card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
        Loading history…
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="ply-card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
        No runs yet. Submit a prompt in the Optimize tab to start the first tournament.
      </div>
    );
  }

  return (
    <div className="ply-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 13 }}>
        Tournament history · {domain.name}
        <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 11.5, color: 'var(--text-subtle)' }}>
          {runs.length} run{runs.length !== 1 ? 's' : ''}
        </span>
      </div>
      {runs.slice(0, 5).map((run: OptimizationRun) => {
        const isFailed = run.status === 'failed';
        return (
          <div key={run.id}>
            <div
              onClick={() => setExpandedId(expandedId === run.id ? null : run.id)}
              style={{
                display: 'grid',
                gridTemplateColumns: '160px 1fr 100px 100px 1fr',
                gap: 10, alignItems: 'center',
                padding: '12px 16px', fontSize: 12.5,
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
                background: expandedId === run.id ? 'var(--surface-2)' : undefined,
                opacity: isFailed ? 0.8 : 1,
              }}
            >
              <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                {new Date(run.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
              <span style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                {isFailed
                  ? <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: 'var(--danger-soft, rgba(239,68,68,0.12))', color: 'var(--danger)', letterSpacing: '.04em' }}>FAILED</span>
                  : <Icon name="trophy" size={12} />
                }
                {run.domain_name}
              </span>
              <span className="mono" style={{ color: isFailed ? 'var(--text-subtle)' : undefined }}>
                {isFailed ? '—' : (run.win_rate != null ? `${Math.round(run.win_rate * 100)}% wr` : '—')}
              </span>
              <span className="mono" style={{ color: 'var(--text-muted)' }}>
                {isFailed ? '—' : `${run.rounds_run ?? 40} rounds`}
              </span>
              <span style={{ color: expandedId === run.id ? 'var(--primary)' : 'var(--text-subtle)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                {expandedId === run.id ? '▲ hide' : (isFailed ? '▼ view error' : '▼ view prompt')}
              </span>
            </div>
            {expandedId === run.id && (
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, marginBottom: 6 }}>Input prompt</div>
                  <pre className="ply-prompt-block" style={{ margin: 0, fontSize: 12, maxHeight: 120, overflowY: 'auto' }}>{run.prompt_input}</pre>
                </div>
                {isFailed ? (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, marginBottom: 6 }}>Error</div>
                    <pre className="ply-prompt-block" style={{ margin: 0, fontSize: 12, color: 'var(--danger)', maxHeight: 120, overflowY: 'auto' }}>{run.error_message ?? 'Unknown error'}</pre>
                  </div>
                ) : (
                  <>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, marginBottom: 6 }}>PDO optimized</div>
                      <pre className="ply-prompt-block" style={{ margin: 0, fontSize: 12, maxHeight: 180, overflowY: 'auto' }}>{run.optimized_prompt}</pre>
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                      {run.score_before != null && <span>Score before: <strong>{run.score_before.toFixed(3)}</strong></span>}
                      {run.score_after != null && <span>Score after: <strong>{run.score_after.toFixed(3)}</strong></span>}
                      {run.candidates_tried != null && <span>Candidates: <strong>{run.candidates_tried}</strong></span>}
                      {run.dataset_size != null && <span>Dataset: <strong>{run.dataset_size} Q&A</strong></span>}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {runs.length > 5 && (
        <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-subtle)', textAlign: 'center' }}>
          Showing 5 of {runs.length} runs
        </div>
      )}
    </div>
  );
}

/* ── Domain switcher dropdown ────────────────────────────────────── */
function DomainSwitcher({ domains, selected, onSelect, onNewDomain }: {
  domains: DomainPrompt[];
  selected: DomainPrompt | null;
  onSelect: (d: DomainPrompt) => void;
  onNewDomain: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const filename = selected?.dataset?.pdf_key ? pdfFilename(selected.dataset.pdf_key) : null;

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="ply-btn"
        style={{ height: 44, padding: '0 12px', gap: 10, whiteSpace: 'nowrap', maxWidth: 320 }}
      >
        <div style={{
          width: 28, height: 28, borderRadius: 7, flexShrink: 0,
          background: 'linear-gradient(135deg, var(--primary), var(--accent))',
          display: 'grid', placeItems: 'center', color: 'white',
        }}>
          <Icon name="flask" size={14} />
        </div>
        <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selected?.name ?? 'Select domain'}
          </span>
          {filename && (
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {filename}
            </span>
          )}
        </div>
        <Icon name="chevronDown" size={14} />
      </button>

      {open && (
        <div className="ply-card anim-fade-fast" style={{
          position: 'absolute', top: 52, left: 0, width: 400, zIndex: 20,
          padding: 6, boxShadow: 'var(--shadow-lg)',
        }}>
          {domains.map(d => (
            <button key={d.id} onClick={() => { onSelect(d); setOpen(false); }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 10px', borderRadius: 7, border: 0,
                background: d.id === selected?.id ? 'var(--surface-2)' : 'transparent',
                textAlign: 'left', cursor: 'pointer', color: 'var(--text)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = d.id === selected?.id ? 'var(--surface-2)' : 'transparent')}
            >
              <div style={{
                width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                background: 'var(--surface-3)', display: 'grid', placeItems: 'center',
              }}>
                <Icon name="flask" size={14} color="var(--text-muted)" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pdfFilename(d.dataset?.pdf_key)} · {d.dataset?.row_count ?? 0} Q&A
                  {d.win_rate ? ` · last ${Math.round(d.win_rate * 100)}% wr` : ''}
                </div>
              </div>
              <StatusPill status={d.status} />
            </button>
          ))}
          <div style={{ padding: 6, borderTop: '1px solid var(--border)', marginTop: 4 }}>
            <button className="ply-btn ply-btn-sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => { onNewDomain(); setOpen(false); }}>
              <Icon name="upload" size={12} /> Upload new PDF · 10 credits
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main workspace ──────────────────────────────────────────────── */
export function DomainWorkspace() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'optimize' | 'dataset' | 'history'>('optimize');
  const [showNew, setShowNew] = useState(false);
  const [pollingJobId, setPollingJobId] = useState<string | null>(null);
  const [pollingDomainId, setPollingDomainId] = useState<string | null>(null);
  const [reoptimizing, setReoptimizing] = useState(false);
  const [sessionResult, setSessionResult] = useState<{
    optimized_prompt: string;
    prompt_input: string;
    win_rate: number | null;
    candidates_tried: number | null;
  } | null>(null);
  const pendingPromptRef = useRef('');

  const { data, isLoading } = useQuery<DomainListResponse>({
    queryKey: ['domain-prompts'],
    queryFn: async () => {
      const res = await api.get<{ data: DomainListResponse }>('/api/v1/domain-prompts/');
      return res.data.data;
    },
    refetchInterval: (query) => {
      if (pollingJobId) return 3000;
      const domains = (query.state.data as DomainListResponse | undefined)?.domains ?? [];
      const hasActive = domains.some(d => ['pending', 'preparing_dataset', 'optimizing'].includes(d.status));
      return hasActive ? 3000 : false;
    },
  });

  const domains = data?.domains ?? [];
  // Only fall back to domains[0] when selectedId is null (nothing explicitly chosen).
  // If selectedId is set but not found yet (new domain still loading), keep selected=null
  // so the tab body shows a loading state instead of the previous domain's content.
  const selected = selectedId
    ? (domains.find(d => d.id === selectedId) ?? null)
    : (domains[0] ?? null);

  useEffect(() => {
    if (!selectedId && domains.length > 0) setSelectedId(domains[0].id);
  }, [domains, selectedId]);

  useEffect(() => {
    setSessionResult(null);
  }, [selectedId]);

  useEffect(() => {
    if (!pollingJobId) return;
    const iv = setInterval(async () => {
      try {
        const res = await api.get<{ data: { status: string; result?: Record<string, unknown> } }>(`/api/v1/domain-prompts/jobs/${pollingJobId}`);
        const { status, result } = res.data.data;
        if (status === 'completed') {
          setPollingJobId(null);
          setPollingDomainId(null);
          setReoptimizing(false);
          void qc.invalidateQueries({ queryKey: ['domain-prompts'] });
          void qc.invalidateQueries({ queryKey: ['domain-runs', pollingDomainId] });
          if (result) {
            setSessionResult({
              optimized_prompt: String(result.optimized_prompt ?? ''),
              prompt_input: pendingPromptRef.current,
              win_rate: result.win_rate != null ? Number(result.win_rate) : null,
              candidates_tried: result.candidates_tried != null ? Number(result.candidates_tried) : null,
            });
          }
        } else if (status === 'failed') {
          setPollingJobId(null);
          setPollingDomainId(null);
          setReoptimizing(false);
          void qc.invalidateQueries({ queryKey: ['domain-prompts'] });
        }
      } catch { setPollingJobId(null); setPollingDomainId(null); setReoptimizing(false); }
    }, 3000);
    return () => clearInterval(iv);
  }, [pollingJobId, pollingDomainId, qc]);

  const handleReoptimize = useCallback(async (prompt: string) => {
    if (!selected) return;
    pendingPromptRef.current = prompt;
    setReoptimizing(true);
    const capturedDomainId = selected.id;
    try {
      const res = await api.post<{ data: { job_id: string; domain_id: string } }>(
        `/api/v1/domain-prompts/${capturedDomainId}/optimize`, { prompt }
      );
      setPollingDomainId(capturedDomainId);
      setPollingJobId(res.data.data.job_id);
    } catch { setReoptimizing(false); }
  }, [selected]);

  const handleDelete = useCallback(async () => {
    if (!selected) return;
    if (!window.confirm('Delete this domain and all its data? This cannot be undone.')) return;
    try {
      await api.delete(`/api/v1/domain-prompts/${selected.id}`);
      setSelectedId(null);
      void qc.invalidateQueries({ queryKey: ['domain-prompts'] });
    } catch { /* ignore */ }
  }, [selected, qc]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* ── Top bar ── */}
      <div style={{
        padding: '14px 24px 0',
        background: 'var(--bg)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 0 }}>
          {/* Left: domain switcher + status pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
            <DomainSwitcher
              domains={domains}
              selected={selected}
              onSelect={d => setSelectedId(d.id)}
              onNewDomain={() => setShowNew(true)}
            />
            {selected && (
              <>
                <StatusPill status={selected.status} />
                {selected.dataset?.row_count != null && (
                  <span className="ply-pill" style={{ fontSize: 11 }}>
                    <Icon name="layers" size={11} /> {selected.dataset.row_count} Q&A
                  </span>
                )}
                {selected.win_rate != null && (
                  <span className="ply-pill ply-pill-success" style={{ fontSize: 11 }}>
                    last run {Math.round(selected.win_rate * 100)}% wr
                  </span>
                )}
              </>
            )}
          </div>

          {/* Right: delete + new domain */}
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button className="ply-btn ply-btn-sm" aria-label="Delete domain" onClick={handleDelete} title="Delete domain">
              <Icon name="trash" size={13} />
            </button>
            <button
              className="ply-btn ply-btn-primary"
              onClick={() => setShowNew(true)}
              style={{ height: 34, padding: '0 14px', gap: 6, fontSize: 13, fontWeight: 500 }}
            >
              <Icon name="plus" size={13} /> New domain
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 0, marginTop: 14 }}>
          {[
            { id: 'optimize',  label: 'Optimize',                                    icon: 'sparkles'  },
            { id: 'dataset',   label: `Dataset (${selected?.dataset?.row_count ?? 0})`, icon: 'fileText'  },
            { id: 'history',   label: 'Tournament history',                           icon: 'history'   },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as typeof tab)} style={{
              padding: '10px 16px', border: 0, background: 'transparent',
              borderBottom: tab === t.id ? '2px solid var(--primary)' : '2px solid transparent',
              color: tab === t.id ? 'var(--text)' : 'var(--text-muted)',
              fontWeight: tab === t.id ? 500 : 400,
              fontSize: 13.5, marginBottom: -1,
              display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
            }}>
              <Icon name={t.icon} size={13} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab body ── */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {isLoading && !selected && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <span className="ply-dot ply-dot-pulse" style={{ width: 8, height: 8, background: 'var(--primary)' }} />
          </div>
        )}

        {!isLoading && domains.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 380 }}>
              <div style={{ width: 54, height: 54, borderRadius: 14, background: 'var(--primary-soft)', display: 'grid', placeItems: 'center', margin: '0 auto', color: 'var(--primary)' }}>
                <Icon name="upload" size={24} />
              </div>
              <div style={{ fontSize: 17, fontWeight: 600 }}>No domains yet</div>
              <div style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                Upload a PDF to create a knowledge base. The optimizer will test prompts against real questions from your document.
              </div>
              <button className="ply-btn ply-btn-primary" style={{ alignSelf: 'center' }} onClick={() => setShowNew(true)}>
                <Icon name="upload" size={14} /> Upload PDF · 10 credits
              </button>
            </div>
          </div>
        )}

        {selected && tab === 'optimize' && (
          <div style={{ padding: '18px 24px 24px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: '100%' }}>
            <OptimizeTab domain={selected} onReoptimize={handleReoptimize} reoptimizing={reoptimizing} sessionResult={sessionResult} onClearResult={() => setSessionResult(null)} />
          </div>
        )}
        {selected && tab === 'dataset' && <DatasetTab domain={selected} />}
        {selected && tab === 'history' && (
          <div style={{ padding: '18px 24px 24px' }}>
            <HistoryTab domain={selected} />
          </div>
        )}
      </div>

      {showNew && (
        <NewDomainModal
          onClose={() => setShowNew(false)}
          onJobStarted={(jobId, domainId) => {
            setPollingJobId(jobId);
            setShowNew(false);
            if (domainId) setSelectedId(domainId);
            void qc.invalidateQueries({ queryKey: ['domain-prompts'] });
          }}
        />
      )}
    </div>
  );
}
