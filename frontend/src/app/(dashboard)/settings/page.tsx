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
  user: { id: string; email: string; credits: number } | undefined;
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
const CREDIT_COSTS = [
  { feature: 'Optimize (council)',  cost: 10, desc: 'Full 3-round multi-model council' },
  { feature: 'Health score',        cost: 5,  desc: '8-dimension quality audit' },
  { feature: 'Advisory',            cost: 5,  desc: 'Strengths / weaknesses / improvements' },
  { feature: 'Bridge',              cost: 5,  desc: 'Reused mapping (1 cr for calibrated)' },
  { feature: 'PDO — Low',          cost: 5,  desc: '15 rounds · 6 candidates' },
  { feature: 'PDO — Medium',       cost: 10, desc: '30 rounds · 10 candidates' },
  { feature: 'PDO — High',         cost: 16, desc: '50 rounds · 15 candidates' },
  { feature: 'GEPA — Low',         cost: 4,  desc: 'B=100 rollouts' },
  { feature: 'GEPA — Medium',      cost: 8,  desc: 'B=260 rollouts' },
  { feature: 'GEPA — High',        cost: 14, desc: 'B=460 rollouts' },
];

function CreditsSection({ credits }: { credits: number | undefined }) {
  const low = (credits ?? 0) < 20;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SectionTitle
        id="credits"
        icon="M2 5h20v14H2zM2 10h20"
        title="Credits"
        subtitle="Each optimization feature costs a fixed number of credits."
      />

      {/* Balance card */}
      <div className="ply-card" style={{
        padding: '18px 20px',
        borderColor: low ? 'rgba(255,107,122,0.35)' : undefined,
        background: low ? 'rgba(255,107,122,0.04)' : undefined,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 11, color: low ? '#ff6b7a' : 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600, marginBottom: 6 }}>
            Current balance
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, fontFamily: 'var(--mono)', letterSpacing: '-0.03em', color: low ? '#ff6b7a' : 'var(--text)', lineHeight: 1 }}>
            {credits ?? '—'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 5 }}>
            {low ? '⚠ Running low — contact us to top up.' : 'New users start with 100 credits.'}
          </div>
        </div>
        <div style={{
          width: 56, height: 56, borderRadius: 14,
          background: low ? 'rgba(255,107,122,0.1)' : 'var(--primary-soft)',
          border: `1px solid ${low ? 'rgba(255,107,122,0.2)' : 'var(--primary-border)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: low ? '#ff6b7a' : 'var(--primary)',
        }}>
          <Icon d="M2 5h20v14H2zM2 10h20" size={22} />
        </div>
      </div>

      {/* Cost breakdown table */}
      <div className="ply-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
          Cost per feature
        </div>
        {CREDIT_COSTS.map((row, i) => (
          <div key={row.feature} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px', borderBottom: i < CREDIT_COSTS.length - 1 ? '1px solid var(--border)' : undefined,
          }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{row.feature}</div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>{row.desc}</div>
            </div>
            <span style={{
              fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700,
              color: 'var(--primary)', minWidth: 48, textAlign: 'right',
            }}>
              {row.cost} cr
            </span>
          </div>
        ))}
      </div>
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
          { value: 'low',    label: 'Low — 15 rounds · 5 cr' },
          { value: 'medium', label: 'Medium — 30 rounds · 10 cr' },
          { value: 'high',   label: 'High — 50 rounds · 16 cr' },
        ]} />
        <SelectRow label="GEPA default tier" field="gepaTier" options={[
          { value: 'low',    label: 'Low — B=100 · 4 cr' },
          { value: 'medium', label: 'Medium — B=260 · 8 cr' },
          { value: 'high',   label: 'High — B=460 · 14 cr' },
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
   ④ PIPELINE CONFIGURATION (read-only display)
══════════════════════════════════════════════════════════════════════ */
const COUNCIL_MODELS = [
  { role: 'Analytical',  model: 'openai/gpt-4o-mini' },
  { role: 'Creative',    model: 'anthropic/claude-3.5-haiku' },
  { role: 'Concise',     model: 'google/gemini-2.5-flash' },
  { role: 'Structured',  model: 'x-ai/grok-4.3' },
];

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

  const { data, isLoading } = useQuery<{ tiers: TierInfo[]; default_tier: string }>({
    queryKey: ['llm-tiers'],
    queryFn: async () => {
      const res = await api.get<{ data: { tiers: TierInfo[]; default_tier: string } }>('/api/v1/openrouter/tiers');
      return res.data.data;
    },
    staleTime: 5 * 60_000,
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
        subtitle="Choose the model tier for Council, Bridge and domain optimizers. Saved as your default for all future runs."
      />

      {isLoading ? (
        <div className="ply-card" style={{ padding: '20px 18px', color: 'var(--text-subtle)', fontSize: 13 }}>Loading pricing…</div>
      ) : (
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
          Stored locally. Applied to every optimization including Council, Bridge, and Domain runs.
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

function PipelineSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SectionTitle
        id="pipeline"
        icon="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
        title="Pipeline configuration"
        subtitle="Active models and feature gates. Change via COUNCIL_MODELS environment variable."
      />

      {/* Council models */}
      <div className="ply-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
          Council models
        </div>
        {COUNCIL_MODELS.map((m, i) => (
          <div key={m.role} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px', borderBottom: i < COUNCIL_MODELS.length - 1 ? '1px solid var(--border)' : undefined,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', minWidth: 72 }}>
                {m.role}
              </span>
            </div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)' }}>{m.model}</span>
          </div>
        ))}
        <div style={{ padding: '10px 16px', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
          <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
            Override via <code style={{ fontFamily: 'var(--mono)', background: 'var(--surface)', padding: '0 4px', borderRadius: 4, fontSize: 11 }}>COUNCIL_MODELS</code> comma-separated env var. Index order maps to strategy.
          </span>
        </div>
      </div>

      {/* Feature gates */}
      <div className="ply-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
          Feature gates
        </div>
        {[
          { label: 'Quality gate',        key: 'QUALITY_GATE_ENABLED',       desc: 'Re-scores synthesized output; loops back if below threshold.' },
          { label: 'Performance gate',    key: 'PERFORMANCE_GATE_ENABLED',    desc: 'Fast-path skip for low-complexity prompts.' },
          { label: 'Subject classifier',  key: 'SUBJECT_CLASSIFIER_ENABLED',  desc: 'Adds domain context to council before optimization.' },
          { label: 'Prompt cache',        key: 'PROMPT_CACHE_ENABLED',        desc: 'Anthropic cache breakpoints on static system prompts.' },
        ].map((g, i, arr) => (
          <div key={g.key} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : undefined,
          }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{g.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>{g.desc}</div>
            </div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, padding: '2px 8px', borderRadius: 5, background: 'rgba(16,185,129,0.1)', color: 'var(--success)', fontWeight: 600 }}>
              enabled
            </span>
          </div>
        ))}
        <div style={{ padding: '10px 16px', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
          <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
            Toggle via env vars (e.g. <code style={{ fontFamily: 'var(--mono)', background: 'var(--surface)', padding: '0 4px', borderRadius: 4, fontSize: 11 }}>QUALITY_GATE_ENABLED=false</code>).
          </span>
        </div>
      </div>
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
      const res = await api.get<{ data: { id: string; email: string; credits: number } }>('/api/v1/users/me');
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
          <CreditsSection credits={userData?.credits} />
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
