interface Props {
  title: string;
  value: string | number;
  subtitle?: string;
  accent?: string;
}

export function StaticCard({ title, value, subtitle, accent }: Props) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '20px 22px', display: 'flex',
      flexDirection: 'column', gap: 6,
    }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-subtle)',
        textTransform: 'uppercase', letterSpacing: '.07em' }}>
        {title}
      </span>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 32, fontWeight: 700,
        color: accent ?? 'var(--text)', lineHeight: 1 }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {subtitle && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{subtitle}</div>
      )}
    </div>
  );
}
