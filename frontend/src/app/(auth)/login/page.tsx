'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { loginSchema, LoginFormData } from '@/lib/schemas';
import { api } from '@/lib/api';
import { formatApiErrorDetail } from '@/lib/api-errors';
import { useAuthStore } from '@/stores/auth-store';
import { setToken } from '@/lib/auth';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import type { User } from '@/types/api';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((state) => state.setAuth);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setLoading(true);
    try {
      const formData = new URLSearchParams();
      formData.append('username', data.email);
      formData.append('password', data.password);

      const res = await api.post('/api/v1/auth/login', formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const token = res.data.data.access_token;
      useAuthStore.getState().setAuth(token, null as any);

      const userRes = await api.get<{ data: User }>('/api/v1/users/me');
      setAuth(token, userRes.data.data);
      await setToken(token);

      toast.success('Welcome back');
      router.push('/optimize');
      router.refresh();
    } catch (error: any) {
      toast.error(formatApiErrorDetail(error.response?.data?.detail, 'Failed to sign in'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ color: '#141414', fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
      <h1 style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontSize: 48,
        fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1.05, margin: '0 0 12px' }}>
        Welcome<br /><em style={{ fontStyle: 'italic', color: '#7c5cff' }}>back</em>.
      </h1>
      <p style={{ color: '#666', fontSize: 14.5, marginBottom: 32, lineHeight: 1.5 }}>
        Pick up where you left off.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
            color: '#888', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Email</label>
          <input type="email" {...register('email')}
            style={{ height: 44, padding: '0 14px', borderRadius: 8, fontSize: 14,
              border: '1px solid #e5e5e1', color: '#141414', background: '#fafaf7',
              outline: 'none', fontFamily: 'inherit' }}
            onFocus={e => (e.target.style.borderColor = '#7c5cff')}
            onBlur={e => (e.target.style.borderColor = '#e5e5e1')} />
          {errors.email && <p style={{ fontSize: 12, color: '#ff6b7a' }}>{errors.email.message}</p>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
            color: '#888', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Password</label>
          <input type="password" {...register('password')}
            style={{ height: 44, padding: '0 14px', borderRadius: 8, fontSize: 14,
              border: '1px solid #e5e5e1', color: '#141414', background: '#fafaf7',
              outline: 'none', fontFamily: 'inherit' }}
            onFocus={e => (e.target.style.borderColor = '#7c5cff')}
            onBlur={e => (e.target.style.borderColor = '#e5e5e1')} />
          {errors.password && <p style={{ fontSize: 12, color: '#ff6b7a' }}>{errors.password.message}</p>}
        </div>

        <button type="submit" disabled={loading}
          style={{ marginTop: 6, height: 44, borderRadius: 8, background: '#7c5cff',
            color: '#fff', border: 'none', fontWeight: 500, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            fontFamily: 'inherit' }}>
          {loading ? <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> : null}
          Sign in →
        </button>
      </form>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0', color: '#999', fontSize: 12 }}>
        <div style={{ flex: 1, height: 1, background: '#e5e5e1' }} />
        <span>or</span>
        <div style={{ flex: 1, height: 1, background: '#e5e5e1' }} />
      </div>

      <Link href="/register"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: 44, borderRadius: 8, border: '1px solid #e5e5e1', fontSize: 14,
          color: '#141414', textDecoration: 'none', background: 'transparent' }}>
        Create account — 100 credits free
      </Link>

      <div style={{ marginTop: 24, textAlign: 'center', fontSize: 12.5, color: '#888' }}>
        New here?{' '}
        <Link href="/register" style={{ color: '#7c5cff', fontWeight: 500, textDecoration: 'none' }}>
          Create account
        </Link>
      </div>
    </div>
  );
}
