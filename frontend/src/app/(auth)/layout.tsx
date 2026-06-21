import Link from 'next/link';
import { AuthPanel } from '@/components/auth/auth-panel';

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
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {children}
        </div>

        {/* Footer */}
        <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
          color: '#999', letterSpacing: '0.1em' }}>
          © 2026 promptly · soc2 · gdpr
        </div>
      </div>

      {/* ── Right: animated feature panel ──────────────────────────────────── */}
      <AuthPanel />
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
