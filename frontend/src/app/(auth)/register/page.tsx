'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { registerSchema, RegisterFormData } from '@/lib/schemas';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { setToken } from '@/lib/auth';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ArrowRight, Loader2, Zap, Shield, Sparkles } from 'lucide-react';
import { User } from '@/types/api';

const PERKS = [
  { icon: Zap, label: '100 free credits to start' },
  { icon: Sparkles, label: '4 AI models work in parallel' },
  { icon: Shield, label: 'No credit card required' },
];

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((state) => state.setAuth);

  const { register, handleSubmit, formState: { errors } } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterFormData) => {
    setLoading(true);
    try {
      await api.post('/api/v1/auth/register', {
        email: data.email,
        password: data.password,
        full_name: data.email.split('@')[0],
      });

      const formData = new URLSearchParams();
      formData.append('username', data.email);
      formData.append('password', data.password);

      const loginRes = await api.post('/api/v1/auth/login', formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const token = loginRes.data.data.access_token;

      useAuthStore.getState().setAuth(token, null as any);

      const userRes = await api.get<{ data: User }>('/api/v1/users/me');
      setAuth(token, userRes.data.data);
      await setToken(token);

      toast.success('Account created successfully');
      router.push('/optimize');
      router.refresh();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to register');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-1.5">
        <h1 className="text-3xl font-black tracking-tight">Get started free</h1>
        <p className="text-muted-foreground">
          Create your account and start optimizing prompts instantly.
        </p>
      </div>

      {/* Perks */}
      <div className="grid grid-cols-1 gap-2">
        {PERKS.map(({ icon: Icon, label }) => (
          <div key={label} className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-primary/5 border border-primary/20">
            <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <Icon className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="text-sm font-medium text-foreground">{label}</span>
          </div>
        ))}
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-sm font-medium">Email address</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            className="h-11 bg-background/60 border-border/70 focus-visible:border-primary/50 focus-visible:ring-primary/20"
            {...register('email')}
          />
          {errors.email && (
            <p className="text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-sm font-medium">Password</Label>
          <Input
            id="password"
            type="password"
            placeholder="Min. 8 characters"
            className="h-11 bg-background/60 border-border/70 focus-visible:border-primary/50 focus-visible:ring-primary/20"
            {...register('password')}
          />
          {errors.password && (
            <p className="text-xs text-destructive">{errors.password.message}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground font-semibold text-sm transition-all shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:pointer-events-none"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>Create account <ArrowRight className="h-4 w-4" /></>
          )}
        </button>
      </form>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border/50" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-background px-3 text-xs text-muted-foreground">Already have an account?</span>
        </div>
      </div>

      {/* Sign-in link */}
      <Link
        href="/login"
        className="flex w-full items-center justify-center gap-2 h-11 rounded-xl border border-border/70 bg-background/60 text-sm font-medium hover:bg-muted/50 transition-colors"
      >
        Sign in instead
      </Link>
    </div>
  );
}
