'use client';

import { useState, useMemo, useEffect, type ReactNode, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { SessionsGrouped, TransferJobListResponse } from '@/types/api';
import type { RunListResponse } from '@/types/domain-prompts';
import { isToday, isAfter, subDays, format } from 'date-fns';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';

/* ── SVG icon helper ─────────────────────────────────────────────── */
const ICON_PATHS: Record<string, ReactNode> = {
  swords:      <><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" y1="14" x2="8.5" y2="17.5"/><line x1="4" y1="20" x2="6" y2="22"/><line x1="6" y1="20" x2="4" y2="22"/></>,
  sparkles:    <path d="m12 3-1.912 5.813a2 2 0 01-1.275 1.275L3 12l5.813 1.912a2 2 0 011.275 1.275L12 21l1.912-5.813a2 2 0 011.275-1.275L21 12l-5.813-1.912a2 2 0 01-1.275-1.275L12 3z"/>,
  grid:        <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  gitBranch:   <><path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 01-9 9"/></>,
  bolt:        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>,
  trophy:      <><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v6a5 5 0 01-10 0z"/><path d="M7 6H4a2 2 0 000 4h3"/><path d="M17 6h3a2 2 0 010 4h-3"/></>,
  arrowRight:  <><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></>,
  file:        <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
  search:      <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
  x:           <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
  chevronDown: <polyline points="6 9 12 15 18 9"/>,
  chevronRight:<polyline points="9 18 15 12 9 6"/>,
  chevronLeft: <polyline points="15 18 9 12 15 6"/>,
  fileText:    <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></>,
  refresh:     <><path d="M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 01-9 9 9.75 9.75 0 01-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></>,
  check:       <polyline points="20 6 9 17 4 12"/>,
  info:        <><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></>,
};

function HIcon({ name, size = 14, color, style }: { name: string; size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color || 'currentColor'} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}>
      {ICON_PATHS[name] ?? null}
    </svg>
  );
}

/* ── Types ───────────────────────────────────────────────────────── */
type MethodId = 'pdo' | 'gepa' | 'council' | 'bridge' | 'skill';
type Bucket = 'Today' | 'Last 7 days' | 'Last 30 days' | 'Older';

const METHOD_META: Record<MethodId, { label: string; short: string; icon: string; tag: string }> = {
  pdo:     { label: 'Prompt Duel Optimizer', short: 'PDO',     icon: 'swords',    tag: 'D-TS tournament'       },
  gepa:    { label: 'GEPA',                  short: 'GEPA',    icon: 'sparkles',  tag: 'Reflective evolution'  },
  council: { label: 'Council Optimizer',     short: 'Council', icon: 'grid',      tag: '4-perspective fusion'  },
  bridge:  { label: 'Bridge',                short: 'Bridge',  icon: 'gitBranch', tag: 'Cross-model translate' },
  skill:   { label: 'SkillOpt',              short: 'Skill',   icon: 'bolt',      tag: 'Skill document'        },
};

const STATUS_NORM: Record<string, 'completed' | 'running' | 'failed'> = {
  completed:          'completed',
  failed:             'failed',
  cancelled:          'failed',
  running:            'running',
  pending:            'running',
  optimizing:         'running',
  preparing_dataset:  'running',
  queued:             'running',
  calibrating:        'running',
  extracting_mapping: 'running',
  adapting:           'running',
};

const STATUS_META: Record<'completed' | 'running' | 'failed', { cls: string; label: string; pulse: boolean; danger: boolean }> = {
  completed: { cls: 'ply-pill-success', label: 'Completed', pulse: false, danger: false },
  running:   { cls: 'ply-pill-primary', label: 'Running',   pulse: true,  danger: false },
  failed:    { cls: '',                  label: 'Failed',    pulse: false, danger: true  },
};

interface ReasoningBlock {
  summary: string;
  changes: { kind: string; title: string; detail: string }[];
  kept: string[];
}

