'use client';

import { useState } from 'react';
import type { JobProgressEvent } from '@/types/api';

// ─── Phase derivation ──────────────────────────────────────────────────────
// Three user-facing phases that map across the internal pipeline.
// We never expose "council", "critic", "synthesize" to the user.

type Phase = 'analyzing' | 'optimizing' | 'refining' | 'done';

interface PhaseInfo {
  phase: Phase;
  label: string;
  sublabel: string;
  progress: number; // 0–100
  iterationLabel?: string; // e.g. "Pass 2 of 3"
}

function derivePhase(events: JobProgressEvent[]): PhaseInfo {
  if (events.length === 0) {
    return { phase: 'analyzing', label: 'Analyzing your prompt', sublabel: 'Understanding the task…', progress: 2 };
  }

  // Track what has been seen
  let seenIntent = false;
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
    else if (ev.step === 'council') {
      if ((ev.done ?? 0) > maxCouncilDone) maxCouncilDone = ev.done ?? 0;
      if (ev.total) councilTotal = ev.total;
    } else if (ev.step === 'critic') seenCritic = true;
    else if (ev.step === 'synthesize') seenSynthesize = true;
    else if (ev.step === 'quality_gate') {
      lastGateDecision = ev.decision;
      // Reset per-round tracking when a loop begins
      if (ev.decision === 'loop') {
        maxCouncilDone = 0;
        seenCritic = false;
        seenSynthesize = false;
      }
    }
  }

  const isRefinement = maxIteration > 0;
  const passLabel = isRefinement ? ` · Pass ${maxIteration + 1}` : '';

  // Phase: analyzing
  if (!seenIntent) {
    return { phase: 'analyzing', label: 'Analyzing your prompt', sublabel: 'Understanding the task…', progress: 5 };
  }

  const label = isRefinement ? `Improving your prompt${passLabel}` : 'Optimizing your prompt';
  const phase: Phase = isRefinement ? 'refining' : 'optimizing';

  // Council still in progress (includes: all 4 done but critic not yet fired)
  if (!seenCritic) {
    const pct = 10 + Math.round((maxCouncilDone / councilTotal) * 35);
    const sublabel = maxCouncilDone === 0
      ? 'Generating multiple perspectives…'
      : maxCouncilDone < councilTotal
        ? `Building perspective ${maxCouncilDone} of ${councilTotal}…`
        : 'Finalising perspectives…';
    return { phase, label, sublabel, progress: pct };
  }

  // Cross-checking (critic done, synthesize not yet)
  if (!seenSynthesize) {
    return { phase, label, sublabel: 'Cross-checking perspectives…', progress: 60 };
  }

  // Synthesize done, quality gate not yet fired
  if (!lastGateDecision) {
    return { phase, label, sublabel: 'Combining the best insights…', progress: 82 };
  }

  // Quality gate decided to loop — next refinement pass starting
  if (lastGateDecision === 'loop') {
    return {
      phase: 'refining',
      label: `Refining further · Pass ${maxIteration + 2}`,
      sublabel: 'Quality check found room to improve — running another pass…',
      progress: 92,
    };
  }

  // Quality gate decided to exit (pass / max / converged) — job still completing
  return { phase: 'optimizing', label: 'Finishing up…', sublabel: 'Wrapping up the result…', progress: 97 };
}

// ─── Detail steps (secondary layer) ───────────────────────────────────────
// Neutral language — no "council", "critic", "synthesize", no model counts

interface DetailStep {
  id: string;
  label: string;
  isRefinement?: boolean;
}

function buildDetailSteps(events: JobProgressEvent[]): DetailStep[] {
  const steps: DetailStep[] = [
    { id: 'intent', label: 'Prompt analysis' },
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

function resolveDetailDone(events: JobProgressEvent[]): Map<string, { gateDecision?: string }> {
  const done = new Map<string, { gateDecision?: string }>();
  // Track per-iteration critic/synthesize
  const criticSeen = new Set<number>();
  const synthSeen = new Set<number>();

  for (const ev of events) {
    const iter = ev.iteration ?? 0;
    if (ev.step === 'intent') done.set('intent', {});
    else if (ev.step === 'council' && ev.done != null) done.set(`council_${iter}_${ev.done}`, {});
    else if (ev.step === 'critic') {
      criticSeen.add(iter);
      done.set(`crosscheck_${iter}`, {});
    } else if (ev.step === 'synthesize') {
      synthSeen.add(iter);
      done.set(`combine_${iter}`, {});
    } else if (ev.step === 'quality_gate') {
      done.set(`quality_${iter}`, { gateDecision: ev.decision });
    }
  }
  return done;
}

// ─── Progress bar ──────────────────────────────────────────────────────────

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div style={{
      width: '100%',
      height: 3,
      borderRadius: 999,
      background: 'rgba(255,255,255,0.06)',
      overflow: 'hidden',
      marginTop: 10,
    }}>
      <div style={{
        height: '100%',
        borderRadius: 999,
        width: `${pct}%`,
        background: 'linear-gradient(90deg, #7c5cff, #a78bfa)',
        transition: 'width 600ms cubic-bezier(0.4,0,0.2,1)',
        boxShadow: '0 0 8px rgba(124,92,255,0.5)',
      }} />
    </div>
  );
}

// ─── Gate badge ────────────────────────────────────────────────────────────

