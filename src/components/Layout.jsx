import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  LayoutDashboard, FlaskConical, Factory, Package, Tag, Stamp,
  ShoppingCart, Wallet, ClipboardList, FileBarChart, Database,
  Settings, ChevronDown, Menu, X, LogOut, Bell, Search, Calculator, Boxes, TrendingUp, AlertTriangle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import FloatingAssistant from '@/components/FloatingAssistant';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/permissions';
import { roleLabel } from '@/lib/roles';

const menuItems = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/', group: 'utama', perm: 'dashboard' },
  { label: 'Resep', icon: FlaskConical, path: '/recipes', group: 'operasional', perm: 'recipes' },
  { label: 'Produksi', icon: Factory, path: '/production', group: 'operasional', perm: 'production' },
  { label: 'Bottling', icon: Package, path: '/bottling', group: 'operasional', perm: 'bottling' },
  { label: 'Labeling', icon: Tag, path: '/labeling', group: 'operasional', perm: 'labeling' },
  { label: 'Proses Cukai', icon: Stamp, path: '/excise', group: 'operasional', perm: 'excise' },
  { label: 'Pembelian', icon: Package, path: '/purchases', group: 'operasional', perm: 'purchases' },
  { label: 'Penjualan', icon: ShoppingCart, path: '/sales', group: 'operasional', perm: 'sales' },
  { label: 'Pembayaran Piutang', icon: Wallet, path: '/payments', group: 'operasional', perm: 'payments' },
  { label: 'Kartu Stok', icon: ClipboardList, path: '/stock-card', group: 'operasional', perm: 'stock_card' },
  { label: 'Kartu Stok Detail', icon: ClipboardList, path: '/stock-card-dedicated', group: 'operasional', perm: 'stock_card_detail' },
  { label: 'Biaya Operasional', icon: AlertTriangle, path: '/operationalCost', group: 'operasional', perm: 'operational_cost' },
  { label: 'Laporan Penjualan', icon: FileBarChart, path: '/reports/sales', group: 'laporan', perm: 'report_sales' },
  { label: 'Laporan Piutang', icon: FileBarChart, path: '/reports/receivables', group: 'laporan', perm: 'report_receivables' },
  { label: 'Traceability Batch', icon: Search, path: '/traceability', group: 'laporan', perm: 'traceability' },
  { label: 'HPP Produk', icon: Calculator, path: '/hpp', group: 'laporan', perm: 'hpp' },
  { label: 'Laporan Inventaris', icon: Boxes, path: '/reports/inventory', group: 'laporan', perm: 'report_inventory' },
  { label: 'Laporan Laba Rugi', icon: TrendingUp, path: '/reports/profit-loss', group: 'laporan', perm: 'report_profit_loss' },
];

