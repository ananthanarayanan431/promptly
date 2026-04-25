export default function PromptsMediaPage() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', fontFamily: 'var(--font-geist, ui-sans-serif)', padding: '0 40px',
    }}>
      <div style={{ maxWidth: 520, width: '100%', textAlign: 'center' }}>

        {/* Icon */}
        <div style={{
          width: 64, height: 64, borderRadius: 16, margin: '0 auto 28px',
          background: 'linear-gradient(135deg, rgba(124,92,255,0.2), rgba(124,92,255,0.05))',
          border: '1px solid rgba(124,92,255,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7c5cff" strokeWidth="1.5">
            <rect x="3" y="3" width="7" height="5" rx="1"/>
            <rect x="14" y="3" width="7" height="5" rx="1"/>
            <rect x="3" y="11" width="7" height="5" rx="1"/>
            <rect x="14" y="11" width="7" height="5" rx="1"/>
            <rect x="3" y="19" width="18" height="2" rx="1"/>
          </svg>
        </div>

        {/* Eyebrow */}
        <div style={{
          fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
          color: '#7c5cff', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 14,
        }}>
          / prompts media
        </div>

        {/* Heading */}
        <h1 style={{
          fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontWeight: 400,
          fontSize: 38, letterSpacing: '-0.02em', lineHeight: 1.12, margin: '0 0 16px',
          color: '#ededed',
        }}>
          A library of<br />
          <em style={{ color: '#7c5cff', fontStyle: 'italic' }}>ready-to-use</em> prompts.
        </h1>

        {/* Description */}
        <p style={{ fontSize: 14, color: '#8a8a90', lineHeight: 1.7, margin: '0 0 32px' }}>
          Browse, copy, and instantly optimize a curated collection of prompts across
          categories — writing, coding, research, analysis, and more.
        </p>

        {/* Coming soon badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '8px 18px', borderRadius: 8,
          background: 'rgba(124,92,255,0.08)', border: '1px solid rgba(124,92,255,0.2)',
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', background: '#7c5cff',
            boxShadow: '0 0 8px rgba(124,92,255,0.8)',
            animation: 'pulse 2s ease-in-out infinite',
          }} />
          <span style={{
            fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12,
            color: '#7c5cff', letterSpacing: '0.06em',
          }}>
            Coming soon
          </span>
        </div>

        {/* Feature hints */}
        <div style={{
          marginTop: 48, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12,
        }}>
          {[
            { icon: '⚡', label: 'One-click optimize', desc: 'Run any prompt through the council instantly' },
            { icon: '🗂', label: 'Browse by category', desc: 'Filtered by use-case and domain' },
            { icon: '📋', label: 'Copy & customize', desc: 'Fork any prompt into your own version' },
          ].map(f => (
            <div key={f.label} style={{
              padding: '14px 12px', borderRadius: 8,
              background: '#1a1a1a', border: '1px solid #1f1f23', textAlign: 'left',
            }}>
              <div style={{ fontSize: 18, marginBottom: 8 }}>{f.icon}</div>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: '#ededed', marginBottom: 4 }}>{f.label}</div>
              <div style={{ fontSize: 11.5, color: '#5a5a60', lineHeight: 1.4 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
