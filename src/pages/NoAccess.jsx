import React from 'react';
import { ShieldAlert, RefreshCw, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';

/**
 * Shown when an authenticated user has no `view` permission for any module.
 * Never falls back to Dashboard. Offers Reload (re-fetch permissions) and Logout.
 */
export default function NoAccess() {
  const { logout } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full text-center bg-white border border-border rounded-xl p-8 shadow-sm">
        <ShieldAlert className="w-12 h-12 mx-auto text-amber-500 mb-4" />
        <h1 className="font-heading text-xl font-bold">Tidak Ada Akses</h1>
        <p className="text-[13px] text-muted-foreground mt-2">
          Akun Anda belum memiliki akses ke modul apa pun. Hubungi Administrator.
        </p>
        <div className="flex items-center justify-center gap-2 mt-6">
          <Button variant="outline" onClick={() => window.location.reload()} className="gap-1.5">
            <RefreshCw className="w-4 h-4" /> Muat Ulang
          </Button>
          <Button onClick={() => logout(true)} className="gap-1.5">
            <LogOut className="w-4 h-4" /> Logout
          </Button>
        </div>
      </div>
    </div>
  );
}