const masterItems = [
  { label: 'Merk', path: '/master/brands', perm: 'master_brands' },
  { label: 'Kategori', path: '/master/categories', perm: 'master_categories' },
  { label: 'Supplier', path: '/master/suppliers', perm: 'master_suppliers' },
  { label: 'Customer', path: '/master/customers', perm: 'master_customers' },
  { label: 'Bahan', path: '/master/materials', perm: 'master_materials' },
  { label: 'Barang', path: '/master/products', perm: 'master_products' },
  { label: 'Gudang', path: '/master/warehouses', perm: 'master_warehouses' },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [masterOpen, setMasterOpen] = useState(
    location.pathname.startsWith('/master')
  );

  /*
   * v3.7 NOTIFICATION CENTER
   * Read-only dari AuditLog. Tidak mengubah transaksi atau schema.
   */
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);

  const canSeeActivityNotifications =
    hasPermission(user, 'dashboard_activity', 'view');

  const notificationStorageKey =
    `labpro_notification_last_seen_${user?.id || user?.email || 'user'}`;

  const isFailureNotification = (row) => {
    const action =
      String(row?.action || '').toLowerCase();

    return (
      action.includes('gagal') ||
      action.includes('failed') ||
      action.includes('failure') ||
      action.includes('error') ||
      action.includes('rollback')
    );
  };

  const notificationTime = (value) => {
    if (!value) return '';

    try {
      return new Intl.DateTimeFormat('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value));
    } catch {
      return String(value);
    }
  };

  const loadNotifications = useCallback(async () => {
    if (!user || !canSeeActivityNotifications) {
      setNotifications([]);
      setUnreadCount(0);
      setNotificationError('');
      return;
    }

    setNotificationsLoading(true);
    setNotificationError('');

    try {
      const rows =
        await base44.entities.AuditLog.list(
          '-action_time',
          50
        );

      const safeRows = rows || [];
      setNotifications(safeRows);

      const lastSeenRaw =
        window.localStorage.getItem(
          notificationStorageKey
        );

      const lastSeen =
        lastSeenRaw
          ? new Date(lastSeenRaw).getTime()
          : 0;

      const unread =
        safeRows.filter(row => {
          const time =
            new Date(
              row.action_time ||
              row.created_date ||
              0
            ).getTime();

          return (
            Number.isFinite(time) &&
            time > lastSeen
          );
        }).length;

      setUnreadCount(unread);
    } catch (error) {
      setNotificationError(
        error?.message ||
        'Gagal memuat notifikasi'
      );
    } finally {
      setNotificationsLoading(false);
    }
  }, [
    user,
    canSeeActivityNotifications,
    notificationStorageKey,
  ]);

  useEffect(() => {
    loadNotifications();

    const timer =
      window.setInterval(
        loadNotifications,
        60000
      );

    return () =>
      window.clearInterval(timer);
  }, [loadNotifications]);

  const toggleNotifications = async () => {
    const nextOpen =
      !notificationOpen;

    setNotificationOpen(nextOpen);

    if (nextOpen) {
      await loadNotifications();

      const now =
        new Date().toISOString();

      window.localStorage.setItem(
        notificationStorageKey,
        now
      );

      setUnreadCount(0);
    }
  };

  const handleLogout = async () => {
    await base44.auth.logout();
  };

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const canSee = (perm) => hasPermission(user, perm, 'view');
  const filteredMenu = (group) => menuItems.filter((i) => i.group === group && canSee(i.perm));
  const visibleMasterItems = masterItems.filter((i) => canSee(i.perm));
  const canSeeMaster = visibleMasterItems.length > 0 || canSee('master');

  const NavLink = ({ item }) => {
    const Icon = item.icon;
    return (
      <Link
        to={item.path}
        onClick={() => setSidebarOpen(false)}
        className={cn(
          'flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors',
          (item.path === '/stock-card' ? location.pathname === item.path : isActive(item.path))
            ? 'bg-primary text-primary-foreground'
            : 'text-sidebar-foreground hover:bg-sidebar-accent'
        )}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span>{item.label}</span>
      </Link>
    );
  };

  const displayName = user?.full_name || (user?.email ? user.email.split('@')[0] : 'Pengguna');
  const initial = (user?.full_name || user?.email || 'A').charAt(0).toUpperCase();
  const hasRole = !!user?.role;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed lg:static inset-y-0 left-0 z-50 w-60 bg-sidebar border-r border-sidebar-border flex flex-col transition-transform duration-200',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="h-14 flex items-center px-4 border-b border-sidebar-border shrink-0 text-sidebar-foreground">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <FlaskConical className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <div className="font-heading font-bold text-[15px] leading-none tracking-tight">IZZI JUICE</div>
              <div className="text-[10px] text-sidebar-foreground/60 mt-0.5">E-Liquid Management</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5">
          {filteredMenu('utama').map((item) => <NavLink key={item.path} item={item} />)}

          {filteredMenu('operasional').length > 0 && (
            <>
              <div className="pt-3 pb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Operasional</div>
              {filteredMenu('operasional').map((item) => <NavLink key={item.path} item={item} />)}
            </>
          )}

          {filteredMenu('laporan').length > 0 && (
            <>
              <div className="pt-3 pb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Laporan</div>
              {filteredMenu('laporan').map((item) => <NavLink key={item.path} item={item} />)}
            </>
          )}

          {canSeeMaster && (
            <>
              <div className="pt-3 pb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Master Data</div>
              <button
                onClick={() => setMasterOpen(!masterOpen)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
              >
                <Database className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left">Master Data</span>
                <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', masterOpen && 'rotate-180')} />
              </button>
              {masterOpen && (
                <div className="space-y-0.5 pl-4">
                  {visibleMasterItems.map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setSidebarOpen(false)}
                      className={cn(
                        'flex items-center gap-2 px-3 py-1.5 rounded-md text-[12.5px] transition-colors',
                        isActive(item.path)
                          ? 'bg-primary/10 text-primary font-semibold'
                          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent'
                      )}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="pt-3 pb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Sistem</div>
          {canSee('database') && (
            <Link
              to="/database"
              onClick={() => setSidebarOpen(false)}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors',
                isActive('/database') ? 'bg-primary text-primary-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent'
              )}
            >
              <Database className="w-4 h-4 shrink-0" />
              <span>Database Management</span>
            </Link>
          )}
          {canSee('settings') && (
            <Link
              to="/settings"
              onClick={() => setSidebarOpen(false)}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors',
                isActive('/settings') ? 'bg-primary text-primary-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent'
              )}
            >
              <Settings className="w-4 h-4 shrink-0" />
              <span>Pengaturan</span>
            </Link>
          )}
        </nav>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-14 border-b border-border bg-card/95 backdrop-blur-sm flex items-center px-4 gap-3 shrink-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-1.5 hover:bg-muted rounded-md"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <div className="flex-1 max-w-md">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Cari..."
                className="w-full h-9 pl-9 pr-3 text-[13px] bg-muted/70 border border-transparent rounded-md focus:bg-card focus:border-primary/30 focus:ring-2 focus:ring-primary/10 outline-none transition-colors"
              />
            </div>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={toggleNotifications}
              className="p-2 hover:bg-muted rounded-md relative"
              aria-label="Buka notifikasi aktivitas"
              title="Notifikasi aktivitas"
            >
              <Bell className="w-4 h-4 text-muted-foreground" />

              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold leading-none">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {notificationOpen && (
              <>
                <button
                  type="button"
                  aria-label="Tutup notifikasi"
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setNotificationOpen(false)}
                />

                <div className="absolute right-0 top-11 z-50 w-[360px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-border bg-card shadow-xl">
                  <div className="flex items-center justify-between border-b border-border px-3.5 py-3">
                    <div>
                      <div className="text-[13px] font-semibold">
                        Notifikasi Aktivitas
                      </div>
                      <div className="text-[10.5px] text-muted-foreground">
                        Log proses berhasil dan gagal
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={loadNotifications}
                      disabled={notificationsLoading}
                      className="text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                    >
                      {notificationsLoading
                        ? 'Memuat...'
                        : 'Segarkan'}
                    </button>
                  </div>

                  <div className="max-h-[420px] overflow-y-auto">
                    {!canSeeActivityNotifications ? (
                      <div className="px-4 py-10 text-center">
                        <Bell className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
                        <div className="text-[12.5px] font-medium">
                          Notifikasi aktivitas tidak tersedia
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          Akun ini tidak memiliki hak akses log aktivitas.
                        </div>
                      </div>
                    ) : notificationError ? (
                      <div className="px-4 py-8 text-center">
                        <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-red-500" />
                        <div className="text-[12.5px] font-medium text-red-600">
                          Gagal memuat notifikasi
                        </div>
                        <div className="mt-1 break-words text-[11px] text-muted-foreground">
                          {notificationError}
                        </div>
                      </div>
                    ) : notificationsLoading && notifications.length === 0 ? (
                      <div className="px-4 py-10 text-center text-[12px] text-muted-foreground">
                        Memuat notifikasi...
                      </div>
                    ) : notifications.length === 0 ? (
                      <div className="px-4 py-10 text-center">
                        <Bell className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
                        <div className="text-[12.5px] font-medium">
                          Belum ada notifikasi
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          Aktivitas berhasil atau gagal akan muncul di sini.
                        </div>
                      </div>
                    ) : (
                      <div className="divide-y divide-border">
                        {notifications.map(row => {
                          const failed =
                            isFailureNotification(row);

                          return (
                            <div
                              key={row.id}
                              className="px-3.5 py-3 hover:bg-muted/40"
                            >
                              <div className="flex items-start gap-2.5">
                                <div
                                  className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                                    failed
                                      ? 'bg-red-500'
                                      : 'bg-emerald-500'
                                  }`}
                                />

                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="truncate text-[12px] font-semibold">
                                      {row.module || 'Sistem'}
                                      {' · '}
                                      {row.action || 'Aktivitas'}
                                    </div>

                                    <span
                                      className={`shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-semibold ${
                                        failed
                                          ? 'bg-red-50 text-red-600'
                                          : 'bg-emerald-50 text-emerald-700'
                                      }`}
                                    >
                                      {failed ? 'GAGAL' : 'BERHASIL'}
                                    </span>
                                  </div>

                                  {row.reference_number && (
                                    <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
                                      {row.reference_number}
                                    </div>
                                  )}

                                  {failed && (
                                    <div className="mt-1.5 rounded bg-red-50 px-2 py-1.5 text-[10.5px] leading-relaxed text-red-700">
                                      {row.reason ||
                                        'Proses gagal. Detail alasan belum dicatat pada log ini.'}
                                    </div>
                                  )}

                                  {!failed && row.reason && (
                                    <div className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
                                      {row.reason}
                                    </div>
                                  )}

                                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[9.5px] text-muted-foreground">
                                    <span className="truncate">
                                      {row.user_name || 'System'}
                                    </span>
                                    <span className="shrink-0">
                                      {notificationTime(
                                        row.action_time ||
                                        row.created_date
                                      )}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-border bg-muted/20 px-3.5 py-2 text-[10px] text-muted-foreground">
                    Menampilkan maksimal 50 aktivitas terbaru.
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-2.5 pl-3 border-l border-border">
            <div className="text-right hidden sm:block">
              <div className="text-[12.5px] font-semibold leading-none">{displayName}</div>
              <div className={`text-[10.5px] mt-0.5 ${hasRole ? 'text-muted-foreground' : 'text-amber-600 font-medium'}`}>{hasRole ? roleLabel(user?.role) : 'Belum Ada Role'}</div>
            </div>
            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[12px] font-bold">{initial}</div>
            <button onClick={handleLogout} className="p-2 hover:bg-muted rounded-md" title="Logout">
              <LogOut className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          {user && !hasRole && (
            <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-[12px] text-amber-800 flex items-center justify-between">
              <span>Akun Anda belum memiliki role. Hubungi Administrator.</span>
              <button onClick={handleLogout} className="text-amber-800 underline font-medium">Logout</button>
            </div>
          )}
          <Outlet />
        </main>
      </div>

      <FloatingAssistant />
    </div>
  );
}