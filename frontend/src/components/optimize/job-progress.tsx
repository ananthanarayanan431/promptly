'use client';

import { useState, useRef, useEffect } from 'react';
import type { JobProgressEvent } from '@/types/api';

// ─── Phase derivation ──────────────────────────────────────────────────────

type Phase = 'analyzing' | 'optimizing' | 'refining' | 'done';

interface PhaseInfo {
  phase: Phase;
  label: string;
  sublabel: string;
  progress: number; // 0–100
}

function derivePhase(events: JobProgressEvent[]): PhaseInfo {
  if (events.length === 0) {
    return { phase: 'analyzing', label: 'Optimizing your prompt', sublabel: 'Understanding the task…', progress: 2 };
  }

  let seenIntent = false;
  let seenSubject = false;
  let maxCouncilDone = 0;
  let councilTotal = 4;
  let seenCritic = false;
  let seenSynthesize = false;
  let lastGateDecision: string | undefined;
  let maxIteration = 0;

  for (const ev of events) {
    const iter = ev.iteration ?? 0;
    if (iter > maxIteration) maxIteration = iter;

    if (ev.step === 'intent') seenIntent = true;
    else if (ev.step === 'subject') seenSubject = true;
    else if (ev.step === 'council') {
      if ((ev.done ?? 0) > maxCouncilDone) maxCouncilDone = ev.done ?? 0;
      if (ev.total) councilTotal = ev.total;
    } else if (ev.step === 'critic') seenCritic = true;
    else if (ev.step === 'synthesize') seenSynthesize = true;
    else if (ev.step === 'quality_gate') {
      lastGateDecision = ev.decision;
      if (ev.decision === 'loop') {
        maxCouncilDone = 0;
        seenCritic = false;
        seenSynthesize = false;
      }
    }
  }

  const isRefinement = maxIteration > 0;

  if (!seenIntent) {
    return { phase: 'analyzing', label: 'Optimizing your prompt', sublabel: 'Understanding the task…', progress: 5 };
  }

  if (!seenSubject) {
    return { phase: 'analyzing', label: 'Optimizing your prompt', sublabel: 'Analyzing prompt context…', progress: 8 };
  }

  const label = 'Optimizing your prompt';
  const phase: Phase = isRefinement ? 'refining' : 'optimizing';

  if (!seenCritic) {
    const pct = 10 + Math.round((maxCouncilDone / councilTotal) * 35);
    const sublabel = maxCouncilDone === 0
      ? 'Generating multiple perspectives…'
      : maxCouncilDone < councilTotal
        ? `Building perspective ${maxCouncilDone} of ${councilTotal}…\n↳ Drafting from a guardrails angle…`
        : 'Finalising perspectives…';
    return { phase, label, sublabel, progress: pct };
  }

  if (!seenSynthesize) {
    return { phase, label, sublabel: 'Cross-checking perspectives…', progress: 60 };
  }

  if (!lastGateDecision) {
    return { phase, label, sublabel: 'Combining the best insights…', progress: 82 };
  }

  if (lastGateDecision === 'loop') {
    return {
      phase: 'refining',
      label: 'Optimizing your prompt',
      sublabel: `Quality check found room to improve — running pass ${maxIteration + 2}…`,
      progress: 92,
    };
  }

  return { phase: 'optimizing', label: 'Optimizing your prompt', sublabel: 'Wrapping up the result…', progress: 97 };
}

// ─── Detail steps ──────────────────────────────────────────────────────────

interface DetailStep {
  id: string;
  label: string;
  isRefinement?: boolean;
}

function buildDetailSteps(events: JobProgressEvent[]): DetailStep[] {
  const steps: DetailStep[] = [
    { id: 'intent', label: 'Prompt analysis' },
    { id: 'subject', label: 'Subject analysis' },
    { id: 'council_0_1', label: 'Perspective 1 of 4' },
    { id: 'council_0_2', label: 'Perspective 2 of 4' },
    { id: 'council_0_3', label: 'Perspective 3 of 4' },
    { id: 'council_0_4', label: 'Perspective 4 of 4' },
    { id: 'crosscheck_0', label: 'Cross-check' },
    { id: 'combine_0', label: 'Combining insights' },
    { id: 'quality_0', label: 'Quality check' },
  ];

  const itersSeen = new Set<number>();
  for (const ev of events) {
    if ((ev.iteration ?? 0) > 0) itersSeen.add(ev.iteration!);
  }

  for (const iter of Array.from(itersSeen).sort((a, b) => a - b)) {
    steps.push(
      { id: `council_${iter}_1`, label: `Pass ${iter + 1} · Perspective 1 of 4`, isRefinement: true },
      { id: `council_${iter}_2`, label: `Pass ${iter + 1} · Perspective 2 of 4`, isRefinement: true },
      { id: `council_${iter}_3`, label: `Pass ${iter + 1} · Perspective 3 of 4`, isRefinement: true },
      { id: `council_${iter}_4`, label: `Pass ${iter + 1} · Perspective 4 of 4`, isRefinement: true },
      { id: `crosscheck_${iter}`, label: `Pass ${iter + 1} · Cross-check`, isRefinement: true },
      { id: `combine_${iter}`, label: `Pass ${iter + 1} · Combining insights`, isRefinement: true },
      { id: `quality_${iter}`, label: `Pass ${iter + 1} · Quality check`, isRefinement: true },
    );
  }

  return steps;
}

