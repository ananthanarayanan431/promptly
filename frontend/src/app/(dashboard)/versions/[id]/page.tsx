'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { PromptFamily, PromptVersion, PromptDiffResponse } from '@/types/api';
import { formatDistanceToNow } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

function DiffView({ diff }: { diff: PromptDiffResponse }) {
  return (
    <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 13, lineHeight: 1.8 }}>
      {/* Stats bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16,
        padding: '8px 12px', borderRadius: 8, background: '#131316', border: '1px solid #1f1f23',
        fontSize: 11.5 }}>
        <span style={{ color: '#5a5a60' }}>v{diff.from_version} → v{diff.to_version}</span>
        <span style={{ color: '#22c55e' }}>+{diff.stats.added} added</span>
        <span style={{ color: '#ff6b7a' }}>−{diff.stats.removed} removed</span>
        <span style={{ color: '#5a5a60' }}>{diff.stats.equal} unchanged</span>
      </div>
      {/* Inline diff */}
      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.9 }}>
        {diff.hunks.map((hunk, i) => {
          if (hunk.type === 'equal') {
            return <span key={i} style={{ color: '#8a8a90' }}>{hunk.text}</span>;
          }
          if (hunk.type === 'insert') {
            return (
              <span key={i} style={{ background: 'rgba(34,197,94,0.15)',
                color: '#22c55e', borderRadius: 2, padding: '0 1px' }}>
                {hunk.text}
              </span>
            );
          }
          if (hunk.type === 'delete') {
            return (
              <span key={i} style={{ background: 'rgba(255,107,122,0.15)',
                color: '#ff6b7a', textDecoration: 'line-through', borderRadius: 2, padding: '0 1px' }}>
                {hunk.text}
              </span>
            );
          }
          // replace: show old (red strikethrough) then new (green)
          return (
            <span key={i}>
              <span style={{ background: 'rgba(255,107,122,0.15)', color: '#ff6b7a',
                textDecoration: 'line-through', borderRadius: 2, padding: '0 1px' }}>
                {hunk.from_text}
              </span>
              <span style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e',
                borderRadius: 2, padding: '0 1px', marginLeft: 2 }}>
                {hunk.to_text}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function VersionHistoryPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { data: family, isLoading } = useQuery({
    queryKey: ['prompt-family', params.id],
    queryFn: async () => {
      const res = await api.get<{ data: PromptFamily }>(`/api/v1/prompts/versions/${params.id}`);
      return res.data.data;
    },
  });

  const [selectedVersion, setSelectedVersion] = useState<PromptVersion | null>(null);
  const [copied, setCopied] = useState(false);
  const [diffFrom, setDiffFrom] = useState<number | null>(null);

  const sortedVersions = family ? [...family.versions].sort((a, b) => b.version - a.version) : [];

  function versionRole(v: number): { label: string; color: string } {
    if (v === 1) return { label: 'Original', color: '#5a5a60' };
    if (v === 2) return { label: 'Optimized', color: '#7c5cff' };
    return { label: `Feedback #${v - 2}`, color: '#f59e0b' };
  }

  const activeVersion = selectedVersion ?? sortedVersions[0] ?? null;

  const { data: diffData, isFetching: diffLoading } = useQuery({
    queryKey: ['prompt-diff', params.id, diffFrom, activeVersion?.version],
    queryFn: async () => {
      const res = await api.get<{ data: PromptDiffResponse }>(
        `/api/v1/prompts/versions/${params.id}/diff`,
        { params: { from: diffFrom, to: activeVersion?.version } }
      );
      return res.data.data;
    },
    enabled:
      diffFrom !== null &&
      activeVersion !== null &&
      diffFrom !== activeVersion?.version,
  });

  const handleCopy = async () => {
    if (!activeVersion) return;
    try {
      await navigator.clipboard.writeText(activeVersion.content);
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const handleOptimize = () => {
    if (!activeVersion) return;
    sessionStorage.setItem('prefill_prompt', activeVersion.content);
    sessionStorage.setItem('prefill_prompt_id', params.id);
    if (family?.name) sessionStorage.setItem('prefill_name', family.name);
    router.push('/optimize');
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: '#8a8a90', gap: 8 }}>
        <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: 13, fontFamily: 'var(--font-geist, ui-sans-serif)' }}>Loading…</span>
      </div>
    );
  }

  if (!family) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: '#8a8a90', fontSize: 13,
        fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
        Prompt family not found.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%',
      fontFamily: 'var(--font-geist, ui-sans-serif)' }}>

      {/* Header */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 24px', height: 52, borderBottom: '1px solid #1f1f23' }}>
        <Link href="/versions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, borderRadius: 6, border: '1px solid #2a2a2e',
          background: 'transparent', textDecoration: 'none', color: '#8a8a90',
          transition: 'background 120ms' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#222226')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.6"><path d="M15 6l-6 6 6 6"/></svg>
        </Link>

        {/* Family name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="#7c5cff" strokeWidth="1.6" style={{ flexShrink: 0 }}>
            <path d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9v3a3 3 0 0 1-3 3H9"/>
          </svg>
          <span style={{ fontSize: 15, fontWeight: 500, color: '#ededed',
            letterSpacing: '-0.005em', overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap' }}>{family.name}</span>
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
            padding: '2px 7px', borderRadius: 999, background: '#222226',
            border: '1px solid #2a2a2e', color: '#7c5cff', flexShrink: 0 }}>
            {family.versions.length} version{family.versions.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Split panel */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

        {/* Left: version list */}
        <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid #1f1f23',
          overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sortedVersions.map((v) => {
            const isActive = activeVersion?.version === v.version;
            const isLatest = v.version === sortedVersions[0]?.version;
            const role = versionRole(v.version);
            return (
              <button key={v.version} type="button" onClick={() => { setSelectedVersion(v); setDiffFrom(null); }}
                style={{ width: '100%', textAlign: 'left', padding: '10px 12px',
                  borderRadius: 8, border: isActive ? '1px solid rgba(124,92,255,0.35)' : '1px solid transparent',
                  background: isActive ? 'rgba(124,92,255,0.08)' : 'transparent',
                  cursor: 'pointer', transition: 'background 120ms, border-color 120ms' }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: 4 }}>
                  <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 13,
                    fontWeight: 600, color: isActive ? '#7c5cff' : '#ededed' }}>v{v.version}</span>
                  {isLatest && (
                    <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 9.5,
                      color: '#7c5cff', background: 'rgba(124,92,255,0.12)', padding: '1px 5px',
                      borderRadius: 3 }}>latest</span>
                  )}
                </div>
                <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
                  color: role.color, marginBottom: 3 }}>
                  {role.label}
                </div>
                <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
                  color: '#5a5a60' }}>
                  {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}
                </div>
              </button>
            );
          })}
        </div>

        {/* Right: content */}
        {activeVersion ? (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
            {/* Panel header */}
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', padding: '0 16px 0 24px', height: 44,
              borderBottom: '1px solid #1f1f23', background: 'rgba(255,255,255,0.01)',
              gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12,
                  fontWeight: 600, color: '#ededed' }}>v{activeVersion.version}</span>
                <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
                  padding: '1px 7px', borderRadius: 4,
                  background: `${versionRole(activeVersion.version).color}18`,
                  color: versionRole(activeVersion.version).color,
                  border: `1px solid ${versionRole(activeVersion.version).color}30` }}>
                  {versionRole(activeVersion.version).label}
                </span>
                <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
                  color: '#5a5a60' }}>
                  · {formatDistanceToNow(new Date(activeVersion.created_at), { addSuffix: true })}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                {/* Diff selector */}
                {sortedVersions.length > 1 && (
                  <>
                    <select
                      value={diffFrom ?? ''}
                      onChange={e => {
                        const v = parseInt(e.target.value, 10);
                        setDiffFrom(isNaN(v) ? null : v);
                      }}
                      style={{ height: 28, padding: '0 8px', borderRadius: 6, fontSize: 11.5,
                        border: '1px solid #2a2a2e', background: '#1a1a1a', color: '#b5b5ba',
                        cursor: 'pointer', fontFamily: 'var(--font-geist-mono, monospace)' }}>
                      <option value="">Diff from…</option>
                      {sortedVersions
                        .filter(v => v.version !== activeVersion.version)
                        .map(v => (
                          <option key={v.version} value={v.version}>v{v.version}</option>
                        ))}
                    </select>
                    {diffFrom !== null && (
                      <button type="button" onClick={() => setDiffFrom(null)}
                        style={{ height: 28, padding: '0 10px', borderRadius: 6, fontSize: 11.5,
                          border: '1px solid rgba(255,107,122,0.3)', background: 'transparent',
                          color: '#ff6b7a', cursor: 'pointer',
                          fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
                        Clear
                      </button>
                    )}
                  </>
                )}

                <button type="button" onClick={handleCopy}
                  style={{ height: 28, padding: '0 10px', borderRadius: 6,
                    border: '1px solid #2a2a2e', background: 'transparent', fontSize: 12,
                    color: copied ? '#5cffb1' : '#b5b5ba', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontFamily: 'var(--font-geist, ui-sans-serif)',
                    transition: 'color 120ms' }}>
                  {copied ? (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="1.6"><path d="M20 6L9 17l-5-5"/></svg>
                      Copied
                    </>
                  ) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="1.6">
                        <rect x="9" y="9" width="13" height="13" rx="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                      Copy
                    </>
                  )}
                </button>
                <button type="button" onClick={handleOptimize}
                  style={{ height: 28, padding: '0 12px', borderRadius: 6,
                    background: '#7c5cff', border: '1px solid #7c5cff', fontSize: 12,
                    color: '#fff', cursor: 'pointer', display: 'flex',
                    alignItems: 'center', gap: 6,
                    fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="1.6">
                    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>
                  </svg>
                  Optimize
                </button>
              </div>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
              {diffFrom !== null && diffData ? (
                <DiffView diff={diffData} />
              ) : diffFrom !== null && diffLoading ? (
                <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12,
                  color: '#5a5a60' }}>Computing diff…</div>
              ) : (
                <pre style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 13,
                  lineHeight: 1.8, color: '#ededed', whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word', margin: 0 }}>
                  {activeVersion.content}
                </pre>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center',
            color: '#8a8a90', fontSize: 13 }}>
            Select a version to view its content.
          </div>
        )}
      </div>
    </div>
  );
}
