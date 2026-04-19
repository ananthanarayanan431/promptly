import Link from 'next/link';

const AGENTS = [
  { letter: 'A', name: 'Analytical', color: '#7c5cff', blurb: 'Precision, constraints, output format.' },
  { letter: 'C', name: 'Creative',   color: '#ff7ac6', blurb: 'Context, persona, exemplars.' },
  { letter: 'O', name: 'Concise',    color: '#5cffb1', blurb: 'Radical brevity, signal density.' },
  { letter: 'S', name: 'Structured', color: '#ffb85c', blurb: 'Logical decomposition, schemas.' },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr',
      fontFamily: 'var(--font-geist, ui-sans-serif)' }}>

      {/* ── Left: form ─────────────────────────────────────────────────────── */}
      <div style={{ background: '#ffffff', color: '#141414', padding: '28px 48px',
        display: 'flex', flexDirection: 'column' }}>

        {/* Logo + back */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none',
            fontSize: 14, fontWeight: 600, color: '#141414' }}>
            <LogoMark />
            promptly
          </Link>
          <Link href="/" style={{ marginLeft: 'auto', height: 28, padding: '0 10px',
            borderRadius: 6, border: '1px solid #e5e5e1', fontSize: 12, color: '#666',
            textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
            ← back
          </Link>
        </div>

        {/* Form content */}
        <div style={{ margin: 'auto 0', maxWidth: 400, width: '100%' }}>
          {children}
        </div>

        {/* Footer */}
        <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
          color: '#999', letterSpacing: '0.1em' }}>
          © 2026 promptly · soc2 · gdpr
        </div>
      </div>

      {/* ── Right: dark feature preview ────────────────────────────────────── */}
      <div style={{ background: '#141414', color: '#ededed', padding: 48,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        borderLeft: '1px solid #e5e5e1' }}>

        <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
          color: '#7c5cff', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 20 }}>
          What&apos;s inside
        </div>

        <div style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)',
          fontSize: 44, lineHeight: 1.05, letterSpacing: '-0.02em', color: '#ededed', marginBottom: 30 }}>
          Four models.<br />Three rounds.<br />One answer.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 30 }}>
          {AGENTS.map(a => (
            <div key={a.letter} style={{ background: '#1a1a1a', border: '1px solid #1f1f23',
              borderRadius: 10, padding: 14 }}>
              <div style={{ width: 26, height: 26, borderRadius: 6, background: a.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 10 }}>{a.letter}</div>
              <div style={{ color: '#ededed', fontSize: 13, fontWeight: 500 }}>{a.name}</div>
              <div style={{ color: '#8a8a90', fontSize: 11.5, marginTop: 4, lineHeight: 1.4 }}>{a.blurb}</div>
            </div>
          ))}
        </div>

        <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12.5,
          color: '#8a8a90', lineHeight: 1.6 }}>
          <span style={{ color: '#7c5cff' }}>$ </span>
          curl promptly.dev/optimize \<br />
          <span style={{ paddingLeft: 16 }}>-H &quot;Authorization: Bearer qac_...&quot; \</span><br />
          <span style={{ paddingLeft: 16 }}>-d &apos;{'{"prompt": "..."}'}&apos;</span>
        </div>
      </div>
    </div>
  );
}

function LogoMark() {
  return (
    <div style={{ width: 22, height: 22, borderRadius: 6, background: '#7c5cff',
      position: 'relative', display: 'inline-flex', alignItems: 'center',
      justifyContent: 'center', flexShrink: 0,
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3), 0 1px 0 rgba(0,0,0,0.15)' }}>
      <div style={{ position: 'absolute', inset: 5, border: '1.5px solid #fff',
        borderRight: '1.5px solid transparent', borderBottom: '1.5px solid transparent',
        borderRadius: 2, transform: 'rotate(45deg)' }} />
    </div>
  );
}
