import Link from 'next/link';
import { LandingNav } from '@/components/landing/nav';
import {
  Sparkles,
  Brain,
  Shield,
  BarChart3,
  GitBranch,
  Zap,
  Lightbulb,
  ArrowRight,
  Check,
  Quote,
  Layers,
  Target,
  Users,
} from 'lucide-react';

/* ─────────────────────────────────────── data ─────────────────────────────── */

const catchyLines = [
  'Committee-approved. Model-tested.',
  'Blind review beats echo chambers.',
  'From vague ask to crisp instruction.',
];

const bento = [
  {
    icon: Layers,
    title: 'Ship prompts, not experiments',
    description:
      'Every optimization is versioned — compare v1 → v2 → v3 and promote what actually moved the needle.',
    className:
      'md:col-span-2 md:row-span-1 min-h-[180px] border-violet-500/20 bg-gradient-to-br from-violet-500/[0.08] to-transparent dark:from-violet-500/10',
    iconClass: 'text-violet-500 dark:text-violet-400',
  },
  {
    icon: Target,
    title: 'Eight dimensions. One score.',
    description: 'Clarity, tone, actionability — scored with rationale you can act on.',
    className: 'border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.06] to-transparent dark:from-emerald-500/10',
    iconClass: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    icon: Users,
    title: 'Four lenses. Zero groupthink.',
    description: 'Anonymous peer review so the best idea wins — not the loudest model.',
    className: 'border-blue-500/20 bg-gradient-to-br from-blue-500/[0.06] to-transparent dark:from-blue-500/10',
    iconClass: 'text-blue-600 dark:text-blue-400',
  },
];

