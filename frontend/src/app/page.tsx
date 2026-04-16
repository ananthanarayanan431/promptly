import Link from 'next/link';
import { LandingNav } from '@/components/landing/nav';
import {
  Sparkles,
  MessageSquareDiff,
  ShieldCheck,
  BarChart3,
  GitBranch,
  Lightbulb,
  ArrowRight,
  Check,
  Clock,
  RefreshCw,
  Target,
  ChevronRight,
} from 'lucide-react';

/* ─────────────────────────────────────── data ─────────────────────────────── */

const benefits = [
  {
    icon: Target,
    title: 'Get it right the first time',
    description:
      'Stop cycling through rewrites. Promptly delivers a polished, precise version of your prompt so your AI actually gives you what you meant.',
    tag: 'Accuracy',
  },
  {
    icon: ShieldCheck,
    title: 'Catch every blind spot',
    description:
      'A single perspective misses things. Multiple independent checks surface weaknesses and gaps you\'d never catch on your own.',
    tag: 'Quality',
  },
  {
    icon: Sparkles,
    title: 'One clear answer, every time',
    description:
      'No conflicting suggestions, no option overload. You get a single, synthesized result that combines the best of everything.',
    tag: 'Clarity',
  },
  {
    icon: BarChart3,
    title: "Know exactly what's working",
    description:
      "See a plain-English breakdown of what's strong, what's weak, and what to fix — across eight dimensions that actually matter.",
    tag: 'Insight',
  },
  {
    icon: GitBranch,
    title: 'Build on what already works',
    description:
      'Every improvement is saved as a new version. Go back, compare, and keep what moved the needle instead of starting from scratch.',
    tag: 'Memory',
  },
  {
    icon: Lightbulb,
    title: 'Expert guidance, plain English',
    description:
      'Get a full advisory review with specific strengths, concrete weaknesses, and prioritized fixes — without needing to know anything about prompt engineering.',
    tag: 'Guidance',
  },
];

const steps = [
  {
    num: '01',
    title: 'Paste what you have',
    desc: "Drop in any prompt — a half-formed idea, a system instruction, a task brief. It doesn't have to be good yet.",
    color: 'text-primary border-primary/20 bg-primary/5',
  },
  {
    num: '02',
    title: 'Watch it get stress-tested',
    desc: "Multiple independent perspectives check your prompt from different angles, catching gaps and weaknesses you'd never spot alone.",
    color: 'text-blue-600 dark:text-blue-400 border-blue-500/20 bg-blue-500/5',
  },
  {
    num: '03',
    title: 'Get the best version back',
    desc: 'The strongest ideas are combined into one clear, polished result — ready to copy and use immediately.',
    color: 'text-emerald-600 dark:text-emerald-400 border-emerald-500/20 bg-emerald-500/5',
  },
];

const proofPoints = [
  { value: 'Seconds', label: 'Not hours of editing' },
  { value: 'Zero', label: 'Prompt expertise needed' },
  { value: 'Any AI', label: 'ChatGPT, Claude, Gemini…' },
  { value: 'Free', label: 'to get started today' },
];

const comparisons = [
  { before: 'Vague instructions that confuse your AI', after: 'Clear, precise prompts that deliver exactly what you need' },
  { before: 'Endless back-and-forth trying to get a usable response', after: 'First-shot results you can actually use' },
  { before: 'Guessing what makes a prompt "good"', after: 'An exact breakdown of what to fix and why' },
  { before: 'Starting from scratch every single time', after: 'A growing library of your best, versioned prompts' },
];