function GateBadge({ decision }: { decision?: string }) {
  if (!decision) return null;

  if (decision === 'exit' || decision === 'exit_converged') {
    return (
      <span style={{ fontSize: 9.5, color: '#22c55e', background: 'rgba(34,197,94,0.08)',
        border: '1px solid rgba(34,197,94,0.2)', borderRadius: 4, padding: '1px 5px',
        fontFamily: 'var(--font-geist-mono, monospace)', marginLeft: 6 }}>
        passed
      </span>
    );
  }
  if (decision === 'exit_max') {
    return (
      <span style={{ fontSize: 9.5, color: '#f59e0b', background: 'rgba(245,158,11,0.08)',
        border: '1px solid rgba(245,158,11,0.2)', borderRadius: 4, padding: '1px 5px',
        fontFamily: 'var(--font-geist-mono, monospace)', marginLeft: 6 }}>
        max passes reached
      </span>
    );
  }
  if (decision === 'loop') {
    return (
      <span style={{ fontSize: 9.5, color: '#a78bfa', background: 'rgba(167,139,250,0.08)',
        border: '1px solid rgba(167,139,250,0.2)', borderRadius: 4, padding: '1px 5px',
        fontFamily: 'var(--font-geist-mono, monospace)', marginLeft: 6 }}>
        improving
      </span>
    );
  }
  return null;
}

// ─── Main component ────────────────────────────────────────────────────────

interface Props {
  progress: JobProgressEvent[];
}

export function JobProgress({ progress }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const phaseInfo = derivePhase(progress);
  const detailSteps = buildDetailSteps(progress);
  const doneDet = resolveDetailDone(progress);
  const activeDetIdx = detailSteps.findIndex((s) => !doneDet.has(s.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* ── Primary layer ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Status row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Animated pulse dot */}
          <div style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: '#7c5cff',
            boxShadow: '0 0 0 0 rgba(124,92,255,0.4)',
            animation: 'progressPulse 1.6s ease-in-out infinite',
          }} />
          <span style={{
            fontFamily: 'var(--font-geist-mono, monospace)',
            fontSize: 12,
            fontWeight: 500,
            color: '#c4b5fd',
          }}>
            {phaseInfo.label}
          </span>
        </div>

        {/* Sub-label */}
        <span style={{
          fontFamily: 'var(--font-geist-mono, monospace)',
          fontSize: 10.5,
          color: '#5a5a60',
          paddingLeft: 15,
        }}>
          {phaseInfo.sublabel}
        </span>

        {/* Progress bar */}
        <ProgressBar pct={phaseInfo.progress} />
      </div>

      {/* ── Details toggle ── */}
      <button
        type="button"
        onClick={() => setDetailsOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          marginTop: 10,
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          width: 'fit-content',
        }}
      >
        <svg
          width="10" height="10" viewBox="0 0 12 12" fill="none"
          stroke="#3a3a40" strokeWidth="1.6"
          style={{
            transform: detailsOpen ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 200ms',
            flexShrink: 0,
          }}
        >
          <path d="M4 2l4 4-4 4" />
        </svg>
        <span style={{
          fontFamily: 'var(--font-geist-mono, monospace)',
          fontSize: 10,
          color: '#3a3a40',
          userSelect: 'none',
        }}>
          {detailsOpen ? 'Hide details' : 'Show details'}
        </span>
      </button>

      {/* ── Secondary layer (detail steps) ── */}
      {detailsOpen && (
        <div style={{
          marginTop: 8,
          paddingTop: 10,
          borderTop: '1px solid #1f1f23',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {detailSteps.map((step, i) => {
            const isComplete = doneDet.has(step.id);
            const isActive = i === activeDetIdx;
            const meta = doneDet.get(step.id);

            return (
              <div key={step.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                opacity: !isComplete && !isActive ? 0.28 : 1,
                transition: 'opacity 300ms',
              }}>
                {/* Dot */}
                <div style={{
                  width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isComplete ? 'rgba(124,92,255,0.12)' : isActive ? 'rgba(124,92,255,0.08)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isComplete || isActive ? 'rgba(124,92,255,0.35)' : '#222226'}`,
                }}>
                  {isComplete ? (
                    <svg width="7" height="7" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="#7c5cff" strokeWidth="1.8"
                        strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : isActive ? (
                    <div style={{
                      width: 5, height: 5, borderRadius: '50%',
                      background: '#7c5cff',
                      animation: 'pulse 1.4s ease-in-out infinite',
                    }} />
                  ) : (
                    <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#2a2a2e' }} />
                  )}
                </div>

                {/* Label */}
                <span style={{
                  fontFamily: 'var(--font-geist-mono, monospace)',
                  fontSize: 10.5,
                  color: isComplete
                    ? (step.isRefinement ? '#a78bfa' : '#7c5cff')
                    : isActive ? '#c4b5fd' : '#3a3a40',
                  transition: 'color 300ms',
                }}>
                  {step.label}
                </span>

                {/* Gate badge */}
                {step.id.startsWith('quality_') && isComplete && (
                  <GateBadge decision={meta?.gateDecision} />
                )}

                {/* Done label for non-gate steps */}
                {isComplete && !step.id.startsWith('quality_') && (
                  <span style={{
                    fontFamily: 'var(--font-geist-mono, monospace)',
                    fontSize: 9.5, color: '#2a2a2e', marginLeft: 'auto',
                  }}>
                    done
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Keyframe for the pulse dot — injected once */}
      <style>{`
        @keyframes progressPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(124,92,255,0.5); }
          50% { box-shadow: 0 0 0 5px rgba(124,92,255,0); }
        }
      `}</style>
    </div>
  );
}
