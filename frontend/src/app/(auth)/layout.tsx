export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen flex items-stretch bg-background overflow-hidden">
      {/* ── Left column — form ───────────────────────────────────────── */}
      <div className="relative z-10 flex flex-1 items-center justify-center px-6 py-12 lg:max-w-lg xl:max-w-xl">
        {/* Radial gradient behind form */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_30%_40%,oklch(0.62_0.22_280/0.12),transparent_60%)] dark:bg-[radial-gradient(ellipse_80%_60%_at_30%_40%,oklch(0.55_0.22_280/0.25),transparent_60%)]"
        />
        <div className="relative w-full max-w-md">{children}</div>
      </div>

      {/* ── Right column — feature panel (hidden on mobile) ──────────── */}
      <div className="hidden lg:flex flex-1 items-center justify-center relative overflow-hidden bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-700 dark:from-violet-700 dark:via-indigo-700 dark:to-blue-800">
        {/* Mesh overlay */}
        <div
          aria-hidden
          className="absolute inset-0 [background-image:linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:3rem_3rem]"
        />
        {/* Glow spots */}
        <div aria-hidden className="absolute top-[-10%] right-[-10%] w-96 h-96 rounded-full bg-white/10 blur-3xl" />
        <div aria-hidden className="absolute bottom-[-10%] left-[-5%] w-80 h-80 rounded-full bg-indigo-400/20 blur-3xl" />

        <div className="relative z-10 max-w-sm px-8 text-white space-y-10">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-white/15 backdrop-blur-sm border border-white/20">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z" />
              </svg>
            </div>
            <span className="font-black text-xl tracking-tight">Promptly</span>
          </div>

          {/* Headline */}
          <div className="space-y-3">
            <h2 className="text-3xl font-black leading-snug tracking-tight">
              Better prompts.<br />Better results.
            </h2>
            <p className="text-white/75 leading-relaxed text-sm">
              Four AI models compete to optimize your prompt, blind-review each other,
              and produce a single best result — automatically.
            </p>
          </div>

          {/* Feature list */}
          <ul className="space-y-4">
            {[
              { label: 'Multi-model optimization', sub: 'Four specialized models, one result' },
              { label: 'Blind peer review', sub: 'Anonymous critique eliminates bias' },
              { label: 'Version history', sub: 'Track every improvement over time' },
              { label: '8-dimension scoring', sub: 'Clarity, tone, goal alignment & more' },
            ].map((f) => (
              <li key={f.label} className="flex items-start gap-3">
                <div className="mt-0.5 h-5 w-5 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                  <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="2 6 5 9 10 3" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold">{f.label}</p>
                  <p className="text-xs text-white/60 mt-0.5">{f.sub}</p>
                </div>
              </li>
            ))}
          </ul>

          {/* Quote */}
          <div className="border-l-2 border-white/30 pl-4">
            <p className="text-sm text-white/70 italic leading-relaxed">
              "Stop recycling vague instructions — let AI stress-test your prompts before
              your users ever see them."
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
