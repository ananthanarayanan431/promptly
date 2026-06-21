'use client';

import { useEffect, useState } from 'react';

const SLIDES = [
  {
    eyebrow: 'The council',
    heading: <>Four minds.<br />Three rounds.<br />One answer.</>,
    body: 'Analytical, Creative, Concise, and Structured models optimize your prompt in parallel — then blind-review each other before a chairman synthesises the winner.',
    visual: <CouncilVisual />,
  },
  {
    eyebrow: 'The pipeline',
    heading: <>Intent.<br />Council.<br />Synthesis.</>,
    body: 'Every submission passes an intent gate, three refinement rounds, and a quality gate before you see a result. Low-quality prompts never reach the LLMs.',
    visual: <PipelineVisual />,
  },
  {
    eyebrow: 'Quality scoring',
    heading: <>Ten dimensions.<br />One health<br />score.</>,
    body: 'Clarity, specificity, injection robustness, goal alignment and six more — each scored and explained so you know exactly what to fix.',
    visual: <ScoringVisual />,
  },
  {
    eyebrow: 'Developer-first',
    heading: <>One endpoint.<br />Zero<br />complexity.</>,
    body: 'Submit a prompt, get back the optimized version, council proposals, reasoning, and a full diff. Versioned families keep your prompt history tidy.',
    visual: <ApiVisual />,
  },
];

export function AuthPanel() {
  const [active, setActive] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setActive(a => (a + 1) % SLIDES.length);
        setFading(false);
      }, 350);
    }, 4500);
    return () => clearInterval(id);
  }, []);

  const slide = SLIDES[active];

  return (
    <div style={{
      background: '#0e0e10', color: '#ededed', padding: '48px 52px',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      minHeight: '100vh', position: 'relative', overflow: 'hidden',
    }}>
      {/* Subtle grid */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
      }} />

      {/* Glow */}
      <div style={{
        position: 'absolute', top: -120, right: -120, width: 360, height: 360,
        borderRadius: '50%', background: 'radial-gradient(circle, rgba(124,92,255,.18) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Top: eyebrow */}
      <div style={{
        fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
        color: '#7c5cff', textTransform: 'uppercase', letterSpacing: '0.16em',
        opacity: fading ? 0 : 1, transition: 'opacity 0.35s ease',
        position: 'relative',
      }}>
        {slide.eyebrow}
      </div>

      {/* Middle: main content */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 32,
        opacity: fading ? 0 : 1,
        transform: fading ? 'translateY(10px)' : 'translateY(0)',
        transition: 'opacity 0.35s ease, transform 0.35s ease',
        position: 'relative',
      }}>
        <h2 style={{
          fontFamily: 'var(--font-instrument-serif, Georgia, serif)',
          fontSize: 52, lineHeight: 1.0, letterSpacing: '-0.025em',
          color: '#f5f5f5', margin: 0, fontWeight: 400,
        }}>
          {slide.heading}
        </h2>

        <p style={{
          fontSize: 14.5, color: '#8a8a95', lineHeight: 1.65,
          margin: 0, maxWidth: 380,
        }}>
          {slide.body}
        </p>

        <div>{slide.visual}</div>
      </div>

      {/* Bottom: slide indicators */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
        {SLIDES.map((_, i) => (
          <button
            key={i}
            onClick={() => { setFading(true); setTimeout(() => { setActive(i); setFading(false); }, 350); }}
            style={{
              width: i === active ? 22 : 6, height: 6, borderRadius: 3,
              background: i === active ? '#7c5cff' : '#2a2a30',
              border: 'none', cursor: 'pointer', padding: 0,
              transition: 'width 0.35s ease, background 0.25s ease',
            }}
          />
        ))}
        <span style={{ marginLeft: 8, fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, color: '#3a3a40' }}>
          {String(active + 1).padStart(2, '0')} / {String(SLIDES.length).padStart(2, '0')}
        </span>
      </div>
    </div>
  );
}

/* ── Slide visuals ──────────────────────────────────────────────── */

