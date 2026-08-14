import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission, getFirstAccessibleRoute } from '@/lib/permissions';
import Dashboard from '@/pages/Dashboard';

/**
 * The root "/" element. Renders Dashboard only when the user has dashboard.view;
 * otherwise redirects to the first accessible route (or /no-access). Prevents
 * the post-login "flash of Dashboard" for users without dashboard access — the
 * decision is made synchronously from the already-loaded user, so no Dashboard
 * is ever painted for them.
 */
export default function LandingRedirect() {
  const { user } = useAuth();
  if (hasPermission(user, 'dashboard', 'view')) return <Dashboard />;
  const first = getFirstAccessibleRoute(user);
  return <Navigate to={first || '/no-access'} replace />;
}