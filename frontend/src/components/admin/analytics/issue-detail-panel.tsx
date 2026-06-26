'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface StackFrame {
  filename: string;
  lineno: number | null;
  function: string;
  context: [number, string][];
  in_app: boolean;
  vars: Record<string, string>;
}

interface ExceptionInfo {
  exc_type: string;
  exc_value: string;
  mechanism: string;
  frames: StackFrame[];
}

interface RequestInfo {
  method: string;
  url: string;
  query_string: string;
  headers: [string, string][];
}

interface IssueDetail {
  issue: {
    id: string;
    short_id: string;
    title: string;
    level: string;
    count: number;
    user_count: number;
    first_seen: string;
    last_seen: string;
    permalink: string;
    culprit: string;
    status: string;
  };
  latest_event: {
    event_id: string;
    timestamp: string;
    user: {
      id: string | null;
      email: string | null;
      ip: string | null;
      geo_city: string | null;
      geo_country: string | null;
      geo_region: string | null;
    };
    tags: { key: string; value: string }[];
    exception: ExceptionInfo | null;
    request: RequestInfo | null;
    breadcrumbs: {
      type: string; category: string; message: string;
      level: string; timestamp: string;
    }[];
    release: string | null;
  };
}

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

const LEVEL_COLOR: Record<string, string> = {
  error: '#f43f5e', warning: '#f59e0b', info: '#06b6d4', debug: '#6b7280',
};

// ── AI fix payload builder ────────────────────────────────────────────────────

function buildAiFixPayload(d: IssueDetail) {
  const ev = d.latest_event;
  const exc = ev.exception;

  const compressedFrames = exc
    ? (exc.frames.filter(f => f.in_app).slice(-8)).map(f => ({
        filename: f.filename,
        lineno: f.lineno,
        function: f.function,
        // max 7 context lines around the error line
        context: f.context.slice(-7),
        in_app: f.in_app,
        // max 4 vars
        vars: Object.fromEntries(Object.entries(f.vars).slice(0, 4)),
      }))
    : [];

  return {
    title: d.issue.title,
    level: d.issue.level,
    culprit: d.issue.culprit,
    exception: exc ? {
      exc_type: exc.exc_type,
      exc_value: exc.exc_value.slice(0, 400),
      mechanism: exc.mechanism,
      frames: compressedFrames,
    } : null,
    request_method: ev.request?.method ?? '',
    request_url: ev.request?.url ?? '',
    // last 3 breadcrumbs only
    breadcrumbs: ev.breadcrumbs.slice(-3).map(c => ({
      category: c.category,
      message: c.message.slice(0, 100),
      timestamp: c.timestamp,
    })),
  };
}

// ── Simple markdown renderer (## headings + ```code``` blocks) ───────────────

