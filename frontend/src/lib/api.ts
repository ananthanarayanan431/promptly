import axios from 'axios';
import { env } from '@/lib/env';

export const api = axios.create({
  baseURL: env.NEXT_PUBLIC_API_URL,
});

// Token is stored here and updated by ClerkTokenSync
let _currentToken: string | null = null;

export function setAuthToken(token: string | null) {
  _currentToken = token;
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
}

export function getAuthToken(): string | null {
  return _currentToken;
}

// Response interceptor — redirect to sign-in only when we have no token (truly signed out)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Only redirect if we have no token at all — if we have a token but got 401,
      // it means the backend rejected it (wrong org, etc.); let TanStack Query surface the error.
      if (
        typeof window !== 'undefined' &&
        !_currentToken &&
        !window.location.pathname.startsWith('/sign-in')
      ) {
        window.location.href = '/sign-in';
      }
    }
    return Promise.reject(error);
  }
);
