'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { X, Copy, CheckCheck, GitBranch, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { buttonVariants } from '@/components/ui/button';
import type { JobResult, ReasoningBlock } from '@/types/api';
import { useFavoriteStatus, useLikeMutation, useUnlikeByVersionMutation } from '@/hooks/use-favorites';

const DIMENSION_LABELS: Record<string, string> = {
  role_persona: 'Role / Persona',
  goal_clarity: 'Goal Clarity',
  context_grounding: 'Context Grounding',
  output_format: 'Output Format',
  examples_exemplars: 'Examples / Exemplars',
  constraints_guardrails: 'Constraints',
  tone_audience: 'Tone & Audience',
  conciseness: 'Conciseness',
};

const DIMENSION_ORDER = Object.keys(DIMENSION_LABELS);

function ScoreDot({ score }: { score: string }) {
  const color =
    score === 'strong' ? 'var(--success)' :
    score === 'weak' ? 'var(--warning)' :
    'var(--danger)';
  const label =
    score === 'strong' ? 'Strong' :
    score === 'weak' ? 'Weak' :
    'Missing';
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
      <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11, color, fontWeight: 600 }}>{label}</span>
    </span>
  );
}

function DimensionBreakdown({ scores, rationale }: { scores: Record<string, string>; rationale?: string | null }) {
  return (
    <div style={{ borderRadius: 10, border: '1px solid rgba(34,197,94,0.2)', background: 'rgba(34,197,94,0.04)', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(34,197,94,0.15)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
        <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10, fontWeight: 700, color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          Quality breakdown
        </span>
      </div>
      <div style={{ padding: '8px 0' }}>
        {DIMENSION_ORDER.map((key) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 14px' }}>
            <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {DIMENSION_LABELS[key]}
            </span>
            <ScoreDot score={scores[key] ?? 'missing'} />
          </div>
        ))}
      </div>
      {rationale && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(34,197,94,0.15)', fontFamily: 'var(--font-geist, ui-sans-serif)', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.6 }}>
          {rationale}
        </div>
      )}
    </div>
  );
}

const KIND_COLORS: Record<string, { bg: string; text: string }> = {
  Structure:       { bg: 'rgba(99,102,241,0.12)',  text: '#818cf8' },
  Scope:           { bg: 'rgba(20,184,166,0.12)',  text: '#2dd4bf' },
  Guardrails:      { bg: 'rgba(245,158,11,0.12)',  text: '#fbbf24' },
  'Failure modes': { bg: 'rgba(239,68,68,0.12)',   text: '#f87171' },
  Tone:            { bg: 'rgba(34,197,94,0.12)',   text: '#4ade80' },
  Clarity:         { bg: 'rgba(168,85,247,0.12)',  text: '#c084fc' },
  Format:          { bg: 'rgba(59,130,246,0.12)',  text: '#60a5fa' },
};
const DEFAULT_KIND_COLOR = { bg: 'rgba(124,92,255,0.1)', text: 'var(--primary)' };

