'use client';
import { usePermissions } from '@/hooks/use-permissions';

interface PermissionGateProps {
  permission?: string;
  role?: string | string[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function PermissionGate({ permission, role, children, fallback = null }: PermissionGateProps) {
  const { hasPermission, hasRole } = usePermissions();

  if (permission && !hasPermission(permission)) return <>{fallback}</>;
  if (role) {
    const roles = Array.isArray(role) ? role : [role];
    if (!hasRole(...roles)) return <>{fallback}</>;
  }

  return <>{children}</>;
}
