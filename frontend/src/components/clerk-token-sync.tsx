'use client';
import { useAuth } from '@clerk/nextjs';
import { useEffect } from 'react';
import { registerTokenGetter } from '@/lib/api';

export function ClerkTokenSync() {
  const { getToken } = useAuth();

  useEffect(() => {
    registerTokenGetter(getToken);
  }, [getToken]);

  return null;
}
