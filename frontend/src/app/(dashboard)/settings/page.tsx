'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { listApiKeys, createApiKey, revokeApiKey } from '@/lib/api-keys';
import type { ApiKeyStatus } from '@/lib/api-keys';
import type { ApiKey, ApiKeyCreated } from '@/types/api';

const PAGE_SIZE = 10;

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy}
      style={{ height: 28, padding: '0 10px', borderRadius: 6, border: '1px solid #2a2a2e',
        background: 'transparent', fontSize: 12, color: copied ? '#4ade80' : '#8a8a90',
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      {copied ? (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

function NewKeyBanner({ created, onDismiss }: { created: ApiKeyCreated; onDismiss: () => void }) {
  return (
    <div style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.25)',
      borderRadius: 10, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#4ade80' }}>
            Key created — copy it now, it won&apos;t be shown again
          </span>
        </div>
        <button onClick={onDismiss}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#5a5a60', padding: 2 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <code style={{ flex: 1, fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12.5,
          background: '#111115', border: '1px solid #2a2a2e', borderRadius: 6, padding: '8px 12px',
          color: '#ededed', overflowX: 'auto', whiteSpace: 'nowrap' }}>
          {created.key}
        </code>
        <CopyButton value={created.key} />
      </div>
    </div>
  );
}

function ApiKeyRow({ apiKey, onRevoke }: { apiKey: ApiKey; onRevoke: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px',
      borderBottom: '1px solid #1f1f23' }}>
      {/* Status dot */}
      <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: apiKey.is_active ? '#4ade80' : '#5a5a60' }} />

      {/* Name + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: apiKey.is_active ? '#ededed' : '#5a5a60',
          marginBottom: 3 }}>
          {apiKey.name}
        </div>
        <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11, color: '#5a5a60' }}>
          {apiKey.is_active
            ? `Created ${formatDistanceToNow(new Date(apiKey.created_at), { addSuffix: true })}`
            : `Revoked ${apiKey.revoked_at
                ? formatDistanceToNow(new Date(apiKey.revoked_at), { addSuffix: true })
                : ''}`}
        </div>
      </div>

      {/* Status badge */}
      <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
        padding: '3px 8px', borderRadius: 4,
        background: apiKey.is_active ? 'rgba(74,222,128,0.1)' : 'rgba(90,90,96,0.15)',
        color: apiKey.is_active ? '#4ade80' : '#5a5a60',
        border: `1px solid ${apiKey.is_active ? 'rgba(74,222,128,0.2)' : '#2a2a2e'}` }}>
        {apiKey.is_active ? 'active' : 'revoked'}
      </span>

      {/* Revoke */}
      {apiKey.is_active && (
        confirming ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#8a8a90' }}>Revoke?</span>
            <button onClick={() => { onRevoke(apiKey.id); setConfirming(false); }}
              style={{ height: 26, padding: '0 10px', borderRadius: 5,
                background: 'rgba(255,107,122,0.12)', border: '1px solid rgba(255,107,122,0.3)',
                color: '#ff6b7a', fontSize: 12, cursor: 'pointer' }}>
              Yes
            </button>
            <button onClick={() => setConfirming(false)}
              style={{ height: 26, padding: '0 10px', borderRadius: 5,
                background: 'transparent', border: '1px solid #2a2a2e',
                color: '#8a8a90', fontSize: 12, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirming(true)}
            style={{ height: 28, padding: '0 12px', borderRadius: 6, border: '1px solid #2a2a2e',
              background: 'transparent', fontSize: 12, color: '#8a8a90', cursor: 'pointer' }}>
            Revoke
          </button>
        )
      )}
    </div>
  );
}

function CreateKeyForm({ onCreated }: { onCreated: (key: ApiKeyCreated) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: createApiKey,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      onCreated(created);
      setName('');
      setError('');
    },
    onError: (err: { response?: { data?: { detail?: string }; status?: number } }) => {
      const status = err.response?.status;
      if (status === 409) {
        setError('An active key with that name already exists.');
      } else {
        setError('Failed to create key. Try again.');
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError('Name is required.'); return; }
    if (trimmed.length > 100) { setError('Name must be 100 characters or fewer.'); return; }
    setError('');
    mutate(trimmed);
  };

  return (
    <form onSubmit={handleSubmit}
      style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <div style={{ flex: 1 }}>
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setError(''); }}
          placeholder='e.g. "production" or "ci-pipeline"'
          disabled={isPending}
          style={{ width: '100%', height: 36, padding: '0 12px', borderRadius: 7,
            background: '#111115', border: `1px solid ${error ? 'rgba(255,107,122,0.4)' : '#2a2a2e'}`,
            color: '#ededed', fontSize: 13, outline: 'none', boxSizing: 'border-box',
            fontFamily: 'var(--font-geist, ui-sans-serif)' }}
        />
        {error && (
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
            color: '#ff6b7a', marginTop: 5 }}>
            {error}
          </div>
        )}
      </div>
      <button type="submit" disabled={isPending || !name.trim()}
        style={{ height: 36, padding: '0 16px', borderRadius: 7, flexShrink: 0,
          background: isPending || !name.trim() ? '#2a2a2e' : '#7c5cff',
          border: 'none', color: isPending || !name.trim() ? '#5a5a60' : '#fff',
          fontSize: 13, fontWeight: 500, cursor: isPending || !name.trim() ? 'not-allowed' : 'pointer' }}>
        {isPending ? 'Creating…' : 'Create key'}
      </button>
    </form>
  );
}

