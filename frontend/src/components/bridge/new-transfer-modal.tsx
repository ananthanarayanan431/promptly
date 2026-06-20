'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { TransferJobCreatedResponse } from '@/types/bridge';
import type { ModelInfo, ModelListResponse } from '@/types/openrouter';

function useModels() {
  return useQuery<ModelInfo[]>({
    queryKey: ['openrouter-models'],
    queryFn: async () => {
      const res = await api.get<{ data: ModelListResponse }>('/api/v1/openrouter/models');
      return res.data.data.models;
    },
    staleTime: 10 * 60 * 1000, // 10 min — matches server-side TTL
    retry: 1,
  });
}

function fmtCtx(n: number | null): string {
  if (n == null) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M ctx`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k ctx`;
  return `${n} ctx`;
}

function fmtPrice(p: ModelInfo['pricing']): string {
  if (!p) return '';
  const val = Number(p.prompt_per_token);
  if (Number.isNaN(val)) return '';
  return `$${(val * 1_000_000).toFixed(2)}/M`;
}

interface Props {
  onClose: () => void;
  onJobStarted: (jobId: string) => void;
  defaultSourceModel?: string;
  defaultTargetModel?: string;
}

function ModelInput({
  label,
  value,
  onChange,
  placeholder,
  models,
  modelsLoading,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  models: ModelInfo[];
  modelsLoading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const query = value.toLowerCase();
  const filtered = models.filter(
    (m) => m.id.toLowerCase().includes(query) || (m.name ?? '').toLowerCase().includes(query),
  );

  return (
    <div style={{ position: 'relative' }}>
      <label style={{
        display: 'block', fontSize: 11.5, color: 'var(--text-subtle)',
        marginBottom: 5, fontWeight: 500, letterSpacing: '0.02em',
      }}>
        {label}
      </label>
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={e => { setOpen(true); (e.target as HTMLInputElement).style.borderColor = 'var(--primary)'; }}
        onBlur={e => { setTimeout(() => setOpen(false), 140); (e.target as HTMLInputElement).style.borderColor = 'var(--border)'; }}
        placeholder={modelsLoading ? 'Loading models…' : placeholder}
        style={{
          width: '100%', padding: '9px 11px', borderRadius: 8,
          border: '1px solid var(--border)', background: 'var(--surface-2)',
          color: 'var(--text)', fontSize: 13, outline: 'none',
          boxSizing: 'border-box', fontFamily: 'var(--font-geist-mono, monospace)',
          transition: 'border-color 150ms',
        }}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
          marginTop: 4,
          boxShadow: 'var(--shadow-lg)',
          maxHeight: 240, overflowY: 'auto',
        }}>
          {filtered.slice(0, 50).map((m) => (
            <button
              key={m.id}
              type="button"
              onMouseDown={() => { onChange(m.id); setOpen(false); }}
              style={{
                width: '100%', padding: '7px 11px', background: 'none', border: 'none',
                textAlign: 'left', cursor: 'pointer',
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8,
                transition: 'background 100ms',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
            >
              <span style={{
                fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12,
                color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {m.id}
              </span>
              <span style={{
                fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
                color: 'var(--text-subtle)', flexShrink: 0,
                display: 'flex', gap: 8,
              }}>
                {m.context_length != null && (
                  <span>{fmtCtx(m.context_length)}</span>
                )}
                {m.pricing && (
                  <span style={{ color: 'var(--primary)', opacity: 0.8 }}>{fmtPrice(m.pricing)}</span>
                )}
              </span>
            </button>
          ))}
          {filtered.length > 50 && (
            <div style={{ padding: '6px 11px', fontSize: 11, color: 'var(--text-subtle)', fontFamily: 'var(--font-geist-mono, monospace)' }}>
              +{filtered.length - 50} more — type to narrow
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BridgeDiagram({ animating }: { animating: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0 4px' }}>
      <div style={{
        width: 36, height: 36, borderRadius: 9,
        background: animating ? 'var(--primary-soft)' : 'var(--surface-2)',
        border: `1px solid ${animating ? 'var(--primary)' : 'var(--border)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 400ms',
      }}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
          stroke={animating ? 'var(--primary)' : 'var(--text-subtle)'}
          strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="7" width="8" height="10" rx="2" />
          <path d="M10 12h4" />
        </svg>
      </div>

      <div style={{ flex: 1, height: 2, position: 'relative', background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
        {animating && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0, width: '40%', borderRadius: 2,
            background: 'linear-gradient(90deg, transparent, var(--primary), #a78bfa, transparent)',
            animation: 'ntmFlow 1.2s ease-in-out infinite',
          }} />
        )}
      </div>

      <div style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
          stroke={animating ? 'var(--primary)' : 'var(--border-strong)'}
          strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
          style={{ transition: 'stroke 400ms' }}>
          <path d="M8 3L4 7l4 4M16 21l4-4-4-4M4 7h16M20 17H4" />
        </svg>
      </div>

      <div style={{ flex: 1, height: 2, position: 'relative', background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
        {animating && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0, width: '40%', borderRadius: 2,
            background: 'linear-gradient(90deg, transparent, #a78bfa, var(--primary), transparent)',
            animation: 'ntmFlow 1.2s ease-in-out infinite 0.6s',
          }} />
        )}
      </div>

      <div style={{
        width: 36, height: 36, borderRadius: 9,
        background: animating ? 'var(--primary-soft)' : 'var(--surface-2)',
        border: `1px solid ${animating ? 'var(--primary)' : 'var(--border)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 400ms',
      }}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
          stroke={animating ? 'var(--primary)' : 'var(--text-subtle)'}
          strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <rect x="14" y="7" width="8" height="10" rx="2" />
          <path d="M14 12H10" />
        </svg>
      </div>

      <style>{`
        @keyframes ntmFlow {
          0%   { transform: translateX(-200%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}

export function NewTransferModal({ onClose, onJobStarted, defaultSourceModel = '', defaultTargetModel = '' }: Props) {
  const [sourceModel, setSourceModel] = useState(defaultSourceModel);
  const [targetModel, setTargetModel] = useState(defaultTargetModel);
  const [sourcePrompt, setSourcePrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isPrefilled = !!defaultSourceModel && !!defaultTargetModel;

  const { data: models = [], isLoading: modelsLoading } = useModels();

  const valid = sourceModel.trim().length >= 3 && targetModel.trim().length >= 3 && sourcePrompt.trim().length >= 10 && sourceModel.trim() !== targetModel.trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    if (sourceModel.trim() === targetModel.trim()) {
      setError('Source and target model must be different.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post<{ data: TransferJobCreatedResponse }>(
        '/api/v1/prompt-bridge/transfer',
        { source_prompt: sourcePrompt.trim(), source_model: sourceModel.trim(), target_model: targetModel.trim() }
      );
      onJobStarted(res.data.data.job_id);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail ?? 'Transfer failed. Please try again.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(3px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 16,
          padding: '26px 28px', width: '100%', maxWidth: 560,
          fontFamily: 'var(--font-geist, ui-sans-serif)',
          boxShadow: 'var(--shadow-lg)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 6 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
              <h2 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, color: 'var(--text)' }}>
                {isPrefilled ? 'Try Another Prompt' : 'New Transfer'}
              </h2>
              <span style={{
                fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                background: isPrefilled
                  ? 'linear-gradient(135deg, #0ea5e9, #6366f1)'
                  : 'linear-gradient(135deg, var(--primary), #a855f7)',
                color: '#fff', letterSpacing: '0.05em',
              }}>
                {isPrefilled ? 'CACHED · fast' : 'BRIDGE · calibrates models'}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.5 }}>
              {isPrefilled
                ? `Reusing your ${sourceModel.split('/')[1] ?? sourceModel} → ${targetModel.split('/')[1] ?? targetModel} mapping. Just paste a new prompt.`
                : 'Translate a prompt optimised for one model to work on another.'}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: 'var(--text-subtle)',
              cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 0, marginLeft: 12,
            }}
          >×</button>
        </div>

        <BridgeDiagram animating={submitting} />

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <ModelInput label="Source model" value={sourceModel} onChange={setSourceModel} placeholder="openai/gpt-4o" models={models} modelsLoading={modelsLoading} />
            <ModelInput label="Target model" value={targetModel} onChange={setTargetModel} placeholder="anthropic/claude-sonnet-4-5" models={models} modelsLoading={modelsLoading} />
          </div>

          <div>
            <label style={{
              display: 'block', fontSize: 11.5, color: 'var(--text-subtle)',
              marginBottom: 5, fontWeight: 500, letterSpacing: '0.02em',
            }}>
              Source prompt <span style={{ color: 'var(--border-strong)', fontWeight: 400 }}>— already optimised for the source model</span>
            </label>
            <textarea
              value={sourcePrompt}
              onChange={e => setSourcePrompt(e.target.value)}
              rows={6}
              placeholder="Paste the prompt here…"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--surface-2)',
                color: 'var(--text)', fontSize: 13, outline: 'none',
                resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box',
                fontFamily: 'var(--font-geist, ui-sans-serif)',
                transition: 'border-color 150ms',
              }}
              onFocus={e => (e.target.style.borderColor = 'var(--primary)')}
              onBlur={e => (e.target.style.borderColor = 'var(--border)')}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--text-subtle)', fontFamily: 'var(--font-geist-mono, monospace)' }}>
                {sourcePrompt.length} chars
              </span>
            </div>
          </div>

          <div style={{
            background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8,
            padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5,
          }}>
            <span style={{ color: 'var(--primary)' }}>tokens</span> for a new model pair (builds reusable calibration) ·{' '}
            <span style={{ color: 'var(--accent)' }}>1 credit</span> when a mapping already exists
          </div>

          {error && (
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--danger)' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting || !valid}
            style={{
              padding: '11px 0', borderRadius: 9, border: 'none',
              background: submitting || !valid
                ? 'var(--surface-3)'
                : 'linear-gradient(135deg, var(--primary), #9c6bff)',
              color: submitting || !valid ? 'var(--text-subtle)' : '#fff',
              fontWeight: 600, fontSize: 14,
              cursor: submitting || !valid ? 'not-allowed' : 'pointer',
              transition: 'all 200ms',
              boxShadow: submitting || !valid ? 'none' : '0 4px 16px var(--primary-ring)',
            }}
          >
            {submitting ? 'Initiating transfer…' : 'Transfer Prompt'}
          </button>
        </form>
      </div>
    </div>
  );
}
