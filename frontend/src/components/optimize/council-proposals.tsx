'use client';

import { useState } from 'react';
import type { CouncilProposal } from '@/types/api';

const STRATEGY_LABELS: Record<string, string> = {
  'openai/gpt-4o-mini': 'Analytical',
  'anthropic/claude-3.5-haiku': 'Creative',
  'google/gemini-2.0-flash-001': 'Concise',
  'x-ai/grok-2-1212': 'Structured',
};

const STRATEGY_COLORS: Record<string, string> = {
  Analytical: '#7c5cff',
  Creative: '#22c55e',
  Concise: '#f59e0b',
  Structured: '#3b82f6',
};

function getStrategyLabel(model: string): string {
  return STRATEGY_LABELS[model] ?? model.split('/').pop() ?? model;
}

function getModelShortName(model: string): string {
  return model.split('/').pop()?.replace(/-/g, ' ') ?? model;
}

export function CouncilProposals({ proposals }: { proposals: CouncilProposal[] }) {
  const [open, setOpen] = useState<number | null>(null);

  if (!proposals || proposals.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8,
      fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5a5a60" strokeWidth="1.6">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
        </svg>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: '#8a8a90' }}>Council Proposals</span>
        <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
          padding: '1px 6px', borderRadius: 4, background: '#222226', border: '1px solid #2a2a2e',
          color: '#5a5a60' }}>{proposals.length} models</span>
      </div>

      <div style={{ border: '1px solid #1f1f23', borderRadius: 10, overflow: 'hidden' }}>
        {proposals.map((proposal, idx) => {
          const strategy = getStrategyLabel(proposal.model);
          const color = STRATEGY_COLORS[strategy] ?? '#7c5cff';
          const isOpen = open === idx;

          return (
            <div key={idx} style={{ borderBottom: idx < proposals.length - 1 ? '1px solid #1f1f23' : 'none' }}>
              <button onClick={() => setOpen(isOpen ? null : idx)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer',
                  textAlign: 'left', transition: 'background 100ms' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
                  fontWeight: 600, padding: '2px 7px', borderRadius: 4,
                  background: `${color}18`, color, border: `1px solid ${color}30`,
                  flexShrink: 0 }}>{strategy}</span>
                <span style={{ fontSize: 12, color: '#5a5a60', flex: 1, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontFamily: 'var(--font-geist-mono, monospace)' }}>
                  {getModelShortName(proposal.model)}
                </span>
                <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
                  color: '#5a5a60', flexShrink: 0 }}>
                  {proposal.usage?.total_tokens ?? 0} tok
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="#5a5a60" strokeWidth="1.8"
                  style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms', flexShrink: 0 }}>
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
              {isOpen && (
                <div style={{ padding: '0 14px 14px' }}>
                  <pre style={{ margin: 0, padding: '12px 14px', borderRadius: 8,
                    background: '#131316', border: '1px solid #1f1f23',
                    fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12,
                    color: '#8a8a90', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {proposal.optimized_prompt}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