export default function SettingsPage() {
  const [newKey, setNewKey] = useState<ApiKeyCreated | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ApiKeyStatus>('all');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['api-keys', page, status],
    queryFn: () => listApiKeys(page, PAGE_SIZE, status),
  });

  const keys = data?.keys ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 0;

  const { mutate: revoke } = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  const handleStatusChange = (next: ApiKeyStatus) => {
    setStatus(next);
    setPage(1);
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '28px 40px 80px',
      fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 36 }}>

        {/* Header */}
        <div>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
            color: '#7c5cff', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>
            / settings
          </div>
          <h1 style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontWeight: 400,
            fontSize: 36, letterSpacing: '-0.02em', lineHeight: 1.15, margin: '0 0 6px', color: '#ededed' }}>
            API Keys
          </h1>
          <p style={{ fontSize: 13.5, color: '#8a8a90', margin: 0, lineHeight: 1.6 }}>
            Create named keys to authenticate SDK and script access. Each key is shown once — store it securely.
          </p>
        </div>

        {/* New key banner */}
        {newKey && (
          <NewKeyBanner created={newKey} onDismiss={() => setNewKey(null)} />
        )}

        {/* Create form */}
        <div style={{ background: '#1a1a1a', border: '1px solid #1f1f23', borderRadius: 10, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#ededed', marginBottom: 4 }}>
            Create a new key
          </div>
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
            color: '#5a5a60', marginBottom: 14 }}>
            Give it a descriptive name so you can tell keys apart later.
          </div>
          <CreateKeyForm onCreated={setNewKey} />
        </div>

        {/* Keys list */}
        <div style={{ background: '#1a1a1a', border: '1px solid #1f1f23', borderRadius: 10, overflow: 'hidden' }}>

          {/* List header: title + total + status filter */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #1f1f23',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#ededed' }}>Keys</div>
              <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
                color: '#5a5a60' }}>{total}</span>
            </div>
            <select
              value={status}
              onChange={(e) => handleStatusChange(e.target.value as ApiKeyStatus)}
              style={{ height: 28, padding: '0 8px', borderRadius: 6, border: '1px solid #2a2a2e',
                background: '#111115', color: '#8a8a90', fontSize: 12, cursor: 'pointer', outline: 'none' }}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="revoked">Revoked</option>
            </select>
          </div>

          {/* Rows */}
          {isLoading ? (
            <div style={{ padding: '28px 20px', textAlign: 'center',
              fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12, color: '#5a5a60' }}>
              Loading…
            </div>
          ) : keys.length === 0 ? (
            <div style={{ padding: '28px 20px', textAlign: 'center',
              fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12, color: '#5a5a60' }}>
              {status === 'active' ? 'No active keys — create one above.'
                : status === 'revoked' ? 'No revoked keys.'
                : 'No keys yet — create one above.'}
            </div>
          ) : (
            keys.map((k) => (
              <ApiKeyRow key={k.id} apiKey={k} onRevoke={revoke} />
            ))
          )}

          {/* Pagination footer */}
          {totalPages > 1 && (
            <div style={{ padding: '12px 20px', borderTop: '1px solid #1f1f23',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11, color: '#5a5a60' }}>
                Page {page} of {totalPages}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 1}
                  style={{ height: 28, padding: '0 12px', borderRadius: 6, border: '1px solid #2a2a2e',
                    background: 'transparent', fontSize: 12,
                    color: page === 1 ? '#3a3a3e' : '#8a8a90',
                    cursor: page === 1 ? 'not-allowed' : 'pointer' }}>
                  Prev
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page === totalPages}
                  style={{ height: 28, padding: '0 12px', borderRadius: 6, border: '1px solid #2a2a2e',
                    background: 'transparent', fontSize: 12,
                    color: page === totalPages ? '#3a3a3e' : '#8a8a90',
                    cursor: page === totalPages ? 'not-allowed' : 'pointer' }}>
                  Next
                </button>
              </div>
            </div>
          )}

        </div>

      </div>
    </div>
  );
}
