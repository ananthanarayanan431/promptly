'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { listApiKeys, createApiKey, revokeApiKey } from '@/lib/api-keys';
import type { ApiKeyStatus } from '@/lib/api-keys';
import type { ApiKey, ApiKeyCreated } from '@/types/api';
import { PageHeader } from '@/components/layout/page-header';

const PAGE_SIZE = 10;

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className="ply-btn"
      style={{ color: copied ? 'var(--success)' : undefined }}>
      {copied ? (
        <>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
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
    <div className="ply-card" style={{ padding: '16px 18px', borderColor: 'var(--success)',
      background: 'var(--success-soft)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--success)' }}>
            Key created — copy it now, it won&apos;t be shown again
          </span>
        </div>
        <button onClick={onDismiss} style={{ background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text-subtle)', padding: 2 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <code style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 12.5,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
          padding: '8px 12px', color: 'var(--text)', overflowX: 'auto', whiteSpace: 'nowrap' }}>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px',
      borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: apiKey.is_active ? 'var(--success)' : 'var(--text-subtle)' }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: apiKey.is_active ? 'var(--text)' : 'var(--text-subtle)',
          marginBottom: 2 }}>
          {apiKey.name}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>
          {apiKey.is_active
            ? `Created ${formatDistanceToNow(new Date(apiKey.created_at), { addSuffix: true })}`
            : `Revoked ${apiKey.revoked_at
                ? formatDistanceToNow(new Date(apiKey.revoked_at), { addSuffix: true })
                : ''}`}
        </div>
      </div>

      <span className="ply-pill" style={{
        color: apiKey.is_active ? 'var(--success)' : 'var(--text-subtle)',
      }}>
        {apiKey.is_active ? 'active' : 'revoked'}
      </span>

      {apiKey.is_active && (
        confirming ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Revoke?</span>
            <button onClick={() => { onRevoke(apiKey.id); setConfirming(false); }}
              className="ply-btn" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>
              Yes
            </button>
            <button onClick={() => setConfirming(false)} className="ply-btn">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setConfirming(true)} className="ply-btn">Revoke</button>
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
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <div style={{ flex: 1 }}>
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setError(''); }}
          placeholder='e.g. "production" or "ci-pipeline"'
          disabled={isPending}
          style={{ width: '100%', height: 36, padding: '0 12px', borderRadius: 7,
            background: 'var(--surface-2)', border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
            color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
        />
        {error && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--danger)', marginTop: 5 }}>
            {error}
          </div>
        )}
      </div>
      <button type="submit" disabled={isPending || !name.trim()} className="ply-btn ply-btn-primary"
        style={{ height: 36, opacity: isPending || !name.trim() ? 0.5 : 1,
          cursor: isPending || !name.trim() ? 'not-allowed' : 'pointer' }}>
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
    <>
      <PageHeader
        title="Settings"
        subtitle="Create named API keys for SDK and script access. Each key is shown once — store it securely."
      />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 28px 80px' }}>
        <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {newKey && <NewKeyBanner created={newKey} onDismiss={() => setNewKey(null)} />}

          {/* Create form */}
          <div className="ply-card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 3 }}>
                Create a new key
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>
                Give it a descriptive name so you can tell keys apart later.
              </div>
            </div>
            <CreateKeyForm onCreated={setNewKey} />
          </div>

          {/* Keys list */}
          <div className="ply-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Keys</div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>
                  {total}
                </span>
              </div>
              <select
                value={status}
                onChange={(e) => handleStatusChange(e.target.value as ApiKeyStatus)}
                style={{ height: 28, padding: '0 8px', borderRadius: 6, border: '1px solid var(--border)',
                  background: 'var(--surface-2)', color: 'var(--text-muted)', fontSize: 12,
                  cursor: 'pointer', outline: 'none' }}>
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="revoked">Revoked</option>
              </select>
            </div>

            {isLoading ? (
              <div style={{ padding: '28px 18px', textAlign: 'center',
                fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-subtle)' }}>
                Loading…
              </div>
            ) : keys.length === 0 ? (
              <div style={{ padding: '28px 18px', textAlign: 'center',
                fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-subtle)' }}>
                {status === 'active' ? 'No active keys — create one above.'
                  : status === 'revoked' ? 'No revoked keys.'
                  : 'No keys yet — create one above.'}
              </div>
            ) : (
              keys.map((k) => <ApiKeyRow key={k.id} apiKey={k} onRevoke={revoke} />)
            )}

            {totalPages > 1 && (
              <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>
                  Page {page} of {totalPages}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setPage((p) => p - 1)} disabled={page === 1} className="ply-btn"
                    style={{ opacity: page === 1 ? 0.4 : 1, cursor: page === 1 ? 'not-allowed' : 'pointer' }}>
                    Prev
                  </button>
                  <button onClick={() => setPage((p) => p + 1)} disabled={page === totalPages} className="ply-btn"
                    style={{ opacity: page === totalPages ? 0.4 : 1, cursor: page === totalPages ? 'not-allowed' : 'pointer' }}>
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Usage snippet */}
          <div className="ply-card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontWeight: 500, color: 'var(--text)', fontSize: 13 }}>Using your key</div>
            <pre className="ply-prompt-block" style={{ margin: 0, fontSize: 11.5 }}>{`curl https://api.promptly.ai/v1/chat/ \\
  -H "Authorization: Bearer qac_••••••••" \\
  -H "Content-Type: application/json" \\
  -d '{ "prompt": "..." }'`}</pre>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Use the key prefix <code style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>qac_</code> in{' '}
              <code style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>Authorization: Bearer</code>.
              Both JWT and API keys are accepted.
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