function CouncilVisual() {
  const agents = [
    { letter: 'A', name: 'Analytical',  desc: 'Precision & constraints',   color: '#7c5cff' },
    { letter: 'C', name: 'Creative',    desc: 'Persona & exemplars',        color: '#ff7ac6' },
    { letter: 'O', name: 'Concise',     desc: 'Brevity & signal density',   color: '#5cffb1' },
    { letter: 'S', name: 'Structured',  desc: 'Schemas & decomposition',    color: '#ffb85c' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {agents.map(a => (
        <div key={a.letter} style={{
          background: '#141418', border: '1px solid #1f1f26',
          borderRadius: 12, padding: '14px 16px',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8, background: a.color + '22',
            border: `1px solid ${a.color}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, color: a.color, flexShrink: 0,
          }}>{a.letter}</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e8e8ed' }}>{a.name}</div>
            <div style={{ fontSize: 11.5, color: '#5a5a65', marginTop: 2, lineHeight: 1.4 }}>{a.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PipelineVisual() {
  const steps = [
    { icon: '🎯', label: 'Intent gate',   sub: 'Off-topic & harmful content blocked' },
    { icon: '⚖️',  label: 'Council vote',  sub: '4 models optimize in parallel' },
    { icon: '🔍', label: 'Critic round',  sub: 'Blind peer-review, proposals ranked' },
    { icon: '✨', label: 'Synthesis',     sub: 'Chairman picks the best final output' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9, background: '#141418',
            border: '1px solid #1f1f26', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 15, flexShrink: 0,
          }}>{s.icon}</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e8e8ed' }}>{s.label}</div>
            <div style={{ fontSize: 11.5, color: '#5a5a65', lineHeight: 1.3 }}>{s.sub}</div>
          </div>
          {i < steps.length - 1 && (
            <div style={{
              position: 'absolute', left: 64, width: 1, height: 8,
              background: '#2a2a35',
            }} />
          )}
        </div>
      ))}
    </div>
  );
}

function ScoringVisual() {
  const dims = [
    { label: 'Clarity',         score: 9 },
    { label: 'Specificity',     score: 7 },
    { label: 'Goal alignment',  score: 10 },
    { label: 'Inj. robustness', score: 8 },
    { label: 'Conciseness',     score: 6 },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: '#4a4a55', fontFamily: 'var(--font-geist-mono, monospace)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Overall health</span>
        <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 22, fontWeight: 700, color: '#5cffb1' }}>A</span>
      </div>
      {dims.map(d => (
        <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11.5, color: '#6a6a75', minWidth: 110 }}>{d.label}</span>
          <div style={{ flex: 1, height: 4, background: '#1f1f26', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${d.score * 10}%`, borderRadius: 99,
              background: d.score >= 9 ? '#5cffb1' : d.score >= 7 ? '#7c5cff' : '#ffb85c',
              transition: 'width 0.6s ease',
            }} />
          </div>
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11, color: '#4a4a55', minWidth: 16, textAlign: 'right' }}>{d.score}</span>
        </div>
      ))}
    </div>
  );
}

function ApiVisual() {
  return (
    <div style={{
      background: '#141418', border: '1px solid #1f1f26',
      borderRadius: 12, overflow: 'hidden',
    }}>
      {/* Title bar */}
      <div style={{
        padding: '10px 16px', background: '#0a0a0c',
        borderBottom: '1px solid #1f1f26',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#ff5f57', display: 'inline-block' }} />
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#ffbd2e', display: 'inline-block' }} />
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#28ca41', display: 'inline-block' }} />
        <span style={{ marginLeft: 8, fontSize: 10.5, color: '#3a3a45', fontFamily: 'var(--font-geist-mono, monospace)' }}>terminal</span>
      </div>
      <div style={{
        padding: '16px 18px',
        fontFamily: 'var(--font-geist-mono, monospace)',
        fontSize: 11.5, lineHeight: 1.8, color: '#8a8a95',
      }}>
        <div><span style={{ color: '#7c5cff' }}>POST</span> <span style={{ color: '#5cffb1' }}>/api/v1/chat/</span></div>
        <div style={{ color: '#3a3a45' }}>{'{'}</div>
        <div style={{ paddingLeft: 16 }}>
          <span style={{ color: '#ffb85c' }}>&quot;prompt&quot;</span>
          <span style={{ color: '#5a5a65' }}>: </span>
          <span style={{ color: '#ededed' }}>&quot;You are a helpful assistant...&quot;</span>
        </div>
        <div style={{ color: '#3a3a45' }}>{'}'}</div>
        <div style={{ marginTop: 8, color: '#3a3a45' }}>→ 202  <span style={{ color: '#7c5cff' }}>{'{ job_id: "jb_..." }'}</span></div>
        <div style={{ color: '#3a3a45' }}>→ poll <span style={{ color: '#5cffb1' }}>GET /jobs/{'{id}'}</span></div>
        <div style={{ color: '#3a3a45', marginTop: 4 }}>→ 200  <span style={{ color: '#ededed' }}>optimized_prompt + diff + reasoning</span></div>
      </div>
    </div>
  );
}
