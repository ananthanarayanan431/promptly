import axios from 'axios';
import { useAuthStore } from '@/stores/auth-store';
import { env } from '@/lib/env';

export const api = axios.create({
  baseURL: env.NEXT_PUBLIC_API_URL,
});

// Request Interceptor
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response Interceptor
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Check if it's a 401 Unauthorized
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      // Attempt token refresh (if backend supported it)
      // Since standard backend doesn't show a refresh endpoint in instructions
      // other than: "intercept 401s in your API wrapper and refresh silently",
      // But no refresh token is returned in the auth schema...?
      // If we don't have a refresh flow, we just logout.

      // Log out
      useAuthStore.getState().logout();
      await fetch('/api/auth', { method: 'DELETE' }); // Clear the cookie synchronously
      window.location.href = '/login';
      return Promise.reject(error);
    }

    return Promise.reject(error);
  }
);
