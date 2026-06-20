'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { listApiKeys, createApiKey, revokeApiKey } from '@/lib/api-keys';
import type { ApiKeyStatus } from '@/lib/api-keys';
import type { ApiKey, ApiKeyCreated } from '@/types/api';
import { api } from '@/lib/api';
import { createClient } from '@/lib/supabase';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';

const PAGE_SIZE = 10;

/* ── Shared icon ────────────────────────────────────────────────────── */
function Icon({ d, size = 14 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/* ── Section header ─────────────────────────────────────────────────── */
function SectionTitle({ id, icon, title, subtitle }: {
  id: string; icon: string; title: string; subtitle?: string;
}) {
  return (
    <div id={id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, paddingTop: 4 }}>
      <div style={{
        width: 34, height: 34, borderRadius: 9, flexShrink: 0, marginTop: 2,
        background: 'var(--primary-soft)', border: '1px solid var(--primary-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)',
      }}>
        <Icon d={icon} size={15} />
      </div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{subtitle}</div>}
      </div>
    </div>
  );
}

/* ── Row item (label + value) ───────────────────────────────────────── */
function SettingsRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 0', borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{
        fontSize: 13, color: 'var(--text)', fontWeight: 500,
        fontFamily: mono ? 'var(--mono)' : undefined,
      }}>{value}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   ① PROFILE SECTION
══════════════════════════════════════════════════════════════════════ */
function ProfileSection({ user, sbUser }: {
  user: { id: string; email: string; credits: number; token_balance?: number } | undefined;
  sbUser: SupabaseUser | null;
}) {
  const name = (sbUser?.user_metadata?.full_name as string | undefined) ?? '—';
  const email = sbUser?.email ?? user?.email ?? '—';
  const joined = sbUser?.created_at
    ? new Date(sbUser.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '—';
  const provider = sbUser?.app_metadata?.provider ?? 'email';
  const avatarUrl = (sbUser?.user_metadata?.avatar_url as string | undefined) ?? null;
  const initials = name !== '—' ? name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() : '?';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Profile header — avatar replaces the generic icon */}
      <div id="profile" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, paddingTop: 4 }}>
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={name}
            referrerPolicy="no-referrer"
            style={{
              width: 38, height: 38, borderRadius: 10, flexShrink: 0, marginTop: 2,
              objectFit: 'cover', border: '1px solid var(--border)',
            }}
          />
        ) : (
          <div style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0, marginTop: 2,
            background: 'var(--primary-soft)', border: '1px solid var(--primary-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--primary)', fontSize: 13, fontWeight: 700,
          }}>
            {initials}
          </div>
        )}
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>Profile</div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>Your account identity and membership details.</div>
        </div>
      </div>
      <div className="ply-card" style={{ padding: '6px 18px' }}>
        <SettingsRow label="Name" value={name} />
        <SettingsRow label="Email" value={email} />
        <SettingsRow label="Auth provider" value={
          <span style={{ textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
            {provider}
          </span>
        } />
        <SettingsRow label="Member since" value={joined} />
        {user?.id && (
          <SettingsRow label="User ID" value={
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>
              {user.id.slice(0, 8)}…
            </span>
          } />
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   ② CREDITS SECTION
══════════════════════════════════════════════════════════════════════ */
// Token cost bars (costs in K tokens, max scale 500K)

function CreditBar({ cost, color }: { cost: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
      <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 99 }}>
        <div style={{ height: '100%', width: `${Math.min(100, (cost / 500) * 100)}%`, background: color, borderRadius: 99, transition: 'width .3s' }} />
      </div>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color, minWidth: 36, textAlign: 'right', flexShrink: 0 }}>
        ~{cost}K tok
      </span>
    </div>
  );
}

function FeatureRow({ label, desc, cost, color }: { label: string; desc: string; cost: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: '0 0 160px', minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>{desc}</div>
      </div>
      <CreditBar cost={cost} color={color} />
    </div>
  );
}

function TierCompare({ tiers, color }: {
  tiers: { label: string; cost: number; desc: string }[];
  color: string;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      {tiers.map(t => (
        <div key={t.label} style={{
          background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{t.label}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color }}>~{t.cost}K</span>
          </div>
          <div style={{ height: 3, background: 'var(--border)', borderRadius: 99, marginBottom: 5 }}>
            <div style={{ height: '100%', width: `${Math.min(100, (t.cost / 500) * 100)}%`, background: color, borderRadius: 99 }} />
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text-subtle)' }}>{t.desc}</div>
        </div>
      ))}
    </div>
  );
}

