'use client';

import { useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase';
import { registerTokenGetter } from '@/lib/api';

export function SupabaseTokenSync() {
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    registerTokenGetter(async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return session?.access_token ?? null;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