interface HistoryItem {
  id: string;
  type: MethodId;
  title: string;
  context: string | null;
  source: string | null;
  status: 'completed' | 'running' | 'failed';
  when: string;
  credits: number;
  scoreBefore:   number | null;
  scoreAfter:    number | null;
  winRate:       number | null;
  winner:        string | null;
  metrics:       { k: string; v: string }[];
  promptInput:   string | null;
  optimizedPrompt: string | null;
  errorMessage:  string | null;
  tokenCount:    number | null;
  feedbackCount: number | null;
  reasoning:     ReasoningBlock | null;
  mappingText:   string | null;
  bucket: Bucket;
  created_at: string;
}

/* ── Date helpers ────────────────────────────────────────────────── */
function getBucket(dateStr: string): Bucket {
  const d   = new Date(dateStr);
  const now = new Date();
  if (isToday(d))                       return 'Today';
  if (isAfter(d, subDays(now, 7)))  return 'Last 7 days';
  if (isAfter(d, subDays(now, 30))) return 'Last 30 days';
  return 'Older';
}

function formatWhen(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d))                             return `Today, ${format(d, 'HH:mm')}`;
  if (isAfter(d, subDays(new Date(), 7))) return format(d, 'EEE MMM d');
  return format(d, 'MMM d, yyyy');
}

/* ── MetricCell ──────────────────────────────────────────────────── */
function MetricCell({ k, v, primary }: { k: string; v: ReactNode; primary?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, whiteSpace: 'nowrap' }}>{k}</span>
      <span className={primary ? '' : 'mono'} style={{ fontSize: primary ? 13.5 : 14, fontWeight: primary ? 500 : 600, whiteSpace: 'nowrap' }}>{v}</span>
    </div>
  );
}

