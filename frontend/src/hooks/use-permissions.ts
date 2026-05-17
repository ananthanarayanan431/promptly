'use client';
import { useOrganization } from '@clerk/nextjs';

export function usePermissions() {
  const { membership } = useOrganization();
  const permissions: string[] = (membership as any)?.permissions ?? [];
  const role: string = (membership as any)?.role ?? '';

  return {
    hasPermission: (permission: string) => permissions.includes(permission),
    hasRole: (...roles: string[]) => roles.includes(role),
    permissions,
    role,
  };
}