function ReasoningPanel({ reasoning }: { reasoning: ReasoningBlock }) {
  return (
    <div style={{
      marginTop: 24,
      borderTop: '1px solid var(--border)',
      paddingTop: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
    }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          width: 20, height: 20, borderRadius: 6,
          background: 'var(--primary-soft)',
          color: 'var(--primary)',
          display: 'grid', placeItems: 'center', flexShrink: 0,
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
          </svg>
        </span>
        <span style={{
          fontFamily: 'var(--font-geist-mono, monospace)',
          fontSize: 10.5, fontWeight: 700,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          color: 'var(--text-subtle)',
        }}>
          Why this version?
        </span>
      </div>

      {/* Summary */}
      <div style={{
        padding: '10px 14px', borderRadius: 10,
        background: 'var(--primary-soft)',
        border: '1px solid rgba(124,92,255,0.15)',
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--primary)" style={{ flexShrink: 0, marginTop: 2 }}>
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text)', fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
          <span style={{ fontWeight: 700, color: 'var(--primary)', marginRight: 4 }}>Summary.</span>
          {reasoning.summary}
        </p>
      </div>

      {/* What changed */}
      {reasoning.changes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{
            fontFamily: 'var(--font-geist-mono, monospace)',
            fontSize: 10.5, fontWeight: 700,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'var(--text-subtle)',
          }}>
            What changed · {reasoning.changes.length}
          </span>
          {reasoning.changes.map((change, i) => {
            const colors = KIND_COLORS[change.kind] ?? DEFAULT_KIND_COLOR;
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 12, alignItems: 'flex-start' }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center',
                  padding: '3px 8px', borderRadius: 5,
                  background: colors.bg, color: colors.text,
                  fontFamily: 'var(--font-geist-mono, monospace)',
                  fontSize: 10, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap',
                }}>
                  {change.kind}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
                    {change.title}
                  </span>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55, fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
                    {change.detail}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Kept from original */}
      {reasoning.kept.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{
            fontFamily: 'var(--font-geist-mono, monospace)',
            fontSize: 10.5, fontWeight: 700,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'var(--text-subtle)',
          }}>
            Kept from original
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {reasoning.kept.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
                  {item}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function countSections(text: string): number {
  return (text.match(/\n#/g) ?? []).length;
}

function estimateTokens(text: string): number {
  return Math.round(text.length / 4);
}

interface ResultPanelProps {
  result: JobResult;
  onClose: () => void;
  onForceOptimize?: () => void;
  isLoading?: boolean;
}

export function ResultPanel({ result, onClose, onForceOptimize, isLoading = false }: ResultPanelProps) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'optimized' | 'original'>('optimized');
  const isAlreadyOptimized = Boolean(result.already_optimized);

  useEffect(() => {
    setActiveTab('optimized');
  }, [result.optimized_prompt]);

  const { data: statusData } = useFavoriteStatus(result.prompt_version_id ?? null);
  const [isFavorited, setIsFavorited] = useState(false);
  const [favoriteId, setFavoriteId] = useState<string | null>(null);
  const likeMutation = useLikeMutation();
  const unlikeMutation = useUnlikeByVersionMutation();
  const isSavePending = likeMutation.isPending || unlikeMutation.isPending;

  useEffect(() => {
    if (statusData) {
      setIsFavorited(statusData.is_favorited);
      setFavoriteId(statusData.prompt_store_id ?? null);
    }
  }, [statusData]);

  const handleSaveToggle = async () => {
    if (isSavePending || !result.prompt_version_id) return;
    if (isFavorited) {
      await unlikeMutation.mutateAsync(result.prompt_version_id);
      setIsFavorited(false);
      setFavoriteId(null);
    } else {
      const res = await likeMutation.mutateAsync({ prompt_version_id: result.prompt_version_id });
      setIsFavorited(true);
      setFavoriteId(res.id);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.optimized_prompt);
      setCopied(true);
      toast.success('Copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const showing = activeTab === 'optimized' ? result.optimized_prompt : result.original_prompt;
  const optWords = wordCount(result.optimized_prompt);
  const origWords = wordCount(result.original_prompt);
  const wordDelta = optWords - origWords;
  const shownWords = wordCount(showing);
  const shownLines = showing.split('\n').length;
  const shownTokens = estimateTokens(showing);
  const shownSections = countSections(showing);
  const metaStr = [
    `${shownLines} lines`,
    `${shownWords} words`,
    `~${shownTokens} tokens`,
    shownSections > 0 ? `${shownSections} sections` : null,
  ].filter(Boolean).join(' · ');

  return (
    <aside
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface)',
        minHeight: 0,
        overflow: 'hidden',
        borderLeft: '1px solid var(--border)',
      }}
    >
      {/* ── Header ── */}
      <div style={{
        flexShrink: 0,
        padding: '14px 16px 12px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 11,
      }}>
        {/* Top row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Gradient sparkles icon */}
          <div style={{
            width: 28, height: 28, borderRadius: 7, flexShrink: 0,
            background: 'linear-gradient(135deg, var(--primary), var(--accent))',
            color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {/* Sparkles icon */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.5 5.5l2.5 2.5M16 16l2.5 2.5M5.5 18.5l2.5-2.5M16 8l2.5-2.5"/>
            </svg>
          </div>

          {/* Title + subtitle */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5, lineHeight: 1.2, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {isAlreadyOptimized ? 'Already optimized' : 'Optimized prompt'}
            </div>
            <div style={{
              fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
              color: 'var(--text-subtle)', marginTop: 3,
              display: 'flex', alignItems: 'center', gap: 6,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {result.version && (
                <>
                  <GitBranch style={{ width: 9, height: 9, flexShrink: 0 }} />
                  v{result.version}
                  <span>·</span>
                </>
              )}
              <span>Analysis</span>
            </div>
          </div>

          {/* Right buttons */}
          {/* Save heart */}
          <button
            type="button"
            onClick={handleSaveToggle}
            disabled={!result.prompt_version_id || isSavePending}
            title={!result.prompt_version_id ? 'Run the optimization first to save it' : isFavorited ? 'Remove from prompt store' : 'Save to prompt store'}
            style={{
              width: 28, height: 28, padding: 0, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 6, border: '1px solid transparent',
              background: 'transparent', cursor: !result.prompt_version_id ? 'not-allowed' : 'pointer',
              color: isFavorited ? '#f43f5e' : 'var(--text-subtle)',
              opacity: !result.prompt_version_id ? 0.5 : 1,
              transition: 'background 150ms, color 150ms',
            }}
            onMouseEnter={e => { if (result.prompt_version_id) e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={isFavorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
            </svg>
          </button>

          {/* Close */}
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            style={{
              width: 28, height: 28, padding: 0, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 6, border: '1px solid transparent',
              background: 'transparent', color: 'var(--text-subtle)', cursor: 'pointer',
              transition: 'background 150ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-subtle)'; }}
          >
            <X style={{ width: 13, height: 13 }} />
          </button>
        </div>

        {/* ── Pill tab switcher ── */}
        {!isAlreadyOptimized && (
          <div style={{
            display: 'flex', gap: 2, padding: 3,
            background: 'var(--surface-2)', borderRadius: 8,
            border: '1px solid var(--border)',
          }}>
            {([
              { id: 'optimized', label: 'Optimized', icon: (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.5 5.5l2.5 2.5M16 16l2.5 2.5M5.5 18.5l2.5-2.5M16 8l2.5-2.5"/>
                </svg>
              )},
              { id: 'original', label: 'Original', icon: (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
              )},
            ] as const).map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    flex: 1, padding: '6px 10px', borderRadius: 6, border: 0, cursor: 'pointer',
                    background: isActive ? 'var(--surface)' : 'transparent',
                    color: isActive ? 'var(--text)' : 'var(--text-muted)',
                    boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                    fontWeight: isActive ? 600 : 500,
                    fontSize: 12,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    transition: 'background 150ms, color 150ms',
                    fontFamily: 'var(--font-geist, ui-sans-serif)',
                  }}
                >
                  {tab.icon}{tab.label}
                </button>
              );
            })}
          </div>
        )}

        {/* ── Meta strip ── */}
        <div style={{
          display: 'flex', gap: 8, fontSize: 10.5,
          fontFamily: 'var(--font-geist-mono, monospace)',
          color: 'var(--text-subtle)', flexWrap: 'wrap', alignItems: 'center',
        }}>
          <span>{metaStr}</span>
          <span style={{ flex: 1 }} />
          {activeTab === 'optimized' && wordDelta !== 0 && (
            <span style={{
              padding: '1px 6px', borderRadius: 4,
              background: wordDelta > 0 ? 'var(--success-soft)' : 'var(--danger-soft)',
              color: wordDelta > 0 ? 'var(--success)' : 'var(--danger)',
              fontWeight: 600,
            }}>
              {wordDelta > 0 ? '+' : ''}{wordDelta} words
            </span>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 20px', background: 'var(--bg)', alignSelf: 'stretch' }}>
        {isAlreadyOptimized && (
          <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 16, fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
            Your prompt is already in great shape — no changes made.
          </p>
        )}

        <pre style={{
          margin: 0,
          fontFamily: 'var(--font-geist-mono, monospace)',
          fontSize: 12.5, lineHeight: 1.7,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          color: activeTab === 'original' ? 'var(--text-muted)' : 'var(--text)',
        }}>
          {showing || '(empty)'}
        </pre>

        {isAlreadyOptimized && result.gate_dimension_scores && (
          <div style={{ marginTop: 20 }}>
            <DimensionBreakdown scores={result.gate_dimension_scores} rationale={result.gate_rationale} />
          </div>
        )}

        {!isAlreadyOptimized && activeTab === 'optimized' && result.reasoning && (
          <ReasoningPanel reasoning={result.reasoning} />
        )}
      </div>

      {/* ── Footer ── */}
      <div style={{
        flexShrink: 0,
        padding: '10px 12px',
        borderTop: '1px solid var(--border)',
        background: 'var(--surface)',
        display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
      }}>
        {/* Copy */}
        <button
          type="button"
          onClick={handleCopy}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px',
            borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer',
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--text-muted)', fontFamily: 'var(--font-geist, ui-sans-serif)',
            transition: 'background 150ms, color 150ms, border-color 150ms',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          {copied ? (
            <><CheckCheck style={{ width: 13, height: 13, color: 'var(--success)' }} /> Copied</>
          ) : (
            <><Copy style={{ width: 13, height: 13 }} /> Copy</>
          )}
        </button>

        {/* Download */}
        <button
          type="button"
          onClick={() => {
            const blob = new Blob([result.optimized_prompt], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'optimized-prompt.md'; a.click();
            URL.revokeObjectURL(url);
          }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px',
            borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer',
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--text-muted)', fontFamily: 'var(--font-geist, ui-sans-serif)',
            transition: 'background 150ms, color 150ms',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download
        </button>

        {/* Save */}
        <button
          type="button"
          onClick={handleSaveToggle}
          disabled={!result.prompt_version_id || isSavePending}
          title={!result.prompt_version_id ? 'Run the optimization first to save it' : isFavorited ? 'Remove from prompt store' : 'Save to prompt store'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px',
            borderRadius: 7, fontSize: 12, fontWeight: 500,
            cursor: (!result.prompt_version_id || isSavePending) ? 'not-allowed' : 'pointer',
            border: isFavorited ? '1px solid rgba(244,63,94,0.4)' : '1px solid var(--border)',
            background: isFavorited ? 'rgba(244,63,94,0.08)' : 'transparent',
            color: isFavorited ? '#f43f5e' : 'var(--text-muted)',
            opacity: (!result.prompt_version_id || isSavePending) ? 0.5 : 1,
            fontFamily: 'var(--font-geist, ui-sans-serif)',
            transition: 'background 150ms, color 150ms, border-color 150ms',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill={isFavorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
          </svg>
          {isFavorited ? 'Saved' : 'Save'}
        </button>

        <div style={{ flex: 1 }} />

        {/* Version history */}
        {result.prompt_id && !isAlreadyOptimized && (
          <Link
            href={`/versions/${result.prompt_id}`}
            className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'h-7 text-xs' })}
          >
            <GitBranch style={{ width: 11, height: 11, marginRight: 4 }} />
            Version history
          </Link>
        )}

        {/* Re-run */}
        {isAlreadyOptimized && onForceOptimize && (
          <button
            type="button"
            onClick={onForceOptimize}
            disabled={isLoading}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px',
              borderRadius: 7, fontSize: 12, fontWeight: 500,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-muted)', cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.5 : 1,
              fontFamily: 'var(--font-geist, ui-sans-serif)',
              transition: 'background 150ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <Zap style={{ width: 12, height: 12 }} />
            Re-run
          </button>
        )}
      </div>
    </aside>
  );
}
