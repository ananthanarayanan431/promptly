'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { CreateDomainJobResponse } from '@/types/domain-prompts';

interface Props {
  onClose: () => void;
  onJobStarted: (jobId: string, domainId: string) => void;
}

export function NewDomainModal({ onClose, onJobStarted }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setError('Please upload a PDF file.'); return; }
    if (!name.trim()) { setError('Domain name is required.'); return; }
    if (file.size > 100 * 1024 * 1024) { setError('PDF must be 100 MB or smaller.'); return; }

    setError(null);
    setSubmitting(true);

    try {
      const form = new FormData();
      form.append('name', name.trim());
      form.append('file', file);
      if (description.trim()) form.append('description', description.trim());

      const res = await api.post<{ data: CreateDomainJobResponse }>(
        '/api/v1/domain-prompts/',
        form,
      );
      onJobStarted(res.data.data.job_id, res.data.data.domain_id);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail ?? 'Failed to create domain. Please try again.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 7,
    border: '1px solid var(--border)', background: 'var(--surface-2)',
    color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 500,
  };

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
          background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14,
          padding: 28, width: '100%', maxWidth: 540,
          fontFamily: 'var(--font-geist, ui-sans-serif)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)', flex: 1 }}>
            New Domain Prompt
          </h2>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
            background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
            color: '#fff', marginRight: 12,
          }}>PREMIUM · 10 credits</span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 18,
          }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Domain Name *</label>
            <input
              style={inputStyle} value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Nutrition, Legal, Medical"
              required
            />
          </div>

          <div>
            <label style={labelStyle}>Description</label>
            <input
              style={inputStyle} value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief description of this domain"
            />
          </div>

          <div>
            <label style={labelStyle}>Source PDF *</label>
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}
              style={{
                border: '1.5px dashed var(--border)', borderRadius: 8, padding: '20px 16px',
                textAlign: 'center', cursor: 'pointer', color: 'var(--text-subtle)', fontSize: 13,
                transition: 'border-color 150ms',
              }}
              onMouseEnter={e => ((e.currentTarget as HTMLDivElement).style.borderColor = 'var(--primary)')}
              onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)')}
            >
              {file
                ? <span style={{ color: 'var(--primary)' }}>{file.name}</span>
                : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: 6, display: 'block', margin: '0 auto 6px' }}>
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <div>Click to upload PDF</div>
                    <div style={{ fontSize: 11, marginTop: 4 }}>Dataset will be generated from this file</div>
                  </>
                )
              }
            </div>
            <input
              ref={fileRef} type="file" accept=".pdf"
              style={{ display: 'none' }}
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {error && (
            <p style={{ margin: 0, fontSize: 12.5, color: '#f43f5e' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: '10px 0', borderRadius: 8, border: 'none',
              background: submitting ? 'var(--surface-3)' : 'var(--primary)',
              color: submitting ? 'var(--text-subtle)' : '#fff',
              fontWeight: 600, fontSize: 14, cursor: submitting ? 'not-allowed' : 'pointer',
              transition: 'background 150ms',
            }}
          >
            {submitting ? 'Creating…' : 'Create Domain Prompt'}
          </button>
        </form>
      </div>
    </div>
  );
}