function AiFixResult({ text }: { text: string }) {
  // Split into segments: heading | code | plain text
  const segments: { type: 'h2' | 'code' | 'text'; content: string }[] = [];
  const codeRe = /```[\w]*\n?([\s\S]*?)```/g;
  let remaining = text;

  // Process section by section (split on ## headings)
  const sections = remaining.split(/(?=^## )/m);
  for (const section of sections) {
    const headingMatch = section.match(/^## (.+)\n?/);
    if (headingMatch) {
      segments.push({ type: 'h2', content: headingMatch[1].trim() });
      remaining = section.slice(headingMatch[0].length);
    } else {
      remaining = section;
    }

    // Within the section body, extract code blocks
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
              fontFamily: 'var(--mono)', fontSize: 11.5,
              color: '#e2e8f0', padding: '10px 14px',
              margin: 0, overflowX: 'auto', whiteSpace: 'pre',
            }}>
              {seg.content}
            </pre>
          </div>
        );
        // Inline code within text: wrap `backtick` spans
        const parts = seg.content.split(/`([^`]+)`/);
        return (
          <p key={i} style={{
            fontSize: 12.5, color: 'var(--text)',
            lineHeight: 1.6, margin: 0,
          }}>
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

// ── Sub-components ────────────────────────────────────────────────────────────

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

function StackTrace({ exc }: { exc: ExceptionInfo }) {
  const [showAll, setShowAll] = useState(false);
  const frames = [...exc.frames].reverse(); // newest first
  const inAppFrames = frames.filter(f => f.in_app);
  const displayed = showAll ? frames : (inAppFrames.length > 0 ? inAppFrames : frames.slice(0, 8));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Exception header */}
      <div style={{
        background: 'color-mix(in oklab, #f43f5e 8%, transparent)',
        border: '1px solid color-mix(in oklab, #f43f5e 25%, transparent)',
        borderRadius: 8, padding: '12px 14px', marginBottom: 8,
      }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700,
          color: '#f43f5e', marginBottom: 4 }}>
          {exc.exc_type}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12,
          color: 'var(--text)', lineHeight: 1.5, wordBreak: 'break-all' }}>
          {exc.exc_value}
        </div>
        {exc.mechanism && (
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 6 }}>
            mechanism: {exc.mechanism}
          </div>
        )}
      </div>

      {/* Frames */}
      {displayed.map((frame, i) => (
        <FrameRow key={i} frame={frame} />
      ))}

      {/* Toggle */}
      {!showAll && frames.length !== displayed.length && (
        <button
          onClick={() => setShowAll(true)}
          style={{
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '6px 12px', fontSize: 11.5,
            color: 'var(--text-muted)', cursor: 'pointer', marginTop: 4,
          }}
        >
          Show all {frames.length} frames ({frames.length - displayed.length} library frames hidden)
        </button>
      )}
    </div>
  );
}

function FrameRow({ frame }: { frame: StackFrame }) {
  const [expanded, setExpanded] = useState(frame.in_app);
  const hasContext = frame.context && frame.context.length > 0;

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 6,
      overflow: 'hidden',
      opacity: frame.in_app ? 1 : 0.6,
      background: frame.in_app ? 'var(--surface)' : 'var(--surface-2)',
    }}>
      {/* Frame header */}
      <div
        onClick={() => hasContext && setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px',
          cursor: hasContext ? 'pointer' : 'default',
        }}
      >
        {frame.in_app && (
          <span style={{
            fontSize: 9, fontWeight: 700, color: '#6366f1',
            background: 'color-mix(in oklab, #6366f1 12%, transparent)',
            padding: '1px 5px', borderRadius: 3, flexShrink: 0,
          }}>APP</span>
        )}
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5,
          color: frame.in_app ? 'var(--text)' : 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {frame.filename}
          {frame.lineno != null && (
            <span style={{ color: 'var(--text-subtle)' }}> :{frame.lineno}</span>
          )}
        </span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11,
          color: 'var(--text-subtle)', flexShrink: 0 }}>
          in {frame.function}
        </span>
        {hasContext && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
            {expanded ? '▲' : '▼'}
          </span>
        )}
      </div>

      {/* Context lines */}
      {expanded && hasContext && (
        <div style={{
          borderTop: '1px solid var(--border)',
          background: '#0d1117',
          fontFamily: 'var(--mono)', fontSize: 11.5,
          overflowX: 'auto',
        }}>
          {frame.context.map(([lineNo, lineText]) => {
            const isErr = lineNo === frame.lineno;
            return (
              <div key={lineNo} style={{
                display: 'flex',
                background: isErr ? 'rgba(244,63,94,0.15)' : 'transparent',
                borderLeft: isErr ? '3px solid #f43f5e' : '3px solid transparent',
              }}>
                <span style={{
                  minWidth: 40, padding: '1px 8px',
                  color: isErr ? '#f43f5e' : '#4b5563',
                  userSelect: 'none', textAlign: 'right', flexShrink: 0,
                }}>
                  {lineNo}
                </span>
                <span style={{
                  padding: '1px 8px',
                  color: isErr ? '#fca5a5' : '#9ca3af',
                  whiteSpace: 'pre',
                }}>
                  {lineText}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Local vars */}
      {expanded && Object.keys(frame.vars).length > 0 && (
        <div style={{
          borderTop: '1px solid var(--border)',
          padding: '8px 12px',
          display: 'flex', flexWrap: 'wrap', gap: '4px 12px',
        }}>
          {Object.entries(frame.vars).map(([k, v]) => (
            <span key={k} style={{ fontFamily: 'var(--mono)', fontSize: 10.5,
              color: 'var(--text-muted)' }}>
              <span style={{ color: '#60a5fa' }}>{k}</span>
              {' = '}
              <span style={{ color: '#34d399' }}>{v}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function IssueDetailPanel({
  issueId,
  onClose,
}: {
  issueId: string;
  onClose: () => void;
}) {
  const [aiFixShown, setAiFixShown] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);

  const aiFixMutation = useMutation({
    mutationFn: async (payload: ReturnType<typeof buildAiFixPayload>) => {
      const res = await api.post<{ data: { analysis: string } }>(
        '/api/v1/admin/sentry/issues/ai-fix',
        payload,
      );
      return res.data.data.analysis;
    },
    onSuccess: (analysis) => {
      setAiAnalysis(analysis);
      setAiFixShown(true);
    },
  });

  const { data, isLoading, isError } = useQuery<IssueDetail>({
    queryKey: ['admin', 'sentry-issue', issueId],
    queryFn: async () => {
      const res = await api.get<{ data: IssueDetail }>(
        `/api/v1/admin/sentry/issues/${issueId}`
      );
      return res.data.data;
    },
    staleTime: 2 * 60 * 1000,
  });

  const levelColor = data ? (LEVEL_COLOR[data.issue.level] ?? '#6b7280') : '#6b7280';

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
        width: 'min(740px, 90vw)',
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
          {data && (
            <>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12,
                color: 'var(--text-muted)' }}>
                {data.issue.short_id}
              </span>
              <span style={{
                fontSize: 10.5, fontWeight: 700,
                color: levelColor,
                background: `color-mix(in oklab, ${levelColor} 12%, transparent)`,
                padding: '2px 7px', borderRadius: 4, textTransform: 'uppercase',
              }}>
                {data.issue.level}
              </span>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600,
                color: 'var(--text)', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {data.issue.title}
              </span>
              <button
                onClick={() => {
                  if (aiAnalysis) { setAiFixShown(s => !s); return; }
                  aiFixMutation.mutate(buildAiFixPayload(data));
                }}
                disabled={aiFixMutation.isPending}
                style={{
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                  border: '1px solid color-mix(in oklab, #a78bfa 35%, transparent)',
                  borderRadius: 5, padding: '3px 10px',
                  background: aiFixShown
                    ? 'color-mix(in oklab, #a78bfa 15%, transparent)'
                    : 'color-mix(in oklab, #a78bfa 8%, transparent)',
                  color: '#a78bfa',
                  transition: 'all .15s',
                }}
              >
                {aiFixMutation.isPending ? '✦ Analysing…' : aiFixShown ? '✦ Hide AI Fix' : '✦ Fix with AI'}
              </button>
              <a
                href={data.issue.permalink}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 11, color: 'var(--text-muted)',
                  textDecoration: 'none', flexShrink: 0,
                  border: '1px solid var(--border)', borderRadius: 5,
                  padding: '3px 8px',
                }}
              >
                Open in Sentry ↗
              </a>
            </>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 24px' }}>
          {isLoading && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading issue details…
            </div>
          )}
          {isError && (
            <div style={{ padding: 24, color: '#f43f5e', textAlign: 'center' }}>
              Failed to load issue details.
            </div>
          )}

          {data && (() => {
            const ev = data.latest_event;
            const user = ev.user;
            const hasGeo = user.geo_city || user.geo_country;

            return (
              <>
                {/* Quick stats */}
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
                  padding: '16px 0 4px',
                }}>
                  {[
                    { label: 'Events', val: data.issue.count.toLocaleString() },
                    { label: 'Users', val: data.issue.user_count > 0 ? data.issue.user_count.toLocaleString() : '—' },
                    { label: 'First seen', val: relativeTime(data.issue.first_seen) },
                    { label: 'Last seen', val: relativeTime(data.issue.last_seen) },
                  ].map(({ label, val }) => (
                    <div key={label} style={{
                      background: 'var(--surface-2)', border: '1px solid var(--border)',
                      borderRadius: 8, padding: '10px 12px',
                    }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)',
                        textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>
                        {label}
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 700,
                        fontFamily: 'var(--mono)', color: 'var(--text)' }}>
                        {val}
                      </div>
                    </div>
                  ))}
                </div>

                {/* AI Fix result */}
                {aiFixMutation.isError && (
                  <div style={{
                    background: 'color-mix(in oklab, #f43f5e 8%, transparent)',
                    border: '1px solid color-mix(in oklab, #f43f5e 25%, transparent)',
                    borderRadius: 8, padding: '10px 14px',
                    fontSize: 12, color: '#f43f5e',
                  }}>
                    AI analysis failed — check that the backend LLM is configured.
                  </div>
                )}
                {aiFixShown && aiAnalysis && (
                  <div style={{
                    background: 'color-mix(in oklab, #a78bfa 6%, transparent)',
                    border: '1px solid color-mix(in oklab, #a78bfa 25%, transparent)',
                    borderRadius: 10, padding: '16px 18px',
                    display: 'flex', flexDirection: 'column', gap: 12,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 800, letterSpacing: '.1em',
                        color: '#a78bfa',
                        background: 'color-mix(in oklab, #a78bfa 15%, transparent)',
                        padding: '2px 7px', borderRadius: 4,
                      }}>✦ AI ANALYSIS</span>
                      <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                        gpt-4.1-mini · in-app frames only
                      </span>
                      <button
                        onClick={() => { setAiFixShown(false); setAiAnalysis(null); }}
                        style={{
                          marginLeft: 'auto', background: 'none', border: 'none',
                          cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)',
                          padding: '0 4px',
                        }}
                      >
                        ✕
                      </button>
                    </div>
                    <AiFixResult text={aiAnalysis} />
                  </div>
                )}

                {/* Stack trace */}
                {ev.exception && (
                  <>
                    <SectionTitle>Stack Trace</SectionTitle>
                    <StackTrace exc={ev.exception} />
                  </>
                )}

                {/* User & Location */}
                {(user.id || user.email || user.ip || hasGeo) && (
                  <>
                    <SectionTitle>User</SectionTitle>
                    <div style={{
                      background: 'var(--surface-2)', border: '1px solid var(--border)',
                      borderRadius: 8, padding: '12px 14px',
                      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px',
                    }}>
                      {[
                        ['ID', user.id],
                        ['Email', user.email],
                        ['IP', user.ip],
                        ['Location', hasGeo ? [user.geo_city, user.geo_region, user.geo_country].filter(Boolean).join(', ') : null],
                      ].map(([label, val]) => val ? (
                        <div key={String(label)}>
                          <span style={{ fontSize: 10.5, color: 'var(--text-muted)',
                            fontWeight: 600, marginRight: 6 }}>{String(label)}:</span>
                          <span style={{ fontSize: 12, fontFamily: 'var(--mono)',
                            color: 'var(--text)' }}>{String(val)}</span>
                        </div>
                      ) : null)}
                    </div>
                  </>
                )}

                {/* Request */}
                {ev.request && (
                  <>
                    <SectionTitle>Request</SectionTitle>
                    <div style={{
                      background: 'var(--surface-2)', border: '1px solid var(--border)',
                      borderRadius: 8, overflow: 'hidden',
                    }}>
                      <div style={{
                        padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center',
                        borderBottom: ev.request.headers.length > 0 ? '1px solid var(--border)' : 'none',
                      }}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, color: '#6366f1',
                          background: 'color-mix(in oklab, #6366f1 12%, transparent)',
                          padding: '2px 7px', borderRadius: 4,
                        }}>
                          {ev.request.method}
                        </span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 12,
                          color: 'var(--text)', wordBreak: 'break-all' }}>
                          {ev.request.url}
                          {ev.request.query_string && (
                            <span style={{ color: 'var(--text-muted)' }}>?{ev.request.query_string}</span>
                          )}
                        </span>
                      </div>
                      {ev.request.headers.length > 0 && (
                        <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {ev.request.headers
                            .filter(([k]) => !['cookie', 'Cookie', 'authorization', 'Authorization'].includes(k))
                            .slice(0, 8)
                            .map(([k, v], i) => (
                              <div key={i} style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                                <span style={{ color: '#60a5fa' }}>{k}</span>
                                <span style={{ color: 'var(--text-muted)' }}>: </span>
                                <span style={{ color: 'var(--text)' }}>{String(v)}</span>
                              </div>
                            ))
                          }
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Tags */}
                {ev.tags.length > 0 && (
                  <>
                    <SectionTitle>Tags</SectionTitle>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {ev.tags.map(t => (
                        <span key={t.key} style={{
                          fontSize: 11, fontFamily: 'var(--mono)',
                          background: 'var(--surface-2)', border: '1px solid var(--border)',
                          borderRadius: 5, padding: '3px 8px',
                          color: 'var(--text)',
                        }}>
                          <span style={{ color: 'var(--text-muted)' }}>{t.key}:</span>{' '}
                          {t.value}
                        </span>
                      ))}
                    </div>
                  </>
                )}

                {/* Breadcrumbs */}
                {ev.breadcrumbs.length > 0 && (
                  <>
                    <SectionTitle>Breadcrumbs</SectionTitle>
                    <div style={{
                      background: 'var(--surface-2)', border: '1px solid var(--border)',
                      borderRadius: 8, overflow: 'hidden',
                    }}>
                      {ev.breadcrumbs.map((c, i) => (
                        <div key={i} style={{
                          display: 'flex', gap: 10, alignItems: 'flex-start',
                          padding: '7px 12px',
                          borderBottom: i < ev.breadcrumbs.length - 1
                            ? '1px solid var(--border)' : 'none',
                        }}>
                          <span style={{ fontSize: 10.5, color: 'var(--text-muted)',
                            fontFamily: 'var(--mono)', flexShrink: 0, paddingTop: 1 }}>
                            {new Date(c.timestamp).toLocaleTimeString()}
                          </span>
                          <span style={{ fontSize: 10.5, color: 'var(--text-subtle)',
                            flexShrink: 0, paddingTop: 1 }}>
                            {c.category}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text)',
                            lineHeight: 1.4, wordBreak: 'break-all' }}>
                            {c.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Release */}
                {ev.release && (
                  <>
                    <SectionTitle>Release</SectionTitle>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12,
                      color: 'var(--text-muted)' }}>
                      {ev.release}
                    </span>
                  </>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </>
  );
}
