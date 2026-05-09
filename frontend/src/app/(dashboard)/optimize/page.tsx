import { Suspense } from 'react';
import { OptimizeChat } from '@/components/optimize/optimize-chat';
import { PageHeader } from '@/components/layout/page-header';

export default function OptimizePage() {
  return (
    <>
      <PageHeader
        title="Optimize"
        subtitle="Paste a prompt. Get a sharper, better-structured one back."
      />
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <Suspense fallback={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <div className="ply-dot ply-dot-pulse" style={{ width: 8, height: 8, background: 'var(--primary)' }} />
          </div>
        }>
          <OptimizeChat />
        </Suspense>
      </div>
    </>
  );
}