function FeatureGroup({ icon, title, color, children }: {
  icon: string; title: string; color: string; children: React.ReactNode;
}) {
  return (
    <div className="ply-card" style={{ padding: '14px 18px 6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `color-mix(in oklab, ${color} 12%, transparent)`,
          border: `1px solid color-mix(in oklab, ${color} 25%, transparent)`,
          color, flexShrink: 0,
        }}>
          <Icon d={icon} size={13} />
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function CreditsSection({ credits: _credits, tokenBalance }: { credits?: number; tokenBalance?: number }) {
  const TOKEN_START = 3_000_000;
  // Clamp at 0 — never reveal the internal overdraft buffer to users.
  const bal = Math.max(0, tokenBalance ?? TOKEN_START);
  const isDepleted = bal === 0;
  const low = !isDepleted && bal < TOKEN_START * 0.1;
  const pct = Math.min(100, (bal / TOKEN_START) * 100);
  const fmtBal = (n: number) => n === 0 ? '0' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K` : String(n);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionTitle
        id="credits"
        icon="M2 5h20v14H2zM2 10h20"
        title="Token Balance"
        subtitle="Every LLM call is metered. New accounts start with 3 M tokens — tokens are deducted based on actual usage."
      />

      {/* Balance card */}
      <div className="ply-card" style={{
        padding: '18px 20px',
        borderColor: low ? 'rgba(255,107,122,0.35)' : undefined,
        background: low ? 'rgba(255,107,122,0.04)' : undefined,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: (isDepleted || low) ? '#ff6b7a' : 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
              Token balance
            </div>
            <div style={{ fontSize: 40, fontWeight: 700, fontFamily: 'var(--mono)', letterSpacing: '-0.03em', color: (isDepleted || low) ? '#ff6b7a' : 'var(--text)', lineHeight: 1 }}>
              {fmtBal(bal)}
            </div>
          </div>
          {/* Quick math chips */}
<div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
              {[
                { label: 'Council opts', val: `~${Math.floor(bal / 50_000)}` },
                { label: 'Health scores', val: `~${Math.floor(bal / 3_000)}` },
                { label: 'SkillOpt Low', val: `~${Math.floor(bal / 100_000)}` },
              ].filter(() => bal > 0).map(chip => (
                <div key={chip.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
                  <span style={{ color: 'var(--text-subtle)' }}>{chip.label}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 5, padding: '1px 7px' }}>
                    ×{chip.val}
                  </span>
                </div>
              ))}
            </div>
        </div>
        {/* Progress bar */}
        <div style={{ height: 5, background: 'var(--border)', borderRadius: 99 }}>
          <div style={{
            height: '100%', borderRadius: 99, transition: 'width .4s ease',
            width: `${pct}%`,
            background: isDepleted ? '#ef4444' : low ? '#f59e0b' : pct > 50 ? 'var(--success)' : 'var(--primary)',
          }} />
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 6 }}>
          {isDepleted ? '⛔ No tokens remaining — top up to continue.' : low ? `⚠ Low — ${fmtBal(bal)} tokens remaining` : `${fmtBal(bal)} of 3M starting tokens remaining`}
        </div>
      </div>

      {/* Council Optimizer */}
      <FeatureGroup icon="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" title="Council Optimizer" color="var(--primary)">
        <FeatureRow label="Optimize" desc="4-model council · critic · synthesize · 3 rounds" cost={50} color="var(--primary)" />
        <FeatureRow label="Health score" desc="8-dimension quality audit" cost={3} color="var(--primary)" />
        <FeatureRow label="Advisory" desc="Strengths, weaknesses & improvement suggestions" cost={5} color="var(--primary)" />
        <div style={{ height: 4 }} />
      </FeatureGroup>

      {/* Bridge */}
      <FeatureGroup icon="M4 12h4M16 12h4M8 12a4 4 0 008 0M8 12V8M16 12V8M8 8h8" title="Prompt Bridge" color="#3b82f6">
        <FeatureRow label="Full calibration" desc="Cross-model transfer with new mapping" cost={5} color="#3b82f6" />
        <FeatureRow label="Reuse mapping" desc="Apply a previously calibrated mapping" cost={1} color="#3b82f6" />
        <div style={{ height: 4 }} />
      </FeatureGroup>

      {/* Domain PDO */}
      <FeatureGroup icon="M14.5 17.5 3 6 3 3 6 3 17.5 14.5M13 19 19 13M16 16 20 20M19 21 21 19M14.5 6.5 18 3 21 3 21 6 17.5 9.5M5 14 8.5 17.5M4 20 6 22M6 20 4 22" title="Domain — PDO Tournament" color="#f59e0b">
        <TierCompare color="#f59e0b" tiers={[
          { label: 'Low',    cost: 5,  desc: '15 rounds · 6 candidates' },
          { label: 'Medium', cost: 10, desc: '30 rounds · 10 candidates' },
          { label: 'High',   cost: 16, desc: '50 rounds · 15 candidates' },
        ]} />
        <div style={{ height: 4 }} />
      </FeatureGroup>

      {/* Domain GEPA */}
      <FeatureGroup icon="m12 3-1.912 5.813a2 2 0 01-1.275 1.275L3 12l5.813 1.912a2 2 0 011.275 1.275L12 21l1.912-5.813a2 2 0 011.275-1.275L21 12l-5.813-1.912a2 2 0 01-1.275-1.275L12 3z" title="Domain — GEPA Reflective" color="#7c5cff">
        <TierCompare color="#7c5cff" tiers={[
          { label: 'Low',    cost: 4,  desc: 'B=100 rollouts' },
          { label: 'Medium', cost: 8,  desc: 'B=260 rollouts' },
          { label: 'High',   cost: 14, desc: 'B=460 rollouts' },
        ]} />
        <div style={{ height: 4 }} />
      </FeatureGroup>

      {/* SkillOpt */}
      <FeatureGroup icon="M13 2L3 14h9l-1 8 10-12h-9l1-8z" title="Skill Optimizer (SkillOpt)" color="#06b6d4">
        <TierCompare color="#06b6d4" tiers={[
          { label: 'Low',    cost: 5,  desc: '2 epochs · 10 rollouts/epoch' },
          { label: 'Medium', cost: 10, desc: '3 epochs · 20 rollouts/epoch' },
          { label: 'High',   cost: 16, desc: '4 epochs · 30 rollouts/epoch' },
        ]} />
        <div style={{ height: 4 }} />
      </FeatureGroup>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   ③ OPTIMIZATION DEFAULTS (localStorage)
══════════════════════════════════════════════════════════════════════ */
const LS_KEY = 'ply_opt_defaults';
type OptDefaults = { engine: 'pdo' | 'gepa'; pdoTier: 'low' | 'medium' | 'high'; gepaTier: 'low' | 'medium' | 'high' };
const DEFAULT_PREFS: OptDefaults = { engine: 'pdo', pdoTier: 'low', gepaTier: 'low' };

function loadDefaults(): OptDefaults {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch { return DEFAULT_PREFS; }
}

function OptimizationDefaultsSection() {
  const [prefs, setPrefs] = useState<OptDefaults>(DEFAULT_PREFS);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setPrefs(loadDefaults()); }, []);

  function save(next: OptDefaults) {
    setPrefs(next);
    localStorage.setItem(LS_KEY, JSON.stringify(next));
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  function SelectRow({ label, field, options }: {
    label: string;
    field: keyof OptDefaults;
    options: { value: string; label: string }[];
  }) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 0', borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
        <select
          value={prefs[field]}
          onChange={e => save({ ...prefs, [field]: e.target.value })}
          style={{
            height: 30, padding: '0 8px', borderRadius: 6, border: '1px solid var(--border)',
            background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12.5,
            cursor: 'pointer', outline: 'none',
          }}
        >
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SectionTitle
        id="defaults"
        icon="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"
        title="Optimization defaults"
        subtitle="Stored locally. Pre-selects engine and effort on the Domain Optimize tab."
      />
      <div className="ply-card" style={{ padding: '0 18px' }}>
        <SelectRow label="Default engine" field="engine" options={[
          { value: 'pdo', label: 'PDO — Prompt Duel Optimizer' },
          { value: 'gepa', label: 'GEPA — Reflective evolution' },
        ]} />
        <SelectRow label="PDO default tier" field="pdoTier" options={[
          { value: 'low',    label: 'Low — 15 rounds · ~50K tokens' },
          { value: 'medium', label: 'Medium — 30 rounds · ~100K tokens' },
          { value: 'high',   label: 'High — 50 rounds · ~200K tokens' },
        ]} />
        <SelectRow label="GEPA default tier" field="gepaTier" options={[
          { value: 'low',    label: 'Low — B=100 · ~100K tokens' },
          { value: 'medium', label: 'Medium — B=260 · ~260K tokens' },
          { value: 'high',   label: 'High — B=460 · ~460K tokens' },
        ]} />
        <div style={{ padding: '12px 0', display: 'flex', justifyContent: 'flex-end' }}>
          {saved && (
            <span style={{ fontSize: 12, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="20 6 9 17 4 12" /></svg>
              Saved
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   ④ PIPELINE CONFIGURATION (interactive)
══════════════════════════════════════════════════════════════════════ */
const LS_PIPELINE_KEY = 'ply_custom_pipeline';
const COUNCIL_ROLES = ['Analytical', 'Creative', 'Concise', 'Structured'] as const;
const DEFAULT_COUNCIL = [
  'openai/gpt-4o-mini',
  'anthropic/claude-3.5-haiku',
  'google/gemini-2.5-flash',
  'x-ai/grok-4.3',
];
const DEFAULT_SYNTHESIZER = 'openai/gpt-4o-mini';

interface ModelOption { id: string; name: string; input: number; output: number; }
interface PipelineConfig { council: string[]; synthesizer: string; }

function loadPipeline(): PipelineConfig {
  try {
    const raw = localStorage.getItem(LS_PIPELINE_KEY);
    return raw ? JSON.parse(raw) : { council: DEFAULT_COUNCIL, synthesizer: DEFAULT_SYNTHESIZER };
  } catch { return { council: DEFAULT_COUNCIL, synthesizer: DEFAULT_SYNTHESIZER }; }
}

/* ══════════════════════════════════════════════════════════════════════
   ④ LLM EFFORT TIERS
══════════════════════════════════════════════════════════════════════ */
const LS_EFFORT_KEY = 'ply_llm_effort';

interface TierModelInfo { model: string; display: string; cost_per_1m_input: number; cost_per_1m_output: number; }
interface TierInfo { key: string; label: string; desc: string; council_models: TierModelInfo[]; synthesizer: TierModelInfo; est_cost_per_run_usd: number; }

const TIER_COLORS: Record<string, string> = { low: '#10b981', medium: '#f59e0b', high: '#7c5cff' };
const TIER_ICONS: Record<string, string> = {
  low: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  medium: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  high: 'M5 3l14 9-14 9V3z',
};

function LLMEffortSection() {
  const [selected, setSelected] = useState<string>(() => {
    try { return localStorage.getItem(LS_EFFORT_KEY) ?? 'medium'; } catch { return 'medium'; }
  });
  const [saved, setSaved] = useState(false);

  const { data, isLoading, isError } = useQuery<{ tiers: TierInfo[]; default_tier: string }>({
    queryKey: ['llm-tiers'],
    queryFn: async () => {
      const res = await api.get<{ data: { tiers: TierInfo[]; default_tier: string } }>('/api/v1/openrouter/tiers');
      return res.data.data;
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const tiers = data?.tiers ?? [];

  function pick(key: string) {
    setSelected(key);
    try { localStorage.setItem(LS_EFFORT_KEY, key); } catch { /* noop */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SectionTitle
        id="llm-effort"
        icon="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
        title="LLM effort"
        subtitle="Choose the model tier for Council, Bridge, Domain and Skill optimizers. Saved as your default for all future runs."
      />

      {isLoading && (
        <div className="ply-card" style={{ padding: '20px 18px', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-subtle)', fontSize: 13 }}>
          <span className="ply-dot ply-dot-pulse" style={{ background: 'var(--primary)', width: 7, height: 7 }} />
          Loading live pricing from OpenRouter…
        </div>
      )}
      {isError && !isLoading && (
        <div className="ply-card" style={{ padding: '14px 18px', fontSize: 12.5, color: 'var(--text-muted)' }}>
          Pricing unavailable — OpenRouter unreachable. Tier selection still works; model costs shown at inference time.
        </div>
      )}
      {!isLoading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {tiers.map(tier => {
            const active = selected === tier.key;
            const color = TIER_COLORS[tier.key] ?? 'var(--primary)';
            return (
              <button
                key={tier.key}
                onClick={() => pick(tier.key)}
                style={{
                  border: 0, borderRadius: 10, padding: '16px 16px 14px', cursor: 'pointer',
                  textAlign: 'left', transition: 'all .15s',
                  background: active ? 'var(--surface)' : 'var(--surface-2)',
                  outline: active ? `2px solid ${color}` : '1px solid var(--border)',
                  boxShadow: active ? `0 0 0 4px color-mix(in oklab, ${color} 12%, transparent)` : 'none',
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                      background: active ? color : 'var(--surface)',
                      border: `1px solid ${active ? color : 'var(--border)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: active ? '#fff' : 'var(--text-subtle)',
                      transition: 'all .15s',
                    }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d={TIER_ICONS[tier.key]} />
                      </svg>
                    </div>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: active ? color : 'var(--text)' }}>
                      {tier.label}
                    </span>
                  </div>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: active ? color : 'var(--text-subtle)' }}>
                    ~${tier.est_cost_per_run_usd < 0.01 ? tier.est_cost_per_run_usd.toFixed(4) : tier.est_cost_per_run_usd.toFixed(3)}/run
                  </span>
                </div>

                {/* Description */}
                <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginBottom: 12, lineHeight: 1.45 }}>
                  {tier.desc}
                </div>

                {/* Council models */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {tier.council_models.map((m) => (
                    <div key={m.model} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                      <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0, marginRight: 6 }}>
                        {m.display}
                      </span>
                      <span style={{ color: 'var(--text-subtle)', fontFamily: 'var(--mono)', flexShrink: 0, fontSize: 10 }}>
                        ${m.cost_per_1m_input}/1M
                      </span>
                    </div>
                  ))}
                </div>

                {/* Synthesizer */}
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                  <span style={{ color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    Chairman
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110, fontSize: 10 }}>
                    {tier.synthesizer.display}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Info + save indicator */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 12, color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
          Stored locally. Applied to every optimization including Council, Bridge, Domain and Skill runs.
        </div>
        {saved && (
          <span style={{ fontSize: 12, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="20 6 9 17 4 12"/></svg>
            Saved
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Feature gate toggles ──────────────────────────────────────────── */
const LS_GATES_KEY = 'ply_feature_gates';
interface GateState { quality: boolean; performance: boolean; subject: boolean; }
const DEFAULT_GATES: GateState = { quality: true, performance: true, subject: true };

function loadGates(): GateState {
  try { const r = localStorage.getItem(LS_GATES_KEY); return r ? { ...DEFAULT_GATES, ...JSON.parse(r) } : DEFAULT_GATES; }
  catch { return DEFAULT_GATES; }
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{
        width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
        position: 'relative', transition: 'background .2s',
        background: on ? 'var(--success)' : 'var(--border)',
        flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: on ? 21 : 3,
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'left .2s',
      }} />
    </button>
  );
}

function GateToggles() {
  const [gates, setGates] = useState<GateState>(loadGates);
  const [saved, setSaved] = useState(false);

  function set(key: keyof GateState, val: boolean) {
    const next = { ...gates, [key]: val };
    setGates(next);
    try { localStorage.setItem(LS_GATES_KEY, JSON.stringify(next)); } catch { /* noop */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  const GATES: { key: keyof GateState; label: string; desc: string; serverOnly?: boolean }[] = [
    { key: 'performance', label: 'Performance gate', desc: 'Fast-path skip for prompts already production-grade. Disable to always run the full council.' },
    { key: 'quality',     label: 'Quality gate',     desc: 'Re-scores synthesized output and loops back if weak dimensions remain. Disable for a single-pass run.' },
    { key: 'subject',     label: 'Subject classifier', desc: 'Analyses prompt topic before council to add domain context. Disable to save one LLM call.' },
  ];

  return (
    <div className="ply-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
          Feature gates
        </span>
        {saved && (
          <span style={{ fontSize: 11.5, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="20 6 9 17 4 12"/></svg>
            Saved
          </span>
        )}
      </div>
      {GATES.map((g) => (
        <div key={g.key} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--border)', gap: 16,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
              {g.label}
              {!gates[g.key] && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  off
                </span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 3, lineHeight: 1.45 }}>{g.desc}</div>
          </div>
          <Toggle on={gates[g.key]} onChange={v => set(g.key, v)} />
        </div>
      ))}
      {/* Prompt cache — server-only, read-only */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', gap: 16,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
            Prompt cache
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--surface-2)', color: 'var(--text-subtle)', border: '1px solid var(--border)', fontFamily: 'var(--mono)' }}>
              server only
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 3 }}>
            Anthropic cache breakpoints on static system prompts. Configure via <code style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>PROMPT_CACHE_ENABLED</code> env var.
          </div>
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, padding: '2px 8px', borderRadius: 5, background: 'rgba(16,185,129,0.1)', color: 'var(--success)', fontWeight: 600, flexShrink: 0 }}>
          enabled
        </span>
      </div>
    </div>
  );
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: '#10a37f', anthropic: '#d97706', google: '#4285f4',
  'meta-llama': '#0668e1', mistralai: '#ff6b35', 'x-ai': '#1da1f2',
  deepseek: '#7c5cff', qwen: '#ff4d4f',
};
const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google',
  'meta-llama': 'Meta', mistralai: 'Mistral', 'x-ai': 'xAI',
  deepseek: 'DeepSeek', qwen: 'Qwen',
};
const PROVIDER_ORDER = ['openai', 'anthropic', 'google', 'meta-llama', 'mistralai', 'x-ai', 'deepseek', 'qwen'];

