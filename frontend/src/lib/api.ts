import axios from 'axios';
import { env } from '@/lib/env';
import { createClient } from '@/lib/supabase';

export const api = axios.create({
  baseURL: env.NEXT_PUBLIC_API_URL,
});

// Registered by SupabaseTokenSync on mount; called per-request so the token is
// always fresh (Supabase handles session refresh internally via getSession()).
let _getToken: (() => Promise<string | null>) | null = null;

export function registerTokenGetter(fn: () => Promise<string | null>) {
  _getToken = fn;
}

// Request interceptor — attach a fresh Supabase JWT to every outgoing call.
api.interceptors.request.use(async (config) => {
  if (_getToken) {
    const token = await _getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Response interceptor — redirect to sign-in on any 401 (expired token, revoked session, etc.).
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (
      error.response?.status === 401 &&
      typeof window !== 'undefined' &&
      !window.location.pathname.startsWith('/sign-in')
    ) {
      // A 401 means the backend rejected our Supabase JWT, but the Supabase
      // session cookie may still be valid. If we just navigate to /sign-in the
      // middleware will see a valid session and bounce us straight back to
      // /optimize — an infinite redirect loop. Clear the session first so the
      // sign-in page actually renders.
      try {
        await createClient().auth.signOut();
      } catch {
        // best-effort — redirect regardless
      }
      window.location.href = '/sign-in';
    }
    return Promise.reject(error);
  }
);
