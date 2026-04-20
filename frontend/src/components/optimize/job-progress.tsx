'use client';

import type { JobProgressEvent } from '@/types/api';

interface StepDef {
  id: string;
  label: string;
}

const STEPS: StepDef[] = [
  { id: 'intent',    label: 'Analyzing prompt' },
  { id: 'council_1', label: 'Optimizer 1 / 4' },
  { id: 'council_2', label: 'Optimizer 2 / 4' },
  { id: 'council_3', label: 'Optimizer 3 / 4' },
  { id: 'council_4', label: 'Optimizer 4 / 4' },
  { id: 'critic',    label: 'Peer reviewing' },
  { id: 'synthesize', label: 'Synthesizing result' },
];

function resolvedStepIds(progress: JobProgressEvent[]): Set<string> {
  const done = new Set<string>();
  for (const ev of progress) {
    if (ev.step === 'intent') done.add('intent');
    else if (ev.step === 'council' && ev.done != null) done.add(`council_${ev.done}`);
    else if (ev.step === 'critic') done.add('critic');
    else if (ev.step === 'synthesize') done.add('synthesize');
  }
  return done;
}

interface Props {
  progress: JobProgressEvent[];
}

export function JobProgress({ progress }: Props) {
  const done = resolvedStepIds(progress);
  const activeIdx = STEPS.findIndex((s) => !done.has(s.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
      {STEPS.map((step, i) => {
        const isComplete = done.has(step.id);
        const isActive = i === activeIdx;

        return (
          <div
            key={step.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              opacity: !isComplete && !isActive ? 0.35 : 1,
              transition: 'opacity 300ms',
            }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isComplete
                  ? 'rgba(124,92,255,0.15)'
                  : isActive
                    ? 'rgba(124,92,255,0.12)'
                    : 'rgba(255,255,255,0.04)',
                border: `1px solid ${isComplete || isActive ? 'rgba(124,92,255,0.4)' : '#2a2a2e'}`,
              }}
            >
              {isComplete ? (
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M2 6l3 3 5-5"
                    stroke="#7c5cff"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : isActive ? (
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#7c5cff',
                    animation: 'pulse 1.4s ease-in-out infinite',
                  }}
                />
              ) : (
                <div
                  style={{ width: 5, height: 5, borderRadius: '50%', background: '#3a3a40' }}
                />
              )}
            </div>

            <span
              style={{
                fontFamily: 'var(--font-geist-mono, monospace)',
                fontSize: 11.5,
                color: isComplete ? '#7c5cff' : isActive ? '#c4b5fd' : '#5a5a60',
                fontWeight: isActive ? 500 : 400,
                transition: 'color 300ms',
              }}
            >
              {step.label}
            </span>

            {isComplete && (
              <span
                style={{
                  fontFamily: 'var(--font-geist-mono, monospace)',
                  fontSize: 10,
                  color: '#3a3a40',
                  marginLeft: 'auto',
                }}
              >
                done
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