function ProviderDot({ provider, size = 7 }: { provider: string; size?: number }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: PROVIDER_COLORS[provider] ?? 'var(--text-subtle)',
    }} />
  );
}

function PriceBadge({ input }: { input: number }) {
  const color = input === 0 ? '#10b981' : input < 0.2 ? '#10b981' : input < 1 ? '#f59e0b' : input < 3 ? '#ef8c4a' : '#ef4444';
  return (
    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color, flexShrink: 0 }}>
      ${input}/1M
    </span>
  );
}

function ModelPicker({ value, onChange, models, loading }: {
  value: string; onChange: (v: string) => void;
  models: ModelOption[]; loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (open) { setSearch(''); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);

  const selected = models.find(m => m.id === value);
  const selProvider = value.split('/')[0];
  const selSlug = value.split('/').slice(1).join('/') || value;

  const q = search.toLowerCase();
  const filtered = q
    ? models.filter(m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
    : models;

  // Group by provider
  const groups: { provider: string; label: string; items: ModelOption[] }[] = [];
  const seen = new Set<string>();
  [...PROVIDER_ORDER, '__other__'].forEach(p => {
    const items = p === '__other__'
      ? filtered.filter(m => !PROVIDER_ORDER.includes(m.id.split('/')[0]) && !seen.has(m.id))
      : filtered.filter(m => m.id.startsWith(p + '/'));
    if (items.length) {
      items.forEach(m => seen.add(m.id));
      groups.push({ provider: p, label: PROVIDER_LABELS[p] ?? 'Other', items });
    }
  });

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      {/* Trigger button */}
      <button
        onClick={() => !loading && setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px', borderRadius: 8,
          border: open ? '1px solid var(--primary)' : '1px solid var(--border)',
          background: open ? 'var(--surface)' : 'var(--surface-2)',
          cursor: loading ? 'wait' : 'pointer', outline: 'none',
          boxShadow: open ? '0 0 0 3px color-mix(in oklab, var(--primary) 12%, transparent)' : 'none',
          transition: 'all .12s',
        }}
      >
        {loading ? (
          <span style={{ fontSize: 12, color: 'var(--text-subtle)', flex: 1, textAlign: 'left' }}>Loading models…</span>
        ) : (
          <>
            <ProviderDot provider={selProvider} />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)', flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selSlug}
            </span>
            {selected && <PriceBadge input={selected.input} />}
          </>
        )}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 999,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,.18)',
          display: 'flex', flexDirection: 'column', maxHeight: 320, overflow: 'hidden',
        }}>
          {/* Search */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 7 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              ref={inputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search models…"
              style={{
                flex: 1, border: 'none', outline: 'none', background: 'transparent',
                fontSize: 13, color: 'var(--text)',
              }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-subtle)', padding: 0, lineHeight: 1 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            )}
          </div>

          {/* Results */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {groups.length === 0 ? (
              <div style={{ padding: '16px 12px', textAlign: 'center', fontSize: 13, color: 'var(--text-subtle)' }}>
                No models found
              </div>
            ) : groups.map(group => (
              <div key={group.provider}>
                <div style={{ padding: '6px 12px 3px', fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.07em', display: 'flex', alignItems: 'center', gap: 5, position: 'sticky', top: 0, background: 'var(--surface)' }}>
                  <ProviderDot provider={group.provider} size={6} />
                  {group.label}
                  <span style={{ marginLeft: 'auto', fontWeight: 400, fontSize: 10 }}>{group.items.length}</span>
                </div>
                {group.items.map(m => {
                  const slug = m.id.split('/').slice(1).join('/') || m.id;
                  const isSel = m.id === value;
                  return (
                    <button
                      key={m.id}
                      role="option"
                      aria-selected={isSel}
                      onClick={() => { onChange(m.id); setOpen(false); }}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(m.id); setOpen(false); } }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                        padding: '7px 12px', cursor: 'pointer', transition: 'background .08s',
                        background: isSel ? 'color-mix(in oklab, var(--primary) 8%, transparent)' : 'transparent',
                        border: 0, textAlign: 'left',
                      }}
                      onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; }}
                      onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                    >
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: isSel ? 'var(--primary)' : 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isSel ? 600 : 400 }}>
                        {slug}
                      </span>
                      <span style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                        <PriceBadge input={m.input} />
                        <span style={{ fontSize: 10, color: 'var(--text-subtle)', fontFamily: 'var(--mono)' }}>·</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-subtle)' }}>${m.output}/out</span>
                      </span>
                      {isSel && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PipelineSection() {
  const [config, setConfig] = useState<PipelineConfig>(loadPipeline);
  const [saved, setSaved] = useState(false);

  const { data: modelsData, isLoading, isError: modelsError } = useQuery<{ models: { id: string; name: string; pricing?: { prompt_per_token: number; completion_per_token: number } | null }[] }>({
    queryKey: ['openrouter-models'],
    queryFn: async () => {
      const res = await api.get<{ data: { models: { id: string; name: string; pricing?: { prompt_per_token: number; completion_per_token: number } | null }[]; cached: boolean } }>('/api/v1/openrouter/models');
      return res.data.data;
    },
    staleTime: 10 * 60_000,
    retry: 1,
  });

  const models: ModelOption[] = (modelsData?.models ?? []).map(m => ({
    id: m.id,
    name: m.name,
    input:  m.pricing ? Math.round(m.pricing.prompt_per_token * 1_000_000 * 1000) / 1000 : 1,
    output: m.pricing ? Math.round(m.pricing.completion_per_token * 1_000_000 * 1000) / 1000 : 4,
  }));

  function save(next: PipelineConfig) {
    setConfig(next);
    try { localStorage.setItem(LS_PIPELINE_KEY, JSON.stringify(next)); } catch { /* noop */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  function reset() {
    save({ council: DEFAULT_COUNCIL, synthesizer: DEFAULT_SYNTHESIZER });
    try { localStorage.removeItem(LS_PIPELINE_KEY); } catch { /* noop */ }
  }

  const isDefault = config.council.every((m, i) => m === DEFAULT_COUNCIL[i])
    && config.synthesizer === DEFAULT_SYNTHESIZER;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SectionTitle
        id="pipeline"
        icon="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
        title="Pipeline configuration"
        subtitle="Choose the models for each council role and the chairman synthesizer. Applied to every Council optimization."
      />

      {/* Council models — interactive dropdowns */}
      {/* overflow must stay visible so the model-picker dropdowns can escape the card boundary */}
      <div className="ply-card" style={{ padding: 0, overflow: 'visible' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '12px 12px 0 0' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Council models
          </span>
          {isLoading && (
            <span style={{ fontSize: 11, color: 'var(--text-subtle)', fontFamily: 'var(--mono)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span className="ply-dot ply-dot-pulse" style={{ background: 'var(--text-subtle)', width: 5, height: 5 }} />
              Loading from OpenRouter…
            </span>
          )}
          {modelsError && !isLoading && (
            <span style={{ fontSize: 11, color: 'var(--warning)', fontFamily: 'var(--mono)' }}>
              OpenRouter unreachable — type a model ID manually
            </span>
          )}
        </div>

        {COUNCIL_ROLES.map((role, i) => (
          <div key={role} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px', borderBottom: '1px solid var(--border)', gap: 16,
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', minWidth: 80, flexShrink: 0 }}>
              {role}
            </span>
            <ModelPicker
              value={config.council[i] ?? DEFAULT_COUNCIL[i]}
              onChange={(v: string) => {
                const next = [...config.council];
                next[i] = v;
                save({ ...config, council: next });
              }}
              models={models}
              loading={isLoading}
            />
          </div>
        ))}

        {/* Synthesizer row */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', gap: 16,
          background: 'color-mix(in oklab, var(--primary) 4%, var(--surface-2))',
        }}>
          <div style={{ minWidth: 80, flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Chairman</div>
            <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 2 }}>Synthesizer</div>
          </div>
          <ModelPicker
            value={config.synthesizer}
            onChange={(v: string) => save({ ...config, synthesizer: v })}
            models={models}
            loading={isLoading}
          />
        </div>
      </div>

      {/* Save indicator + reset */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!isDefault && (
            <button
              onClick={reset}
              className="ply-btn"
              style={{ fontSize: 12 }}
            >
              Reset to defaults
            </button>
          )}
          <span style={{ fontSize: 12, color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
            Stored locally. Sent with every Council optimization.
          </span>
        </div>
        {saved && (
          <span style={{ fontSize: 12, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="20 6 9 17 4 12"/></svg>
            Saved
          </span>
        )}
      </div>

      {/* Feature gates — interactive toggles */}
      <GateToggles />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   ⑤ API KEYS (existing code, unchanged)
══════════════════════════════════════════════════════════════════════ */
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
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="20 6 9 17 4 12"/></svg>
          Copied
        </>
      ) : (
        <>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
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
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--success)' }}>
            Key created — copy it now, it won&apos;t be shown again
          </span>
        </div>
        <button onClick={onDismiss} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', padding: 2 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: apiKey.is_active ? 'var(--success)' : 'var(--text-subtle)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: apiKey.is_active ? 'var(--text)' : 'var(--text-subtle)', marginBottom: 2 }}>
          {apiKey.name}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>
          {apiKey.is_active
            ? `Created ${formatDistanceToNow(new Date(apiKey.created_at), { addSuffix: true })}`
            : `Revoked ${apiKey.revoked_at ? formatDistanceToNow(new Date(apiKey.revoked_at), { addSuffix: true }) : ''}`}
        </div>
      </div>
      <span className="ply-pill" style={{ color: apiKey.is_active ? 'var(--success)' : 'var(--text-subtle)' }}>
        {apiKey.is_active ? 'active' : 'revoked'}
      </span>
      {apiKey.is_active && (
        confirming ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Revoke?</span>
            <button onClick={() => { onRevoke(apiKey.id); setConfirming(false); }} className="ply-btn" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>Yes</button>
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
    onSuccess: (created) => { queryClient.invalidateQueries({ queryKey: ['api-keys'] }); onCreated(created); setName(''); setError(''); },
    onError: (err: { response?: { data?: { detail?: string }; status?: number } }) => {
      setError(err.response?.status === 409 ? 'An active key with that name already exists.' : 'Failed to create key. Try again.');
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
        <input value={name} onChange={(e) => { setName(e.target.value); setError(''); }}
          placeholder='e.g. "production" or "ci-pipeline"' disabled={isPending}
          style={{ width: '100%', height: 36, padding: '0 12px', borderRadius: 7,
            background: 'var(--surface-2)', border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
            color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
        {error && <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--danger)', marginTop: 5 }}>{error}</div>}
      </div>
      <button type="submit" disabled={isPending || !name.trim()} className="ply-btn ply-btn-primary"
        style={{ height: 36, opacity: isPending || !name.trim() ? 0.5 : 1, cursor: isPending || !name.trim() ? 'not-allowed' : 'pointer' }}>
        {isPending ? 'Creating…' : 'Create key'}
      </button>
    </form>
  );
}

function ApiKeysSection() {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SectionTitle
        id="api-keys"
        icon="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"
        title="API keys"
        subtitle="Create named keys for SDK and script access. Each key is shown once — store it securely."
      />

      {newKey && <NewKeyBanner created={newKey} onDismiss={() => setNewKey(null)} />}

      <div className="ply-card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 3 }}>Create a new key</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>Give it a descriptive name so you can tell keys apart later.</div>
        </div>
        <CreateKeyForm onCreated={setNewKey} />
      </div>

      <div className="ply-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Keys</div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>{total}</span>
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value as ApiKeyStatus); setPage(1); }}
            style={{ height: 28, padding: '0 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', outline: 'none' }}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="revoked">Revoked</option>
          </select>
        </div>

        {isLoading ? (
          <div style={{ padding: '28px 18px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-subtle)' }}>Loading…</div>
        ) : keys.length === 0 ? (
          <div style={{ padding: '28px 18px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-subtle)' }}>
            {status === 'active' ? 'No active keys — create one above.' : status === 'revoked' ? 'No revoked keys.' : 'No keys yet — create one above.'}
          </div>
        ) : (
          keys.map((k) => <ApiKeyRow key={k.id} apiKey={k} onRevoke={revoke} />)
        )}

        {totalPages > 1 && (
          <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>Page {page} of {totalPages}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setPage((p) => p - 1)} disabled={page === 1} className="ply-btn" style={{ opacity: page === 1 ? 0.4 : 1, cursor: page === 1 ? 'not-allowed' : 'pointer' }}>Prev</button>
              <button onClick={() => setPage((p) => p + 1)} disabled={page === totalPages} className="ply-btn" style={{ opacity: page === totalPages ? 0.4 : 1, cursor: page === totalPages ? 'not-allowed' : 'pointer' }}>Next</button>
            </div>
          </div>
        )}
      </div>

      <div className="ply-card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 500, color: 'var(--text)', fontSize: 13 }}>Using your key</div>
        <pre className="ply-prompt-block" style={{ margin: 0, fontSize: 11.5 }}>{`curl https://api.promptly.ai/api/v1/chat/ \\
  -H "Authorization: Bearer qac_••••••••" \\
  -H "Content-Type: application/json" \\
  -d '{ "prompt": "..." }'`}</pre>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Use the prefix <code style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>qac_</code> in{' '}
          <code style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>Authorization: Bearer</code>.
          Both JWT and API keys are accepted.
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   ⑥ DANGER ZONE
══════════════════════════════════════════════════════════════════════ */
function DangerZoneSection() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push('/sign-in');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SectionTitle
        id="danger"
        icon="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"
        title="Danger zone"
        subtitle="Irreversible actions — proceed with caution."
      />
      <div className="ply-card" style={{ padding: 0, overflow: 'hidden', borderColor: 'rgba(255,107,122,0.3)' }}>
        <div style={{
          padding: '16px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255,107,122,0.15)',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 3 }}>Sign out</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>End your current session on this device.</div>
          </div>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="ply-btn"
            style={{ color: 'var(--danger)', borderColor: 'rgba(255,107,122,0.4)', opacity: signingOut ? 0.6 : 1, cursor: signingOut ? 'not-allowed' : 'pointer' }}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
        <div style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 3 }}>Delete account</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Permanently delete your account, all prompts, and history. This cannot be undone.</div>
          </div>
          <button
            className="ply-btn"
            style={{ color: 'var(--danger)', borderColor: 'rgba(255,107,122,0.4)', cursor: 'not-allowed', opacity: 0.5 }}
            disabled
            title="Contact support to delete your account"
          >
            Delete account
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   LEFT NAV
══════════════════════════════════════════════════════════════════════ */
const NAV_ITEMS = [
  { id: 'profile',    label: 'Profile',               icon: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z' },
  { id: 'credits',    label: 'Credits',               icon: 'M2 5h20v14H2zM2 10h20' },
  { id: 'defaults',   label: 'Optimization defaults', icon: 'M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8' },
  { id: 'llm-effort', label: 'LLM effort',            icon: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z' },
  { id: 'pipeline',   label: 'Pipeline',              icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
  { id: 'api-keys',   label: 'API keys',              icon: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4' },
  { id: 'danger',     label: 'Danger zone',           icon: 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01' },
];

/* ══════════════════════════════════════════════════════════════════════
   PAGE
══════════════════════════════════════════════════════════════════════ */
export default function SettingsPage() {
  const [sbUser, setSbUser] = useState<SupabaseUser | null>(null);
  const [activeSection, setActiveSection] = useState('profile');
  const supabase = useMemo(() => createClient(), []);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setSbUser(user));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: userData } = useQuery({
    queryKey: ['user-me'],
    queryFn: async () => {
      const res = await api.get<{ data: { id: string; email: string; credits: number; token_balance: number } }>('/api/v1/users/me');
      return res.data.data;
    },
  });

  // Track active section on scroll
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const handler = () => {
      for (const item of [...NAV_ITEMS].reverse()) {
        const el = document.getElementById(item.id);
        if (el && el.getBoundingClientRect().top <= 120) {
          setActiveSection(item.id);
          break;
        }
      }
    };
    container.addEventListener('scroll', handler, { passive: true });
    return () => container.removeEventListener('scroll', handler);
  }, []);

  function scrollTo(id: string) {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveSection(id);
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* Left nav */}
      <aside style={{
        width: 200, flexShrink: 0, borderRight: '1px solid var(--border)',
        padding: '24px 12px', display: 'flex', flexDirection: 'column', gap: 2,
        overflowY: 'auto',
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 10, paddingLeft: 10 }}>
          Settings
        </div>
        {NAV_ITEMS.map(item => {
          const active = activeSection === item.id;
          const isDanger = item.id === 'danger';
          return (
            <button
              key={item.id}
              onClick={() => scrollTo(item.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '7px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', textAlign: 'left',
                background: active ? 'var(--primary-soft)' : 'transparent',
                color: active ? 'var(--primary)' : isDanger ? 'var(--danger)' : 'var(--text-muted)',
                fontSize: 13, fontWeight: active ? 600 : 400,
                transition: 'background .12s, color .12s',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
                style={{ flexShrink: 0 }}>
                <path d={item.icon} />
              </svg>
              {item.label}
            </button>
          );
        })}
      </aside>

      {/* Scrollable content */}
      <div ref={contentRef} style={{ flex: 1, overflowY: 'auto', padding: '28px 40px 100px' }}>
        <div style={{ maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 48 }}>

          <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: 6 }}>
              / settings
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', margin: 0, color: 'var(--text)' }}>
              Settings
            </h1>
          </div>

          <ProfileSection user={userData} sbUser={sbUser} />
          <CreditsSection credits={userData?.credits} tokenBalance={userData?.token_balance} />
          <OptimizationDefaultsSection />
          <LLMEffortSection />
          <PipelineSection />
          <ApiKeysSection />
          <DangerZoneSection />

        </div>
      </div>
    </div>
  );
}
