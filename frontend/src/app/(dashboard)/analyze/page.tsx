'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import type { HealthScoreResponse, AdvisoryResponse } from '@/types/api';
import { Loader2 } from 'lucide-react';

function scoreColor(n: number) {
  if (n < 4) return '#ff6b7a';
  if (n < 7) return '#ffb85c';
  return '#7c5cff';
}

export default function AnalyzePage() {
  const [prompt, setPrompt] = useState('');
  const [focused, setFocused] = useState(false);
  const [healthScore, setHealthScore] = useState<HealthScoreResponse | null>(null);
  const [advisory, setAdvisory] = useState<AdvisoryResponse | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [loadingAdvisory, setLoadingAdvisory] = useState(false);

  const handleHealthScore = async () => {
    if (!prompt.trim()) { toast.error('Paste a prompt first'); return; }
    setLoadingHealth(true);
    try {
      const res = await api.post<{ data: HealthScoreResponse }>('/api/v1/prompts/health-score', { prompt });
      setHealthScore(res.data.data);
    } catch {
      toast.error('Health score failed — check the server logs');
    } finally {
      setLoadingHealth(false);
    }
  };

  const handleAdvisory = async () => {
    if (!prompt.trim()) { toast.error('Paste a prompt first'); return; }
    setLoadingAdvisory(true);
    try {
      const res = await api.post<{ data: AdvisoryResponse }>('/api/v1/prompts/advisory', { prompt });
      setAdvisory(res.data.data);
    } catch {
      toast.error('Advisory failed — check the server logs');
    } finally {
      setLoadingAdvisory(false);
    }
  };

  const isAnyLoading = loadingHealth || loadingAdvisory;
  const hasResults = healthScore || advisory;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%',
      fontFamily: 'var(--font-geist, ui-sans-serif)' }}>

      {/* Results area */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!hasResults ? (
          /* Empty state */
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%' }}>
            <div style={{ maxWidth: 640, width: '100%', margin: '0 auto', textAlign: 'center', padding: '0 40px 80px' }}>
              <div className="eyebrow" style={{ fontFamily: 'var(--font-geist-mono, monospace)',
                fontSize: 11, color: '#7c5cff', textTransform: 'uppercase', letterSpacing: '0.12em',
                marginBottom: 16 }}>/ analyze</div>
              <h1 style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontWeight: 400,
                fontSize: 42, letterSpacing: '-0.02em', lineHeight: 1.12, margin: '0 0 16px',
                color: '#ededed' }}>
                Health score &<br /><em style={{ color: '#7c5cff', fontStyle: 'italic' }}>advisory</em> for your prompt.
              </h1>
              <p style={{ fontSize: 14, color: '#8a8a90', lineHeight: 1.5 }}>
                Paste a prompt below. Run a Health Score (8 dimensions) or Advisory review. Each costs 5 credits.
              </p>
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: 960, margin: '0 auto', padding: '28px 40px 80px' }}>
            {/* Page header */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
                color: '#7c5cff', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>
                / analyze
              </div>
              <h1 style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontWeight: 400,
                fontSize: 42, letterSpacing: '-0.02em', lineHeight: 1.12, margin: 0, color: '#ededed' }}>
                Health score &<br /><em style={{ color: '#7c5cff', fontStyle: 'italic' }}>advisory</em> for your prompt.
              </h1>
            </div>

            {/* Health score */}
            {healthScore && <HealthScorePanel score={healthScore} />}

            {/* Advisory */}
            {advisory && <AdvisoryPanel advisory={advisory} />}
          </div>
        )}
      </div>

      {/* Input area */}
      <div style={{ flexShrink: 0, padding: '12px 20px 16px',
        background: 'linear-gradient(to top, #141414 80%, transparent)',
        borderTop: '1px solid #1f1f23' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{ border: `1px solid ${focused ? 'rgba(124,92,255,0.6)' : '#2a2a2e'}`,
            borderRadius: 14, background: '#1a1a1a', overflow: 'hidden',
            boxShadow: focused ? '0 0 0 3px rgba(124,92,255,0.14)' : 'none',
            transition: 'border-color 120ms, box-shadow 120ms' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #1f1f23',
              background: 'rgba(255,255,255,0.015)',
              fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
              color: '#8a8a90', textTransform: 'uppercase', letterSpacing: '0.1em',
              display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>
              </svg>
              your prompt
            </div>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
              onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
              placeholder="Paste the prompt you want to analyze…"
              style={{ width: '100%', minHeight: 120, padding: '14px 16px', resize: 'none',
                background: 'transparent', border: 'none', outline: 'none',
                fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 13, lineHeight: 1.6,
                color: '#ededed', display: 'block', boxSizing: 'border-box' }} />
            <div style={{ padding: '10px 14px', borderTop: '1px solid #1f1f23',
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'rgba(255,255,255,0.01)' }}>
              <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11.5,
                color: '#8a8a90' }}>
                {prompt.length} chars
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button onClick={handleHealthScore}
                  disabled={isAnyLoading || !prompt.trim()}
                  style={{ height: 28, padding: '0 10px', borderRadius: 6,
                    border: '1px solid #2a2a2e', background: 'transparent', fontSize: 12,
                    color: isAnyLoading || !prompt.trim() ? '#5a5a60' : '#b5b5ba',
                    cursor: isAnyLoading || !prompt.trim() ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
                  {loadingHealth
                    ? <Loader2 style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} />
                    : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 3v18h18"/><path d="M7 14v4M12 10v8M17 6v12"/></svg>}
                  {loadingHealth ? 'Scoring…' : 'Health Score'}
                  <span style={{ color: '#7c5cff' }}>5cr</span>
                </button>
                <button onClick={handleAdvisory}
                  disabled={isAnyLoading || !prompt.trim()}
                  style={{ height: 28, padding: '0 12px', borderRadius: 6,
                    border: '1px solid #7c5cff', background: '#7c5cff', fontSize: 12,
                    color: isAnyLoading || !prompt.trim() ? 'rgba(255,255,255,0.5)' : '#fff',
                    cursor: isAnyLoading || !prompt.trim() ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
                    opacity: isAnyLoading || !prompt.trim() ? 0.6 : 1 }}>
                  {loadingAdvisory
                    ? <Loader2 style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} />
                    : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>}
                  {loadingAdvisory ? 'Reviewing…' : 'Advisory'}
                  <span style={{ opacity: 0.7 }}>5cr</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HealthScorePanel({ score }: { score: HealthScoreResponse }) {
  const overall = score.overall_score ?? 5;
  const pct = (overall / 10) * 100;
  const circumference = 2 * Math.PI * 78;
  const dash = (pct / 100) * circumference;

  const METRIC_KEYS = ['clarity','specificity','completeness','conciseness','tone','actionability','context_richness','goal_alignment'] as const;
  const dims = METRIC_KEYS.map(k => ({
    name: k.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()),
    score: score[k]?.score ?? 0,
    rationale: score[k]?.rationale ?? '',
  }));

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 28, alignItems: 'start' }}>
        {/* Score ring */}
        <div style={{ background: '#1a1a1a', border: '1px solid #1f1f23', borderRadius: 10,
          padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
            color: '#5a5a60', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 20 }}>
            Health Score
          </div>
          <div style={{ position: 'relative', width: 180, height: 180 }}>
            <svg width="180" height="180" viewBox="0 0 180 180">
              <circle cx="90" cy="90" r="78" stroke="#2a2a2e" strokeWidth="3" fill="none"/>
              <circle cx="90" cy="90" r="78" stroke="#7c5cff" strokeWidth="3" fill="none"
                strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round"
                transform="rotate(-90 90 90)"/>
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)',
                fontSize: 64, letterSpacing: '-0.03em', lineHeight: 1, color: '#ededed' }}>
                {overall.toFixed(1)}
              </div>
              <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
                color: '#8a8a90', textTransform: 'uppercase', letterSpacing: '0.1em' }}>/ 10</div>
            </div>
          </div>
          <div style={{ marginTop: 22, textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: '#ededed', marginBottom: 6 }}>
              {overall < 4 ? 'Needs work' : overall < 7 ? 'Below median' : 'Strong'}
            </div>
            <div style={{ fontSize: 12.5, color: '#8a8a90', lineHeight: 1.5 }}>
              Structure and constraints are the main gaps.
            </div>
          </div>
        </div>

        {/* Dimensions */}
        {dims.length > 0 && (
          <div style={{ background: '#1a1a1a', border: '1px solid #1f1f23', borderRadius: 10, padding: 18 }}>
            <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
              color: '#8a8a90', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 6 }}>
              {dims.length} dimensions
            </div>
            {dims.map((d, i) => (
              <div key={d.name} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 44px',
                gap: 14, alignItems: 'center', padding: '10px 0',
                borderBottom: i < dims.length - 1 ? '1px solid #1f1f23' : 'none' }}>
                <div>
                  <div style={{ fontSize: 13, color: '#ededed' }}>{d.name}</div>
                  {d.rationale && (
                    <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
                      color: '#5a5a60', marginTop: 2, lineHeight: 1.4 }}>{d.rationale}</div>
                  )}
                </div>
                <div style={{ height: 6, borderRadius: 3, background: '#1f1f23', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${d.score * 10}%`,
                    background: scoreColor(d.score), borderRadius: 3 }} />
                </div>
                <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12,
                  color: '#b5b5ba', textAlign: 'right' }}>{d.score.toFixed(1)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AdvisoryPanel({ advisory }: { advisory: AdvisoryResponse }) {
  const sections = [
    { key: 'strengths', label: 'Strengths', color: '#5cffb1', items: advisory.strengths ?? [] },
    { key: 'weaknesses', label: 'Weaknesses', color: '#ff6b7a', items: advisory.weaknesses ?? [] },
    { key: 'improvements', label: 'Suggested improvements', color: '#7c5cff', items: advisory.improvements ?? [] },
  ];

  return (
    <div style={{ marginTop: 12 }}>
      {advisory.overall_assessment && (
        <div style={{ padding: '12px 16px', marginBottom: 12, background: '#1a1a1a',
          border: '1px solid #1f1f23', borderRadius: 10,
          fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12.5,
          lineHeight: 1.6, color: '#b5b5ba' }}>
          {advisory.overall_assessment}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {sections.map(s => (
        <div key={s.key}
          style={{ gridColumn: s.key === 'improvements' ? '1 / -1' : 'auto',
            padding: 16, border: '1px solid #1f1f23', borderRadius: 10, background: '#1a1a1a' }}>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
            textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10,
            display: 'flex', alignItems: 'center', gap: 8, color: s.color }}>
            {s.label}
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {(s.items as string[]).map((item: string, i: number) => (
              <li key={i} style={{ display: 'grid', gridTemplateColumns: '18px 1fr', gap: 10,
                padding: '8px 0', borderBottom: i < s.items.length - 1 ? '1px dashed #1f1f23' : 'none',
                fontSize: 12.5, lineHeight: 1.5, color: '#b5b5ba' }}>
                <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
                  color: '#5a5a60', paddingTop: 2 }}>
                  {String.fromCharCode(65 + i)}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      </div>
    </div>
  );
}
