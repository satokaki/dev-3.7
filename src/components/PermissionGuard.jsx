import React from 'react';
import { Outlet, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { canAccessRoute, getFirstAccessibleRoute } from '@/lib/permissions';

/**
 * Layout-level route guard: blocks direct/typed access to any page the current
 * user lacks `view` permission for, redirecting to the first accessible route
 * (or /no-access). Sits inside <Layout/> so it re-evaluates on every navigation
 * and whenever the user object changes (e.g. permission revoked mid-session).
 */
export default function PermissionGuard() {
  const location = useLocation();
  const { user } = useAuth();
  if (!user) return <Outlet />; // safety; auth gate handles unauthenticated
  if (user.role === 'admin') return <Outlet />;
  if (canAccessRoute(user, location.pathname)) return <Outlet />;
  const first = getFirstAccessibleRoute(user);
  return <Navigate to={first || '/no-access'} replace />;
}