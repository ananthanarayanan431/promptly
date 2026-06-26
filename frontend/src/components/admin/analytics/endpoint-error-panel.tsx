'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { EndpointError, EndpointErrorDetail } from '@/types/api';

// ── Clear options ─────────────────────────────────────────────────────────────

const CLEAR_OPTIONS = [
  { label: 'Last 1 hour',   window: '1h'  },
  { label: 'Last 12 hours', window: '12h' },
  { label: 'Last 1 day',    window: '1d'  },
  { label: 'Last 7 days',   window: '7d'  },
  { label: 'Clear all',     window: 'all', danger: true },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

function statusColor(code: number) {
  if (code >= 500) return '#f43f5e';
  if (code >= 400) return '#f97316';
  return '#10b981';
}

// ── Simple markdown renderer reused from issue-detail-panel ──────────────────

function AiFixResult({ text }: { text: string }) {
  const segments: { type: 'h2' | 'code' | 'text'; content: string }[] = [];
  const codeRe = /```[\w]*\n?([\s\S]*?)```/g;
  const sections = text.split(/(?=^## )/m);

  for (const section of sections) {
    let remaining = section;
    const headingMatch = section.match(/^## (.+)\n?/);
    if (headingMatch) {
      segments.push({ type: 'h2', content: headingMatch[1].trim() });
      remaining = section.slice(headingMatch[0].length);
    }
    let lastIndex = 0;
    codeRe.lastIndex = 0;
    let match;
    while ((match = codeRe.exec(remaining)) !== null) {
      if (match.index > lastIndex) {
        const plain = remaining.slice(lastIndex, match.index).trim();
        if (plain) segments.push({ type: 'text', content: plain });
      }
      segments.push({ type: 'code', content: match[1] });
      lastIndex = match.index + match[0].length;
    }
    const tail = remaining.slice(lastIndex).trim();
    if (tail) segments.push({ type: 'text', content: tail });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {segments.map((seg, i) => {
        if (seg.type === 'h2') return (
          <div key={i} style={{
            fontSize: 11, fontWeight: 700, color: '#a78bfa',
            textTransform: 'uppercase', letterSpacing: '.08em',
            marginTop: i === 0 ? 0 : 10,
          }}>
            {seg.content}
          </div>
        );
        if (seg.type === 'code') return (
          <div key={i} style={{
            background: '#0d1117', borderRadius: 6,
            border: '1px solid color-mix(in oklab, #6366f1 20%, transparent)',
            overflow: 'hidden',
          }}>
            <pre style={{
              fontFamily: 'var(--mono)', fontSize: 11.5, color: '#e2e8f0',
              padding: '10px 14px', margin: 0, overflowX: 'auto', whiteSpace: 'pre',
            }}>
              {seg.content}
            </pre>
          </div>
        );
        const parts = seg.content.split(/`([^`]+)`/);
        return (
          <p key={i} style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.6, margin: 0 }}>
            {parts.map((p, j) =>
              j % 2 === 1
                ? <code key={j} style={{
                    fontFamily: 'var(--mono)', fontSize: 11.5,
                    background: 'var(--surface-2)', padding: '1px 5px',
                    borderRadius: 4, color: '#a78bfa',
                  }}>{p}</code>
                : p
            )}
          </p>
        );
      })}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10.5, fontWeight: 700, color: 'var(--text-subtle)',
      textTransform: 'uppercase', letterSpacing: '.1em',
      padding: '14px 0 8px',
      borderBottom: '1px solid var(--border)', marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

// ── Error log list with expandable detail rows ───────────────────────────────

const COL = {
  when:     { flex: '0 0 100px' },
  status:   { flex: '0 0 52px'  },
  method:   { flex: '0 0 52px'  },
  duration: { flex: '0 0 74px'  },
  user:     { flex: '1 1 0', minWidth: 0 },
  chevron:  { flex: '0 0 20px'  },
} as const;

function RowCell({
  col, right, children, mono, muted,
}: {
  col: keyof typeof COL;
  right?: boolean;
  mono?: boolean;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span style={{
      ...COL[col],
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      textAlign: right ? 'right' : 'left',
      fontFamily: mono ? 'var(--mono)' : undefined,
      color: muted ? 'var(--text-muted)' : 'var(--text)',
      fontSize: 12,
    }}>
      {children}
    </span>
  );
}

function ErrorLogRow({ err, last }: { err: EndpointError; last: boolean }) {
  const [expanded, setExpanded] = useState(false);

  // Parse error_message JSON → extract nested detail field
  let parsedDetail: string | null = null;
  if (err.error_message) {
    try {
      const j = JSON.parse(err.error_message);
      if (typeof j?.detail === 'string') {
        parsedDetail = j.detail;
      } else if (Array.isArray(j?.detail)) {
        // FastAPI validation errors — format each item
        parsedDetail = j.detail
          .map((d: { loc?: string[]; msg?: string; type?: string }) =>
            `[${(d.loc ?? []).join(' → ')}] ${d.msg ?? ''} (${d.type ?? ''})`
          )
          .join('\n');
      } else if (typeof j?.detail === 'object') {
        parsedDetail = JSON.stringify(j.detail, null, 2);
      } else {
        parsedDetail = err.error_message;
      }
    } catch {
      parsedDetail = err.error_message;
    }
  }

  return (
    <div style={{ borderBottom: last ? 'none' : '1px solid var(--border)' }}>
      {/* Summary row — always clickable */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 14px',
          cursor: 'pointer',
          transition: 'background .1s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface)')}
        onMouseLeave={e => (e.currentTarget.style.background = '')}
      >
        <RowCell col="when" muted>
          <span title={new Date(err.created_at).toLocaleString()}>
            {relativeTime(err.created_at)}
          </span>
        </RowCell>
        <RowCell col="status" mono>
          <span style={{ fontWeight: 700, color: statusColor(err.status_code) }}>
            {err.status_code}
          </span>
        </RowCell>
        <RowCell col="method" mono>
          <span style={{ color: '#6366f1', fontWeight: 600 }}>{err.method}</span>
        </RowCell>
        <RowCell col="duration" mono muted right>
          {err.duration_ms}ms
        </RowCell>
        <RowCell col="user" mono muted>
          {err.user_id ?? '—'}
        </RowCell>
        <span style={{ ...COL.chevron, fontSize: 9, color: 'var(--text-muted)', textAlign: 'right' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* Expanded detail — always renders when open */}
      {expanded && (
        <div style={{
          padding: '10px 14px 14px',
          display: 'flex', flexDirection: 'column', gap: 10,
          background: 'color-mix(in oklab, var(--surface-2) 80%, transparent)',
          borderTop: '1px solid var(--border)',
        }}>
          {/* Exact timestamp */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              <span style={{ fontWeight: 700, color: 'var(--text-subtle)', marginRight: 4 }}>WHEN</span>
              {new Date(err.created_at).toLocaleString()}
            </span>
            {err.user_id && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                <span style={{ fontWeight: 700, color: 'var(--text-subtle)', marginRight: 4, fontFamily: 'inherit' }}>USER</span>
                {err.user_id}
              </span>
            )}
          </div>

          {/* Query params */}
          {err.query_params ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)',
                textTransform: 'uppercase', letterSpacing: '.08em' }}>
                Query Params
              </span>
              <code style={{
                fontFamily: 'var(--mono)', fontSize: 12,
                color: '#60a5fa',
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 5, padding: '6px 10px', wordBreak: 'break-all',
                display: 'block',
              }}>
                ?{err.query_params}
              </code>
            </div>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              No query params on this request.
            </span>
          )}

          {/* Error detail */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)',
              textTransform: 'uppercase', letterSpacing: '.08em' }}>
              Error Detail
            </span>
            {parsedDetail ? (
              <pre style={{
                fontFamily: 'var(--mono)', fontSize: 12,
                color: statusColor(err.status_code),
                background: `color-mix(in oklab, ${statusColor(err.status_code)} 6%, var(--surface))`,
                border: `1px solid color-mix(in oklab, ${statusColor(err.status_code)} 25%, transparent)`,
                borderRadius: 5, padding: '8px 10px',
                margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {parsedDetail}
              </pre>
            ) : (
              <div style={{
                background: 'var(--surface)', border: '1px dashed var(--border)',
                borderRadius: 5, padding: '8px 12px',
                fontSize: 11.5, color: 'var(--text-muted)', fontStyle: 'italic',
              }}>
                Error body not captured — this log was recorded before response-body capture
                was enabled. New errors after the server restart will include the full detail.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ErrorLogList({ errors }: { errors: EndpointError[] }) {
  return (
    <div style={{
      background: 'var(--surface-2)', border: '1px solid var(--border)',
      borderRadius: 8, overflow: 'hidden',
    }}>
      {/* Column header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 14px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
      }}>
        {(
          [
            { col: 'when',     label: 'When'     },
            { col: 'status',   label: 'Status'   },
            { col: 'method',   label: 'Method'   },
            { col: 'duration', label: 'Duration', right: true },
            { col: 'user',     label: 'User'     },
            { col: 'chevron',  label: ''         },
          ] as { col: keyof typeof COL; label: string; right?: boolean }[]
        ).map(({ col, label, right }) => (
          <span key={col} style={{
            ...COL[col],
            fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)',
            textTransform: 'uppercase', letterSpacing: '.07em',
            textAlign: right ? 'right' : 'left',
          }}>
            {label}
          </span>
        ))}
      </div>
      {errors.map((err, i) => (
        <ErrorLogRow key={err.id} err={err} last={i === errors.length - 1} />
      ))}
    </div>
  );
}

// ── AI fix payload for an HTTP endpoint error ────────────────────────────────

function buildHttpAiFixPayload(detail: EndpointErrorDetail) {
  const topStatus = detail.status_breakdown[0];
  const recentSample = detail.recent_errors.slice(0, 5);

  return {
    title: `HTTP ${topStatus?.status_code ?? '4xx/5xx'} errors on ${detail.path}`,
    level: (topStatus?.status_code ?? 500) >= 500 ? 'error' : 'warning',
    culprit: detail.path,
    request_method: recentSample[0]?.method ?? '',
    request_url: detail.path,
    breadcrumbs: recentSample.map(e => ({
      category: 'http',
      message: `${e.method} ${detail.path} → ${e.status_code} (${e.duration_ms}ms)${e.user_id ? ` [user: ${e.user_id}]` : ''}`,
      timestamp: e.created_at,
    })),
  };
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function EndpointErrorPanel({
  path,
  onClose,
}: {
  path: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const aiCacheKey = ['admin', 'endpoint-ai-fix', path];
  const hasCached = !!queryClient.getQueryData(aiCacheKey);
  const [aiEnabled, setAiEnabled] = useState(hasCached);
  const [aiShown, setAiShown] = useState(hasCached);
  const [copied, setCopied] = useState(false);
  const [clearMenuOpen, setClearMenuOpen] = useState(false);
  const [clearDoneLabel, setClearDoneLabel] = useState<string | null>(null);
  const clearMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!clearMenuOpen) return;
    function handle(e: MouseEvent) {
      if (clearMenuRef.current && !clearMenuRef.current.contains(e.target as Node)) {
        setClearMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [clearMenuOpen]);

  const clearMutation = useMutation({
    mutationFn: async (window: string) => {
      await api.delete(
        `/api/v1/admin/endpoint-errors?path=${encodeURIComponent(path)}&window=${window}`
      );
    },
    onSuccess: (_data, window) => {
      setClearMenuOpen(false);
      const opt = CLEAR_OPTIONS.find(o => o.window === window);
      setClearDoneLabel(opt?.label ?? window);
      setTimeout(() => setClearDoneLabel(null), 2500);
      queryClient.invalidateQueries({ queryKey: ['admin', 'endpoint-errors', path] });
    },
  });

  const { data, isLoading, isError } = useQuery<EndpointErrorDetail>({
    queryKey: ['admin', 'endpoint-errors', path],
    queryFn: async () => {
      const res = await api.get<{ data: EndpointErrorDetail }>(
        `/api/v1/admin/endpoint-errors?path=${encodeURIComponent(path)}&days=30`
      );
      return res.data.data;
    },
    staleTime: 2 * 60 * 1000,
  });

  const aiQuery = useQuery<string>({
    queryKey: aiCacheKey,
    queryFn: async () => {
      const detail = queryClient.getQueryData<EndpointErrorDetail>(
        ['admin', 'endpoint-errors', path]
      )!;
      const payload = buildHttpAiFixPayload(detail);
      const res = await api.post<{ data: { analysis: string } }>(
        '/api/v1/admin/sentry/issues/ai-fix',
        payload,
      );
      return res.data.data.analysis;
    },
    enabled: aiEnabled,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.45)',
          zIndex: 200, backdropFilter: 'blur(2px)',
        }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(700px, 92vw)',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
        zIndex: 201,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 20px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <button
            onClick={onClose}
            style={{
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 6, width: 28, height: 28, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, color: 'var(--text-muted)', flexShrink: 0,
            }}
          >
            ✕
          </button>
          <span style={{
            fontSize: 10.5, fontWeight: 700,
            color: '#f43f5e',
            background: 'color-mix(in oklab, #f43f5e 12%, transparent)',
            padding: '2px 7px', borderRadius: 4, textTransform: 'uppercase', flexShrink: 0,
          }}>
            HTTP Errors
          </span>
          <span style={{
            flex: 1, fontFamily: 'var(--mono)', fontSize: 12.5, fontWeight: 600,
            color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {path}
          </span>
          {data && (
            <button
              onClick={() => {
                if (aiQuery.data) { setAiShown(s => !s); return; }
                setAiEnabled(true);
                setAiShown(true);
              }}
              disabled={aiQuery.isFetching}
              style={{
                fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                border: '1px solid color-mix(in oklab, #a78bfa 35%, transparent)',
                borderRadius: 5, padding: '3px 10px',
                background: aiShown
                  ? 'color-mix(in oklab, #a78bfa 15%, transparent)'
                  : 'color-mix(in oklab, #a78bfa 8%, transparent)',
                color: '#a78bfa',
                transition: 'all .15s',
              }}
            >
              {aiQuery.isFetching ? '✦ Analysing…' : aiShown ? '✦ Hide AI Fix' : '✦ Fix with AI'}
            </button>
          )}

          {/* Clear errors dropdown */}
          {data && (
            <div ref={clearMenuRef} style={{ position: 'relative', flexShrink: 0 }}>
              <button
                onClick={() => setClearMenuOpen(o => !o)}
                disabled={clearMutation.isPending}
                style={{
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  border: '1px solid color-mix(in oklab, #f43f5e 35%, transparent)',
                  borderRadius: 5, padding: '3px 10px',
                  background: clearMenuOpen
                    ? 'color-mix(in oklab, #f43f5e 15%, transparent)'
                    : 'color-mix(in oklab, #f43f5e 8%, transparent)',
                  color: clearDoneLabel ? '#10b981' : '#f43f5e',
                  transition: 'all .15s',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                {clearMutation.isPending ? (
                  '⏳ Clearing…'
                ) : clearDoneLabel ? (
                  `✓ Cleared`
                ) : (
                  <>⊘ Clear</>
                )}
              </button>

              {clearMenuOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 8, overflow: 'hidden',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                  zIndex: 300, minWidth: 168,
                }}>
                  <div style={{
                    padding: '7px 12px 6px',
                    fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)',
                    textTransform: 'uppercase', letterSpacing: '.08em',
                    borderBottom: '1px solid var(--border)',
                  }}>
                    Clear errors for this endpoint
                  </div>
                  {CLEAR_OPTIONS.map(opt => (
                    <button
                      key={opt.window}
                      onClick={() => clearMutation.mutate(opt.window)}
                      disabled={clearMutation.isPending}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '8px 14px',
                        fontSize: 12.5, fontWeight: opt.window === 'all' ? 600 : 400,
                        color: opt.window === 'all' ? '#f43f5e' : 'var(--text)',
                        background: 'none', border: 'none',
                        borderTop: opt.window === 'all' ? '1px solid var(--border)' : 'none',
                        cursor: 'pointer',
                        transition: 'background .1s',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLButtonElement).style.background =
                          opt.window === 'all'
                            ? 'color-mix(in oklab, #f43f5e 10%, transparent)'
                            : 'var(--surface-2)';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLButtonElement).style.background = 'none';
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 24px' }}>
          {isLoading && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading error details…
            </div>
          )}
          {isError && (
            <div style={{ padding: 24, color: '#f43f5e', textAlign: 'center' }}>
              Failed to load endpoint errors.
            </div>
          )}

          {data && (
            <>
              {/* Quick stats */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
                padding: '16px 0 4px',
              }}>
                <div style={{
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '10px 12px',
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)',
                    textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>
                    Total Errors
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--mono)',
                    color: '#f43f5e' }}>
                    {data.total_errors.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>last 30 days</div>
                </div>
                <div style={{
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '10px 12px',
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)',
                    textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>
                    Affected Users
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--mono)',
                    color: 'var(--text)' }}>
                    {new Set(data.recent_errors.map(e => e.user_id).filter(Boolean)).size}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>unique users (last 50 errors)</div>
                </div>
                <div style={{
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '10px 12px',
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)',
                    textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>
                    Latest Error
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--mono)',
                    color: 'var(--text)' }}>
                    {data.recent_errors[0]
                      ? relativeTime(data.recent_errors[0].created_at)
                      : '—'}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                    {data.recent_errors[0]
                      ? new Date(data.recent_errors[0].created_at).toLocaleString()
                      : ''}
                  </div>
                </div>
              </div>

              {/* AI Fix error */}
              {aiQuery.isError && (
                <div style={{
                  background: 'color-mix(in oklab, #f43f5e 8%, transparent)',
                  border: '1px solid color-mix(in oklab, #f43f5e 25%, transparent)',
                  borderRadius: 8, padding: '10px 14px',
                  fontSize: 12, color: '#f43f5e',
                }}>
                  AI analysis failed — check that the backend LLM is configured.
                </div>
              )}

              {/* AI Fix result */}
              {aiShown && aiQuery.data && (
                <div style={{
                  background: 'color-mix(in oklab, #a78bfa 6%, transparent)',
                  border: '1px solid color-mix(in oklab, #a78bfa 25%, transparent)',
                  borderRadius: 10, padding: '16px 18px',
                  display: 'flex', flexDirection: 'column', gap: 12,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 800, letterSpacing: '.1em',
                      color: '#a78bfa',
                      background: 'color-mix(in oklab, #a78bfa 15%, transparent)',
                      padding: '2px 7px', borderRadius: 4,
                    }}>✦ AI ANALYSIS</span>
                    <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                      Based on recent error patterns
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(aiQuery.data ?? '').then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        });
                      }}
                      style={{
                        fontSize: 10.5, fontWeight: 600, cursor: 'pointer',
                        border: '1px solid color-mix(in oklab, #a78bfa 30%, transparent)',
                        borderRadius: 5, padding: '2px 9px',
                        background: 'color-mix(in oklab, #a78bfa 10%, transparent)',
                        color: '#a78bfa', transition: 'all .12s',
                      }}
                    >
                      {copied ? '✓ Copied!' : '⎘ Copy'}
                    </button>
                    <button
                      onClick={() => setAiShown(false)}
                      style={{
                        marginLeft: 'auto', background: 'none', border: 'none',
                        cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', padding: '0 4px',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <AiFixResult text={aiQuery.data} />
                </div>
              )}

              {/* Status breakdown */}
              {data.status_breakdown.length > 0 && (
                <>
                  <SectionTitle>Status Code Breakdown</SectionTitle>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {data.status_breakdown.map(({ status_code, count }) => (
                      <div key={status_code} style={{
                        background: 'var(--surface-2)', border: `1px solid ${statusColor(status_code)}40`,
                        borderRadius: 8, padding: '10px 16px', minWidth: 90, textAlign: 'center',
                      }}>
                        <div style={{
                          fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700,
                          color: statusColor(status_code),
                        }}>
                          {status_code}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>
                          {count.toLocaleString()}
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>errors</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Recent errors list */}
              {data.recent_errors.length > 0 && (
                <>
                  <SectionTitle>Recent Errors</SectionTitle>
                  <ErrorLogList errors={data.recent_errors} />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
