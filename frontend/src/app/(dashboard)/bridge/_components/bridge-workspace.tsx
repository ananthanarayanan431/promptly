'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { NewTransferModal } from '@/components/bridge/new-transfer-modal';
import { TransferDetail } from '@/components/bridge/transfer-detail';
import type { TemplateListResponse } from '@/types/api';
import type {
  TransferJobSummary,
  TransferJobListResponse,
  TransferJobPollResponse,
  PromptMappingDetail,
  MappingListResponse,
  PromptMapping,
} from '@/types/bridge';
import type { ModelInfo, ModelListResponse } from '@/types/openrouter';

// ── Model catalog ─────────────────────────────────────────────────────────────
interface ModelDef {
  id: string;
  label: string;
  vendor: string;
  hue: string;
  short: string;
  contextLength: number | null;
  isFree: boolean;
}

// Per-provider hue for the colored dot
const PROVIDER_HUE: Record<string, string> = {
  openai:      'oklch(62% 0.13 165)',
  anthropic:   'oklch(66% 0.16 32)',
  google:      'oklch(68% 0.14 215)',
  'meta-llama':'oklch(58% 0.12 250)',
  'x-ai':      'oklch(56% 0.04 280)',
  mistralai:   'oklch(62% 0.10 30)',
  deepseek:    'oklch(56% 0.14 220)',
  qwen:        'oklch(60% 0.14 190)',
  cohere:      'oklch(62% 0.14 145)',
};
const DEFAULT_HUE = 'oklch(58% 0.04 280)';

// Clean "Provider: Model Name" → "Model Name"
function cleanName(raw: string): string {
  const colon = raw.indexOf(':');
  return colon >= 0 ? raw.slice(colon + 1).trim() : raw;
}

function modelDefFromInfo(m: ModelInfo): ModelDef {
  const provider = m.id.split('/')[0] ?? '';
  const slug = m.id.split('/')[1] ?? m.id;
  const label = cleanName(m.name);
  const short = label.split(' ').slice(0, 2).join(' ').slice(0, 14);
  const vendorMap: Record<string, string> = {
    openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google',
    'meta-llama': 'Meta', 'x-ai': 'xAI', mistralai: 'Mistral',
    deepseek: 'DeepSeek', qwen: 'Qwen', cohere: 'Cohere',
  };
  const pricing = m.pricing;
  const isFree = pricing != null
    ? pricing.prompt_per_token === 0 && pricing.completion_per_token === 0
    : m.id.endsWith(':free');
  return {
    id: m.id,
    label,
    vendor: vendorMap[provider] ?? (provider.charAt(0).toUpperCase() + provider.slice(1)),
    hue: PROVIDER_HUE[provider] ?? DEFAULT_HUE,
    short: short || slug,
    contextLength: m.context_length ?? null,
    isFree,
  };
}

// Fallback static list shown while the API loads (keeps the UI responsive)
const FALLBACK_MODELS: ModelDef[] = [
  { id: 'openai/gpt-4o',               label: 'GPT-4o',            vendor: 'OpenAI',    hue: PROVIDER_HUE.openai,    short: 'GPT-4o',   contextLength: 128000,  isFree: false },
  { id: 'openai/gpt-4o-mini',          label: 'GPT-4o mini',       vendor: 'OpenAI',    hue: PROVIDER_HUE.openai,    short: '4o mini',  contextLength: 128000,  isFree: false },
  { id: 'anthropic/claude-3.5-haiku',  label: 'Claude 3.5 Haiku',  vendor: 'Anthropic', hue: PROVIDER_HUE.anthropic, short: 'Haiku',    contextLength: 200000,  isFree: false },
  { id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5', vendor: 'Anthropic', hue: PROVIDER_HUE.anthropic, short: 'Sonnet',   contextLength: 200000,  isFree: false },
  { id: 'google/gemini-2.5-flash',     label: 'Gemini 2.5 Flash',  vendor: 'Google',    hue: PROVIDER_HUE.google,    short: 'Flash',    contextLength: 1048576, isFree: false },
  { id: 'x-ai/grok-3-beta',            label: 'Grok 3',            vendor: 'xAI',       hue: PROVIDER_HUE['x-ai'],   short: 'Grok 3',   contextLength: 131072,  isFree: false },
];

function useModelCatalog() {
  return useQuery<ModelDef[]>({
    queryKey: ['openrouter-models'],
    queryFn: async () => {
      const res = await api.get<{ data: ModelListResponse }>('/api/v1/openrouter/models');
      return res.data.data.models.map(modelDefFromInfo);
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
    placeholderData: FALLBACK_MODELS,
  });
}

function findModel(id: string, models: ModelDef[]): ModelDef {
  return models.find(m => m.id === id) ?? {
    id,
    label: cleanName(id.split('/')[1] ?? id),
    vendor: id.split('/')[0] ?? '',
    hue: PROVIDER_HUE[id.split('/')[0] ?? ''] ?? DEFAULT_HUE,
    short: (id.split('/')[1] ?? id).slice(0, 14),
    contextLength: null,
    isFree: id.endsWith(':free'),
  };
}

function fmtCtx(n: number | null): string {
  if (n === null) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M ctx`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k ctx`;
  return `${n} ctx`;
}

// Stage labels (no architecture leak)
const STAGE_LABELS: Record<string, string> = {
  source:  'Studying source model',
  target:  'Studying target model',
  extract: 'Learning translation rules',
  adapt:   'Adapting your prompt',
  done:    'Done',
};

// ── Vendor dot ────────────────────────────────────────────────────────────────
function VendorDot({ hue, size = 10 }: { hue: string; size?: number }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
      background: hue,
      boxShadow: `0 0 0 2px color-mix(in oklab, ${hue} 22%, transparent)`,
    }} />
  );
}

