'use client';

import { useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';

export function AuthInitializer({ token }: { token: string | null }) {
  useState(() => {
    if (token) {
      // Synchronously hydrate token into Zustand before any children render
      // Using setState directly avoids 'setAuth' requiring a user object.
      useAuthStore.setState({ token });
    }
  });

  return null;
}
