import axios from 'axios';
import { env } from '@/lib/env';

export const api = axios.create({
  baseURL: env.NEXT_PUBLIC_API_URL,
});

// Registered by ClerkTokenSync once Clerk is ready; called per-request so the
// token is always fresh (Clerk handles caching and JWT refresh internally).
let _getToken: (() => Promise<string | null>) | null = null;

export function registerTokenGetter(fn: () => Promise<string | null>) {
  _getToken = fn;
}

// Request interceptor — attach a fresh Clerk JWT to every outgoing call.
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
      window.location.href = '/sign-in';
    }
    return Promise.reject(error);
  }
);