function resolveDetailDone(events: JobProgressEvent[]): Map<string, { gateDecision?: string; ts?: number }> {
  const done = new Map<string, { gateDecision?: string; ts?: number }>();

  for (const ev of events) {
    const iter = ev.iteration ?? 0;
    if (ev.step === 'intent') done.set('intent', { ts: ev.ts });
    else if (ev.step === 'subject') done.set('subject', { ts: ev.ts });
    else if (ev.step === 'council' && ev.done != null) done.set(`council_${iter}_${ev.done}`, { ts: ev.ts });
    else if (ev.step === 'critic') done.set(`crosscheck_${iter}`, { ts: ev.ts });
    else if (ev.step === 'synthesize') done.set(`combine_${iter}`, { ts: ev.ts });
    else if (ev.step === 'quality_gate') done.set(`quality_${iter}`, { gateDecision: ev.decision, ts: ev.ts });
  }
  return done;
}

// ─── Gate badge ────────────────────────────────────────────────────────────

function GateBadge({ decision }: { decision?: string }) {
  if (!decision) return null;
  if (decision === 'exit' || decision === 'exit_converged') {
    return (
      <span style={{ fontSize: 9.5, color: 'var(--success)', background: 'var(--success-soft)',
        borderRadius: 4, padding: '1px 5px',
        fontFamily: 'var(--mono)', marginLeft: 6 }}>
        passed
      </span>
    );
  }
  if (decision === 'exit_max') {
    return (
      <span style={{ fontSize: 9.5, color: 'var(--warning)', background: 'var(--warning-soft)',
        borderRadius: 4, padding: '1px 5px',
        fontFamily: 'var(--mono)', marginLeft: 6 }}>
        max passes reached
      </span>
    );
  }
  if (decision === 'loop') {
    return (
      <span style={{ fontSize: 9.5, color: 'var(--primary)', background: 'var(--primary-soft)',
        borderRadius: 4, padding: '1px 5px',
        fontFamily: 'var(--mono)', marginLeft: 6 }}>
        improving
      </span>
    );
  }
  return null;
}

// ─── Elapsed timer ─────────────────────────────────────────────────────────

function useElapsed(): number {
  const startRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Date.now() - startRef.current);
    }, 100);
    return () => clearInterval(id);
  }, []);

  return elapsed;
}

// ─── Step timing ───────────────────────────────────────────────────────────

function useStepTimings(
  doneDet: Map<string, { gateDecision?: string; ts?: number }>,
  startTs: number,
): Map<string, number> {
  const timingsRef = useRef<Map<string, number>>(new Map());
  const recordedRef = useRef<Set<string>>(new Set());

  Array.from(doneDet.keys()).forEach((id) => {
    if (!recordedRef.current.has(id)) {
      recordedRef.current.add(id);
      timingsRef.current.set(id, Date.now() - startTs);
    }
  });

  return timingsRef.current;
}

// ─── Main component ────────────────────────────────────────────────────────

interface Props {
  progress: JobProgressEvent[];
}

