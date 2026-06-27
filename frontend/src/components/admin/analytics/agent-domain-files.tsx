'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AdminDomainItem, AdminDomainList, AdminDomainQAResponse } from '@/types/api';

const PER_PAGE = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'completed' ? '#10b981' :
    status === 'failed'    ? '#f43f5e' :
    status === 'cancelled' ? '#6b7280' : '#f59e0b';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 99,
      fontSize: 11, fontWeight: 600, letterSpacing: '.03em',
      background: `color-mix(in oklab, ${color} 12%, transparent)`,
      color,
    }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ── PDF Modal ─────────────────────────────────────────────────────────────────

function PdfModal({
  domain,
  onClose,
}: {
  domain: AdminDomainItem;
  onClose: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);

    api.get<Blob>(`/api/v1/admin/domain-prompts/${domain.domain_id}/pdf`, {
      responseType: 'blob',
    }).then(res => {
      if (cancelled) return;
      const url = URL.createObjectURL(res.data);
      urlRef.current = url;
      setBlobUrl(url);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) { setError(true); setLoading(false); }
    });

    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [domain.domain_id]);

  const handleDownload = () => {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${domain.domain_name}.pdf`;
    a.click();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`PDF viewer: ${domain.domain_name}`}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', background: 'var(--surface)',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              {domain.domain_name}
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              {domain.user_email}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {blobUrl && (
            <button
              onClick={handleDownload}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', fontSize: 12.5, fontWeight: 600,
                borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--surface-2)', color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download PDF
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close PDF viewer"
            style={{
              width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--surface-2)', color: 'var(--text-muted)',
              cursor: 'pointer', fontSize: 18, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: 'rgba(255,255,255,.6)', fontSize: 14,
          }}>
            Loading PDF…
          </div>
        )}
        {error && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 8,
          }}>
            <span style={{ color: '#f43f5e', fontSize: 14, fontWeight: 600 }}>
              Failed to load PDF
            </span>
            <span style={{ color: 'rgba(255,255,255,.5)', fontSize: 12.5 }}>
              Check that MinIO is reachable and the file exists.
            </span>
          </div>
        )}
        {blobUrl && (
          <iframe
            src={blobUrl}
            title={`PDF: ${domain.domain_name}`}
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          />
        )}
      </div>
    </div>
  );
}

// ── QA Side Panel ─────────────────────────────────────────────────────────────

function QAPanel({
  domain,
  onClose,
}: {
  domain: AdminDomainItem;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');

  const { data, isLoading, isError } = useQuery<AdminDomainQAResponse>({
    queryKey: ['admin', 'domain-qa', domain.domain_id],
    queryFn: async () => {
      const res = await api.get<{ data: AdminDomainQAResponse }>(
        `/api/v1/admin/domain-prompts/${domain.domain_id}/dataset`
      );
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const filtered = data?.rows.filter(r =>
    !search ||
    r.question.toLowerCase().includes(search.toLowerCase()) ||
    r.answer.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  return (
    <div style={{
      width: 460, flexShrink: 0, borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
      background: 'var(--surface)',
    }}>
      {/* Panel header */}
      <div style={{
        padding: '14px 18px 12px', borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {domain.domain_name}
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              {domain.user_email}
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close Q&A panel"
            style={{
              flexShrink: 0, width: 28, height: 28, borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--surface-2)',
              color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {data && (
          <div style={{ marginTop: 10 }}>
            <span style={{
              fontSize: 10.5, fontWeight: 700, color: 'var(--text-subtle)',
              textTransform: 'uppercase', letterSpacing: '.07em',
            }}>
              {data.row_count} Q&A pair{data.row_count !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* Search */}
        {data && data.row_count > 5 && (
          <div style={{ marginTop: 10, position: 'relative' }}>
            <svg
              width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round"
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}
            >
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              type="text"
              placeholder="Search questions and answers…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', padding: '7px 10px 7px 30px', fontSize: 12.5,
                border: '1px solid var(--border)', borderRadius: 7,
                background: 'var(--surface-2)', color: 'var(--text)',
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
        )}
      </div>

      {/* Pairs list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {isLoading && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, paddingTop: 20, textAlign: 'center' }}>
            Loading…
          </div>
        )}
        {isError && (
          <div style={{ color: 'var(--danger)', fontSize: 13, paddingTop: 20, textAlign: 'center' }}>
            Failed to load Q&A pairs.
          </div>
        )}
        {data && data.rows.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, paddingTop: 20, textAlign: 'center' }}>
            No Q&A pairs for this domain yet.
          </div>
        )}
        {search && filtered.length === 0 && data && data.rows.length > 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, paddingTop: 12, textAlign: 'center' }}>
            No results for &ldquo;{search}&rdquo;
          </div>
        )}
        {filtered.map((row, i) => {
          const globalIndex = data!.rows.indexOf(row);
          return (
            <div key={i} style={{
              border: '1px solid var(--border)', borderRadius: 10,
              overflow: 'hidden', background: 'var(--surface)',
            }}>
              {/* Question */}
              <div style={{
                padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'flex-start',
                borderBottom: '1px solid var(--border)',
                background: 'color-mix(in oklab, #06b6d4 5%, transparent)',
              }}>
                <div style={{
                  flexShrink: 0, width: 22, height: 22, borderRadius: 6,
                  background: 'color-mix(in oklab, #06b6d4 18%, transparent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: '#06b6d4', letterSpacing: 0 }}>Q</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#06b6d4',
                    textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    Question {globalIndex + 1}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55 }}>
                    {row.question}
                  </span>
                </div>
              </div>
              {/* Answer */}
              <div style={{
                padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'flex-start',
              }}>
                <div style={{
                  flexShrink: 0, width: 22, height: 22, borderRadius: 6,
                  background: 'color-mix(in oklab, #8b5cf6 14%, transparent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: '#8b5cf6', letterSpacing: 0 }}>A</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#8b5cf6',
                    textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    Answer
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                    {row.answer}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Domain table row ──────────────────────────────────────────────────────────

function DomainRow({
  domain,
  qaOpen,
  onOpenQA,
  onOpenPDF,
}: {
  domain: AdminDomainItem;
  qaOpen: boolean;
  onOpenQA: () => void;
  onOpenPDF: () => void;
}) {
  return (
    <tr style={{
      borderBottom: '1px solid var(--border)',
      background: qaOpen ? 'color-mix(in oklab, var(--primary) 4%, transparent)' : undefined,
      transition: 'background .12s',
    }}>
      <td style={{ padding: '11px 16px', fontSize: 12.5, color: 'var(--text-muted)' }}>
        {domain.user_email}
      </td>
      <td style={{ padding: '11px 16px', fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>
        {domain.domain_name}
      </td>
      <td style={{ padding: '11px 16px' }}>
        <StatusBadge status={domain.status} />
      </td>
      <td style={{ padding: '11px 16px', fontSize: 12.5, fontFamily: 'var(--mono)',
        color: 'var(--text-muted)', textAlign: 'right' }}>
        {domain.row_count != null ? domain.row_count.toLocaleString() : '—'}
      </td>
      <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
        {fmtDate(domain.created_at)}
      </td>
      <td style={{ padding: '11px 16px' }}>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          {domain.has_dataset && (
            <button
              onClick={onOpenQA}
              style={{
                padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 7,
                border: `1px solid ${qaOpen ? '#06b6d4' : 'var(--border)'}`,
                background: qaOpen
                  ? 'color-mix(in oklab, #06b6d4 12%, transparent)'
                  : 'var(--surface-2)',
                color: qaOpen ? '#06b6d4' : 'var(--text-muted)',
                cursor: 'pointer', transition: 'all .12s',
              }}
            >
              {qaOpen ? 'Hide QA' : 'View QA'}
            </button>
          )}
          {domain.has_pdf && (
            <button
              onClick={onOpenPDF}
              style={{
                padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 7,
                border: '1px solid var(--border)', background: 'var(--surface-2)',
                color: 'var(--text-muted)', cursor: 'pointer',
              }}
            >
              View PDF
            </button>
          )}
          {!domain.has_pdf && !domain.has_dataset && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', padding: '5px 0' }}>
              No files
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function AgentDomainFiles() {
  const [page, setPage] = useState(1);
  const [openQAId, setOpenQAId] = useState<string | null>(null);
  const [pdfDomain, setPdfDomain] = useState<AdminDomainItem | null>(null);

  const { data, isLoading, isError } = useQuery<AdminDomainList>({
    queryKey: ['admin', 'domain-prompts', page],
    queryFn: async () => {
      const res = await api.get<{ data: AdminDomainList }>(
        `/api/v1/admin/domain-prompts?page=${page}&per_page=${PER_PAGE}`
      );
      return res.data.data;
    },
    staleTime: 2 * 60 * 1000,
  });

  const totalPages = data ? Math.ceil(data.total / PER_PAGE) : 1;
  const qaOpenDomain = data?.domains.find(d => d.domain_id === openQAId) ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, height: '100%' }}>
      {/* Summary strip */}
      {data && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 16,
        }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {data.total} domain project{data.total !== 1 ? 's' : ''} from users with data sharing enabled
          </span>
        </div>
      )}

      {/* Main content: table + optional QA panel side-by-side */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 0, overflow: 'hidden' }}>
        {/* Table container */}
        <div style={{
          flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
          border: '1px solid var(--border)', borderRadius: qaOpenDomain ? '12px 0 0 12px' : 12,
          overflow: 'hidden', background: 'var(--surface)',
        }}>
          {isLoading && (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Loading…
            </div>
          )}
          {isError && (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--danger)', fontSize: 13 }}>
              Failed to load domain files.
            </div>
          )}

          {data && data.domains.length === 0 && (
            <div style={{
              padding: '56px 24px', textAlign: 'center',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
            }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
                stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)' }}>
                No shared domain files yet
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 320 }}>
                Files appear here once a user enables data sharing in their account settings and uploads a PDF.
              </div>
            </div>
          )}

          {data && data.domains.length > 0 && (
            <>
              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                    <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                      {[
                        { label: 'User',    align: 'left'  },
                        { label: 'Domain',  align: 'left'  },
                        { label: 'Status',  align: 'left'  },
                        { label: 'QA Rows', align: 'right' },
                        { label: 'Created', align: 'left'  },
                        { label: '',        align: 'right' },
                      ].map((h, i) => (
                        <th key={i} style={{
                          padding: '9px 16px',
                          fontSize: 10.5, fontWeight: 700,
                          color: 'var(--text-subtle)',
                          textTransform: 'uppercase', letterSpacing: '.07em',
                          textAlign: h.align as 'left' | 'right',
                        }}>
                          {h.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.domains.map(domain => (
                      <DomainRow
                        key={domain.domain_id}
                        domain={domain}
                        qaOpen={openQAId === domain.domain_id}
                        onOpenQA={() =>
                          setOpenQAId(prev => prev === domain.domain_id ? null : domain.domain_id)
                        }
                        onOpenPDF={() => setPdfDomain(domain)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 16px', borderTop: '1px solid var(--border)',
                  background: 'var(--surface-2)', flexShrink: 0,
                }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {data.total} domain{data.total !== 1 ? 's' : ''} · page {page} of {totalPages}
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      style={{
                        padding: '4px 12px', fontSize: 12, borderRadius: 6,
                        border: '1px solid var(--border)', background: 'var(--surface)',
                        color: page === 1 ? 'var(--text-muted)' : 'var(--text)',
                        cursor: page === 1 ? 'default' : 'pointer',
                        opacity: page === 1 ? 0.5 : 1,
                      }}
                    >
                      ← Prev
                    </button>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      style={{
                        padding: '4px 12px', fontSize: 12, borderRadius: 6,
                        border: '1px solid var(--border)', background: 'var(--surface)',
                        color: page === totalPages ? 'var(--text-muted)' : 'var(--text)',
                        cursor: page === totalPages ? 'default' : 'pointer',
                        opacity: page === totalPages ? 0.5 : 1,
                      }}
                    >
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* QA side panel — slides in from the right */}
        {qaOpenDomain && (
          <QAPanel
            domain={qaOpenDomain}
            onClose={() => setOpenQAId(null)}
          />
        )}
      </div>

      {/* PDF modal — full-screen overlay */}
      {pdfDomain && (
        <PdfModal
          domain={pdfDomain}
          onClose={() => setPdfDomain(null)}
        />
      )}
    </div>
  );
}