/* ─────────────────────────────────────── page ─────────────────────────────── */

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <LandingNav />

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="relative min-h-[100svh] flex flex-col justify-center pt-28 pb-20 overflow-hidden">
        {/* Background */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] bg-[radial-gradient(ellipse_at_top,oklch(0.67_0.22_285_/_0.15),transparent_70%)]" />
          <div className="absolute bottom-0 right-0 w-[500px] h-[400px] bg-[radial-gradient(ellipse_at_bottom_right,oklch(0.6_0.18_220_/_0.08),transparent_60%)]" />
          <div className="absolute inset-0 [background-image:linear-gradient(to_right,oklch(0.5_0_0_/_0.04)_1px,transparent_1px),linear-gradient(to_bottom,oklch(0.5_0_0_/_0.04)_1px,transparent_1px)] [background-size:56px_56px]" />
        </div>

        <div className="relative z-10 max-w-5xl mx-auto px-6 w-full">
          {/* Badge */}
          <div className="flex justify-center mb-8">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/25 bg-primary/8 text-primary text-xs font-semibold tracking-wide uppercase">
              <Sparkles className="h-3 w-3" />
              Free to start · No credit card
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-center text-5xl sm:text-6xl md:text-7xl lg:text-[5rem] font-black tracking-tight leading-[1.02] text-balance mb-6">
            Your AI is only as good
            <br />
            <span className="bg-gradient-to-r from-primary via-primary/80 to-primary/60 bg-clip-text text-transparent">
              as what you tell it.
            </span>
          </h1>

          {/* Sub */}
          <p className="text-center text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed mb-10">
            Promptly turns rough, vague instructions into polished, precise prompts —
            so you finally get the response you actually wanted.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-10">
            <Link
              href="/register"
              className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:-translate-y-0.5 active:translate-y-0"
            >
              Fix my prompts for free
              <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl border border-border bg-background/80 hover:bg-muted/60 text-foreground font-semibold text-sm transition-all hover:-translate-y-0.5 active:translate-y-0 backdrop-blur-sm"
            >
              Sign in
            </Link>
          </div>

          {/* Trust row */}
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
            {['100 free credits', 'No credit card', 'Works with any AI'].map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Proof points bar ─────────────────────────────────────────────────── */}
      <section className="border-y border-border/60">
        <div className="max-w-4xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 divide-x divide-border/60">
          {proofPoints.map((p) => (
            <div key={p.label} className="py-10 text-center">
              <div className="text-3xl sm:text-4xl font-black text-primary tabular-nums">{p.value}</div>
              <div className="text-xs text-muted-foreground mt-1.5 leading-snug max-w-[110px] mx-auto">{p.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Before / After ───────────────────────────────────────────────────── */}
      <section className="py-28 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-primary mb-4">Sound familiar?</p>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight">
              Tired of prompts
              <br />
              that miss the mark?
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Before column */}
            <div className="rounded-2xl border border-border/60 bg-muted/20 p-7">
              <div className="flex items-center gap-2 mb-5">
                <div className="h-2 w-2 rounded-full bg-destructive/70" />
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Without Promptly</p>
              </div>
              <ul className="space-y-4">
                {comparisons.map((c) => (
                  <li key={c.before} className="flex items-start gap-3">
                    <RefreshCw className="h-4 w-4 text-muted-foreground/50 shrink-0 mt-0.5" />
                    <p className="text-sm text-muted-foreground leading-relaxed">{c.before}</p>
                  </li>
                ))}
              </ul>
            </div>

            {/* After column */}
            <div className="rounded-2xl border border-primary/25 bg-primary/5 p-7">
              <div className="flex items-center gap-2 mb-5">
                <div className="h-2 w-2 rounded-full bg-primary" />
                <p className="text-xs font-bold uppercase tracking-wider text-primary">With Promptly</p>
              </div>
              <ul className="space-y-4">
                {comparisons.map((c) => (
                  <li key={c.after} className="flex items-start gap-3">
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <p className="text-sm text-foreground leading-relaxed font-medium">{c.after}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-28 px-6 bg-muted/20 dark:bg-muted/10 scroll-mt-24">
        <div className="max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-[1fr_2fr] gap-16 items-start">
            {/* Left label */}
            <div className="lg:sticky lg:top-32">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-primary mb-4">How it works</p>
              <h2 className="text-4xl md:text-5xl font-black tracking-tight leading-[1.05] mb-4">
                Paste. Fix.
                <br />
                Copy.
                <br />
                Done.
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                No setup, no learning curve. Works with ChatGPT, Claude, Gemini, or any AI you already use.
              </p>
            </div>

            {/* Steps */}
            <div className="space-y-4">
              {steps.map((step) => (
                <div key={step.num} className={`rounded-2xl border ${step.color} p-7 flex gap-6 items-start`}>
                  <span className="text-4xl font-black opacity-30 shrink-0 leading-none mt-1">{step.num}</span>
                  <div>
                    <h3 className="font-bold text-base text-foreground mb-1.5">{step.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Benefits grid ────────────────────────────────────────────────────── */}
      <section id="features" className="py-28 px-6 scroll-mt-24">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-14">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-primary mb-4">What you get</p>
              <h2 className="text-4xl md:text-5xl font-black tracking-tight leading-tight">
                Everything a great
                <br />
                prompt needs.
              </h2>
            </div>
            <Link
              href="/register"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary/80 transition-colors shrink-0"
            >
              Start free <ChevronRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {benefits.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-border/70 bg-card p-6 hover:border-primary/30 hover:shadow-sm transition-all duration-200"
              >
                <div className="flex items-start justify-between mb-5">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <f.icon className="h-5 w-5 text-primary" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 border border-border rounded-full px-2 py-0.5">
                    {f.tag}
                  </span>
                </div>
                <h3 className="font-bold text-sm mb-2">{f.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Time saved callout ───────────────────────────────────────────────── */}
      <section className="py-28 px-6 bg-muted/20 dark:bg-muted/10">
        <div className="max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Left: visual */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: Clock, label: 'Stop wasting time on rewrites', bg: 'bg-primary/10', iconColor: 'text-primary' },
                { icon: MessageSquareDiff, label: 'Works with any AI tool you already use', bg: 'bg-emerald-500/10', iconColor: 'text-emerald-600 dark:text-emerald-400' },
                { icon: BarChart3, label: 'See what makes a prompt strong or weak', bg: 'bg-amber-500/10', iconColor: 'text-amber-600 dark:text-amber-400' },
                { icon: GitBranch, label: 'Never lose a great prompt again', bg: 'bg-blue-500/10', iconColor: 'text-blue-600 dark:text-blue-400' },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-border/60 bg-card p-5">
                  <div className={`h-9 w-9 rounded-xl ${item.bg} flex items-center justify-center mb-3`}>
                    <item.icon className={`h-4.5 w-4.5 ${item.iconColor}`} />
                  </div>
                  <p className="text-xs font-medium leading-snug">{item.label}</p>
                </div>
              ))}
              {/* Spanning CTA card */}
              <div className="col-span-2 rounded-2xl border border-primary/25 bg-primary/5 p-5 flex items-center justify-between">
                <div>
                  <p className="font-bold text-sm">Ready to stop guessing?</p>
                  <p className="text-xs text-muted-foreground mt-0.5">100 free credits, no card needed</p>
                </div>
                <Link
                  href="/register"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-all shadow-sm shadow-primary/20 shrink-0"
                >
                  Start free <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>

            {/* Right: copy */}
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-primary mb-4">Built for results</p>
              <h2 className="text-4xl md:text-5xl font-black tracking-tight leading-[1.05] mb-4">
                Prompts that
                <br />
                actually work.
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                Whether you're writing system instructions, creative briefs, task descriptions, or agent personas — Promptly ensures every prompt is clear, specific, and built to get the response you want.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                No jargon. No learning curve. Just paste what you have, and walk away with something better.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────────── */}
      <section className="py-28 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="relative rounded-3xl overflow-hidden bg-foreground text-background px-10 py-20 text-center">
            {/* grid overlay */}
            <div aria-hidden className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,oklch(1_0_0_/_0.04)_1px,transparent_1px),linear-gradient(to_bottom,oklch(1_0_0_/_0.04)_1px,transparent_1px)] [background-size:48px_48px]" />
            {/* glow */}
            <div aria-hidden className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-[radial-gradient(ellipse_at_top,oklch(0.67_0.22_285_/_0.3),transparent_60%)]" />

            <div className="relative z-10">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary mb-5">Get started free</p>
              <h2 className="text-5xl md:text-6xl lg:text-7xl font-black tracking-tight leading-none mb-5">
                Your first better
                <br />
                prompt is one click away.
              </h2>
              <p className="text-base text-background/60 mb-10 max-w-md mx-auto leading-relaxed">
                100 free credits on sign-up. No credit card. Start getting better AI results in under a minute.
              </p>
              <Link
                href="/register"
                className="inline-flex items-center gap-2.5 px-8 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-base hover:bg-primary/90 transition-all shadow-xl shadow-primary/30 hover:-translate-y-0.5 active:translate-y-0"
              >
                Fix my prompts for free
                <ArrowRight className="h-5 w-5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border py-10 px-6">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 font-bold text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Promptly
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Works with ChatGPT · Claude · Gemini · and every AI you already use
          </p>
          <div className="flex items-center gap-5 text-sm text-muted-foreground">
            <Link href="/login" className="hover:text-foreground transition-colors">Sign in</Link>
            <Link href="/register" className="hover:text-foreground transition-colors">Get started</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
