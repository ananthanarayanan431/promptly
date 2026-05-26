'use client';

import { useState, useEffect } from 'react';

const PHASES = [
  'Reading your prompt...',
  'Generating optimized versions...',
  'Evaluating and comparing results...',
  'Selecting the strongest outcome...',
  'Preparing your optimized prompt...',
];

export function LoadingWords() {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx((prev) => (prev + 1) % PHASES.length);
        setVisible(true);
      }, 300);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ padding: '4px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.8"
          style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}>
          <path d="M21 12a9 9 0 11-6.219-8.56"/>
        </svg>
        <span style={{ fontSize: 13, color: 'var(--text-muted)', transition: 'opacity 0.3s',
          opacity: visible ? 1 : 0, fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
          {PHASES[idx]}
        </span>
      </div>
      <div style={{ paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[1, 0.82, 0.65].map((w, i) => (
          <div key={i} style={{ height: 10, borderRadius: 4, background: 'var(--border)',
            width: `${w * 100}%`, animation: 'pulse 2s ease-in-out infinite' }} />
        ))}
        <div style={{ height: 28, borderRadius: 6, background: 'var(--border)', marginTop: 4,
          animation: 'pulse 2s ease-in-out infinite' }} />
      </div>
    </div>
  );
}