/* ── Session detail panels ───────────────────────────────────────── */
function SessionDetail({ item }: { item: HistoryItem }) {
  const Title = ({ children }: { children: ReactNode }) => (
    <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600, marginBottom: 8 }}>{children}</div>
  );

  if (item.status === 'failed') {
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', background: 'var(--danger-soft)', borderRadius: 8 }}>
        <HIcon name="info" size={14} color="var(--danger)" style={{ marginTop: 1, flexShrink: 0 }} />
        <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.55 }}>
          <span style={{ fontWeight: 600, color: 'var(--danger)' }}>Run failed. </span>
          {item.errorMessage ?? 'An unknown error occurred.'}
        </div>
      </div>
    );
  }

  if (item.type === 'pdo') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20 }}>
        <div>
          <Title>Final standings</Title>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {item.scoreBefore != null && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, marginBottom: 4 }}>Score before</div>
                <span className="mono" style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-muted)' }}>{Math.round(item.scoreBefore * 100)}%</span>
              </div>
            )}
            {item.scoreAfter != null && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, marginBottom: 4 }}>Score after</div>
                <span className="mono" style={{ fontSize: 20, fontWeight: 600, color: 'var(--success)' }}>{Math.round(item.scoreAfter * 100)}%</span>
              </div>
            )}
            {item.winRate != null && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, marginBottom: 4 }}>Win rate</div>
                <span className="mono" style={{ fontSize: 20, fontWeight: 600, color: 'var(--primary)' }}>{Math.round(item.winRate * 100)}%</span>
              </div>
            )}
          </div>
        </div>
        <div>
          <Title>Ranker consensus</Title>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'var(--primary-soft)', color: 'var(--primary)', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
            <HIcon name="trophy" size={13} />
            Best prompt by D-TS tournament
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {['Copeland', 'Borda', 'Win Rate', 'Elo', 'TrueSkill'].map(r => (
              <span key={r} className="ply-pill" style={{ fontSize: 10 }}>{r}</span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (item.type === 'gepa') {
    const iterMetric = item.metrics.find(m => m.k === 'Iterations');
    return (
      <div>
        <Title>Reflective evolution results</Title>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {item.scoreBefore != null && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, marginBottom: 4 }}>Score before</div>
              <span className="mono" style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-muted)' }}>{Math.round(item.scoreBefore * 100)}%</span>
            </div>
          )}
          {item.scoreAfter != null && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, marginBottom: 4 }}>Score after</div>
              <span className="mono" style={{ fontSize: 20, fontWeight: 600, color: 'var(--success)' }}>{Math.round(item.scoreAfter * 100)}%</span>
            </div>
          )}
          {iterMetric && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, marginBottom: 4 }}>Iterations</div>
              <span className="mono" style={{ fontSize: 20, fontWeight: 600 }}>{iterMetric.v}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (item.type === 'council') {
    const r = item.reasoning;
    const CHANGE_COLORS: Record<string, string> = {
      added:    'var(--success)',
      removed:  'var(--danger)',
      modified: 'var(--primary)',
      kept:     'var(--text-subtle)',
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {r ? (
          <>
            {/* Summary */}
            <div>
              <Title>What changed</Title>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>{r.summary}</p>
            </div>
            {/* Changes list */}
            {r.changes.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {r.changes.map((c, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{
                      fontSize: 9.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
                      color: CHANGE_COLORS[c.kind] ?? 'var(--text-subtle)',
                      paddingTop: 2, minWidth: 52, flexShrink: 0,
                    }}>{c.kind}</span>
                    <div>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{c.title}</span>
                      {c.detail && <span style={{ fontSize: 11.5, color: 'var(--text-muted)', marginLeft: 6 }}>{c.detail}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* Preserved */}
            {r.kept.length > 0 && (
              <div>
                <Title>Preserved</Title>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {r.kept.map((k, i) => (
                    <span key={i} className="ply-pill" style={{ fontSize: 10.5 }}>{k}</span>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', margin: 0 }}>
            No reasoning data for this session.
          </p>
        )}
        <div>
          <Link href={`/optimize?session=${item.id}`} style={{ fontSize: 12, color: 'var(--primary)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Open in optimizer <HIcon name="arrowRight" size={11} color="var(--primary)" />
          </Link>
        </div>
      </div>
    );
  }

  if (item.type === 'bridge') {
    const [src, tgt] = (item.context ?? '').split(' → ');
    const shortName = (s: string) => s?.includes('/') ? s.split('/').pop()! : s;
    const isReused = item.metrics.find(m => m.k === 'Mapping')?.v === 'Reused';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <Title>Translation path</Title>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 10 }}>
            <span className="ply-pill" style={{ fontSize: 11.5, fontWeight: 600 }}>{shortName(src)}</span>
            <HIcon name="arrowRight" size={14} color="var(--primary)" />
            <span className="ply-pill ply-pill-primary" style={{ fontSize: 11.5, fontWeight: 600 }}>{shortName(tgt)}</span>
          </div>
        </div>
        <div>
          <Title>Calibration type</Title>
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            {isReused
              ? 'Reused existing mapping — adapter-only run (1 credit)'
              : 'Full MAP-RPE calibration — built a new reusable mapping (5 credits)'}
          </span>
        </div>
        {item.mappingText && (
          <div>
            <Title>Transfer rules</Title>
            <div style={{
              fontSize: 11.5, color: 'var(--text-muted)', background: 'var(--surface-2)',
              border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px',
              fontFamily: 'var(--mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              maxHeight: 200, overflowY: 'auto', lineHeight: 1.6,
            }}>
              {item.mappingText}
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}

/* ── Session card ────────────────────────────────────────────────── */
function SessionCard({ item }: { item: HistoryItem }) {
  const [open,       setOpen]       = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const m  = METHOD_META[item.type];
  const st = STATUS_META[item.status];
  const failed  = item.status === 'failed';
  const running = item.status === 'running';

  return (
    <div className="ply-card" style={{ padding: 0, overflow: 'hidden', opacity: failed ? 0.92 : 1 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10, flexShrink: 0,
          display: 'grid', placeItems: 'center',
          background: failed ? 'var(--surface-2)' : 'linear-gradient(135deg, var(--primary), var(--accent))',
          color: failed ? 'var(--text-subtle)' : 'white',
        }}>
          <HIcon name={m.icon} size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', rowGap: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{item.title}</span>
            <span className="ply-pill ply-pill-primary" style={{ fontSize: 10, padding: '1px 7px' }}>{m.short}</span>
            <span className="ply-pill" style={{ fontSize: 9.5, padding: '1px 6px' }}>{m.tag}</span>
          </div>
          {item.context && (
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <HIcon name={item.source ? 'file' : 'sparkles'} size={11} />
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 340 }}>{item.context}</span>
              {item.source && <><span>·</span><span className="mono" style={{ fontSize: 11 }}>{item.source}</span></>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          <span className={`ply-pill ${st.cls}`} style={{ fontSize: 10.5, display: 'inline-flex', alignItems: 'center', gap: 5, ...(st.danger ? { color: 'var(--danger)' } : {}) }}>
            <span className={`ply-dot${st.pulse ? ' ply-dot-pulse' : ''}`} style={{ background: 'currentColor' }} />
            {st.label}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{item.when}</span>
        </div>
      </div>

      {/* Metrics strip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)',
        flexWrap: 'wrap', rowGap: 12,
      }}>
        {item.winRate != null && (
          <div style={{ paddingRight: 18, marginRight: 18, borderRight: '1px solid var(--border)' }}>
            <MetricCell k="Win rate" v={<span style={{ color: 'var(--success)' }}>{Math.round(item.winRate * 100)}%</span>} />
          </div>
        )}
        {item.metrics.map(mt => (
          <div key={mt.k} style={{ paddingRight: 18, marginRight: 18, borderRight: '1px solid var(--border)' }}>
            <MetricCell k={mt.k} v={mt.v} />
          </div>
        ))}
        <div style={{ paddingRight: 18, marginRight: 18, borderRight: '1px solid var(--border)' }}>
          <MetricCell k="Tokens" v={
            item.tokenCount != null
              ? item.tokenCount.toLocaleString()
              : running
                ? <span style={{ color: 'var(--primary)' }}>live</span>
                : '—'
          } />
        </div>
        {item.type === 'council' && (
          <div style={{ paddingRight: 18, marginRight: 18, borderRight: '1px solid var(--border)' }}>
            <MetricCell k="Feedback" v={item.feedbackCount != null ? String(item.feedbackCount) : '—'} />
          </div>
        )}
        <MetricCell k="Credits" v={`−${item.credits}`} />
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {item.winner ? (
          item.type === 'council' ? (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 560, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <HIcon name="sparkles" size={12} color="var(--primary)" style={{ marginRight: 6, verticalAlign: 'middle' }} />
              {item.winner.length > 100 ? item.winner.slice(0, 100) + '…' : item.winner}
            </span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--text-muted)' }}>
              <HIcon name="trophy" size={12} color="var(--primary)" />
              Winner: <span style={{ fontWeight: 600, color: 'var(--text)' }}>{item.winner}</span>
            </span>
          )
        ) : (
          <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
            {running ? 'Optimization in progress…' : (failed ? 'Run failed' : 'Prompt optimized')}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button className="ply-btn ply-btn-ghost ply-btn-sm" onClick={() => setOpen(o => !o)}>
          <HIcon name={open ? 'chevronDown' : 'chevronRight'} size={11} />
          {open ? 'Hide details' : 'Details'}
        </button>
        <button
          className="ply-btn ply-btn-sm"
          disabled={running}
          onClick={() => { setShowPrompt(s => !s); if (open) setOpen(false); }}
        >
          <HIcon name="fileText" size={12} /> {showPrompt ? 'Hide prompt' : 'View prompt'}
        </button>
        <button className="ply-btn ply-btn-sm" disabled title="Re-run not yet implemented">
          <HIcon name="refresh" size={11} /> Re-run
        </button>
      </div>

      {/* Expanded detail */}
      {open && (
        <div className="anim-fade-fast" style={{ padding: '16px 18px', borderTop: '1px solid var(--border)', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SessionDetail item={item} />
        </div>
      )}

      {/* View prompt panel — original vs optimized side by side */}
      {showPrompt && (
        <div className="anim-fade-fast" style={{ padding: '16px 18px', borderTop: '1px solid var(--border)', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600, marginBottom: 6 }}>Original prompt</div>
              <div style={{
                fontSize: 11.5, color: 'var(--text-muted)', background: 'var(--surface-2)',
                border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px',
                fontFamily: 'var(--mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                minHeight: 80, maxHeight: 260, overflowY: 'auto', lineHeight: 1.6,
              }}>
                {item.promptInput ?? <span style={{ color: 'var(--text-subtle)', fontFamily: 'inherit' }}>—</span>}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600, marginBottom: 6 }}>{item.type === 'bridge' ? 'Adapted prompt' : 'Optimized prompt'}</div>
              <div style={{
                fontSize: 11.5, color: 'var(--text)', background: 'var(--surface-2)',
                border: '1px solid var(--primary)', borderRadius: 8, padding: '10px 12px',
                fontFamily: 'var(--mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                minHeight: 80, maxHeight: 260, overflowY: 'auto', lineHeight: 1.6,
              }}>
                {item.optimizedPrompt ?? <span style={{ color: 'var(--text-subtle)', fontFamily: 'inherit' }}>Not available</span>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main history page ───────────────────────────────────────────── */
const HISTORY_PAGE_SIZE = 4;
const BUCKETS: Bucket[] = ['Today', 'Last 7 days', 'Last 30 days', 'Older'];
const ALL_METHODS: MethodId[] = ['pdo', 'gepa', 'council', 'bridge', 'skill'];

export default function HistoryPage() {
  const [filter, setFilter] = useState<'all' | MethodId>('all');
  const [query,  setQuery]  = useState('');
  const [page,   setPage]   = useState(1);

  /* ── Fetch domain optimization runs (PDO + GEPA) ── */
  const { data: runsData, isLoading: runsLoading } = useQuery<RunListResponse>({
    queryKey: ['all-domain-runs'],
    queryFn: async () => {
      const res = await api.get<{ data: RunListResponse }>('/api/v1/domain-prompts/runs');
      return res.data.data;
    },
    staleTime: 30_000,
  });

  /* ── Fetch council chat sessions ── */
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery<SessionsGrouped>({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await api.get<{ data: SessionsGrouped }>('/api/v1/chat/sessions');
      return res.data.data;
    },
    staleTime: 30_000,
  });

  /* ── Fetch bridge transfer jobs ── */
  const { data: bridgeData, isLoading: bridgeLoading } = useQuery<TransferJobListResponse>({
    queryKey: ['bridge-jobs'],
    queryFn: async () => {
      const res = await api.get<{ data: TransferJobListResponse }>('/api/v1/prompt-bridge/jobs');
      return res.data.data;
    },
    staleTime: 30_000,
  });

  const isLoading = runsLoading || sessionsLoading || bridgeLoading;

  /* ── Build unified list ── */
  const allItems = useMemo<HistoryItem[]>(() => {
    const items: HistoryItem[] = [];

    for (const r of (runsData?.runs ?? [])) {
      const method: MethodId = r.algorithm === 'gepa' ? 'gepa' : 'pdo';
      const status = STATUS_NORM[r.status] ?? 'failed';

      const metrics: { k: string; v: string }[] = method === 'pdo'
        ? [
            ...(r.rounds_run       != null ? [{ k: 'Rounds',     v: String(r.rounds_run)       }] : []),
            ...(r.candidates_tried != null ? [{ k: 'Candidates', v: String(r.candidates_tried) }] : []),
            ...(r.dataset_size     != null ? [{ k: 'Q&A pairs',  v: String(r.dataset_size)     }] : []),
          ]
        : [
            ...(r.rounds_run       != null ? [{ k: 'Iterations', v: String(r.rounds_run)       }] : []),
            ...(r.candidates_tried != null ? [{ k: 'Pool',       v: String(r.candidates_tried) }] : []),
          ];

      items.push({
        id:              r.id,
        type:            method,
        title:           r.domain_name || 'Domain optimization',
        context:         r.domain_name ?? null,
        source:          null,
        status,
        when:            formatWhen(r.created_at),
        credits:         method === 'gepa' ? 12 : 10,
        scoreBefore:     r.score_before,
        scoreAfter:      r.score_after,
        winRate:         r.win_rate,
        winner:          r.score_after != null ? 'Optimized prompt' : null,
        metrics,
        promptInput:     r.prompt_input ?? null,
        optimizedPrompt: r.optimized_prompt ?? null,
        errorMessage:    r.error_message,
        tokenCount:      r.total_tokens ?? null,
        feedbackCount:   null,
        reasoning:       null,
        mappingText:     null,
        bucket:          getBucket(r.created_at),
        created_at:      r.created_at,
      });
    }

    const allSessions = [
      ...(sessionsData?.today        ?? []),
      ...(sessionsData?.last_7_days  ?? []),
      ...(sessionsData?.last_30_days ?? []),
      ...(sessionsData?.older        ?? []),
    ];
    for (const s of allSessions) {
      const reasoning = s.reasoning ?? null;
      const changeCount = reasoning?.changes?.length ?? 0;
      items.push({
        id:              s.id,
        type:            'council',
        title:           s.title || 'Council optimization',
        context:         s.title ?? null,
        source:          null,
        status:          'completed',
        when:            formatWhen(s.created_at),
        credits:         10,
        scoreBefore:     null,
        scoreAfter:      null,
        winRate:         null,
        winner:          reasoning?.summary ?? null,
        metrics:         [
          { k: 'Perspectives', v: '4' },
          { k: 'Cross-checks', v: '12' },
          ...(changeCount > 0 ? [{ k: 'Changes', v: String(changeCount) }] : []),
        ],
        promptInput:     s.prompt_input ?? null,
        optimizedPrompt: s.optimized_prompt ?? null,
        errorMessage:    null,
        tokenCount:      s.token_count ?? null,
        feedbackCount:   s.feedback_count ?? null,
        reasoning,
        mappingText:     null,
        bucket:          getBucket(s.created_at),
        created_at:      s.created_at,
      });
    }

    const shortModel = (slug: string) => slug.includes('/') ? slug.split('/').pop()! : slug;

    for (const j of (bridgeData?.jobs ?? [])) {
      const status = STATUS_NORM[j.status] ?? 'failed';
      items.push({
        id:              j.id,
        type:            'bridge',
        title:           `${shortModel(j.source_model)} → ${shortModel(j.target_model)}`,
        context:         `${j.source_model} → ${j.target_model}`,
        source:          null,
        status,
        when:            formatWhen(j.created_at),
        credits:         j.credits_charged,
        scoreBefore:     null,
        scoreAfter:      null,
        winRate:         null,
        winner:          null,
        metrics:         [{ k: 'Mapping', v: j.reused_mapping ? 'Reused' : 'Full calibration' }],
        promptInput:     j.source_prompt,
        optimizedPrompt: j.adapted_prompt ?? null,
        errorMessage:    j.error_message,
        tokenCount:      j.token_count ?? null,
        feedbackCount:   null,
        reasoning:       null,
        mappingText:     j.mapping_text ?? null,
        bucket:          getBucket(j.created_at),
        created_at:      j.created_at,
      });
    }

    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return items;
  }, [runsData, sessionsData, bridgeData]);

  /* ── Filter + search ── */
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    return allItems.filter(item => {
      if (filter !== 'all' && item.type !== filter) return false;
      if (!q) return true;
      return [item.title, item.context, item.source, METHOD_META[item.type].label]
        .filter(Boolean)
        .some(t => (t as string).toLowerCase().includes(q));
    });
  }, [allItems, filter, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / HISTORY_PAGE_SIZE));

  useEffect(() => { setPage(1); }, [filter, query]);

  const safePage  = Math.min(page, totalPages);
  const start     = (safePage - 1) * HISTORY_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + HISTORY_PAGE_SIZE);

  const countFor = (id: 'all' | MethodId) =>
    id === 'all' ? allItems.length : allItems.filter(i => i.type === id).length;

  const FILTERS: { id: 'all' | MethodId; label: string }[] = [
    { id: 'all', label: 'All methods' },
    ...ALL_METHODS.map(k => ({ id: k as MethodId, label: METHOD_META[k].short })),
  ];

  return (
    <>
      <PageHeader
        title="History"
        subtitle={`${allItems.length} optimization${allItems.length !== 1 ? 's' : ''} total`}
      />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px 80px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Search */}
        <div style={{ position: 'relative', maxWidth: 380 }}>
          <HIcon
            name="search" size={14} color="var(--text-subtle)"
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
          />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search sessions by name, domain, or file…"
            style={{
              width: '100%', height: 38, padding: '0 34px 0 34px', borderRadius: 10,
              border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)',
              fontSize: 13, outline: 'none', boxSizing: 'border-box',
              transition: 'border-color .15s, box-shadow .15s',
            }}
            onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-soft)'; }}
            onBlur={e  => { e.target.style.borderColor = 'var(--border)';  e.target.style.boxShadow = 'none'; }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                width: 22, height: 22, borderRadius: '50%', border: 0,
                background: 'var(--surface-2)', color: 'var(--text-subtle)',
                display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0,
              }}
            >
              <HIcon name="x" size={12} />
            </button>
          )}
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map(f => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => { setFilter(f.id); setPage(1); }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  height: 30, padding: '0 12px', borderRadius: 999,
                  border: `1px solid ${active ? 'transparent' : 'var(--border)'}`,
                  background: active ? 'var(--primary)' : 'var(--surface)',
                  color: active ? 'white' : 'var(--text-muted)',
                  fontSize: 12.5, fontWeight: 500, cursor: 'pointer', transition: 'all .15s ease',
                }}
              >
                {f.id !== 'all' && <HIcon name={METHOD_META[f.id as MethodId].icon} size={12} />}
                {f.label}
                <span className="mono" style={{ fontSize: 10.5, opacity: active ? 0.85 : 0.6 }}>{countFor(f.id)}</span>
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
            {filtered.length} result{filtered.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* Loading */}
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '60px 0', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <span className="ply-dot ply-dot-pulse" style={{ background: 'var(--primary)' }} />
            <span style={{ fontSize: 13 }}>Loading…</span>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && filtered.length === 0 && (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
            No sessions match{q ? ` "${query}"` : ''}
            {filter !== 'all' ? ` in ${METHOD_META[filter as MethodId].short}` : ''}.
            {allItems.length === 0 && !q && filter === 'all' && (
              <> <Link href="/optimize" style={{ color: 'var(--primary)', textDecoration: 'none' }}>Start your first optimization →</Link></>
            )}
          </div>
        )}

        {/* Date-grouped session cards */}
        {!isLoading && BUCKETS.map(b => {
          const items = pageItems.filter(i => i.bucket === b);
          if (!items.length) return null;
          return (
            <div key={b} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>{b}</div>
              {items.map(s => <SessionCard key={s.id} item={s} />)}
            </div>
          );
        })}

        {/* Pagination */}
        {!isLoading && filtered.length > 0 && totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
              Showing {start + 1}–{Math.min(start + HISTORY_PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button className="ply-btn ply-btn-sm" disabled={safePage === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                <HIcon name="chevronLeft" size={12} /> Prev
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => {
                const active = n === safePage;
                return (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className="mono"
                    style={{
                      minWidth: 30, height: 30, padding: '0 8px', borderRadius: 8, cursor: 'pointer',
                      border: `1px solid ${active ? 'transparent' : 'var(--border)'}`,
                      background: active ? 'var(--primary)' : 'var(--surface)',
                      color: active ? 'white' : 'var(--text-muted)',
                      fontSize: 12.5, fontWeight: active ? 600 : 500, transition: 'all .15s ease',
                    }}
                  >
                    {n}
                  </button>
                );
              })}
              <button className="ply-btn ply-btn-sm" disabled={safePage === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                Next <HIcon name="chevronRight" size={12} />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
