import type { JobStatusResponse } from '@/types/api';

const ROUNDS = [
  {
    label: 'Round 1',
    desc: 'Council optimizing independently',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
      </svg>
    ),
  },
  {
    label: 'Round 2',
    desc: 'Peer-reviewing each proposal',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
      </svg>
    ),
  },
  {
    label: 'Round 3',
    desc: 'Chairman synthesizing best result',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
      </svg>
    ),
  },
];

export function JobStatus({ status }: { status: JobStatusResponse['status'] }) {
  const isActive = status === 'started';

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid rgba(124,92,255,0.25)', borderRadius: 12,
      padding: '20px 20px 18px', fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c5cff" strokeWidth="1.8"
          style={{ animation: 'spin 1s linear infinite' }}>
          <path d="M21 12a9 9 0 11-6.219-8.56"/>
        </svg>
        <span style={{ fontSize: 13.5, fontWeight: 500, color: '#ededed' }}>
          {status === 'queued' ? 'Queued — waiting for a worker…' : 'Optimizing your prompt…'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        {ROUNDS.map((round, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <div style={{ flex: 1, padding: '12px 10px', borderRadius: 8, textAlign: 'center',
              border: `1px solid ${isActive ? 'rgba(124,92,255,0.3)' : '#1f1f23'}`,
              background: isActive ? 'rgba(124,92,255,0.06)' : 'rgba(255,255,255,0.02)',
              color: isActive ? '#7c5cff' : '#5a5a60',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              {round.icon}
              <div style={{ fontSize: 11.5, fontWeight: 600, color: isActive ? '#ededed' : '#5a5a60' }}>
                {round.label}
              </div>
              <div style={{ fontSize: 10.5, color: '#5a5a60', lineHeight: 1.4, fontFamily: 'var(--font-geist-mono, monospace)' }}>
                {round.desc}
              </div>
            </div>
            {idx < ROUNDS.length - 1 && (
              <div style={{ width: 12, height: 1, background: '#1f1f23', flexShrink: 0 }} />
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[1, 0.85, 0.7].map((w, i) => (
          <div key={i} style={{ height: 10, borderRadius: 4, background: '#222226',
            width: `${w * 100}%`, animation: 'pulse 2s ease-in-out infinite' }} />
        ))}
        <div style={{ height: 32, borderRadius: 6, background: '#222226', marginTop: 6,
          animation: 'pulse 2s ease-in-out infinite' }} />
      </div>

      <p style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11, color: '#5a5a60',
        textAlign: 'center', marginTop: 14 }}>
        Usually takes 20–40 seconds · Stay on this page or check back with your job ID
      </p>
    </div>
  );
}