const features = [
  {
    icon: Brain,
    title: 'Multi-Model Council',
    description:
      'Four specialized AI models — GPT-4o Mini, Claude 3.5 Haiku, Gemini 2.0 Flash, and Grok-2 — each optimize your prompt with a completely different strategy.',
    border: 'border-violet-500/25',
    glow: 'from-violet-500/10 to-purple-500/5',
    iconColor: 'text-violet-600 dark:text-violet-400',
  },
  {
    icon: Shield,
    title: 'Blind Peer Review',
    description:
      "Every proposal is anonymised (A/B/C/D) and reviewed by the other models. No bias, no echo chambers — only the strongest ideas survive the critic round.",
    border: 'border-blue-500/25',
    glow: 'from-blue-500/10 to-cyan-500/5',
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
  {
    icon: Sparkles,
    title: 'Chairman Synthesis',
    description:
      'A chairman model receives all four proposals and all four critique reviews, then synthesizes the single best optimized prompt from the collective intelligence.',
    border: 'border-indigo-500/25',
    glow: 'from-indigo-500/10 to-violet-500/5',
    iconColor: 'text-indigo-600 dark:text-indigo-400',
  },
  {
    icon: BarChart3,
    title: '8-Dimension Scoring',
    description:
      'Score any prompt across clarity, specificity, completeness, conciseness, tone, actionability, context richness, and goal alignment — each with a rationale.',
    border: 'border-emerald-500/25',
    glow: 'from-emerald-500/10 to-teal-500/5',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    icon: GitBranch,
    title: 'Version Control',
    description:
      'Every optimized prompt is saved as a new version. Track your prompt evolution across v1 → v2 → v3, compare side by side, and build on past wins.',
    border: 'border-orange-500/25',
    glow: 'from-orange-500/10 to-amber-500/5',
    iconColor: 'text-orange-600 dark:text-orange-400',
  },
  {
    icon: Zap,
    title: 'Advisory Review',
    description:
      'Get a deep advisory breakdown: specific strengths, concrete weaknesses, prioritized improvements, and an overall effectiveness assessment for any prompt.',
    border: 'border-pink-500/25',
    glow: 'from-pink-500/10 to-rose-500/5',
    iconColor: 'text-pink-600 dark:text-pink-400',
  },
];

const steps = [
  {
    number: '01',
    title: 'Submit your prompt',
    description:
      'Paste any existing prompt — a system instruction, task brief, creative directive, or agent persona. Add optional feedback to guide the council.',
    accent: 'text-violet-600 dark:text-violet-400',
    card: 'border-violet-500/20 bg-violet-500/[0.06] dark:bg-violet-500/5',
    connector: 'from-violet-500/40',
  },
  {
    number: '02',
    title: 'Council votes & reviews',
    description:
      'Four models optimize in parallel, then each reviews the others blind. Three rounds of multi-model intelligence — analytical, creative, concise, structured.',
    accent: 'text-blue-600 dark:text-blue-400',
    card: 'border-blue-500/20 bg-blue-500/[0.06] dark:bg-blue-500/5',
    connector: 'from-blue-500/40',
  },
  {
    number: '03',
    title: 'Get the best result',
    description:
      'A synthesis pass combines the strongest elements from all proposals and critiques into the single optimal prompt. Saved automatically as your next version.',
    accent: 'text-emerald-600 dark:text-emerald-400',
    card: 'border-emerald-500/20 bg-emerald-500/[0.06] dark:bg-emerald-500/5',
    connector: '',
  },
];

const models = [
  {
    name: 'GPT-4o Mini',
    role: 'Analytical precision',
    strategy: 'Constraints, output format, edge cases',
    dot: 'bg-green-500 dark:bg-green-400',
    ring: 'ring-green-400/30',
    card: 'border-green-500/20 from-green-500/[0.08] to-green-600/[0.03] dark:from-green-500/8',
  },
  {
    name: 'Claude 3.5 Haiku',
    role: 'Creative depth',
    strategy: 'Context richness, personas, exemplars',
    dot: 'bg-amber-500 dark:bg-amber-400',
    ring: 'ring-amber-400/30',
    card: 'border-amber-500/20 from-amber-500/[0.08] to-amber-600/[0.03] dark:from-amber-500/8',
  },
  {
    name: 'Gemini 2.0 Flash',
    role: 'Radical conciseness',
    strategy: 'Signal density, zero redundancy',
    dot: 'bg-blue-500 dark:bg-blue-400',
    ring: 'ring-blue-400/30',
    card: 'border-blue-500/20 from-blue-500/[0.08] to-blue-600/[0.03] dark:from-blue-500/8',
  },
  {
    name: 'Grok-2',
    role: 'Structured logic',
    strategy: 'Decomposition, schemas, reasoning chains',
    dot: 'bg-violet-500 dark:bg-violet-400',
    ring: 'ring-violet-400/30',
    card: 'border-violet-500/20 from-violet-500/[0.08] to-violet-600/[0.03] dark:from-violet-500/8',
  },
];

/* ─────────────────────────────────────── page ─────────────────────────────── */

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased selection:bg-violet-500/25">
      <LandingNav />

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="relative min-h-[min(100vh,920px)] flex flex-col justify-center pt-28 pb-16 md:pb-24 overflow-hidden">
        {/* mesh + grid — tuned for light and dark */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,oklch(0.62_0.22_280/0.18),transparent_55%),radial-gradient(ellipse_50%_45%_at_100%_30%,oklch(0.58_0.18_250/0.12),transparent_50%),radial-gradient(ellipse_45%_40%_at_0%_70%,oklch(0.65_0.14_200/0.1),transparent_50%)] dark:bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,oklch(0.55_0.22_280/0.35),transparent_55%),radial-gradient(ellipse_50%_45%_at_100%_30%,oklch(0.45_0.2_260/0.2),transparent_50%),radial-gradient(ellipse_45%_40%_at_0%_70%,oklch(0.5_0.12_230/0.15),transparent_50%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,hsl(0_0%_50%/0.06)_1px,transparent_1px),linear-gradient(to_bottom,hsl(0_0%_50%/0.06)_1px,transparent_1px)] [background-size:4rem_4rem] dark:[background-image:linear-gradient(to_right,hsl(0_0%_100%/0.04)_1px,transparent_1px),linear-gradient(to_bottom,hsl(0_0%_100%/0.04)_1px,transparent_1px)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-[20%] right-[-5%] w-[min(520px,90vw)] h-[520px] rounded-full bg-violet-500/[0.07] dark:bg-violet-500/10 blur-[100px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-[5%] left-[-10%] w-[480px] h-[480px] rounded-full bg-indigo-500/[0.06] dark:bg-indigo-500/10 blur-[90px]"
        />

        <div className="relative z-10 max-w-6xl mx-auto px-6 w-full">
          <div className="grid lg:grid-cols-[1fr_min(460px,42%)] gap-12 lg:gap-16 items-center">
            {/* Copy */}
            <div className="text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-violet-500/25 bg-violet-500/[0.08] dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 text-sm font-medium mb-6">
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                Multi-model council · 3-round optimization
              </div>

              <h1 className="text-[2.35rem] sm:text-5xl lg:text-[3.25rem] xl:text-[3.5rem] font-black tracking-tight leading-[1.05] text-balance">
                Prompts that ship
                <br />
                <span className="bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 dark:from-violet-400 dark:via-purple-400 dark:to-blue-400 bg-clip-text text-transparent">
                  win by committee
                </span>
              </h1>

              <p className="mt-5 text-lg md:text-xl text-muted-foreground max-w-xl mx-auto lg:mx-0 leading-relaxed">
                Four models optimize, blind-review each other, and a chairman synthesizes
                the best prompt — so you stop guessing and start shipping.
              </p>

              <div className="mt-6 flex flex-wrap gap-2 justify-center lg:justify-start">
                {catchyLines.map((line) => (
                  <span
                    key={line}
                    className="text-xs font-medium px-3 py-1.5 rounded-full border border-border/80 bg-card/80 text-muted-foreground"
                  >
                    {line}
                  </span>
                ))}
              </div>

              <div className="mt-9 flex flex-col sm:flex-row items-center lg:items-stretch gap-3 sm:gap-4 justify-center lg:justify-start">
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-7 py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-sm transition-all shadow-lg shadow-violet-500/20 dark:shadow-violet-500/25 hover:shadow-violet-500/35 hover:-translate-y-0.5 active:translate-y-0"
                >
                  Start for free
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-7 py-3.5 rounded-xl border border-border bg-background/80 dark:bg-card/50 hover:bg-muted/80 dark:hover:bg-muted/40 text-foreground font-semibold text-sm transition-all hover:-translate-y-0.5 active:translate-y-0 backdrop-blur-sm"
                >
                  Sign in
                </Link>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 justify-center lg:justify-start text-sm text-muted-foreground">
                {['100 free credits', 'No credit card', '4 AI models included'].map((t) => (
                  <span key={t} className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    {t}
                  </span>
                ))}
              </div>
            </div>

            {/* Floating product visual */}
            <div className="relative mx-auto w-full max-w-[440px] lg:max-w-none">
              <div
                aria-hidden
                className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-violet-500/10 via-transparent to-indigo-500/10 blur-2xl dark:from-violet-500/15"
              />
              <div className="relative rotate-0 sm:-rotate-1 lg:rotate-[-2deg] transition-transform duration-500 hover:rotate-0">
                <div className="rounded-2xl border border-border/80 bg-card/90 dark:bg-card/70 backdrop-blur-md shadow-2xl shadow-black/10 dark:shadow-black/40 ring-1 ring-black/[0.04] dark:ring-white/[0.06] overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/40 dark:bg-muted/25">
                    <div className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
                    <div className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                    <div className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
                    <span className="ml-2 text-[11px] text-muted-foreground font-mono tracking-tight">
                      promptly — optimize
                    </span>
                  </div>

                  <div className="p-5 sm:p-6 grid gap-5">
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                        Original prompt
                      </p>
                      <div className="rounded-xl border border-border bg-muted/30 dark:bg-muted/20 p-3.5 text-xs sm:text-sm text-muted-foreground leading-relaxed font-mono min-h-[88px]">
                        &ldquo;Write a blog post about AI and how it affects business&rdquo;
                      </div>
                      <div className="mt-2.5 flex items-center gap-3">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full w-[42%] rounded-full bg-orange-500/80" />
                        </div>
                        <span className="text-[11px] text-orange-600 dark:text-orange-400 font-semibold tabular-nums">
                          4.2 / 10
                        </span>
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                        <Sparkles className="h-3 w-3" />
                        Council optimized
                      </p>
                      <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.06] dark:bg-violet-500/10 p-3.5 text-xs sm:text-sm text-foreground leading-relaxed font-mono min-h-[88px]">
                        &ldquo;As a B2B content strategist, write a 1200-word executive brief on AI
                        adoption ROI for mid-market firms. Include 3 case studies, quantified outcomes,
                        and a 5-step implementation roadmap. Tone: authoritative yet accessible.&rdquo;
                      </div>
                      <div className="mt-2.5 flex items-center gap-3">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full w-[88%] rounded-full bg-gradient-to-r from-violet-600 to-blue-500 dark:from-violet-500 dark:to-blue-400" />
                        </div>
                        <span className="text-[11px] text-violet-600 dark:text-violet-400 font-semibold tabular-nums">
                          8.8 / 10
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-border bg-muted/20 dark:bg-muted/10 px-4 py-2.5 flex items-center gap-4 overflow-x-auto [scrollbar-width:thin]">
                    {models.map((m) => (
                      <div key={m.name} className="flex items-center gap-1.5 shrink-0">
                        <div className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">{m.name}</span>
                      </div>
                    ))}
                    <div className="ml-auto shrink-0 flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                      <Check className="h-3 w-3" />
                      Synthesized
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats ───────────────────────────────────────────────────────────── */}
      <section className="border-y border-border bg-muted/15 dark:bg-muted/10 py-12 md:py-14">
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-y-10 gap-x-6 text-center">
          {[
            { value: '4', label: 'AI models in council' },
            { value: '3', label: 'Optimization rounds' },
            { value: '8', label: 'Quality dimensions' },
            { value: '100', label: 'Free starting credits' },
          ].map((s) => (
            <div key={s.label}>
              <div className="text-4xl sm:text-5xl font-black bg-gradient-to-br from-violet-600 to-blue-600 dark:from-violet-400 dark:to-blue-400 bg-clip-text text-transparent tabular-nums">
                {s.value}
              </div>
              <div className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-snug uppercase tracking-wide">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Ideas (bento) ───────────────────────────────────────────────────── */}
      <section id="ideas" className="py-24 md:py-28 px-6 scroll-mt-28">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12 md:mb-14">
            <p className="text-sm font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-widest mb-3">
              Ideas that work
            </p>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-black tracking-tight text-balance">
              Built for clarity — not chaos
            </h2>
            <p className="mt-3 text-muted-foreground max-w-lg mx-auto leading-relaxed">
              A calmer, more intentional workflow: score, review, synthesize, and version — in one
              place.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4 md:gap-5 auto-rows-fr">
            {bento.map((item) => (
              <div
                key={item.title}
                className={`group relative rounded-2xl border p-6 md:p-7 flex flex-col justify-between ${item.className} hover:border-border transition-colors duration-300`}
              >
                <div>
                  <div className="h-10 w-10 rounded-xl bg-background/80 dark:bg-background/50 border border-border flex items-center justify-center mb-4 shadow-sm">
                    <item.icon className={`h-5 w-5 ${item.iconClass}`} />
                  </div>
                  <h3 className="font-bold text-lg mb-2 leading-snug">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 flex justify-center">
            <div className="inline-flex items-start gap-3 max-w-xl rounded-2xl border border-border/80 bg-card/50 dark:bg-card/30 px-5 py-4 text-left">
              <Quote className="h-8 w-8 text-violet-500/40 shrink-0 mt-0.5" aria-hidden />
              <p className="text-sm text-muted-foreground leading-relaxed">
                <span className="text-foreground font-medium">Your prompt&apos;s last draft before production.</span>{' '}
                Stop recycling the same vague instructions — let the council stress-test structure,
                tone, and edge cases before your users ever see them.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────────── */}
      <section id="features" className="py-24 md:py-28 px-6 bg-muted/20 dark:bg-muted/10 scroll-mt-28">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-sm font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-widest mb-3">
              Features
            </p>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-black tracking-tight">
              Everything your prompts need
            </h2>
            <p className="mt-3 text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
              From raw idea to council-approved output — every tool to build prompts that
              consistently deliver.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((f) => (
              <div
                key={f.title}
                className={`group relative rounded-2xl border ${f.border} bg-gradient-to-br ${f.glow} p-6 hover:scale-[1.02] transition-all duration-200 overflow-hidden`}
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-br from-foreground/[0.02] to-transparent dark:from-white/[0.03]" />
                <div className="relative">
                  <div className="h-10 w-10 rounded-xl bg-background/80 border border-border flex items-center justify-center mb-4 shadow-sm">
                    <f.icon className={`h-5 w-5 ${f.iconColor}`} />
                  </div>
                  <h3 className="font-bold text-base mb-2">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-24 md:py-28 px-6 scroll-mt-28">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-sm font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-widest mb-3">
              Process
            </p>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-black tracking-tight">
              How the council works
            </h2>
            <p className="mt-3 text-lg text-muted-foreground max-w-xl mx-auto">
              Three rounds of structured multi-model debate, distilled into one perfect prompt.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {steps.map((step) => (
              <div key={step.number} className="relative">
                <div className={`rounded-2xl border ${step.card} p-7 h-full`}>
                  <div className={`text-5xl sm:text-6xl font-black ${step.accent} opacity-25 mb-4 leading-none`}>
                    {step.number}
                  </div>
                  <h3 className="font-bold text-base mb-2">{step.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── The Council ──────────────────────────────────────────────────────── */}
      <section id="council" className="py-24 md:py-28 px-6 bg-muted/20 dark:bg-muted/10 scroll-mt-28">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest mb-3">
              The Council
            </p>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-black tracking-tight">
              Four models. One verdict.
            </h2>
            <p className="mt-3 text-lg text-muted-foreground max-w-xl mx-auto">
              Each model brings a distinct optimization lens. Together they cover every angle your
              prompt could need.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {models.map((m) => (
              <div
                key={m.name}
                className={`rounded-2xl border bg-gradient-to-br ${m.card} p-6 hover:scale-[1.03] transition-transform duration-200 cursor-default to-transparent`}
              >
                <div className={`h-3 w-3 rounded-full ${m.dot} mb-4 ring-4 ${m.ring}`} />
                <p className="font-bold text-sm mb-0.5">{m.name}</p>
                <p className="text-xs text-muted-foreground font-medium mb-3">{m.role}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{m.strategy}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground text-center">
              <div className="h-px w-10 bg-border hidden sm:block" />
              <span>Chairman synthesizes the best from all four</span>
              <div className="h-px w-10 bg-border hidden sm:block" />
            </div>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-emerald-500/25 bg-emerald-500/[0.08] dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-sm font-semibold">
              <Check className="h-4 w-4" />
              One optimal prompt
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────────── */}
      <section className="py-24 md:py-28 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="relative rounded-3xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.08] via-background to-indigo-500/[0.06] dark:from-violet-500/10 dark:to-indigo-500/10 p-12 md:p-16 overflow-hidden">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,hsl(0_0%_50%/0.05)_1px,transparent_1px),linear-gradient(to_bottom,hsl(0_0%_50%/0.05)_1px,transparent_1px)] [background-size:2.5rem_2.5rem] rounded-3xl opacity-60 dark:opacity-40"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-violet-500/15 blur-3xl"
            />

            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 mb-5 text-violet-600 dark:text-violet-400">
                <Lightbulb className="h-8 w-8" />
              </div>
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-black tracking-tight mb-3">
                Ready to optimize?
              </h2>
              <p className="text-lg text-muted-foreground mb-9 max-w-md mx-auto leading-relaxed">
                100 free credits on sign-up. No credit card. Your first council session is one click
                away.
              </p>
              <Link
                href="/register"
                className="inline-flex items-center gap-2.5 px-8 py-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-base transition-all shadow-xl shadow-violet-500/20 dark:shadow-violet-500/30 hover:shadow-violet-500/40 hover:-translate-y-0.5 active:translate-y-0"
              >
                Get started for free
                <ArrowRight className="h-5 w-5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border py-12 px-6 bg-muted/10">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <Sparkles className="h-5 w-5 text-violet-500" />
            Promptly
          </Link>
          <p className="text-sm text-muted-foreground text-center max-w-md leading-relaxed">
            Multi-model AI prompt optimization. Powered by GPT-4o Mini · Claude 3.5 Haiku · Gemini
            2.0 Flash · Grok-2.
          </p>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link href="/login" className="hover:text-foreground transition-colors">
              Sign in
            </Link>
            <Link href="/register" className="hover:text-foreground transition-colors">
              Register
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
