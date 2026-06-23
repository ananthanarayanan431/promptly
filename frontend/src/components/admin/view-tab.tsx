'use client';

import { useState } from 'react';
import { PlatformEngagement } from './analytics/platform-engagement';
import { PlatformLogins } from './analytics/platform-logins';
import { AgentOptimizer } from './analytics/agent-optimizer';
import { AgentSkillOpt } from './analytics/agent-skillopt';
import { AgentDomain } from './analytics/agent-domain';
import { AgentBridge } from './analytics/agent-bridge';

type TopToggle = 'platform' | 'agents';

type PlatformView = 'feature_engagement' | 'login_activity';
type AgentView = 'prompt_optimizer' | 'skill_builder' | 'domain_pdogepa' | 'bridge';

const PLATFORM_ITEMS: { id: PlatformView; label: string }[] = [
  { id: 'feature_engagement', label: 'Feature Engagement' },
  { id: 'login_activity',     label: 'Login Activity' },
];

const AGENT_ITEMS: { id: AgentView; label: string }[] = [
  { id: 'prompt_optimizer', label: 'Prompt Optimizer' },
  { id: 'skill_builder',    label: 'Skill Builder' },
  { id: 'domain_pdogepa',   label: 'Domain PDO/GEPA' },
  { id: 'bridge',           label: 'Bridge' },
];

function SidebarItem({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '9px 14px', width: '100%', textAlign: 'left',
        background: active ? 'color-mix(in oklab, var(--primary) 12%, transparent)' : 'transparent',
        color: active ? 'var(--primary)' : 'var(--text-muted)',
        border: 'none', borderRadius: 8,
        fontSize: 13, fontWeight: active ? 600 : 400,
        cursor: 'pointer', transition: 'all .12s',
      }}
    >
      {active && <span style={{ width: 3, height: 14, borderRadius: 99,
        background: 'var(--primary)', flexShrink: 0 }} />}
      {label}
    </button>
  );
}

export function ViewTab() {
  const [toggle, setToggle] = useState<TopToggle>('platform');
  const [platformView, setPlatformView] = useState<PlatformView>('feature_engagement');
  const [agentView, setAgentView] = useState<AgentView>('prompt_optimizer');

  const sidebarItems = toggle === 'platform' ? PLATFORM_ITEMS : AGENT_ITEMS;
  const activeId = toggle === 'platform' ? platformView : agentView;

  const headings: Record<string, { title: string; desc: string }> = {
    feature_engagement: { title: 'Feature Engagement',
      desc: 'Track and analyze user engagement with different features across the platform' },
    login_activity:     { title: 'Login Activity',
      desc: 'Track login activity and daily, weekly, monthly active user trends' },
    prompt_optimizer:   { title: 'Prompt Optimizer',
      desc: 'Council optimizer runs, token consumption, and model distribution' },
    skill_builder:      { title: 'Skill Builder',
      desc: 'SkillOpt runs, score improvements, edit acceptance, and tier breakdown' },
    domain_pdogepa:     { title: 'Domain PDO/GEPA',
      desc: 'Domain prompt optimization and dataset augmentation usage' },
    bridge:             { title: 'Bridge',
      desc: 'Prompt bridge usage, token consumption, and unique users' },
  };

  const heading = headings[activeId] ?? { title: '', desc: '' };

  return (
    <div style={{ display: 'flex', gap: 0, height: '100%', minHeight: 0 }}>
      {/* Sidebar */}
      <div style={{
        width: 200, flexShrink: 0, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', gap: 0, padding: '12px 8px',
      }}>
        {/* Platform / Agents toggle */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16,
          background: 'var(--surface-2)', borderRadius: 8, padding: 4 }}>
          {(['platform', 'agents'] as const).map(t => (
            <button key={t} onClick={() => setToggle(t)} style={{
              flex: 1, padding: '6px 0', fontSize: 12.5, fontWeight: 600,
              borderRadius: 6, border: 'none', cursor: 'pointer',
              background: toggle === t ? 'var(--surface)' : 'transparent',
              color: toggle === t ? 'var(--text)' : 'var(--text-muted)',
              boxShadow: toggle === t ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
              transition: 'all .12s',
            }}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Sidebar nav items */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sidebarItems.map(item => (
            <SidebarItem
              key={item.id}
              label={item.label}
              active={activeId === item.id}
              onClick={() => {
                if (toggle === 'platform') setPlatformView(item.id as PlatformView);
                else setAgentView(item.id as AgentView);
              }}
            />
          ))}
        </div>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {/* Sub-view heading */}
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)',
            margin: 0, letterSpacing: '-.01em' }}>
            {heading.title}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {heading.desc}
          </p>
        </div>

        {/* View content */}
        {toggle === 'platform' && platformView === 'feature_engagement' && <PlatformEngagement />}
        {toggle === 'platform' && platformView === 'login_activity' && <PlatformLogins />}
        {toggle === 'agents' && agentView === 'prompt_optimizer' && <AgentOptimizer />}
        {toggle === 'agents' && agentView === 'skill_builder' && <AgentSkillOpt />}
        {toggle === 'agents' && agentView === 'domain_pdogepa' && <AgentDomain />}
        {toggle === 'agents' && agentView === 'bridge' && <AgentBridge />}
      </div>
    </div>
  );
}
