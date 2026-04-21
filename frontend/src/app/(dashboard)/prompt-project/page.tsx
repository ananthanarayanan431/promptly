export default function PromptProjectPage() {
  return (
    <div style={{
      maxWidth: 760,
      margin: '0 auto',
      padding: '56px 32px 80px',
    }}>

      {/* Header */}
      <div style={{ marginBottom: 48 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: 'linear-gradient(135deg, #7c5cff22 0%, #7c5cff44 100%)',
            border: '1px solid #7c5cff40',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7c5cff" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M8 12h8M8 8h5M8 16h6"/>
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ fontSize: 22, fontWeight: 600, color: '#ededed', margin: 0, letterSpacing: '-0.3px' }}>
                Prompt Projects
              </h1>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '3px 10px', borderRadius: 20,
                background: '#7c5cff18', border: '1px solid #7c5cff35',
                fontSize: 10.5, fontWeight: 500, color: '#9e82ff',
                letterSpacing: '0.4px', textTransform: 'uppercase' as const,
              }}>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%', background: '#7c5cff',
                  display: 'inline-block', animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
                }} />
                Coming soon
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 13.5, color: '#8a8a90', lineHeight: 1.5 }}>
              A purpose-built workspace for crafting, testing, and managing prompts for your AI agents.
            </p>
          </div>
        </div>
      </div>

      {/* Section: What is a Prompt Project */}
      <Section
        eyebrow="The concept"
        title="Build a complete prompt suite for your agent"
        body="A Prompt Project is a collection of all the prompts that power a single AI agent — system instructions, task handlers, fallback responses, tool-use descriptions, and more. Instead of scattering them across chat sessions, you keep every prompt for an agent in one place, optimise them together, and ship a coherent set."
      />

      {/* Use-case cards */}
      <div style={{ marginBottom: 48 }}>
        <Label>Example use cases</Label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
          {USECASES.map(u => (
            <UsecaseCard key={u.title} icon={u.icon} title={u.title} body={u.body} />
          ))}
        </div>
      </div>

      {/* Section: Agent Interaction System */}
      <Section
        eyebrow="Agent interaction system"
        title="Test how your agent responds — before you ship"
        body="Once your prompt suite is ready, the Agent Interaction System lets you talk directly to your configured agent inside Promptly. Send it messages, see which prompt fired, inspect the raw model output, and iterate in place. No external calls, no copy-pasting into playgrounds — the feedback loop stays inside your project."
      />

      {/* Interaction flow diagram */}
      <div style={{ marginBottom: 48 }}>
        <Label>How it works</Label>
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 0 }}>
          {FLOW.map((step, i) => (
            <div key={step.label} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              {/* connector */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 32, flexShrink: 0 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: '#17171b', border: '1px solid #7c5cff50',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, color: '#9e82ff', fontWeight: 600, flexShrink: 0,
                }}>
                  {i + 1}
                </div>
                {i < FLOW.length - 1 && (
                  <div style={{ width: 1, flex: 1, minHeight: 20, background: '#1f1f23', margin: '4px 0' }} />
                )}
              </div>
              <div style={{ paddingBottom: i < FLOW.length - 1 ? 20 : 0, paddingTop: 6 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: '#d4d4d8', marginBottom: 3 }}>{step.label}</div>
                <div style={{ fontSize: 12.5, color: '#8a8a90', lineHeight: 1.6 }}>{step.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Feature grid */}
      <div style={{ marginBottom: 48 }}>
        <Label>What&apos;s being built</Label>
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {FEATURES.map(f => (
            <div key={f.label} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '12px 16px', borderRadius: 8,
              background: '#17171b', border: '1px solid #1f1f23',
            }}>
              <span style={{ fontSize: 15, marginTop: 1 }}>{f.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#d4d4d8', marginBottom: 2 }}>{f.label}</div>
                <div style={{ fontSize: 12.5, color: '#8a8a90', lineHeight: 1.5 }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: '16px 20px', borderRadius: 8,
        background: '#17171b', border: '1px solid #1f1f23',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7c5cff" strokeWidth="1.5" style={{ flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
        </svg>
        <p style={{ margin: 0, fontSize: 12.5, color: '#8a8a90', lineHeight: 1.6 }}>
          Prompt Projects and the Agent Interaction System are actively being designed.
          Features described here reflect current plans and may evolve as we build.
        </p>
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

/* ── small reusable pieces ───────────────────────────────────────── */

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: '#5a5a60', letterSpacing: '0.6px', textTransform: 'uppercase' as const }}>
      {children}
    </div>
  );
}

function Section({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div style={{ marginBottom: 40 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#7c5cff', letterSpacing: '0.6px', textTransform: 'uppercase' as const, marginBottom: 8 }}>
        {eyebrow}
      </div>
      <h2 style={{ fontSize: 17, fontWeight: 600, color: '#ededed', margin: '0 0 10px', letterSpacing: '-0.2px' }}>
        {title}
      </h2>
      <p style={{ fontSize: 13.5, color: '#8a8a90', lineHeight: 1.75, margin: 0, maxWidth: 620 }}>
        {body}
      </p>
    </div>
  );
}

function UsecaseCard({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div style={{
      padding: '16px 18px', borderRadius: 10,
      background: '#17171b', border: '1px solid #1f1f23',
    }}>
      <div style={{ fontSize: 20, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: '#d4d4d8', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: '#8a8a90', lineHeight: 1.6 }}>{body}</div>
    </div>
  );
}

/* ── data ─────────────────────────────────────────────────────────── */

const USECASES = [
  {
    icon: '🤖',
    title: 'Customer support agent',
    body: 'Craft a system prompt, tone guidelines, escalation logic, and refusal templates — optimise each one separately, then ship the full set together.',
  },
  {
    icon: '✍️',
    title: 'Content writing agent',
    body: 'Manage prompts for brief intake, drafting, SEO rewriting, and headline generation as a single versioned project.',
  },
  {
    icon: '🔍',
    title: 'Research & summarisation agent',
    body: 'Keep query-expansion, source-ranking, and summary-formatting prompts aligned with each other as your agent evolves.',
  },
  {
    icon: '💻',
    title: 'Code review agent',
    body: 'Version your review criteria, severity classification, and suggestion-formatting prompts together so changes stay consistent.',
  },
];

const FLOW = [
  {
    label: 'Define your prompt suite',
    desc: 'Add each prompt your agent uses — system instructions, tool descriptions, few-shot examples — and tag them by role.',
  },
  {
    label: 'Optimise individually or as a batch',
    desc: 'Run any prompt through the Promptly council. Improvements are saved as new versions inside the project, not scattered across sessions.',
  },
  {
    label: 'Open the interaction sandbox',
    desc: 'Send test messages to your agent directly from the project. Promptly routes each turn through your configured prompt suite.',
  },
  {
    label: 'Inspect and iterate',
    desc: 'See which prompt fired, the raw model output, token usage, and health score — then edit and re-test without leaving the page.',
  },
  {
    label: 'Export or deploy',
    desc: 'Download the finalised prompt set as JSON or connect via API to pull the latest approved versions into your production agent.',
  },
];

const FEATURES = [
  {
    icon: '📁',
    label: 'Project workspace',
    desc: 'Group all prompts for a single agent into one named project with shared versioning and history.',
  },
  {
    icon: '⚡',
    label: 'Batch optimisation',
    desc: 'Queue every prompt in a project for optimisation in one click. Results come back as new versions, not overwriting the originals.',
  },
  {
    icon: '💬',
    label: 'Agent interaction sandbox',
    desc: 'A built-in chat interface that runs against your project\'s active prompt suite so you can test the full agent experience.',
  },
  {
    icon: '🔀',
    label: 'Prompt-level diff view',
    desc: 'Compare any two versions of a prompt side-by-side with highlighted changes, quality scores, and rollback in one click.',
  },
  {
    icon: '🔗',
    label: 'API access',
    desc: 'Pull the latest approved prompts from a project via the Promptly API so your production agent always uses the current best version.',
  },
];
