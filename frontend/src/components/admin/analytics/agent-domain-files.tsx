'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AdminDomainItem, AdminDomainList, AdminDomainQAResponse } from '@/types/api';

const PER_PAGE = 20;
const QA_PANEL_WIDTH = 420;

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

function PdfModal({ domain, onClose }: { domain: AdminDomainItem; onClose: () => void }) {
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
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    };
  }, [domain.domain_id]);

  const handleDownload = () => {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${domain.domain_name}.pdf`;
    a.click();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onKeyDown={e => e.key === 'Escape' && onClose()}
      tabIndex={-1}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', background: 'var(--surface)',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              {domain.domain_name}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 1 }}>
              {domain.user_email}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {blobUrl && (
            <button onClick={handleDownload} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', fontSize: 12.5, fontWeight: 600, borderRadius: 7,
              border: '1px solid var(--border)', background: 'var(--surface-2)',
              color: 'var(--text)', cursor: 'pointer',
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download
            </button>
          )}
          <button onClick={onClose} aria-label="Close" style={{
            width: 32, height: 32, borderRadius: 7, border: '1px solid var(--border)',
            background: 'var(--surface-2)', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 18, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}>×</button>
        </div>
      </div>
      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: 'rgba(255,255,255,.6)', fontSize: 14 }}>
            Loading PDF…
          </div>
        )}
        {error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 6 }}>
            <span style={{ color: '#f43f5e', fontSize: 14, fontWeight: 600 }}>Failed to load PDF</span>
            <span style={{ color: 'rgba(255,255,255,.45)', fontSize: 12.5 }}>
              Check that MinIO is reachable and the file exists.
            </span>
          </div>
        )}
        {blobUrl && (
          <iframe src={blobUrl} title={`PDF: ${domain.domain_name}`}
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }} />
        )}
      </div>
    </div>
  );
}

// ── QA overlay panel ──────────────────────────────────────────────────────────

function QAPanel({ domain, onClose }: { domain: AdminDomainItem; onClose: () => void }) {
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
    /* Dim backdrop — clicking it closes the panel */
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 10,
        background: 'rgba(0,0,0,.08)',
      }}
    >
      {/* Panel — stop click propagation so clicks inside don't close it */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0,
          width: QA_PANEL_WIDTH,
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '-6px 0 24px rgba(0,0,0,.10)',
          display: 'flex', flexDirection: 'column',
          borderRadius: '0 12px 12px 0',
          overflow: 'hidden',
        }}
      >
        {/* Panel header */}
        <div style={{
          padding: '14px 16px 12px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          background: 'var(--surface)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {domain.domain_name}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                {domain.user_email}
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" style={{
              flexShrink: 0, marginLeft: 8, width: 28, height: 28, borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--surface-2)',
              color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>×</button>
          </div>

          {data && (
            <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700,
              color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {data.row_count} Q&A pair{data.row_count !== 1 ? 's' : ''}
            </div>
          )}

          {data && data.row_count > 5 && (
            <div style={{ marginTop: 8, position: 'relative' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round"
                style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)' }}>
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                type="text"
                placeholder="Search…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  width: '100%', padding: '6px 10px 6px 28px', fontSize: 12.5,
                  border: '1px solid var(--border)', borderRadius: 6,
                  background: 'var(--surface-2)', color: 'var(--text)',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
          )}
        </div>

        {/* Pairs list — block layout so cards grow to their natural height */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '10px 12px' }}>
          {isLoading && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', paddingTop: 24 }}>
              Loading…
            </div>
          )}
          {isError && (
            <div style={{ color: 'var(--danger)', fontSize: 13, textAlign: 'center', paddingTop: 24 }}>
              Failed to load Q&A pairs.
            </div>
          )}
          {data && data.rows.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', paddingTop: 24 }}>
              No Q&A pairs yet.
            </div>
          )}
          {search && filtered.length === 0 && data && data.rows.length > 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12.5, textAlign: 'center', paddingTop: 16 }}>
              No results for &ldquo;{search}&rdquo;
            </div>
          )}
          {filtered.map((row, i) => (
            <div key={i} style={{
              marginBottom: 8, border: '1px solid var(--border)',
              borderRadius: 9, overflow: 'hidden',
            }}>
              {/* Question */}
              <div style={{
                padding: '10px 12px',
                borderBottom: '1px solid var(--border)',
                background: 'rgba(6,182,212,0.06)',
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: '#06b6d4',
                  textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4,
                }}>
                  Q {i + 1}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
                  {row.question}
                </div>
              </div>
              {/* Answer */}
              <div style={{ padding: '10px 12px', background: 'var(--surface)' }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: '#8b5cf6',
                  textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4,
                }}>
                  A
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  {row.answer}
                </div>
              </div>
            </div>
          ))}
          {/* bottom breathing room */}
          {filtered.length > 0 && <div style={{ height: 8 }} />}
        </div>
      </div>
    </div>
  );
}

// ── Table row ─────────────────────────────────────────────────────────────────

function DomainRow({
  domain, qaOpen, onOpenQA, onOpenPDF,
}: {
  domain: AdminDomainItem;
  qaOpen: boolean;
  onOpenQA: () => void;
  onOpenPDF: () => void;
}) {
  return (
    <tr style={{
      borderBottom: '1px solid var(--border)',
      background: qaOpen
        ? 'color-mix(in oklab, var(--primary) 5%, transparent)'
        : undefined,
    }}>
      <td style={{ padding: '12px 16px', fontSize: 12.5, color: 'var(--text-muted)',
        maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {domain.user_email}
      </td>
      <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text)',
        fontWeight: 600, whiteSpace: 'nowrap' }}>
        {domain.domain_name}
      </td>
      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
        <StatusBadge status={domain.status} />
      </td>
      <td style={{ padding: '12px 16px', fontSize: 12.5, fontFamily: 'var(--mono)',
        color: 'var(--text-muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {domain.row_count != null ? domain.row_count.toLocaleString() : '—'}
      </td>
      <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)',
        whiteSpace: 'nowrap' }}>
        {fmtDate(domain.created_at)}
      </td>
      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
          {domain.has_dataset && (
            <button onClick={onOpenQA} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 11px', fontSize: 12, fontWeight: 600, borderRadius: 6,
              border: `1px solid ${qaOpen ? '#06b6d4' : 'var(--border)'}`,
              background: qaOpen
                ? 'color-mix(in oklab, #06b6d4 10%, transparent)'
                : 'var(--surface-2)',
              color: qaOpen ? '#06b6d4' : 'var(--text-muted)',
              cursor: 'pointer', transition: 'all .12s',
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 16v-4M12 8h.01"/>
              </svg>
              QA Pairs
            </button>
          )}
          {domain.has_pdf && (
            <button onClick={onOpenPDF} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 11px', fontSize: 12, fontWeight: 600, borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--surface-2)',
              color: 'var(--text-muted)', cursor: 'pointer', transition: 'all .12s',
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              View PDF
            </button>
          )}
          {!domain.has_pdf && !domain.has_dataset && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 14 }}>
      {/* Count strip */}
      {data && data.total > 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0 }}>
          {data.total} domain project{data.total !== 1 ? 's' : ''} · users with data sharing enabled
        </div>
      )}

      {/* Table card — always full width; QA panel overlays on top */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div style={{
          height: '100%', display: 'flex', flexDirection: 'column',
          border: '1px solid var(--border)', borderRadius: 12,
          overflow: 'hidden', background: 'var(--surface)',
        }}>
          {isLoading && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Loading…
            </div>
          )}
          {isError && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: 'var(--danger)', fontSize: 13 }}>
              Failed to load domain files.
            </div>
          )}

          {data && data.domains.length === 0 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
                stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)' }}>
                No shared domain files yet
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6,
                maxWidth: 300, textAlign: 'center' }}>
                Files appear here once a user enables data sharing and uploads a PDF.
              </div>
            </div>
          )}

          {data && data.domains.length > 0 && (
            <>
              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                    <tr style={{ background: 'var(--surface-2)',
                      borderBottom: '1px solid var(--border)' }}>
                      {[
                        { label: 'User',    align: 'left' as const  },
                        { label: 'Domain',  align: 'left' as const  },
                        { label: 'Status',  align: 'left' as const  },
                        { label: 'QA Rows', align: 'right' as const },
                        { label: 'Created', align: 'left' as const  },
                        { label: '',        align: 'right' as const },
                      ].map((h, i) => (
                        <th key={i} style={{
                          padding: '9px 16px', fontSize: 10.5, fontWeight: 700,
                          color: 'var(--text-subtle)', textTransform: 'uppercase',
                          letterSpacing: '.07em', textAlign: h.align,
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
                          setOpenQAId(prev =>
                            prev === domain.domain_id ? null : domain.domain_id
                          )
                        }
                        onOpenPDF={() => setPdfDomain(domain)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '9px 16px', borderTop: '1px solid var(--border)',
                  background: 'var(--surface-2)', flexShrink: 0,
                }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Page {page} of {totalPages} · {data.total} total
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[
                      { label: '← Prev', disabled: page === 1, action: () => setPage(p => p - 1) },
                      { label: 'Next →', disabled: page === totalPages, action: () => setPage(p => p + 1) },
                    ].map(btn => (
                      <button key={btn.label} onClick={btn.action} disabled={btn.disabled} style={{
                        padding: '4px 12px', fontSize: 12, borderRadius: 6,
                        border: '1px solid var(--border)', background: 'var(--surface)',
                        color: btn.disabled ? 'var(--text-muted)' : 'var(--text)',
                        cursor: btn.disabled ? 'default' : 'pointer',
                        opacity: btn.disabled ? 0.45 : 1,
                      }}>
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* QA panel — absolute overlay, does NOT squish the table */}
        {qaOpenDomain && (
          <QAPanel
            domain={qaOpenDomain}
            onClose={() => setOpenQAId(null)}
          />
        )}
      </div>

      {/* PDF modal — full-screen */}
      {pdfDomain && (
        <PdfModal domain={pdfDomain} onClose={() => setPdfDomain(null)} />
      )}
    </div>
  );
}