// ── Model picker ──────────────────────────────────────────────────────────────
function ModelPicker({ value, onChange, side, excludeId, models }: {
  value: string;
  onChange: (v: string) => void;
  side: 'source' | 'target';
  excludeId: string;
  models: ModelDef[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const m = findModel(value, models);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Auto-focus search when dropdown opens
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 30);
    else setSearch('');
  }, [open]);

  const q = search.toLowerCase();
  const filtered = q
    ? models.filter(o => o.id.toLowerCase().includes(q) || o.label.toLowerCase().includes(q) || o.vendor.toLowerCase().includes(q))
    : models;

  // Group by vendor, preserving the sort order from the API
  const groups: { vendor: string; hue: string; items: ModelDef[] }[] = [];
  for (const opt of filtered) {
    const last = groups[groups.length - 1];
    if (last && last.vendor === opt.vendor) {
      last.items.push(opt);
    } else {
      groups.push({ vendor: opt.vendor, hue: opt.hue, items: [opt] });
    }
  }

  function pick(opt: ModelDef) {
    if (opt.id === excludeId) return;
    onChange(opt.id);
    setOpen(false);
    setSearch('');
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
          background: 'var(--surface)', border: open ? '1.5px solid var(--primary)' : '1px solid var(--border)',
          borderRadius: 12, cursor: 'pointer',
          boxShadow: open ? '0 0 0 4px var(--primary-ring), 0 1px 2px rgba(15,15,30,.04)' : '0 1px 2px rgba(15,15,30,.04)',
          transition: 'all .18s ease',
        }}
      >
        <VendorDot hue={m.hue} size={12} />
        <div style={{ textAlign: 'left', flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600 }}>
            {side === 'source' ? 'From' : 'To'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 1 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</span>
            {m.isFree && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, flexShrink: 0,
                background: 'color-mix(in srgb, var(--success) 12%, transparent)',
                color: 'var(--success)', border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)',
                letterSpacing: '0.04em',
              }}>FREE</span>
            )}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text-subtle)', fontFamily: 'var(--font-geist-mono, monospace)' }}>{m.vendor}</div>
        </div>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth={2} strokeLinecap="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s ease', flexShrink: 0 }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, minWidth: 300,
          zIndex: 40,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
          boxShadow: '0 16px 36px rgba(15,15,30,.12), 0 4px 10px rgba(15,15,30,.06)',
          display: 'flex', flexDirection: 'column',
          maxHeight: 400, overflow: 'hidden',
          animation: 'bwFadeIn .12s ease both',
        }}>
          {/* Search bar */}
          <div style={{
            padding: '8px 8px 6px', borderBottom: '1px solid var(--border)', flexShrink: 0,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'var(--surface-2)', borderRadius: 8, padding: '6px 10px',
              border: '1px solid var(--border)',
            }}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth={2.2} strokeLinecap="round" style={{ flexShrink: 0 }}>
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search models…"
                style={{
                  flex: 1, border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 12.5, color: 'var(--text)', fontFamily: 'var(--font-geist-mono, monospace)',
                }}
              />
              {search && (
                <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-subtle)', lineHeight: 1 }}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              )}
            </div>
          </div>

          {/* Grouped list */}
          <div style={{ overflowY: 'auto', flex: 1, padding: '4px 6px 6px' }}>
            {groups.length === 0 ? (
              <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 12.5 }}>
                No models match &ldquo;{search}&rdquo;
              </div>
            ) : groups.map(group => (
              <div key={group.vendor}>
                {/* Group header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '8px 8px 4px', position: 'sticky', top: 0,
                  background: 'var(--surface)',
                }}>
                  <VendorDot hue={group.hue} size={7} />
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)',
                    textTransform: 'uppercase', letterSpacing: '.09em',
                    fontFamily: 'var(--font-geist-mono, monospace)',
                  }}>
                    {group.vendor}
                  </span>
                  <span style={{ fontSize: 9.5, color: 'var(--text-subtle)', opacity: 0.6, fontFamily: 'var(--font-geist-mono, monospace)' }}>
                    {group.items.length}
                  </span>
                </div>

                {/* Models in group */}
                {group.items.map(opt => {
                  const disabled = opt.id === excludeId;
                  const selected = opt.id === value;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => pick(opt)}
                      disabled={disabled}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                        padding: '7px 8px 7px 22px', borderRadius: 7, border: 0,
                        background: selected ? 'var(--primary-soft)' : 'transparent',
                        textAlign: 'left', opacity: disabled ? .35 : 1,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        transition: 'background 80ms',
                      }}
                      onMouseEnter={e => { if (!disabled && !selected) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; }}
                      onMouseLeave={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = selected ? 'var(--primary-soft)' : 'transparent'; }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 12.5, fontWeight: selected ? 600 : 400,
                          color: selected ? 'var(--primary)' : 'var(--text)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {opt.label}
                        </div>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 6, marginTop: 1,
                        }}>
                          <span style={{
                            fontSize: 10, color: 'var(--text-subtle)',
                            fontFamily: 'var(--font-geist-mono, monospace)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            flex: 1,
                          }}>
                            {opt.id}
                          </span>
                          {opt.isFree && (
                            <span style={{
                              fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                              background: 'color-mix(in srgb, var(--success) 12%, transparent)',
                              color: 'var(--success)', border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)',
                              whiteSpace: 'nowrap', flexShrink: 0, letterSpacing: '0.04em',
                            }}>FREE</span>
                          )}
                          {opt.contextLength !== null && (
                            <span style={{
                              fontSize: 9.5, fontFamily: 'var(--font-geist-mono, monospace)',
                              color: selected ? 'var(--primary)' : 'var(--text-subtle)',
                              background: selected ? 'var(--primary-ring)' : 'var(--surface-2)',
                              border: '1px solid var(--border)',
                              borderRadius: 4, padding: '1px 5px',
                              whiteSpace: 'nowrap', flexShrink: 0,
                            }}>
                              {fmtCtx(opt.contextLength)}
                            </span>
                          )}
                        </div>
                      </div>
                      {selected && (
                        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth={2.5} strokeLinecap="round" style={{ flexShrink: 0 }}>
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                      {disabled && (
                        <span style={{
                          fontSize: 9, padding: '2px 5px', borderRadius: 4, flexShrink: 0,
                          border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-subtle)',
                        }}>in use</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Footer: result count */}
          {search && filtered.length > 0 && (
            <div style={{
              padding: '5px 14px', borderTop: '1px solid var(--border)', flexShrink: 0,
              fontSize: 10.5, color: 'var(--text-subtle)', fontFamily: 'var(--font-geist-mono, monospace)',
            }}>
              {filtered.length} result{filtered.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Bridge Visual (SVG) ───────────────────────────────────────────────────────
type BridgeStage = 'idle' | 'source' | 'target' | 'extract' | 'adapt' | 'done' | 'failed';

function BridgeVisual({ source, target, stage, sourceScore, targetScore, reused, models }: {
  source: string; target: string; stage: BridgeStage;
  sourceScore: number | null; targetScore: number | null; reused: boolean;
  models: ModelDef[];
}) {
  const SRC = findModel(source, models), TGT = findModel(target, models);
  const active  = stage !== 'idle';
  const W = 760, H = 170;

  const srcDone   = ['target', 'extract', 'adapt', 'done'].includes(stage);
  const srcActive = stage === 'source';
  const tgtDone   = ['extract', 'adapt', 'done'].includes(stage);
  const tgtActive = stage === 'target';
  const bridgeLit = ['extract', 'adapt', 'done'].includes(stage);
  const rulesFlowing  = stage === 'extract' || stage === 'adapt';
  const promptFlowing = stage === 'adapt';
  const done = stage === 'done';

  const lineX2 = bridgeLit ? W - 160 : (srcDone ? W / 2 : 160 + (srcActive ? 80 : 0));

  return (
    <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block', maxWidth: W }}>
        <defs>
          <linearGradient id="bv-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor={SRC.hue} />
            <stop offset="50%"  stopColor="oklch(70% 0.18 290)" />
            <stop offset="100%" stopColor={TGT.hue} />
          </linearGradient>
          <radialGradient id="bv-src-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%"   stopColor={SRC.hue} stopOpacity="0.55" />
            <stop offset="100%" stopColor={SRC.hue} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="bv-tgt-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%"   stopColor={TGT.hue} stopOpacity="0.55" />
            <stop offset="100%" stopColor={TGT.hue} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* dashed idle line */}
        <line x1="160" y1={H / 2} x2={W - 160} y2={H / 2}
          stroke="var(--border)" strokeWidth="1.5" strokeDasharray="4 4"
          opacity={active ? 0.3 : 0.8} />

        {/* progress line */}
        {active && (
          <line x1="160" y1={H / 2} x2={lineX2} y2={H / 2}
            stroke="url(#bv-grad)" strokeWidth="2.5" strokeLinecap="round"
            style={{ transition: 'all .8s ease' }} />
        )}

        {/* SOURCE node */}
        <g transform={`translate(120,${H / 2})`}>
          {(srcActive || srcDone) && (
            <circle cx="0" cy="0" r="62" fill="url(#bv-src-glow)"
              style={{ animation: srcActive ? 'bvPulse 1.6s ease-in-out infinite' : 'none', transformOrigin: 'center' }} />
          )}
          <circle cx="0" cy="0" r="38"
            fill="var(--surface)"
            stroke={(srcActive || srcDone) ? SRC.hue : 'var(--border-strong, var(--border))'}
            strokeWidth={srcActive ? 2.5 : 1.5}
            style={{ transition: 'all .3s ease' }} />
          <circle cx="0" cy="0" r="6" fill={SRC.hue}
            style={{ filter: srcActive ? `drop-shadow(0 0 6px ${SRC.hue})` : 'none', transition: 'filter .3s ease' }} />
          {srcActive && [0, 1, 2].map(i => (
            <circle key={i} cx="0" cy="0" r="6" fill="none" stroke={SRC.hue} strokeWidth="1.5"
              style={{ animation: `bvRing 1.8s ease-out ${i * 0.6}s infinite`, transformOrigin: 'center' }} />
          ))}
        </g>

        {/* TARGET node */}
        <g transform={`translate(${W - 120},${H / 2})`}>
          {(tgtActive || tgtDone) && (
            <circle cx="0" cy="0" r="62" fill="url(#bv-tgt-glow)"
              style={{ animation: tgtActive ? 'bvPulse 1.6s ease-in-out infinite' : 'none', transformOrigin: 'center' }} />
          )}
          <circle cx="0" cy="0" r="38"
            fill="var(--surface)"
            stroke={(tgtActive || tgtDone) ? TGT.hue : 'var(--border-strong, var(--border))'}
            strokeWidth={tgtActive ? 2.5 : 1.5}
            style={{ transition: 'all .3s ease' }} />
          <circle cx="0" cy="0" r="6" fill={TGT.hue}
            style={{ filter: tgtActive ? `drop-shadow(0 0 6px ${TGT.hue})` : 'none', transition: 'filter .3s ease' }} />
          {tgtActive && [0, 1, 2].map(i => (
            <circle key={i} cx="0" cy="0" r="6" fill="none" stroke={TGT.hue} strokeWidth="1.5"
              style={{ animation: `bvRing 1.8s ease-out ${i * 0.6}s infinite`, transformOrigin: 'center' }} />
          ))}
        </g>

        {/* Flowing packets (extract + adapt) */}
        {rulesFlowing && [0, 1, 2].map(i => (
          <circle key={i} r="3" fill="var(--primary)"
            style={{
              filter: 'drop-shadow(0 0 4px var(--primary))',
              animation: `bvPkt ${stage === 'adapt' ? 1.0 : 1.8}s linear ${i * 0.4}s infinite`,
              offsetPath: `path('M 160 ${H / 2} L ${W - 160} ${H / 2}')`,
              offsetRotate: '0deg',
            } as React.CSSProperties} />
        ))}

        {/* Token rect flow during adapt */}
        {promptFlowing && [0, 1, 2, 3].map(i => (
          <rect key={i} y={H / 2 - 3} width="14" height="6" rx="2"
            fill="var(--accent, oklch(68% 0.14 215))" opacity="0.7"
            style={{
              filter: 'drop-shadow(0 0 4px var(--accent, oklch(68% 0.14 215)))',
              animation: `bvToken 1.4s ease-in-out ${i * 0.3}s infinite`,
            }} />
        ))}

        {/* Model labels */}
        <g transform={`translate(120,${H / 2 + 56})`} textAnchor="middle">
          <text fontSize="11.5" fontWeight="600" fill="var(--text)">{SRC.label}</text>
          <text y="14" fontSize="10" fill="var(--text-subtle)" fontFamily="var(--font-geist-mono,monospace)">{SRC.vendor}</text>
        </g>
        <g transform={`translate(${W - 120},${H / 2 + 56})`} textAnchor="middle">
          <text fontSize="11.5" fontWeight="600" fill="var(--text)">{TGT.label}</text>
          <text y="14" fontSize="10" fill="var(--text-subtle)" fontFamily="var(--font-geist-mono,monospace)">{TGT.vendor}</text>
        </g>

        {/* Center badge (extract/adapt/done) */}
        {(stage === 'extract' || stage === 'adapt' || done) && (
          <g transform={`translate(${W / 2},${H / 2 - 32})`} textAnchor="middle" style={{ animation: 'bwFadeIn .25s ease both' }}>
            <rect x="-48" y="-12" width="96" height="22" rx="11"
              fill="var(--surface)" stroke="var(--primary)" strokeWidth="1.5" />
            <text fontSize="10.5" fontWeight="600" fill="var(--primary)" y="3"
              fontFamily="var(--font-geist-mono,monospace)">
              {done ? 'BRIDGE READY' : 'BUILDING…'}
            </text>
          </g>
        )}

        {/* Scores */}
        {sourceScore != null && srcDone && (
          <g transform={`translate(120,${H / 2 - 52})`} textAnchor="middle" style={{ animation: 'bwFadeIn .25s ease both' }}>
            <rect x="-22" y="-9" width="44" height="18" rx="9" fill="var(--success-soft, oklch(95% 0.05 150))" />
            <text fontSize="10" fontWeight="600" fill="var(--success)" y="3"
              fontFamily="var(--font-geist-mono,monospace)">{Math.floor(sourceScore * 100)}%</text>
          </g>
        )}
        {targetScore != null && tgtDone && (
          <g transform={`translate(${W - 120},${H / 2 - 52})`} textAnchor="middle" style={{ animation: 'bwFadeIn .25s ease both' }}>
            <rect x="-22" y="-9" width="44" height="18" rx="9" fill="var(--success-soft, oklch(95% 0.05 150))" />
            <text fontSize="10" fontWeight="600" fill="var(--success)" y="3"
              fontFamily="var(--font-geist-mono,monospace)">{Math.floor(targetScore * 100)}%</text>
          </g>
        )}

        {/* Reuse spinning dashed ring */}
        {reused && active && (
          <g transform={`translate(${W / 2},${H / 2})`} style={{ animation: 'bwFadeIn .25s ease both' }}>
            <circle r="48" fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeDasharray="3 4"
              style={{ animation: 'bvSpin 8s linear infinite', transformOrigin: 'center' }} />
            <text textAnchor="middle" y="-58" fontSize="10.5" fontWeight="600" fill="var(--primary)"
              fontFamily="var(--font-geist-mono,monospace)">REUSING SAVED BRIDGE</text>
          </g>
        )}
      </svg>

      <style>{`
        @keyframes bvPulse { 0%,100%{ transform:scale(.95); opacity:.55 } 50%{ transform:scale(1.1); opacity:.85 } }
        @keyframes bvRing  { 0%{ r:6; opacity:.85 } 100%{ r:48; opacity:0 } }
        @keyframes bvPkt   {
          0%   { offset-distance:0%;   opacity:0 }
          10%  { opacity:1 }
          90%  { opacity:1 }
          100% { offset-distance:100%; opacity:0 }
        }
        @keyframes bvToken {
          0%   { transform:translateX(160px); opacity:0 }
          15%  { opacity:1 }
          85%  { opacity:1 }
          100% { transform:translateX(${W - 160 - 14}px); opacity:0 }
        }
        @keyframes bvSpin  { to { transform:rotate(360deg) } }
        @keyframes bwFadeIn { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:none } }
        @keyframes bwDotPulse { 0%,100%{ opacity:1 } 50%{ opacity:.3 } }
        @keyframes bwSpin { to { transform:rotate(360deg) } }
      `}</style>
    </div>
  );
}

// ── Progress card ─────────────────────────────────────────────────────────────
function BridgeProgress({ stage, source, target, expanded, onToggle, sourceScore, targetScore, step, totalSteps, onCancel, reused, models }: {
  stage: BridgeStage; source: string; target: string;
  expanded: boolean; onToggle: () => void;
  sourceScore: number | null; targetScore: number | null;
  step: number | null; totalSteps: number;
  onCancel: () => void; reused: boolean;
  models: ModelDef[];
}) {
  const SRC = findModel(source, models), TGT = findModel(target, models);
  const stages = reused ? ['adapt'] : ['source', 'target', 'extract', 'adapt'];
  const idx = stages.indexOf(stage);
  const percent = stage === 'done' ? 100 : ((idx + 1) / (stages.length + 1)) * 100;

  const hintMap: Record<string, string> = {
    source:  `Probing how ${SRC.short} interprets your prompt`,
    target:  `Probing how ${TGT.short} prefers to receive prompts`,
    extract: 'Finding the structural and stylistic differences',
    adapt:   `Translating prompt: ${SRC.short} → ${TGT.short}`,
    done:    'Translation complete',
  };
  const topLine = stage === 'done' ? 'Translation complete' : (hintMap[stage] ?? 'Working…');

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
      boxShadow: '0 1px 2px rgba(15,15,30,.04)',
      padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 12,
      animation: 'bwFadeIn .35s ease both',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0,
            animation: 'bwDotPulse 1.2s ease-in-out infinite',
          }} />
          <span style={{ fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-geist-mono, monospace)' }}>
            {reused ? 'Reusing saved bridge' : 'Building a new bridge'}
          </span>
          {reused
            ? <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 20, background: 'var(--success-soft, oklch(95% 0.05 150))', color: 'var(--success)', border: '1px solid transparent' }}>1 credit</span>
            : <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 20, background: 'var(--warning-soft, oklch(95% 0.06 80))', color: 'var(--warning)', border: '1px solid transparent' }}>5 credits · first time</span>
          }
        </div>
        {stage !== 'done' && (
          <button
            onClick={onCancel}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
            }}
          >
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            Cancel
          </button>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-geist-mono, monospace)' }}>
        {topLine}
        {step != null && !reused && stage !== 'done' && (
          <span style={{ marginLeft: 8, color: 'var(--text-subtle)' }}>· step {step}/{totalSteps}</span>
        )}
      </div>

      {/* Progress bar */}
      <div style={{ height: 6, background: 'var(--surface-2, oklch(98% 0.004 80))', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${percent}%`,
          background: 'linear-gradient(90deg, var(--primary), oklch(68% 0.14 215))',
          borderRadius: 999, transition: 'width .6s ease',
        }} />
      </div>

      <button
        onClick={onToggle}
        style={{
          alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 4,
          background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', padding: 0,
        }}
      >
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}>
          <path d="M9 18l6-6-6-6" />
        </svg>
        {expanded ? 'Hide details' : 'Show details'}
      </button>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4, animation: 'bwFadeIn .2s ease both' }}>
          {stages.map((s, i) => {
            const state: 'done' | 'active' | 'pending' =
              i < idx || stage === 'done' ? 'done' : i === idx ? 'active' : 'pending';
            const color = state === 'pending' ? 'var(--text-subtle)' : 'var(--primary)';
            const score = s === 'source' && sourceScore != null ? `${Math.floor(sourceScore * 100)}%`
              : s === 'target' && targetScore != null ? `${Math.floor(targetScore * 100)}%`
              : state === 'done' ? 'done' : state === 'active' ? '…' : '';
            return (
              <div key={s} style={{
                display: 'grid', gridTemplateColumns: '18px 1fr auto', gap: 10, alignItems: 'center',
                fontSize: 12.5, opacity: state === 'pending' ? 0.4 : 1,
              }}>
                <span style={{
                  width: 14, height: 14, borderRadius: '50%',
                  border: `1.5px solid ${color}`,
                  display: 'grid', placeItems: 'center', justifySelf: 'center',
                }}>
                  {state === 'done' && (
                    <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                  )}
                  {state === 'active' && (
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'block' }} />
                  )}
                </span>
                <span style={{ color, fontSize: 12.5, fontFamily: 'var(--font-geist-mono, monospace)' }}>
                  {STAGE_LABELS[s] ?? s}
                </span>
                <span style={{ color: 'var(--text-subtle)', fontSize: 11, fontFamily: 'var(--font-geist-mono, monospace)' }}>
                  {score}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Result card ───────────────────────────────────────────────────────────────
function BridgeResult({ original, adapted, source, target, reused, onTryAnother, models }: {
  original: string; adapted: string; source: string; target: string;
  reused: boolean; onTryAnother: () => void; models: ModelDef[];
}) {
  const SRC = findModel(source, models), TGT = findModel(target, models);
  const [tab, setTab] = useState<'compare' | 'adapted'>('compare');
  const [copied, setCopied] = useState(false);

  function copyAdapted() {
    navigator.clipboard.writeText(adapted).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
      boxShadow: '0 1px 2px rgba(15,15,30,.04)', overflow: 'hidden',
      animation: 'bwFadeIn .35s ease both',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(135deg, var(--primary-soft, oklch(95% 0.05 290)), transparent 70%)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth={2.4} strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
              Translated ·{' '}
              <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', color: 'var(--text-muted)', fontWeight: 500 }}>
                {SRC.short} → {TGT.short}
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              {reused
                ? 'Used your saved bridge for this model pair (1 credit)'
                : 'New bridge created and saved for reuse (5 credits)'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* Tab switcher */}
          <div style={{ display: 'flex', background: 'var(--surface-2, oklch(98% 0.004 80))', borderRadius: 7, padding: 2 }}>
            {([['compare', 'Compare'], ['adapted', 'Adapted only']] as const).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} style={{
                padding: '4px 10px', borderRadius: 5, border: 0,
                background: tab === id ? 'var(--surface)' : 'transparent',
                color: tab === id ? 'var(--text)' : 'var(--text-muted)',
                fontWeight: tab === id ? 500 : 400, fontSize: 12,
                boxShadow: tab === id ? '0 1px 2px rgba(15,15,30,.04)' : 'none',
                cursor: 'pointer',
              }}>{label}</button>
            ))}
          </div>
          <button
            onClick={copyAdapted}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 11px', borderRadius: 6,
              border: `1px solid ${copied ? 'var(--success)' : 'var(--border)'}`,
              background: copied ? 'var(--success-soft, oklch(95% 0.05 150))' : 'var(--surface)',
              color: copied ? 'var(--success)' : 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
              transition: 'all 180ms',
            }}
          >
            {copied
              ? <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
              : <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
            }
            {copied ? 'Copied!' : 'Copy adapted'}
          </button>
          <button
            onClick={onTryAnother}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 11px', borderRadius: 6, border: 'none',
              background: 'var(--primary)', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer',
            }}
          >
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M14 5l7 7-7 7M3 12h18" /></svg>
            Try another
          </button>
        </div>
      </div>

      {/* Body */}
      {tab === 'compare' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', minHeight: 280 }}>
          <div style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>
              <VendorDot hue={SRC.hue} size={8} />
              Original · for {SRC.short}
            </div>
            <pre style={{
              margin: 0, color: 'var(--text-muted)',
              fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12.5, lineHeight: 1.6,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>{original}</pre>
          </div>
          <div style={{ background: 'var(--border)' }} />
          <div style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 11, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>
              <VendorDot hue={TGT.hue} size={8} />
              Adapted · for {TGT.short}
            </div>
            <pre style={{
              margin: 0, color: 'var(--text)',
              fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12.5, lineHeight: 1.6,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>{adapted}</pre>
          </div>
        </div>
      ) : (
        <div style={{ padding: '16px 22px' }}>
          <pre style={{
            margin: 0, color: 'var(--text)',
            fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 13, lineHeight: 1.6,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>{adapted}</pre>
        </div>
      )}
    </div>
  );
}

// ── Tiny markdown renderer (headings, bold, hr, bullets) ─────────────────────
function MiniMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let listItems: string[] = [];

  function flushList() {
    if (listItems.length === 0) return;
    nodes.push(
      <ul key={nodes.length} style={{ margin: '4px 0 8px', paddingLeft: 18 }}>
        {listItems.map((item, i) => (
          <li key={i} style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.65, marginBottom: 2 }}>
            <InlineMarkdown text={item} />
          </li>
        ))}
      </ul>
    );
    listItems = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '' || trimmed === '---') {
      flushList();
      if (trimmed === '---') {
        nodes.push(<hr key={nodes.length} style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '10px 0' }} />);
      } else {
        nodes.push(<div key={nodes.length} style={{ height: 4 }} />);
      }
      continue;
    }

    const h4 = trimmed.match(/^####\s+(.*)/);
    const h3 = trimmed.match(/^###\s+(.*)/);
    const h2 = trimmed.match(/^##\s+(.*)/);
    const h1 = trimmed.match(/^#\s+(.*)/);
    const bullet = trimmed.match(/^[-*]\s+(.*)/);

    if (h1 || h2 || h3 || h4) {
      flushList();
      const match = (h1 ?? h2 ?? h3 ?? h4)!;
      const level = h4 ? 4 : h3 ? 3 : h2 ? 2 : 1;
      const sizes: Record<number, number> = { 1: 15, 2: 13.5, 3: 12.5, 4: 11.5 };
      nodes.push(
        <div key={nodes.length} style={{
          fontSize: sizes[level], fontWeight: 700, color: 'var(--text)',
          marginTop: level <= 2 ? 14 : 8, marginBottom: 4,
          borderBottom: level <= 2 ? '1px solid var(--border)' : 'none',
          paddingBottom: level <= 2 ? 4 : 0,
        }}>
          <InlineMarkdown text={match[1]} />
        </div>
      );
    } else if (bullet) {
      listItems.push(bullet[1]);
    } else {
      flushList();
      nodes.push(
        <p key={nodes.length} style={{ margin: '0 0 4px', fontSize: 12.5, color: 'var(--text)', lineHeight: 1.65 }}>
          <InlineMarkdown text={trimmed} />
        </p>
      );
    }
  }
  flushList();

  return <div style={{ padding: '14px 16px' }}>{nodes}</div>;
}

function InlineMarkdown({ text }: { text: string }) {
  // Render **bold** and `code` inline
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} style={{ fontWeight: 700 }}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={i} style={{
              fontFamily: 'var(--font-geist-mono, monospace)',
              fontSize: '0.9em', padding: '1px 5px', borderRadius: 4,
              background: 'var(--surface-2, oklch(96% 0.004 80))',
              color: 'var(--primary)',
            }}>{part.slice(1, -1)}</code>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// ── Mapping detail drawer ─────────────────────────────────────────────────────
function MappingDetailDrawer({
  mapping,
  onClose,
  onUse,
}: {
  mapping: PromptMappingDetail;
  onClose: () => void;
  onUse: (m: PromptMapping) => void;
}) {
  const [rulesExpanded, setRulesExpanded] = useState(false);

  function shortModel(slug: string) {
    const parts = slug.split('/');
    return parts[parts.length - 1];
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.35)', display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 520, maxWidth: '95vw', height: '100%',
          background: 'var(--surface)', borderLeft: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 22px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                {shortModel(mapping.source_model)}
              </span>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth={2} strokeLinecap="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                {shortModel(mapping.target_model)}
              </span>
            </div>
            <p style={{ margin: '3px 0 0', fontSize: 11.5, color: 'var(--text-subtle)' }}>
              {mapping.pair_count} calibrated pair{mapping.pair_count !== 1 ? 's' : ''} · saved bridge
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 30, height: 30, borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--surface)', color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Stats row */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12,
          }}>
            {[
              { label: 'Pairs', value: String(mapping.pair_count) },
              {
                label: 'Avg lift',
                value: mapping.avg_target_score != null
                  ? `+${(mapping.avg_target_score * 100).toFixed(0)}%`
                  : '—',
              },
              { label: 'Last updated', value: new Date(mapping.updated_at).toLocaleDateString() },
            ].map(({ label, value }) => (
              <div key={label} style={{
                background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '10px 14px',
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-geist-mono, monospace)' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Transfer rules */}
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <button
              onClick={() => setRulesExpanded(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
              }}
            >
              <svg
                width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth={2} strokeLinecap="round"
                style={{ transform: rulesExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 180ms', flexShrink: 0 }}
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text)', letterSpacing: '0.04em' }}>
                Transfer rules
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-subtle)' }}>
                {rulesExpanded ? 'Collapse' : 'Expand to view'}
              </span>
            </button>
            {rulesExpanded && (
              <div style={{ borderTop: '1px solid var(--border)', maxHeight: 360, overflowY: 'auto' }}>
                <MiniMarkdown text={mapping.mapping_text} />
              </div>
            )}
          </div>

          {/* Calibrated pairs */}
          {mapping.pairs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Calibrated pairs
              </div>
              {mapping.pairs.map((pair, i) => (
                <div key={pair.id} style={{
                  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden',
                }}>
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border)',
                  }}>
                    <div style={{ padding: '10px 14px', borderRight: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
                        {shortModel(mapping.source_model)}
                        {pair.source_score != null && (
                          <span style={{ marginLeft: 6, color: 'var(--primary)', fontFamily: 'var(--font-geist-mono, monospace)' }}>
                            {(pair.source_score * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <pre style={{ margin: 0, fontSize: 11.5, color: 'var(--text)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--font-geist-mono, monospace)', maxHeight: 120, overflowY: 'auto' }}>
                        {pair.source_optimal_prompt}
                      </pre>
                    </div>
                    <div style={{ padding: '10px 14px' }}>
                      <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
                        {shortModel(mapping.target_model)}
                        {pair.target_score != null && (
                          <span style={{ marginLeft: 6, color: 'var(--success)', fontFamily: 'var(--font-geist-mono, monospace)' }}>
                            {(pair.target_score * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <pre style={{ margin: 0, fontSize: 11.5, color: 'var(--text)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--font-geist-mono, monospace)', maxHeight: 120, overflowY: 'auto' }}>
                        {pair.target_optimal_prompt}
                      </pre>
                    </div>
                  </div>
                  <div style={{ padding: '6px 14px', fontSize: 10, color: 'var(--text-subtle)' }}>
                    Pair {i + 1} · {new Date(pair.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer action */}
        <div style={{
          padding: '14px 22px', borderTop: '1px solid var(--border)',
          display: 'flex', gap: 10,
        }}>
          <button
            onClick={() => { onClose(); onUse(mapping); }}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 9, border: 'none',
              background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 13.5,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: '0 2px 8px color-mix(in oklab, var(--primary) 35%, transparent)',
            }}
          >
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
            Use this bridge · 1 credit
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '10px 18px', borderRadius: 9, border: '1px solid var(--border)',
              background: 'var(--surface)', color: 'var(--text-muted)', fontWeight: 500, fontSize: 13, cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Saved mappings panel ──────────────────────────────────────────────────────
function MappingsPanel({ mappings, onView, models }: { mappings: PromptMapping[]; onView: (m: PromptMapping) => void; models: ModelDef[] }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
      boxShadow: '0 1px 2px rgba(15,15,30,.04)', overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth={2} strokeLinecap="round">
          <rect x="2" y="3" width="6" height="18" rx="1" />
          <rect x="9" y="3" width="6" height="18" rx="1" />
          <rect x="16" y="3" width="6" height="18" rx="1" />
        </svg>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>Your saved bridges</span>
        <span style={{
          fontSize: 10.5, padding: '1px 7px', borderRadius: 20,
          border: '1px solid var(--border)', background: 'var(--surface-2, oklch(98% 0.004 80))',
          color: 'var(--text-subtle)',
        }}>{mappings.length}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>1 credit on reuse</span>
      </div>

      {mappings.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-subtle)', fontSize: 12 }}>
          No bridges yet. Run your first translation above.
        </div>
      ) : (
        mappings.map((m, i) => {
          const SRC = findModel(m.source_model, models), TGT = findModel(m.target_model, models);
          const gainStr = m.avg_target_score != null ? `+${(m.avg_target_score * 100).toFixed(0)}%` : `${m.pair_count} pair${m.pair_count !== 1 ? 's' : ''}`;
          return (
            <div key={String(m.id)} style={{
              padding: '12px 16px',
              borderBottom: i < mappings.length - 1 ? '1px solid var(--border)' : 'none',
              display: 'grid', gridTemplateColumns: '1fr 80px 90px 110px 32px',
              gap: 12, alignItems: 'center',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <VendorDot hue={SRC.hue} size={9} />
                <span style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', color: 'var(--text)' }}>{SRC.short}</span>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth={2} strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                <VendorDot hue={TGT.hue} size={9} />
                <span style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', color: 'var(--text)' }}>{TGT.short}</span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-geist-mono, monospace)' }}>
                {m.pair_count} pair{m.pair_count !== 1 ? 's' : ''}
              </span>
              <span style={{
                fontSize: 10.5, padding: '2px 8px', borderRadius: 20, display: 'inline-block',
                background: 'var(--success-soft, oklch(95% 0.05 150))', color: 'var(--success)',
              }}>{gainStr}</span>
              <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                {new Date(m.updated_at).toLocaleDateString()}
              </span>
              <button
                onClick={() => onView(m)}
                title="View bridge details"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 28, height: 28, borderRadius: 6,
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  color: 'var(--text-muted)', cursor: 'pointer',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2, oklch(98% 0.004 80))'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; }}
              >
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Main workspace ────────────────────────────────────────────────────────────
export function BridgeWorkspace() {
  const { data: models = FALLBACK_MODELS } = useModelCatalog();
  const [source, setSource] = useState('openai/gpt-4o-mini');
  const [target, setTarget] = useState('anthropic/claude-3.5-haiku');
  const [prompt, setPrompt] = useState('');
  const [savedMappings, setSavedMappings] = useState<PromptMapping[]>([]);

  // Job state
  const [stage, setStage] = useState<BridgeStage>('idle');
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [sourceScore, setSourceScore] = useState<number | null>(null);
  const [targetScore, setTargetScore] = useState<number | null>(null);
  const [step, setStep] = useState<number | null>(null);
  const totalSteps = 5;
  const [reused, setReused] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);  // redis job_id
  const [activeDbJobId, setActiveDbJobId] = useState<string | null>(null); // db UUID

  // Result state (from completed job)
  const [resultJob, setResultJob] = useState<TransferJobSummary | null>(null);
  const [failedError, setFailedError] = useState<string | null>(null);

  // Modal / drawer
  const [showNewModal, setShowNewModal] = useState(false);
  const [modalPrefill, setModalPrefill] = useState<{ sourceModel: string; targetModel: string } | null>(null);
  const [selectedJob, setSelectedJob] = useState<TransferJobSummary | null>(null);
  const [selectedMapping, setSelectedMapping] = useState<PromptMappingDetail | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  // Templates for "Use example" picker
  const { data: templatesData } = useQuery<TemplateListResponse>({
    queryKey: ['templates'],
    queryFn: async () => {
      const res = await api.get<{ data: TemplateListResponse }>('/api/v1/templates');
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const isSameModel = source === target;
  const existingMapping = useMemo(
    () => savedMappings.find(m => m.source_model === source && m.target_model === target),
    [savedMappings, source, target],
  );
  const cost = existingMapping ? 1 : 5;

  // Load saved mappings on mount
  useEffect(() => {
    api.get<{ data: MappingListResponse }>('/api/v1/prompt-bridge/mappings')
      .then(r => setSavedMappings(r.data.data.mappings))
      .catch(() => undefined);
  }, []);

  // Poll active job
  useEffect(() => {
    if (!activeJobId) return;
    pollingRef.current = setInterval(async () => {
      try {
        const res = await api.get<{ data: TransferJobPollResponse }>(`/api/v1/prompt-bridge/jobs/${activeJobId}`);
        const poll = res.data.data;
        const liveStage = typeof poll.progress?.stage === 'string' ? poll.progress.stage : null;
        // Map backend stage → visual stage
        const stageMap: Record<string, BridgeStage> = {
          queued: 'idle', calibrating: 'source', calibrating_source: 'source',
          calibrating_target: 'target', extracting_mapping: 'extract', adapting: 'adapt',
        };
        const vis = stageMap[liveStage ?? poll.status] ?? 'idle';
        if (vis !== 'idle') setStage(vis);

        // Simulate scores climbing
        if (vis === 'source' || vis === 'target') {
          const s = typeof poll.progress?.step === 'number' ? poll.progress.step as number : null;
          const t = typeof poll.progress?.total === 'number' ? poll.progress.total as number : null;
          if (s != null) setStep(s);
          if (vis === 'source') setSourceScore(0.42 + (s ?? 1) / (t ?? 5) * 0.45);
          if (vis === 'target') setTargetScore(0.45 + (s ?? 1) / (t ?? 5) * 0.42);
        }

        // Show retrying state when backend re-queued after a 429
        if (poll.status === 'queued' && poll.progress?.retrying) {
          const retryIn = typeof poll.progress.retry_in === 'number' ? poll.progress.retry_in as number : null;
          const attempt = typeof poll.progress.attempt === 'number' ? poll.progress.attempt as number : null;
          setStage('source');
          setFailedError(
            `Rate limited by model provider — retrying automatically${retryIn ? ` in ${retryIn}s` : ''}${attempt ? ` (attempt ${attempt}/${3})` : ''}.`
          );
        }

        if (poll.status === 'completed' || poll.status === 'failed' || poll.status === 'cancelled') {
          clearInterval(pollingRef.current!);
          setActiveJobId(null);

          if (poll.status === 'completed') {
            setStage('done');
            setRunning(false);
            // Fetch the full job record + mapping for result display
            const jobsRes = await api.get<{ data: TransferJobListResponse }>('/api/v1/prompt-bridge/jobs');
            const jobs = jobsRes.data.data.jobs;
            const doneJob = jobs.find(j => j.redis_job_id === activeJobId) ?? jobs[0];
            if (doneJob) setResultJob(doneJob);
            // Refresh mappings
            const mappingsRes = await api.get<{ data: MappingListResponse }>('/api/v1/prompt-bridge/mappings');
            const newMappings = mappingsRes.data.data.mappings;
            setSavedMappings(newMappings);
            // (mapping detail loaded on demand if drawer opened)
          } else if (poll.status === 'failed') {
            setStage('failed');
            setRunning(false);
            setFailedError(poll.error ?? 'Transfer failed. Please try again.');
          } else {
            setStage('idle');
            setRunning(false);
          }
        }
      } catch { /* keep polling */ }
    }, 2500);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [activeJobId]);

  const swap = () => {
    if (running) return;
    setSource(target);
    setTarget(source);
    setResultJob(null);
  };

  const reset = useCallback(() => {
    setStage('idle');
    setRunning(false);
    setSourceScore(null);
    setTargetScore(null);
    setStep(null);
    setReused(false);
    setResultJob(null);
    setActiveJobId(null);
    setActiveDbJobId(null);
    setFailedError(null);
  }, []);

  const handleCancel = useCallback(async () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (activeDbJobId) {
      try {
        await api.post(`/api/v1/prompt-bridge/jobs/${activeDbJobId}/cancel-by-id`);
      } catch { /* ignore */ }
    }
    reset();
  }, [activeDbJobId, reset]);

  const handleRun = useCallback(async () => {
    if (running || isSameModel || !prompt.trim()) return;
    setRunning(true);
    setResultJob(null);
    setSourceScore(null);
    setTargetScore(null);
    setStep(null);
    setStage('source');
    setReused(!!existingMapping);

    try {
      const res = await api.post<{ data: { job_id: string; reused_mapping: boolean; credits_charged: number; message: string } }>(
        '/api/v1/prompt-bridge/transfer',
        { source_prompt: prompt.trim(), source_model: source, target_model: target },
      );
      const { job_id } = res.data.data;
      setActiveJobId(job_id);
      // Fetch db job id for cancel
      const jobsRes = await api.get<{ data: TransferJobListResponse }>('/api/v1/prompt-bridge/jobs');
      const match = jobsRes.data.data.jobs.find(j => j.redis_job_id === job_id);
      if (match) setActiveDbJobId(String(match.id));
    } catch {
      reset();
    }
  }, [running, isSameModel, prompt, source, target, existingMapping, reset]);

  const [viewedMapping, setViewedMapping] = useState<PromptMappingDetail | null>(null);

  const handleViewMapping = useCallback(async (m: PromptMapping) => {
    try {
      const res = await api.get<{ data: PromptMappingDetail }>(`/api/v1/prompt-bridge/mappings/${m.id}`);
      setViewedMapping(res.data.data);
    } catch {
      // fall back to the list-level data without pairs
      setViewedMapping({ ...m, pairs: [] });
    }
  }, []);

  const handlePickMapping = (m: PromptMapping) => {
    setSource(m.source_model);
    setTarget(m.target_model);
    setResultJob(null);
    setModalPrefill({ sourceModel: m.source_model, targetModel: m.target_model });
    setShowNewModal(true);
  };

  return (
    <div style={{
      padding: '24px 28px 32px',
      display: 'flex', flexDirection: 'column', gap: 16,
      fontFamily: 'var(--font-geist, ui-sans-serif)',
      minHeight: '100%', boxSizing: 'border-box',
    }}>
      {/* ── Page header ── */}
      <div ref={topRef} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>
            Bridge
          </h1>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 11.5, fontWeight: 500, padding: '3px 10px', borderRadius: 20,
            border: '1px solid oklch(78% 0.12 200 / 0.5)',
            background: 'oklch(94% 0.06 200 / 0.5)',
            color: 'oklch(42% 0.13 200)',
          }}>
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M8 3L4 7l4 4M16 21l4-4-4-4M4 7h16M20 17H4" />
            </svg>
            Cross-model
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-subtle)' }}>
          Take a prompt tuned for one model and translate it for another — without redoing the work.
        </p>
      </div>

      {/* ── Composer section (flat, not a lifted card) ── */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
        padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 20,
      }}>
        {/* Model pair row */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ModelPicker value={source} side="source" onChange={v => { setSource(v); setResultJob(null); }} excludeId={target} models={models} />
          </div>
          <button
            onClick={swap}
            disabled={running}
            title="Swap models"
            style={{
              width: 40, alignSelf: 'center', flexShrink: 0, padding: 0, height: 40, borderRadius: '50%',
              background: 'var(--surface)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: running ? 'not-allowed' : 'pointer', opacity: running ? 0.5 : 1,
              transition: 'opacity 150ms, background 150ms',
            }}
            onMouseEnter={e => { if (!running) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2, oklch(98% 0.004 80))'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)'; }}
          >
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth={2} strokeLinecap="round">
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M8 8H3v5M21 16h-5v5" />
            </svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ModelPicker value={target} side="target" onChange={v => { setTarget(v); setResultJob(null); }} excludeId={source} models={models} />
          </div>
        </div>

        {/* Bridge visual */}
        <BridgeVisual
          source={source} target={target} stage={stage}
          sourceScore={sourceScore} targetScore={targetScore}
          reused={reused && running} models={models}
        />

        {/* Status / cost banner */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderRadius: 10, fontSize: 12.5,
          background: existingMapping
            ? 'color-mix(in oklab, var(--success) 10%, transparent)'
            : 'color-mix(in oklab, var(--primary) 8%, transparent)',
          border: `1px solid ${existingMapping ? 'color-mix(in oklab, var(--success) 25%, transparent)' : 'color-mix(in oklab, var(--primary) 20%, transparent)'}`,
          color: existingMapping ? 'var(--success)' : 'var(--primary)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            {existingMapping ? (
              <span>You have a saved bridge for this pair — reuse for <strong style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}>1 credit</strong></span>
            ) : (
              <span>No saved bridge yet — first translation calibrates both models · <strong style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}>5 credits</strong></span>
            )}
          </div>
          {existingMapping && (
            <span style={{ fontSize: 11, opacity: .8, fontFamily: 'var(--font-geist-mono, monospace)' }}>
              {existingMapping.pair_count} calibrated pairs · {existingMapping.avg_target_score != null ? `+${(existingMapping.avg_target_score * 100).toFixed(0)}% avg lift` : '—'}
            </span>
          )}
        </div>

        {/* Prompt input */}
        <div style={{
          border: '1px solid var(--border)', borderRadius: 12,
          background: 'var(--surface-2, oklch(98% 0.004 80))',
          padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10.5, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>
              Prompt to translate
            </span>
            <span style={{
              fontSize: 10.5, display: 'flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 20, border: '1px solid var(--border)',
              background: 'var(--surface)', color: 'var(--text-subtle)',
            }}>
              <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
              Currently working on <strong style={{ fontWeight: 600, marginLeft: 3 }}>{findModel(source, models).short}</strong>
            </span>
            <span style={{ flex: 1 }} />
            <button
              onClick={() => setPrompt('')}
              disabled={running || !prompt}
              style={{
                fontSize: 11.5, padding: '3px 9px', borderRadius: 6,
                border: '1px solid var(--border)', background: 'none',
                color: 'var(--text-muted)', cursor: running || !prompt ? 'not-allowed' : 'pointer',
                opacity: running || !prompt ? 0.4 : 1,
              }}
            >Clear</button>
            <button
              onClick={() => { if (!running) setShowTemplates(true); }}
              disabled={running}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 11.5, padding: '3px 9px', borderRadius: 6,
                border: '1px solid var(--border)', background: 'none',
                color: 'var(--text-muted)', cursor: running ? 'not-allowed' : 'pointer',
                opacity: running ? 0.4 : 1,
              }}
            >
              <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <rect x="3" y="3" width="7" height="8" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/>
                <rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="15" width="7" height="6" rx="1"/>
              </svg>
              Use example
            </button>
          </div>

          {/* Textarea */}
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Paste a prompt you've already optimized for the source model…"
            disabled={running}
            rows={6}
            style={{
              width: '100%', resize: 'vertical', minHeight: 120, maxHeight: 360,
              border: 0, outline: 'none', background: 'transparent',
              color: 'var(--text)', fontSize: 13.5, lineHeight: 1.6,
              fontFamily: 'var(--font-geist-mono, monospace)',
              boxSizing: 'border-box',
            }}
          />

          {/* Footer: char count + run button */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', fontFamily: 'var(--font-geist-mono, monospace)' }}>
              {prompt.length.toLocaleString()} chars · ≈ {Math.ceil(prompt.length / 4)} tokens
            </div>
            <button
              onClick={handleRun}
              disabled={running || isSameModel || !prompt.trim()}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 20px', borderRadius: 9, border: 'none',
                background: running || isSameModel || !prompt.trim()
                  ? 'var(--surface-2, oklch(98% 0.004 80))'
                  : 'var(--primary)',
                color: running || isSameModel || !prompt.trim() ? 'var(--text-subtle)' : '#fff',
                fontWeight: 600, fontSize: 13.5,
                cursor: running || isSameModel || !prompt.trim() ? 'not-allowed' : 'pointer',
                boxShadow: running || isSameModel || !prompt.trim() ? 'none' : '0 2px 8px color-mix(in oklab, var(--primary) 35%, transparent)',
                transition: 'all 200ms',
              }}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              {running
                ? (reused ? 'Translating…' : 'Building bridge…')
                : (existingMapping ? 'Translate with saved bridge' : 'Build & translate')}
              <span style={{
                marginLeft: 2, fontSize: 11.5, opacity: .75,
                paddingLeft: 10, borderLeft: '1px solid rgba(255,255,255,.3)',
                fontFamily: 'var(--font-geist-mono, monospace)',
              }}>−{cost}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Progress card ── */}
      {running && (
        <BridgeProgress
          stage={stage} source={source} target={target}
          expanded={expanded} onToggle={() => setExpanded(e => !e)}
          sourceScore={sourceScore} targetScore={targetScore}
          step={step} totalSteps={totalSteps}
          onCancel={handleCancel}
          reused={reused} models={models}
        />
      )}

      {/* ── Error card ── */}
      {stage === 'failed' && failedError && (
        <div style={{
          background: 'var(--surface)', border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)',
          borderRadius: 14, padding: '20px 24px', display: 'flex', gap: 16, alignItems: 'flex-start',
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
            background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth={2} strokeLinecap="round">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
              Transfer failed
            </div>
            {/* Parse out the human-readable reason from the error string */}
            {(() => {
              const is429 = failedError.includes('429') || failedError.includes('rate') || failedError.toLowerCase().includes('temporarily');
              const isRateLimit = is429 || failedError.includes('retry_after');
              if (isRateLimit) {
                const retryMatch = failedError.match(/retry_after_seconds['":\s]+(\d+)/);
                const seconds = retryMatch ? parseInt(retryMatch[1]) : null;
                return (
                  <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', lineHeight: 1.6 }}>
                    <strong style={{ color: 'var(--warning)' }}>Rate limit hit</strong> — the free model you selected has a usage cap.
                    {seconds && <span> OpenRouter suggests waiting <strong>{seconds}s</strong> before retrying.</span>}
                    <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--text-subtle)' }}>
                      Tip: switch to a paid model or wait a minute and try again.
                    </div>
                  </div>
                );
              }
              return (
                <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', lineHeight: 1.6 }}>
                  {failedError.length > 200 ? failedError.slice(0, 200) + '…' : failedError}
                </div>
              );
            })()}
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button
                onClick={() => { reset(); }}
                style={{
                  padding: '7px 16px', borderRadius: 8, border: 'none',
                  background: 'var(--primary)', color: '#fff',
                  fontWeight: 600, fontSize: 12.5, cursor: 'pointer',
                }}
              >
                Try again
              </button>
              <button
                onClick={() => { reset(); setModalPrefill({ sourceModel: source, targetModel: target }); setShowNewModal(true); }}
                style={{
                  padding: '7px 16px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  color: 'var(--text-muted)', fontWeight: 500, fontSize: 12.5, cursor: 'pointer',
                }}
              >
                Change models
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Result card ── */}
      {resultJob?.adapted_prompt && (
        <BridgeResult
          original={resultJob.source_prompt}
          adapted={resultJob.adapted_prompt}
          source={source} target={target}
          reused={resultJob.reused_mapping}
          onTryAnother={() => {
            setModalPrefill({ sourceModel: source, targetModel: target });
            setShowNewModal(true);
          }}
          models={models}
        />
      )}

      {/* ── Saved bridges panel ── */}
      <MappingsPanel mappings={savedMappings} onView={handleViewMapping} models={models} />

      {/* ── Modals / drawers ── */}
      {showNewModal && (
        <NewTransferModal
          onClose={() => { setShowNewModal(false); setModalPrefill(null); }}
          onJobStarted={async (jobId) => {
            setShowNewModal(false);
            setModalPrefill(null);
            setActiveJobId(jobId);
            setRunning(true);
            setStage('source');
            try {
              const jobsRes = await api.get<{ data: TransferJobListResponse }>('/api/v1/prompt-bridge/jobs');
              const match = jobsRes.data.data.jobs.find(j => j.redis_job_id === jobId);
              if (match) setActiveDbJobId(String(match.id));
            } catch { /* cancel will still work via Redis-based endpoint */ }
          }}
          defaultSourceModel={modalPrefill?.sourceModel}
          defaultTargetModel={modalPrefill?.targetModel}
        />
      )}

      {selectedJob && (
        <TransferDetail
          job={selectedJob}
          mapping={selectedMapping}
          onClose={() => { setSelectedJob(null); setSelectedMapping(null); }}
          onRerun={() => { setSelectedJob(null); setSelectedMapping(null); setShowNewModal(true); }}
          onTryAnotherPrompt={(sm, tm) => {
            setSelectedJob(null);
            setSelectedMapping(null);
            setModalPrefill({ sourceModel: sm, targetModel: tm });
            setShowNewModal(true);
          }}
          onCancelled={() => { setSelectedJob(null); setSelectedMapping(null); reset(); }}
          onDeleted={() => { setSelectedJob(null); setSelectedMapping(null); }}
        />
      )}

      {viewedMapping && (
        <MappingDetailDrawer
          mapping={viewedMapping}
          onClose={() => setViewedMapping(null)}
          onUse={handlePickMapping}
        />
      )}

      {showTemplates && templatesData && (
        <TemplatePicker
          data={templatesData}
          onSelect={content => { setPrompt(content); setShowTemplates(false); }}
          onClose={() => setShowTemplates(false)}
        />
      )}
    </div>
  );
}

// ── Template picker modal (same as optimize section) ──────────────────────────
function TemplatePicker({
  data,
  onSelect,
  onClose,
}: {
  data: TemplateListResponse;
  onSelect: (content: string) => void;
  onClose: () => void;
}) {
  const [activeCategory, setActiveCategory] = useState(data.categories[0]?.category ?? '');

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 640, maxHeight: '78vh', borderRadius: 14,
          background: 'var(--bg)', border: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth={1.6}>
              <rect x="3" y="3" width="7" height="8" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/>
              <rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="15" width="7" height="6" rx="1"/>
            </svg>
            <span style={{
              fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
              textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--primary)',
            }}>Prompt Templates</span>
            <span style={{
              fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
              padding: '1px 6px', borderRadius: 4,
              background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-subtle)',
            }}>{data.total}</span>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-subtle)', width: 24, height: 24,
            display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4,
          }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Category tabs */}
        <div style={{
          display: 'flex', gap: 4, padding: '10px 16px',
          borderBottom: '1px solid var(--border)', overflowX: 'auto',
        }}>
          {data.categories.map(g => (
            <button key={g.category} onClick={() => setActiveCategory(g.category)} style={{
              padding: '4px 12px', borderRadius: 6, fontSize: 12,
              border: '1px solid transparent', cursor: 'pointer', whiteSpace: 'nowrap',
              background: activeCategory === g.category ? 'color-mix(in oklab, var(--primary) 15%, transparent)' : 'transparent',
              color: activeCategory === g.category ? 'var(--primary)' : 'var(--text-muted)',
              borderColor: activeCategory === g.category ? 'color-mix(in oklab, var(--primary) 30%, transparent)' : 'transparent',
              fontFamily: 'var(--font-geist-mono, monospace)', textTransform: 'capitalize',
            }}>
              {g.category.replace(/-/g, ' ')}
            </button>
          ))}
        </div>

        {/* Template list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(data.categories.find(g => g.category === activeCategory)?.templates ?? []).map(t => (
            <button key={t.id} onClick={() => onSelect(t.content)} style={{
              textAlign: 'left', padding: '12px 14px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'transparent',
              cursor: 'pointer', transition: 'background 120ms, border-color 120ms',
              fontFamily: 'var(--font-geist, ui-sans-serif)',
            }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'color-mix(in oklab, var(--primary) 6%, transparent)';
                e.currentTarget.style.borderColor = 'color-mix(in oklab, var(--primary) 25%, transparent)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'var(--border)';
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 3 }}>{t.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t.description}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
