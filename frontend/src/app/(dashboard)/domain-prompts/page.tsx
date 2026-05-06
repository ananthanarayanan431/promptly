'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DomainListResponse, DomainPrompt } from '@/types/domain-prompts';
import { DomainCard } from '@/components/domain-prompts/domain-card';
import { NewDomainModal } from '@/components/domain-prompts/new-domain-modal';
import { DomainDetail } from '@/components/domain-prompts/domain-detail';

export default function DomainPromptsPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<DomainPrompt | null>(null);
  const [pollingJobId, setPollingJobId] = useState<string | null>(null);
  const [reoptimizing, setReoptimizing] = useState(false);

  const { data, isLoading } = useQuery<DomainListResponse>({
    queryKey: ['domain-prompts'],
    queryFn: async () => {
      const res = await api.get<{ data: DomainListResponse }>('/api/v1/domain-prompts/');
      return res.data.data;
    },
    refetchInterval: pollingJobId ? 3000 : false,
  });

  useEffect(() => {
    if (!pollingJobId) return;
    const interval = setInterval(async () => {
      try {
        const res = await api.get<{ data: { status: string } }>(
          `/api/v1/domain-prompts/jobs/${pollingJobId}`
        );
        const { status } = res.data.data;
        if (status === 'completed' || status === 'failed') {
          setPollingJobId(null);
          void qc.invalidateQueries({ queryKey: ['domain-prompts'] });
        }
      } catch {
        setPollingJobId(null);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [pollingJobId, qc]);

  const reoptimizeMutation = useMutation({
    mutationFn: async (domainId: string) => {
      const res = await api.post<{ data: { job_id: string } }>(
        `/api/v1/domain-prompts/${domainId}/optimize`
      );
      return res.data.data.job_id;
    },
    onSuccess: (jobId) => {
      setPollingJobId(jobId);
      setReoptimizing(false);
      setSelected(null);
      void qc.invalidateQueries({ queryKey: ['domain-prompts'] });
    },
    onError: () => setReoptimizing(false),
  });

  const handleJobStarted = useCallback((jobId: string, _domainId: string) => {
    setShowNew(false);
    setPollingJobId(jobId);
    void qc.invalidateQueries({ queryKey: ['domain-prompts'] });
  }, [qc]);

  const handleReoptimize = useCallback(() => {
    if (!selected) return;
    setReoptimizing(true);
    reoptimizeMutation.mutate(selected.id);
  }, [selected, reoptimizeMutation]);

  const latestSelected = selected
    ? (data?.domains.find(d => d.id === selected.id) ?? selected)
    : null;

  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: '32px 40px',
      fontFamily: 'var(--font-geist, ui-sans-serif)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 28 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#ededed' }}>
              Domain Prompts
            </h1>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
              background: 'linear-gradient(135deg, #f59e0b, #ef4444)', color: '#fff',
            }}>PREMIUM</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: '#8a8a90' }}>
            Upload a PDF to generate a domain-specific dataset and optimize a system prompt for your use case.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px',
            borderRadius: 8, border: 'none', background: '#7c5cff',
            color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Domain
        </button>
      </div>

      {pollingJobId && (
        <div style={{
          marginBottom: 20, padding: '12px 16px',
          background: 'rgba(124,92,255,0.08)', border: '1px solid rgba(124,92,255,0.2)',
          borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: '#7c5cff', flexShrink: 0,
            animation: 'dpPagePulse 1.4s ease-in-out infinite', display: 'inline-block',
          }} />
          <span style={{ fontSize: 13, color: '#a78bfa' }}>
            Domain optimization in progress… this may take a few minutes.
          </span>
        </div>
      )}

      {isLoading ? (
        <div style={{ color: '#5a5a60', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
          Loading domains…
        </div>
      ) : !data?.domains.length ? (
        <div style={{ textAlign: 'center', paddingTop: 80, color: '#5a5a60' }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1"
            style={{ marginBottom: 12, opacity: 0.4, display: 'block', margin: '0 auto 12px' }}>
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <div style={{ fontSize: 14, marginBottom: 6 }}>No domain prompts yet</div>
          <div style={{ fontSize: 12.5 }}>
            Upload a PDF to create your first domain-specific prompt.
          </div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 14,
        }}>
          {data.domains.map(domain => (
            <DomainCard
              key={domain.id}
              domain={domain}
              onClick={() => setSelected(domain)}
            />
          ))}
        </div>
      )}

      {showNew && (
        <NewDomainModal
          onClose={() => setShowNew(false)}
          onJobStarted={handleJobStarted}
        />
      )}
      {latestSelected && (
        <DomainDetail
          domain={latestSelected}
          onClose={() => setSelected(null)}
          onReoptimize={handleReoptimize}
          reoptimizing={reoptimizing}
        />
      )}

      <style>{`
        @keyframes dpPagePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
