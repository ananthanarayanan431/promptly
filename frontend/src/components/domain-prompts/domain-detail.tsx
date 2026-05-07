'use client';

import { useState } from 'react';
import type { DomainPrompt } from '@/types/domain-prompts';

interface Props {
  domain: DomainPrompt;
  onClose: () => void;
  onReoptimize: (prompt: string) => void;
  reoptimizing: boolean;
}

export function DomainDetail({ domain, onClose, onReoptimize, reoptimizing }: Props) {
  const [copied, setCopied] = useState(false);
  const [promptInput, setPromptInput] = useState(domain.last_prompt ?? '');

  function copyPrompt() {
    if (!domain.optimized_prompt) return;
    navigator.clipboard.writeText(domain.optimized_prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  }

  const scoreImprovement =
    domain.score_before !== null && domain.score_after !== null
      ? Math.round((domain.score_after - domain.score_before) * 100)
      : null;

  const isRunning =
    domain.status === 'preparing_dataset' || domain.status === 'optimizing';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#101014', border: '1px solid #222226', borderRadius: 14,
          padding: 28, width: '100%', maxWidth: 680, maxHeight: '85vh',
          overflowY: 'auto', fontFamily: 'var(--font-geist, ui-sans-serif)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#ededed' }}>
              {domain.name}
            </h2>
            {domain.description && (
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#8a8a90' }}>
                {domain.description}
              </p>
            )}
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#5a5a60', cursor: 'pointer',
            fontSize: 20, marginLeft: 12,
          }}>×</button>
        </div>

        {domain.status === 'completed' && domain.optimized_prompt && (
          <div style={{
            display: 'flex', gap: 16, marginBottom: 20,
            padding: '12px 16px', background: '#141418', borderRadius: 8,
          }}>
            {domain.dataset?.row_count != null && (
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: 20, fontWeight: 700, color: '#7c5cff',
                  fontFamily: 'var(--font-geist-mono, monospace)',
                }}>
                  {domain.dataset.row_count}
                </div>
                <div style={{ fontSize: 11, color: '#5a5a60' }}>Q&amp;A pairs</div>
              </div>
            )}
            {domain.score_before !== null && (
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: 20, fontWeight: 700, color: '#ededed',
                  fontFamily: 'var(--font-geist-mono, monospace)',
                }}>
                  {Math.round(domain.score_before * 100)}%
                </div>
                <div style={{ fontSize: 11, color: '#5a5a60' }}>Before</div>
              </div>
            )}
            {domain.score_after !== null && (
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: 20, fontWeight: 700, color: '#22c55e',
                  fontFamily: 'var(--font-geist-mono, monospace)',
                }}>
                  {Math.round(domain.score_after * 100)}%
                </div>
                <div style={{ fontSize: 11, color: '#5a5a60' }}>After</div>
              </div>
            )}
            {scoreImprovement !== null && (
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: 20, fontWeight: 700,
                  color: scoreImprovement >= 0 ? '#22c55e' : '#f43f5e',
                  fontFamily: 'var(--font-geist-mono, monospace)',
                }}>
                  {scoreImprovement >= 0 ? '+' : ''}{scoreImprovement}%
                </div>
                <div style={{ fontSize: 11, color: '#5a5a60' }}>Improvement</div>
              </div>
            )}
          </div>
        )}

        {isRunning && (
          <div style={{
            marginBottom: 20, padding: '12px 16px',
            background: 'rgba(124,92,255,0.08)', border: '1px solid rgba(124,92,255,0.2)',
            borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: '#7c5cff', flexShrink: 0,
            }} />
            <span style={{ fontSize: 13, color: '#a78bfa' }}>
              {domain.status === 'preparing_dataset' ? 'Building dataset from PDF…' : 'Optimizing prompt variants…'}
            </span>
          </div>
        )}

        {domain.optimized_prompt && domain.last_prompt && (
          <>
            <PromptSection label="Input Prompt" content={domain.last_prompt} />
            <div style={{ margin: '12px 0', textAlign: 'center' }}>
              <span style={{ fontSize: 12, color: '#5a5a60' }}>↓ optimized</span>
            </div>
            <PromptSection label="Optimized Prompt" content={domain.optimized_prompt} highlight />
          </>
        )}

        {domain.status === 'failed' && (
          <div style={{
            padding: '12px 16px', background: 'rgba(244,63,94,0.08)',
            border: '1px solid rgba(244,63,94,0.2)', borderRadius: 8, marginBottom: 16,
          }}>
            <p style={{ margin: 0, fontSize: 13, color: '#f43f5e' }}>
              {domain.error_message ?? 'Optimization failed. Please try again.'}
            </p>
          </div>
        )}

        {/* Prompt input — shown when dataset is ready */}
        {domain.dataset?.dataset_key && !isRunning && (
          <div style={{ marginTop: 20 }}>
            <label style={{
              display: 'block', fontSize: 11, color: '#5a5a60', marginBottom: 6,
              fontFamily: 'var(--font-geist-mono, monospace)', textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>
              Prompt to Optimize
            </label>
            <textarea
              value={promptInput}
              onChange={e => setPromptInput(e.target.value)}
              placeholder="Paste the system prompt you want to optimize against this domain's knowledge base…"
              style={{
                width: '100%', minHeight: 110, padding: '10px 12px', borderRadius: 8,
                border: '1px solid #2a2a2e', background: '#141418',
                color: '#d4d4d8', fontSize: 12.5, lineHeight: 1.6,
                resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                fontFamily: 'var(--font-geist-mono, monospace)',
              }}
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          {domain.optimized_prompt && (
            <button onClick={copyPrompt} style={{
              flex: 1, padding: '10px 0', borderRadius: 8,
              border: '1px solid #2a2a2e', background: 'transparent',
              color: copied ? '#22c55e' : '#ededed', fontWeight: 500, fontSize: 13,
              cursor: 'pointer',
            }}>
              {copied ? '✓ Copied!' : 'Copy Optimized Prompt'}
            </button>
          )}
          {domain.dataset?.dataset_key && (
            <button
              onClick={() => { if (promptInput.trim().length >= 10) onReoptimize(promptInput.trim()); }}
              disabled={reoptimizing || isRunning || promptInput.trim().length < 10}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 6, padding: '10px 0', borderRadius: 8, border: 'none',
                background: reoptimizing || isRunning || promptInput.trim().length < 10 ? '#2a2a2e' : '#7c5cff',
                color: reoptimizing || isRunning || promptInput.trim().length < 10 ? '#5a5a60' : '#fff',
                fontWeight: 600, fontSize: 13,
                cursor: reoptimizing || isRunning || promptInput.trim().length < 10 ? 'not-allowed' : 'pointer',
              }}
            >
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                background: 'rgba(255,255,255,0.2)', color: '#fff',
              }}>PREMIUM</span>
              {reoptimizing ? 'Optimizing…' : 'Optimize (10 cr)'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PromptSection({
  label,
  content,
  highlight,
}: {
  label: string;
  content: string;
  highlight?: boolean;
}) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{
        fontSize: 11, color: '#5a5a60', marginBottom: 6,
        fontFamily: 'var(--font-geist-mono, monospace)', textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}>
        {label}
      </div>
      <pre style={{
        margin: 0, padding: '12px 14px',
        background: highlight ? 'rgba(124,92,255,0.06)' : '#141418',
        border: `1px solid ${highlight ? 'rgba(124,92,255,0.2)' : '#1f1f23'}`,
        borderRadius: 8, fontSize: 12.5, color: '#d4d4d8',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6,
        fontFamily: 'var(--font-geist-mono, monospace)',
        maxHeight: 220, overflowY: 'auto',
      }}>
        {content}
      </pre>
    </div>
  );
}