export function JobProgress({ progress }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const startTsRef = useRef(Date.now());
  const elapsed = useElapsed();

  const phaseInfo = derivePhase(progress);
  const detailSteps = buildDetailSteps(progress);
  const doneDet = resolveDetailDone(progress);
  const activeDetIdx = detailSteps.findIndex((s) => !doneDet.has(s.id));

  const stepTimings = useStepTimings(doneDet, startTsRef.current);

  const totalSteps = detailSteps.length;
  const currentStep = activeDetIdx === -1 ? totalSteps : activeDetIdx + 1;
  const elapsedSec = (elapsed / 1000).toFixed(1);
  const isDone = activeDetIdx === -1;

  // Sublabel lines (may contain \n for active sub-sublabel)
  const sublabelLines = phaseInfo.sublabel.split('\n');

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12,
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      boxShadow: 'var(--shadow-sm)',
      padding: '16px 18px',
    }}>

      {/* ── Header row ── */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {/* Icon square */}
        <div style={{
          width: 30, height: 30, borderRadius: 9, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isDone ? 'var(--success-soft)' : 'var(--primary-soft)',
          color: isDone ? 'var(--success)' : 'var(--primary)',
        }}>
          {isDone ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          ) : (
            <span style={{
              display: 'block',
              width: 12, height: 12,
              borderRadius: '50%',
              border: '2px solid currentColor',
              borderTopColor: 'transparent',
              animation: 'spin .9s linear infinite',
            }} />
          )}
        </div>

        {/* Title + subtitle */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: '-0.005em', color: 'var(--text)' }}>
            {isDone ? 'Optimization complete' : 'Optimizing your prompt'}
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Step {currentStep} of {totalSteps} · {elapsedSec}s elapsed
          </div>
        </div>

        {/* Toggle button */}
        <button
          type="button"
          onClick={() => setDetailsOpen(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 8px', borderRadius: 6,
            background: 'transparent', border: '1px solid transparent',
            color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11,
            fontFamily: 'var(--mono)',
            transition: 'background 150ms',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          <svg
            width="11" height="11" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: detailsOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 200ms' }}
          >
            <path d="M6 9l6 6 6-6"/>
          </svg>
          {detailsOpen ? 'Less' : 'More'}
        </button>
      </div>

      {/* ── Status banner ── */}
      <div style={{
        padding: '10px 12px',
        borderRadius: 9,
        background: isDone ? 'var(--success-soft)' : 'var(--surface-2)',
        border: isDone ? 'none' : '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5, fontWeight: 500, color: 'var(--text)' }}>
          {sublabelLines[0]}
        </span>
        {sublabelLines[1] && (
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)',
            animation: 'fade-in-fast .25s ease both',
          }}>
            {sublabelLines[1]}
          </span>
        )}
      </div>

      {/* ── Progress bar ── */}
      <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 999,
          width: `${isDone ? 100 : phaseInfo.progress}%`,
          background: isDone ? 'var(--success)' : 'var(--primary)',
          transition: 'width 0.25s ease',
        }} />
      </div>

      {/* ── Detail rail ── */}
      {detailsOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, paddingTop: 4 }}>
          {detailSteps.map((step, i) => {
            const isComplete = doneDet.has(step.id);
            const isActive = i === activeDetIdx;
            const isPending = !isComplete && !isActive;
            const meta = doneDet.get(step.id);
            const timingMs = stepTimings.get(step.id);
            const timingSec = timingMs != null ? (timingMs / 1000).toFixed(1) + 's' : null;
            const isLast = i === detailSteps.length - 1;

            return (
              <div key={step.id} style={{
                display: 'grid',
                gridTemplateColumns: '22px 1fr auto',
                gap: 12,
                alignItems: 'flex-start',
                padding: '7px 0',
                position: 'relative',
              }}>
                {/* Connector line */}
                {!isLast && (
                  <div style={{
                    position: 'absolute',
                    left: 10,
                    top: 28,
                    bottom: -3,
                    width: 2,
                    background: i < (activeDetIdx === -1 ? totalSteps : activeDetIdx)
                      ? 'var(--primary)'
                      : 'var(--border)',
                    transition: 'background 0.3s',
                  }} />
                )}

                {/* Marker */}
                <div style={{
                  width: 21, height: 21,
                  borderRadius: '50%',
                  position: 'relative',
                  zIndex: 1,
                  marginTop: 1,
                  flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isComplete
                    ? 'var(--primary)'
                    : 'var(--bg)',
                  border: isComplete
                    ? '2px solid var(--primary)'
                    : isActive
                      ? '2px solid var(--primary)'
                      : '1.5px solid var(--border)',
                  boxShadow: isActive ? '0 0 0 4px var(--primary-ring)' : 'none',
                  transition: 'all 250ms',
                }}>
                  {isComplete ? (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : isActive ? (
                    <div style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: 'var(--primary)',
                      animation: 'pulse-dot 1.2s ease-in-out infinite',
                    }} />
                  ) : (
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--border)' }} />
                  )}
                </div>

                {/* Label column */}
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: 12.5,
                      fontWeight: isActive ? 600 : 500,
                      color: isPending ? 'var(--text-subtle)' : 'var(--text)',
                      transition: 'color 250ms',
                    }}>
                      {step.label}
                    </span>
                    {step.id.startsWith('quality_') && isComplete && (
                      <GateBadge decision={meta?.gateDecision} />
                    )}
                  </div>
                  {isActive && sublabelLines[0] && (
                    <span style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 10.5, color: 'var(--text-muted)',
                      marginTop: 3, lineHeight: 1.4,
                      animation: 'fade-in-fast .25s ease both',
                    }}>
                      {sublabelLines[0]}
                    </span>
                  )}
                </div>

                {/* Timing column */}
                <div style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 10.5,
                  minWidth: 34,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  color: isActive ? 'var(--primary)' : 'var(--text-subtle)',
                }}>
                  {isActive ? `${elapsedSec}s` : (isComplete && timingSec ? timingSec : '')}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
