'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { env } from '@/lib/env';
import { SocialButtons } from './social-buttons';
import styles from './auth.module.css';

const AFTER_AUTH = '/optimize';

function readError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  return mode === 'sign-in' ? <SignInForm /> : <SignUpForm />;
}

/* ───────────────────────────── Sign in ───────────────────────────── */

function SignInForm() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError(readError(err));
      setBusy(false);
    } else {
      router.push(AFTER_AUTH);
    }
  }

  return (
    <div className={styles.shell}>
      <h1 className={styles.heading}>Sign in to promptly</h1>
      <p className={styles.subhead}>Welcome back — let&apos;s optimize.</p>

      <SocialButtons mode="sign-in" />
      <div className={styles.divider}>or</div>

      <form className={styles.form} onSubmit={onSubmit}>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className={styles.input}
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            required
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className={styles.input}
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
        </div>
        <button className={styles.submit} type="submit" disabled={busy}>
          {busy ? <span className={styles.spinner} /> : 'Sign in'}
        </button>
      </form>

      <p className={styles.footer}>
        New to promptly?{' '}
        <Link className={styles.footerLink} href="/sign-up">
          Create account
        </Link>
      </p>
    </div>
  );
}

/* ───────────────────────────── Sign up ───────────────────────────── */

function SignUpForm() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [step, setStep] = useState<'form' | 'verify'>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      },
    });
    if (err) {
      setError(readError(err));
      setBusy(false);
    } else {
      setStep('verify');
      setBusy(false);
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    });
    if (err) {
      setError(readError(err));
      setBusy(false);
    } else {
      router.push(AFTER_AUTH);
    }
  }

  if (step === 'verify') {
    return (
      <div className={styles.shell}>
        <h1 className={styles.heading}>Check your email</h1>
        <p className={styles.subhead}>We sent a verification code to {email}.</p>

        <form className={styles.form} onSubmit={onVerify}>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="code">
              Verification code
            </label>
            <input
              id="code"
              className={styles.input}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
              required
            />
          </div>
          <button className={styles.submit} type="submit" disabled={busy}>
            {busy ? <span className={styles.spinner} /> : 'Verify & continue'}
          </button>
        </form>

        <p className={styles.footer}>
          <button
            type="button"
            className={styles.footerLink}
            onClick={() => {
              setStep('form');
              setError(null);
            }}
          >
            Use a different email
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <h1 className={styles.heading}>Create your account</h1>
      <p className={styles.subhead}>Four models. Three rounds. One better prompt.</p>

      <SocialButtons mode="sign-up" />
      <div className={styles.divider}>or</div>

      <form className={styles.form} onSubmit={onCreate}>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="su-email">
            Email
          </label>
          <input
            id="su-email"
            className={styles.input}
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            required
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="su-password">
            Password
          </label>
          <input
            id="su-password"
            className={styles.input}
            type="password"
            autoComplete="new-password"
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
        </div>
        <button className={styles.submit} type="submit" disabled={busy}>
          {busy ? <span className={styles.spinner} /> : 'Create account'}
        </button>
      </form>

      <p className={styles.footer}>
        Already have an account?{' '}
        <Link className={styles.footerLink} href="/sign-in">
          Sign in
        </Link>
      </p>
    </div>
  );
}
