'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import type { HealthScoreResponse, AdvisoryResponse } from '@/types/api';
import { DIMENSION_LABELS, parseSeverity } from '@/lib/advisory';
import { PageHeader } from '@/components/layout/page-header';

/* ── helpers ─────────────────────────────────────────────────────────────── */
function scoreColor(n: number): string {
  if (n >= 8) return 'var(--success)';
  if (n >= 6) return 'var(--primary)';
  return 'var(--warning)';
}

function gradeLabel(score: number): string {
  if (score >= 9) return 'A';
  if (score >= 8) return 'B+';
  if (score >= 7) return 'B';
  if (score >= 6) return 'C+';
  if (score >= 5) return 'C';
  return 'D';
}

function gradeGradient(score: number): string {
  if (score >= 8) return 'linear-gradient(135deg, var(--primary), var(--accent))';
  if (score >= 6) return 'linear-gradient(135deg, var(--primary), var(--accent))';
  return 'linear-gradient(135deg, var(--warning), oklch(72% 0.16 35))';
}

/* ── Analyze page ───────────────────────────────────────────────────────── */
export default function AnalyzePage() {
  const [prompt, setPrompt] = useState('');
  const [tab, setTab] = useState<'health' | 'advisory'>('health');
  const [healthScore, setHealthScore] = useState<HealthScoreResponse | null>(null);
  const [advisory, setAdvisory] = useState<AdvisoryResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const hasResults = healthScore || advisory;
  const canRun = prompt.trim().length >= 10 && !loading;

  async function runAnalyze() {
    if (!canRun) return;
    setLoading(true);
    setHealthScore(null);
    setAdvisory(null);
    try {
      /* Run both in parallel, show whichever succeeds */
      const [healthRes, advisoryRes] = await Promise.allSettled([
        api.post<{ data: HealthScoreResponse }>('/api/v1/prompts/health-score', { prompt }),
        api.post<{ data: AdvisoryResponse }>('/api/v1/prompts/advisory', { prompt }),
      ]);
      if (healthRes.status === 'fulfilled') {
        setHealthScore(healthRes.value.data.data);
        setTab('health');
      } else {
        setHealthScore(null);
      }
      if (advisoryRes.status === 'fulfilled') {
        setAdvisory(advisoryRes.value.data.data);
        if (healthRes.status === 'rejected') setTab('advisory');
      } else {
        setAdvisory(null);
      }
      if (healthRes.status === 'rejected' && advisoryRes.status === 'rejected') {
        toast.error('Analysis failed — check the server logs');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Analyze"
        badge={
          <span className="ply-pill" style={{ fontSize: 11, color: 'var(--primary)', background: 'var(--primary-soft)' }}>
            <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
            Diagnostic only
          </span>
        }
        subtitle="Score and audit any prompt across 10 dimensions, without modifying it."
      />

      <div style={{
        flex: 1, minHeight: 0, display: 'grid',
        gridTemplateColumns: '1fr 1.4fr',
        gap: 0, overflow: 'hidden',
      }}>
        {/* ── Left: prompt input ──────────────────────────────────────── */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 14,
          padding: '20px 20px 20px 28px',
          borderRight: '1px solid var(--border)',
          overflowY: 'auto',
        }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>Prompt</div>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={14}
            placeholder="Paste the prompt you want to analyze…"
            style={{
              flex: 1, width: '100%', minHeight: 240,
              border: '1px solid var(--border)', borderRadius: 10,
              padding: '12px 14px', background: 'var(--surface-2)', color: 'var(--text)',
              fontFamily: 'var(--mono)', fontSize: 12.5, resize: 'vertical',
              outline: 'none', lineHeight: 1.6,
              transition: 'border-color .15s',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
          />

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="ply-btn ply-btn-primary"
              disabled={!canRun}
              onClick={runAnalyze}
              style={{ flex: 1, justifyContent: 'center', opacity: !canRun ? 0.5 : 1, cursor: !canRun ? 'not-allowed' : 'pointer' }}
            >
              {loading ? (
                <><span className="ply-dot ply-dot-pulse" style={{ width: 8, height: 8, background: 'white' }} /> Analyzing…</>
              ) : (
                <>
                  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                  </svg>
                  Analyze · −10 cr
                </>
              )}
            </button>
          </div>

          {/* Credit note */}
          <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.5 }}>
            Runs Health Score (5 cr) and Advisory (5 cr) together.
          </div>
        </div>

        {/* ── Right: results ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            {([
              { id: 'health' as const, label: 'Health Score' },
              { id: 'advisory' as const, label: 'Advisory' },
            ]).map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: '14px 20px', border: 0, background: 'transparent', cursor: 'pointer',
                borderBottom: tab === t.id ? '2px solid var(--primary)' : '2px solid transparent',
                color: tab === t.id ? 'var(--text)' : 'var(--text-muted)',
                fontWeight: tab === t.id ? 600 : 400, fontSize: 13.5, marginBottom: -1,
                transition: 'color .12s',
              }}>{t.label}</button>
            ))}
          </div>

          {/* Results scroll area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px' }}>
            {!hasResults && !loading && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10, color: 'var(--text-muted)' }}>
                <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                </svg>
                <span style={{ fontSize: 13 }}>Paste a prompt and click Analyze to get started.</span>
              </div>
            )}

            {loading && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: 'var(--text-muted)' }}>
                <span className="ply-dot ply-dot-pulse" style={{ width: 10, height: 10, background: 'var(--primary)' }} />
                <span style={{ fontSize: 13 }}>Running analysis…</span>
              </div>
            )}

            {!loading && tab === 'health' && healthScore && <HealthPanel score={healthScore} prompt={prompt} />}
            {!loading && tab === 'advisory' && advisory && <AdvisoryPanel advisory={advisory} />}
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Health Score panel ───────────────────────────────────────────────────── */
const METRIC_KEYS = [
  'clarity','specificity','completeness','conciseness','tone',
  'actionability','context_richness','goal_alignment',
  'injection_robustness','reusability',
] as const;

const RISK_COLOR: Record<string, string> = {
  NONE: 'var(--success)', LOW: 'var(--primary)', MODERATE: 'var(--warning)', HIGH: 'var(--danger)',
};

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="ply-btn ply-btn-sm" onClick={() => {
      navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
    }} style={{ color: copied ? 'var(--success)' : undefined }}>
      {copied
        ? <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><polyline points="20 6 9 17 4 12"/></svg>
        : <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      }
      {copied ? 'Copied' : 'Copy prompt'}
    </button>
  );
}

function HealthPanel({ score, prompt }: { score: HealthScoreResponse; prompt: string }) {
  const overall = score.meta.overall_score ?? 5;
  const grade = score.meta.grade ?? gradeLabel(overall);
  const dims = METRIC_KEYS.map(k => ({
    name: k.replace(/_/g, ' '),
    score: score.scores[k]?.score ?? 0,
    rationale: score.scores[k]?.rationale ?? '',
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Score hero card */}
      <div className="ply-card" style={{ padding: '18px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 16, alignItems: 'center' }}>
          {/* Grade badge */}
          <div style={{
            width: 68, height: 68, borderRadius: 14,
            background: gradeGradient(overall),
            display: 'grid', placeItems: 'center',
            fontSize: 28, fontWeight: 700, color: 'white',
            fontFamily: 'var(--mono)',
          }}>{grade}</div>

          {/* Score + badges */}
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="mono" style={{ fontSize: 36, fontWeight: 700, color: 'var(--text)' }}>
                {overall.toFixed(1)}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>/ 10 overall</span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {score.meta.deploy_ready && (
                <span className="ply-pill ply-pill-success" style={{ fontSize: 11 }}>Deploy ready</span>
              )}
              <span className="ply-pill" style={{ fontSize: 11, color: RISK_COLOR[score.meta.injection_risk] ?? 'var(--text)' }}>
                Injection risk · {score.meta.injection_risk}
              </span>
            </div>
          </div>

          <CopyBtn text={prompt} />
        </div>
      </div>

      {/* Dimension bars */}
      <div className="ply-card" style={{ padding: 0, overflow: 'hidden' }}>
        {dims.map((d, i) => (
          <div key={d.name} style={{
            display: 'grid', gridTemplateColumns: '160px 50px 1fr',
            gap: 12, alignItems: 'center', padding: '11px 18px',
            borderBottom: i < dims.length - 1 ? '1px solid var(--border)' : 'none',
            fontSize: 13,
          }}>
            <span style={{ color: 'var(--text-muted)' }}>{d.name}</span>
            <span className="mono" style={{ fontWeight: 600, color: scoreColor(d.score) }}>
              {d.score.toFixed(1)}
            </span>
            <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${d.score * 10}%`, background: scoreColor(d.score), borderRadius: 3, transition: 'width .4s ease' }} />
            </div>
          </div>
        ))}
      </div>

      {/* Top improvements */}
      {score.top_improvements.length > 0 && (
        <div className="ply-card" style={{ padding: '14px 18px', background: 'var(--warning-soft)', borderColor: 'transparent' }}>
          <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 8, color: 'var(--warning)' }}>Top improvements</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-muted)', lineHeight: 1.7, fontSize: 12.5 }}>
            {score.top_improvements.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </div>
      )}

      {/* Critical failures */}
      {score.critical_failures.length > 0 && (
        <div className="ply-card" style={{ padding: '14px 18px', background: 'var(--danger-soft)', borderColor: 'transparent' }}>
          <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 8, color: 'var(--danger)' }}>Critical failures</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-muted)', lineHeight: 1.7, fontSize: 12.5 }}>
            {score.critical_failures.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </div>
      )}

      {score.deploy_verdict && (
        <div className="ply-card" style={{ padding: '12px 16px', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <span style={{ fontWeight: 600, color: 'var(--text)', marginRight: 6 }}>Verdict:</span>
          {score.deploy_verdict}
        </div>
      )}
    </div>
  );
}

/* ── Advisory panel ───────────────────────────────────────────────────────── */
const SEVERITY_COLOR: Record<string, string> = {
  HIGH: 'var(--danger)', MEDIUM: 'var(--warning)', LOW: 'var(--text-muted)',
};
const ADVISORY_OVERALL_COLOR: Record<string, string> = {
  EXCELLENT: 'var(--success)', GOOD: 'var(--success)', FAIR: 'var(--warning)', POOR: 'var(--danger)',
};

function AdvisoryPanel({ advisory }: { advisory: AdvisoryResponse }) {
  const sections = [
    { key: 'strengths',    label: 'Strengths',             color: 'var(--success)', items: advisory.strengths    ?? [] },
    { key: 'weaknesses',   label: 'Weaknesses',            color: 'var(--danger)',  items: advisory.weaknesses   ?? [] },
    { key: 'improvements', label: 'Suggested improvements',color: 'var(--primary)', items: advisory.improvements ?? [] },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Meta */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span className="ply-pill" style={{ color: ADVISORY_OVERALL_COLOR[advisory.meta.overall_score] ?? 'var(--text)' }}>
          Overall: {advisory.meta.overall_score}
        </span>
        <span className="ply-pill" style={{ color: SEVERITY_COLOR[advisory.meta.injection_risk] ?? 'var(--text)' }}>
          Injection risk: {advisory.meta.injection_risk}
        </span>
      </div>

      {/* Overall assessment */}
      {advisory.overall_assessment && (
        <div className="ply-card" style={{ padding: '12px 16px', fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
          {advisory.overall_assessment}
        </div>
      )}

      {/* Dimension scores */}
      {advisory.dimension_scores && (
        <div className="ply-card" style={{ padding: '14px 18px' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)',
            textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
            Dimension Scores
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {(Object.keys(DIMENSION_LABELS) as (keyof typeof DIMENSION_LABELS)[]).map(key => {
              const raw = advisory.dimension_scores[key as keyof typeof advisory.dimension_scores] ?? '';
              const sep = raw.indexOf(' — ');
              const label = sep === -1 ? raw.trim() : raw.slice(0, sep).trim();
              const explanation = sep === -1 ? '' : raw.slice(sep + 3).trim();
              return (
                <div key={key} style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text)' }}>{DIMENSION_LABELS[key]}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: SEVERITY_COLOR[label] ?? 'var(--text-muted)', background: 'var(--surface-3)', borderRadius: 3, padding: '1px 6px', whiteSpace: 'nowrap' }}>
                      {label}
                    </span>
                  </div>
                  {explanation && (
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)', marginTop: 4, lineHeight: 1.4 }}>{explanation}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Strengths / Weaknesses / Improvements */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {sections.map(s => (
          <div key={s.key} className="ply-card" style={{ gridColumn: s.key === 'improvements' ? '1 / -1' : 'auto', padding: '14px 16px' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10, color: s.color }}>
              {s.label}
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {(s.items as string[]).map((item, i) => {
                const { severity, text } = parseSeverity(item);
                return (
                  <li key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '7px 0', borderBottom: i < s.items.length - 1 ? '1px dashed var(--border)' : 'none' }}>
                    {severity && (
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: SEVERITY_COLOR[severity] ?? 'var(--text-muted)', alignSelf: 'flex-start', background: 'var(--surface-2)', borderRadius: 3, padding: '1px 6px' }}>
                        {severity}
                      </span>
                    )}
                    <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-muted)' }}>{text}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
