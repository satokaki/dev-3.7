import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import PageHeader from '@/components/PageHeader';
import FormModal from '@/components/FormModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Shield,
  ShieldCheck,
  UserCog,
  UserPlus,
  Trash2,
  Save,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { ROLES, roleLabel } from '@/lib/roles';
import {
  MENU_CATALOG,
  getDefaultPermissions,
  normalizePermissions,
} from '@/lib/permissions';

const actionLabel = {
  view: 'Lihat',
  create: 'Tambah',
  edit: 'Edit',
  delete: 'Hapus',
  approve: 'Approve',
  post: 'Posting',
  cancel: 'Batal',
  print: 'Cetak',
  download: 'Download',
  adjust: 'Adjust',
  backup: 'Backup',
  backup_download: 'Download',
  restore: 'Restore',
  reset: 'Reset',
  export: 'Export',
};

const GROUP_LABEL = {
  utama: 'Utama',
  operasional: 'Operasional',
  laporan: 'Laporan',
  master: 'Master Data',
  sistem: 'Sistem',
};

const GROUP_ORDER = [
  'utama',
  'operasional',
  'laporan',
  'master',
  'sistem',
];

/* ==========================================================
   PERMISSION PARSER / HYDRATION
========================================================== */

/**
 * Permission bisa kembali dari entity sebagai:
 * - object
 * - JSON string
 * - null / kosong
 *
 * PATCH:
 * Jangan langsung fallback ke default sebelum mencoba parse.
 */
function parsePermissionValue(value) {
  if (!value) return null;

  if (
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (!trimmed) return null;

    try {
      const parsed = JSON.parse(trimmed);

      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      ) {
        return parsed;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function hasStoredPermissions(value) {
  const parsed = parsePermissionValue(value);
  return !!(
    parsed &&
    Object.keys(parsed).length > 0
  );
}

function hydratePermissions(user) {
  const stored =
    parsePermissionValue(
      user?.permissions
    );

  if (
    stored &&
    Object.keys(stored).length > 0
  ) {
    return {
      permissions:
        normalizePermissions(stored),
      source: 'custom',
    };
  }

  return {
    permissions:
      getDefaultPermissions(
        user?.role || 'user'
      ),
    source: 'default',
  };
}

/* ==========================================================
   STATUS BADGE
========================================================== */

const statusBadge = (status) => {
  const cls = {
    active:
      'bg-emerald-100 text-emerald-700',
    inactive:
      'bg-slate-200 text-slate-600',
    suspended:
      'bg-red-100 text-red-700',
    deleted:
      'bg-slate-300 text-slate-500',
    pending_invitation:
      'bg-amber-100 text-amber-700',
  }[status] ||
    'bg-muted text-muted-foreground';

  const label = {
    active: 'Aktif',
    inactive: 'Nonaktif',
    suspended: 'Suspended',
    deleted: 'Dihapus',
    pending_invitation:
      'Menunggu Login',
  }[status] || status;

  return (
    <span
      className={`text-[10.5px] px-2 py-0.5 rounded font-semibold ${cls}`}
    >
      {label}
    </span>
  );
};

/* ==========================================================
   SETTINGS / USER PERMISSION MANAGEMENT
========================================================== */

export default function Settings() {
  const { toast } = useToast();
  const { user: currentUser } =
    useAuth();

  const [users, setUsers] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [selectedId, setSelectedId] =
    useState(null);

  const [editForm, setEditForm] =
    useState({
      role: 'user',
      status: 'active',
      permissions: {},
    });

  const [
    permissionSource,
    setPermissionSource,
  ] = useState('none');

  const [saving, setSaving] =
    useState(false);

  const [inviteOpen, setInviteOpen] =
    useState(false);

  const [inviteForm, setInviteForm] =
    useState({
      email: '',
      full_name: '',
      role: 'user',
    });

  const [
    submittingInvite,
    setSubmittingInvite,
  ] = useState(false);

  const [deleteTarget, setDeleteTarget] =
    useState(null);

  const [deleteReason, setDeleteReason] =
    useState('');

  const [deleting, setDeleting] =
    useState(false);

  /* ========================================================
     NORMALIZE USER / INVITATION ROW
  ======================================================== */

  const normalizeUserRow =
    useCallback((u) => {
      return {
        ...u,
        kind: 'user',
        status:
          u.status || 'active',
        last_login_at:
          u.last_login_at ||
          u.updated_date,
        permissions:
          parsePermissionValue(
            u.permissions
          ) ||
          {},
      };
    }, []);

  const normalizeInvitationRow =
    useCallback((i) => {
      return {
        id: i.id,
        kind: 'invitation',
        user_code:
          i.user_code,
        full_name:
          i.full_name || '',
        email:
          i.email,
        role:
          i.role,
        status:
          i.status === 'accepted'
            ? 'active'
            : 'pending_invitation',
        permissions:
          parsePermissionValue(
            i.permissions
          ) ||
          {},
        last_login_at:
          i.last_login_at ||
          i.accepted_at,
      };
    }, []);

  /* ========================================================
     LOAD DATA
  ======================================================== */

  const loadData =
    useCallback(async () => {
      setLoading(true);

      try {
        const [userItems, invs] =
          await Promise.all([
            base44.entities.User.list(
              '-created_date',
              200
            ),
            base44.entities.UserInvitation
              .list(
                '-created_date',
                200
              )
              .catch(() => []),
          ]);

        const rows =
          userItems.map(
            normalizeUserRow
          );

        const usedEmails =
          new Set(
            rows.map(
              r =>
                (
                  r.email || ''
                ).toLowerCase()
            )
          );

        const seenInv =
          new Set();

        const invRows =
          invs
            .filter(
              i =>
                i.status !==
                'cancelled'
            )
            .filter(i => {
              const e =
                (
                  i.email || ''
                ).toLowerCase();

              if (
                usedEmails.has(e) ||
                seenInv.has(e)
              ) {
                return false;
              }

              seenInv.add(e);
              return true;
            })
            .map(
              normalizeInvitationRow
            );

        setUsers([
          ...rows,
          ...invRows,
        ]);

        return [
          ...rows,
          ...invRows,
        ];
      } catch {
        toast({
          variant: 'destructive',
          title:
            'Gagal memuat data pengguna',
        });

        return [];
      } finally {
        setLoading(false);
      }
    }, [
      toast,
      normalizeUserRow,
      normalizeInvitationRow,
    ]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const selectedUser =
    users.find(
      u =>
        u.id === selectedId
    ) || null;

  /* ========================================================
     HYDRATE SELECTED USER
  ======================================================== */

  const hydrateSelectedUser =
    useCallback((user) => {
      if (!user) {
        setPermissionSource('none');
        return;
      }

      const hydrated =
        hydratePermissions(user);

      setEditForm({
        role:
          user.role || 'user',

        status:
          user.status ===
          'pending_invitation'
            ? 'active'
            : (
                user.status ||
                'active'
              ),

        permissions:
          hydrated.permissions,
      });

      setPermissionSource(
        hydrated.source
      );
    }, []);

  const selectUser = (user) => {
    setSelectedId(user.id);
    hydrateSelectedUser(user);
  };

  /* ========================================================
     ROLE PRESET
  ======================================================== */

  const setRolePreset = (role) => {
    setEditForm(f => ({
      ...f,
      role,
      permissions:
        getDefaultPermissions(role),
    }));

    setPermissionSource(
      'default'
    );
  };

  /* ========================================================
     PERMISSION TOGGLES
  ======================================================== */

  const togglePerm = (
    menuKey,
    action
  ) => {
    if (
      editForm.role ===
      'admin'
    ) {
      return;
    }

    setEditForm(f => {
      const row = {
        ...(
          f.permissions[
            menuKey
          ] || {}
        ),
      };

      row[action] =
        !row[action];

      return {
        ...f,
        permissions: {
          ...f.permissions,
          [menuKey]:
            row,
        },
      };
    });

    setPermissionSource(
      'custom-unsaved'
    );
  };

  const toggleMenuAll = (
    menuKey,
    value
  ) => {
    if (
      editForm.role ===
      'admin'
    ) {
      return;
    }

    setEditForm(f => {
      const menu =
        MENU_CATALOG.find(
          m =>
            m.key ===
            menuKey
        );

      const next = {
        ...(
          f.permissions[
            menuKey
          ] || {}
        ),
      };

      (
        menu?.actions || []
      ).forEach(a => {
        next[a] = value;
      });

      return {
        ...f,
        permissions: {
          ...f.permissions,
          [menuKey]:
            next,
        },
      };
    });

    setPermissionSource(
      'custom-unsaved'
    );
  };

  const toggleAll = (value) => {
    if (
      editForm.role ===
      'admin'
    ) {
      return;
    }

    setEditForm(f => {
      const perms = {
        ...f.permissions,
      };

      MENU_CATALOG.forEach(
        m => {
          perms[m.key] = {};

          m.actions.forEach(
            a => {
              perms[m.key][a] =
                value;
            }
          );
        }
      );

      return {
        ...f,
        permissions:
          perms,
      };
    });

    setPermissionSource(
      'custom-unsaved'
    );
  };

  /* ========================================================
     READ-BACK SAVED RECORD
  ======================================================== */

  const readBackSavedRecord =
    useCallback(
      async (target) => {
        if (!target) return null;

        try {
          let fresh;

          if (
            target.kind ===
            'invitation'
          ) {
            fresh =
              await base44.entities
                .UserInvitation
                .get(target.id);

            return normalizeInvitationRow(
              fresh
            );
          }

          fresh =
            await base44.entities.User.get(
              target.id
            );

          return normalizeUserRow(
            fresh
          );
        } catch {
          return null;
        }
      },
      [
        normalizeInvitationRow,
        normalizeUserRow,
      ]
    );

  /* ========================================================
     SAVE PERMISSIONS
  ======================================================== */

  const handleSave = async () => {
    if (!selectedUser) return;

    setSaving(true);

    try {
      const normalized =
        normalizePermissions(
          editForm.permissions
        );

      const payload = {
        role:
          editForm.role,
        permissions:
          normalized,
      };

      if (
        selectedUser.kind ===
        'invitation'
      ) {
        await base44.entities
          .UserInvitation
          .update(
            selectedUser.id,
            payload
          );
      } else {
        payload.status =
          editForm.status;

        await base44.entities
          .User.update(
            selectedUser.id,
            payload
          );
      }

      /*
       * PATCH:
       * read-back langsung dari DB.
       * Toggle yang tampil setelah save
       * adalah nilai persistence, bukan
       * nilai state lokal sebelumnya.
       */
      const fresh =
        await readBackSavedRecord(
          selectedUser
        );

      if (!fresh) {
        throw new Error(
          'Hak akses tersimpan tetapi gagal dibaca ulang untuk verifikasi. Muat ulang halaman dan periksa user.'
        );
      }

      const stored =
        parsePermissionValue(
          fresh.permissions
        );

      if (
        !stored ||
        Object.keys(stored).length === 0
      ) {
        throw new Error(
          'Permission tidak terbaca kembali setelah disimpan. Save belum dapat diverifikasi.'
        );
      }

      const verifiedPermissions =
        normalizePermissions(
          stored
        );

      setEditForm({
        role:
          fresh.role ||
          editForm.role,

        status:
          fresh.status ===
          'pending_invitation'
            ? 'active'
            : (
                fresh.status ||
                editForm.status
              ),

        permissions:
          verifiedPermissions,
      });

      setPermissionSource(
        'custom'
      );

      /*
       * Refresh list lalu pertahankan selection.
       */
      const refreshed =
        await loadData();

      const latest =
        refreshed.find(
          u =>
            u.id ===
            selectedUser.id
        );

      if (latest) {
        setSelectedId(
          latest.id
        );

        hydrateSelectedUser(
          latest
        );
      }

      toast({
        title:
          'Hak akses disimpan & diverifikasi',
        description:
          `${selectedUser.full_name || selectedUser.email} diperbarui`,
      });
    } catch (e) {
      toast({
        variant: 'destructive',
        title:
          'Gagal menyimpan',
        description:
          e.message,
      });
    } finally {
      setSaving(false);
    }
  };

  /* ========================================================
     INVITE
  ======================================================== */

  const openInvite = () => {
    setInviteForm({
      email: '',
      full_name: '',
      role: 'user',
    });

    setInviteOpen(true);
  };

  const handleInvite =
    async () => {
      if (
        !inviteForm.email ||
        !inviteForm.full_name
      ) {
        toast({
          variant: 'destructive',
          title:
            'Nama dan email wajib diisi',
        });

        return;
      }

      const email =
        inviteForm.email
          .trim()
          .toLowerCase();

      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
          email
        )
      ) {
        toast({
          variant: 'destructive',
          title:
            'Format email tidak valid',
        });

        return;
      }

      const exists =
        users.find(
          r =>
            (
              r.email || ''
            ).toLowerCase() ===
              email &&
            r.status !==
              'inactive' &&
            r.status !==
              'deleted'
        );

      if (exists) {
        toast({
          variant: 'destructive',
          title:
            'Pengguna dengan email ini sudah terdaftar.',
        });

        return;
      }

      if (!appParams.appId) {
        toast({
          type: 'error',
          title:
            'App ID belum dikonfigurasi',
          description:
            'Publish ulang aplikasi dari builder Base44 agar App ID aktif terpasang.',
          duration:
            7000,
        });

        return;
      }

      setSubmittingInvite(true);

      try {
        await base44.users
          .inviteUser(
            email,
            inviteForm.role
          );

        /*
         * Simpan default permissions ke invitation
         * sejak awal supaya tidak ambigu saat user
         * belum login.
         */
        const invitePermissions =
          getDefaultPermissions(
            inviteForm.role
          );

        await base44.entities
          .UserInvitation
          .create({
            email,
            full_name:
              inviteForm.full_name,
            role:
              inviteForm.role,
            status:
              'pending',
            invited_by:
              currentUser?.full_name ||
              currentUser?.email ||
              '',
            permissions:
              invitePermissions,
          });

        toast({
          title:
            'Undangan terkirim',
          description:
            `${inviteForm.full_name} · ${email}`,
        });

        setInviteOpen(false);
        loadData();
      } catch (e) {
        const errData =
          e?.response?.data ||
          {};

        const msg =
          (
            errData.message ||
            errData.detail ||
            errData.error ||
            e.message ||
            ''
          ).toString();

        if (
          /app not found/i.test(
            msg
          )
        ) {
          toast({
            type: 'error',
            title:
              'Undangan gagal — App not found',
            description:
              'Publish ulang aplikasi, muat ulang, lalu undang ulang.',
            duration:
              9000,
          });
        } else {
          toast({
            variant: 'destructive',
            title:
              'Gagal mengundang',
            description:
              msg ||
              'Terjadi kesalahan',
          });
        }
      } finally {
        setSubmittingInvite(false);
      }
    };

  /* ========================================================
     DELETE / DEACTIVATE
  ======================================================== */

  const handleDelete =
    async () => {
      if (!deleteTarget) return;

      setDeleting(true);

      try {
        const res =
          await base44.functions.invoke(
            'deactivateUser',
            {
              email:
                deleteTarget.email,
              reason:
                deleteReason,
            }
          );

        const d =
          res && res.data
            ? res.data
            : res;

        if (
          d &&
          d.error
        ) {
          toast({
            variant:
              'destructive',
            title:
              d.error,
          });

          return;
        }

        toast({
          title:
            'Pengguna dinonaktifkan',
          description:
            deleteTarget.email,
        });

        setDeleteTarget(null);

        if (
          selectedId ===
          deleteTarget.id
        ) {
          setSelectedId(null);
          setPermissionSource(
            'none'
          );
        }

        loadData();
      } catch (e) {
        const msg =
          e?.response?.data
            ?.error ||
          e?.message ||
          'Gagal menonaktifkan';

        toast({
          variant:
            'destructive',
          title:
            msg,
        });
      } finally {
        setDeleting(false);
      }
    };

  const canDelete =
    currentUser?.role ===
    'admin';

  const menusByGroup =
    GROUP_ORDER
      .map(g => ({
        group: g,
        items:
          MENU_CATALOG.filter(
            m =>
              m.group === g
          ),
      }))
      .filter(
        x =>
          x.items.length > 0
      );

  /* ========================================================
     PERMISSION SOURCE BADGE
  ======================================================== */

  const permissionStatusBlock = () => {
    if (
      editForm.role ===
      'admin'
    ) {
      return null;
    }

    if (
      permissionSource ===
      'custom'
    ) {
      return (
        <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11.5px] text-emerald-700 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>
            <b>Custom permission tersimpan.</b>
            {' '}Toggle di bawah dibaca dari data user yang tersimpan.
          </span>
        </div>
      );
    }

    if (
      permissionSource ===
      'custom-unsaved'
    ) {
      return (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            <b>Ada perubahan belum disimpan.</b>
            {' '}Tekan Simpan Hak Akses untuk menyimpan toggle.
          </span>
        </div>
      );
    }

    return (
      <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[11.5px] text-blue-700 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>
          <b>Menggunakan preset role default.</b>
          {' '}Belum ada custom permission tersimpan untuk user ini.
        </span>
      </div>
    );
  };

  /* ========================================================
     RENDER
  ======================================================== */

  return (
    <div className="p-5 max-w-[1500px] mx-auto">
      <PageHeader
        title="Pengaturan & Hak Akses"
        description="Pusat kendali tunggal untuk pengguna, peran, dan hak akses per menu"
        actions={
          <div className="flex items-center gap-2">
            {selectedUser &&
              editForm.role !==
                'admin' && (
                <Button
                  onClick={handleSave}
                  size="sm"
                  className="gap-1.5"
                  disabled={saving}
                >
                  <Save className="w-4 h-4" />
                  {
                    saving
                      ? 'Menyimpan...'
                      : 'Simpan Hak Akses'
                  }
                </Button>
              )}

            {canDelete && (
              <Button
                onClick={
                  openInvite
                }
                size="sm"
                variant="outline"
                className="gap-1.5"
              >
                <UserPlus className="w-4 h-4" />
                Undang Pengguna
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* USER LIST */}
        <div className="lg:col-span-1">
          <div className="bg-white border border-border rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-[12.5px] font-semibold flex items-center gap-1.5">
                <UserCog className="w-3.5 h-3.5" />
                Daftar Pengguna
              </Label>

              <span className="text-[10.5px] text-muted-foreground">
                {users.length} user
              </span>
            </div>

            <div className="space-y-1.5 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
              {loading ? (
                Array.from({
                  length: 4,
                }).map(
                  (_, i) => (
                    <div
                      key={i}
                      className="h-12 bg-muted/50 rounded animate-pulse"
                    />
                  )
                )
              ) : (
                users.map(u => {
                  const active =
                    selectedId ===
                    u.id;

                  return (
                    <div
                      key={u.id}
                      onClick={() =>
                        selectUser(
                          u
                        )
                      }
                      className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg border transition-colors cursor-pointer ${
                        active
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-muted/30'
                      }`}
                    >
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                          u.role ===
                          'admin'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {
                          u.full_name?.[0]
                            ?.toUpperCase() ||
                          u.email?.[0]
                            ?.toUpperCase() ||
                          'U'
                        }
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] font-semibold truncate">
                          {
                            u.full_name ||
                            u.email
                          }
                        </div>

                        <div className="text-[10.5px] text-muted-foreground flex items-center gap-1.5 truncate">
                          <span className="inline-flex items-center gap-1">
                            {
                              u.role ===
                              'admin'
                                ? (
                                  <ShieldCheck className="w-2.5 h-2.5 text-primary" />
                                )
                                : (
                                  <Shield className="w-2.5 h-2.5" />
                                )
                            }

                            {
                              roleLabel(
                                u.role
                              )
                            }
                          </span>

                          <span>·</span>

                          {
                            statusBadge(
                              u.status
                            )
                          }
                        </div>
                      </div>

                      {canDelete &&
                        u.status !==
                          'inactive' &&
                        u.status !==
                          'deleted' &&
                        u.email?.toLowerCase() !==
                          currentUser?.email?.toLowerCase() && (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              setDeleteTarget(
                                u
                              );
                              setDeleteReason(
                                ''
                              );
                            }}
                            className="p-1.5 hover:bg-red-50 rounded text-red-600 shrink-0"
                            title="Nonaktifkan pengguna"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* PERMISSION MATRIX */}
        <div className="lg:col-span-2">
          {selectedUser ? (
            <div className="bg-white border border-border rounded-lg p-4">
              <div className="mb-4 pb-3 border-b border-border flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-bold flex items-center gap-1.5">
                    {
                      selectedUser.full_name ||
                      selectedUser.email
                    }
                  </h2>

                  <p className="text-[12px] text-muted-foreground mt-0.5">
                    {
                      selectedUser.user_code
                        ? `${selectedUser.user_code} · `
                        : ''
                    }
                    {
                      selectedUser.email
                    }
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Select
                    value={
                      editForm.role
                    }
                    onValueChange={
                      setRolePreset
                    }
                  >
                    <SelectTrigger className="h-8 w-[150px] text-[12.5px]">
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent>
                      {
                        ROLES.map(
                          r => (
                            <SelectItem
                              key={
                                r.value
                              }
                              value={
                                r.value
                              }
                            >
                              {
                                r.label
                              }
                            </SelectItem>
                          )
                        )
                      }
                    </SelectContent>
                  </Select>

                  {selectedUser.kind ===
                    'user' && (
                    <Select
                      value={
                        editForm.status
                      }
                      onValueChange={v =>
                        setEditForm(
                          f => ({
                            ...f,
                            status: v,
                          })
                        )
                      }
                    >
                      <SelectTrigger className="h-8 w-[120px] text-[12.5px]">
                        <SelectValue />
                      </SelectTrigger>

                      <SelectContent>
                        <SelectItem value="active">
                          Aktif
                        </SelectItem>

                        <SelectItem value="suspended">
                          Suspended
                        </SelectItem>

                        <SelectItem value="inactive">
                          Nonaktif
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              {editForm.role ===
                'admin' ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-[12.5px] text-emerald-700 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  Administrator memiliki akses penuh ke semua menu dan aksi. Tidak perlu konfigurasi permission.
                </div>
              ) : (
                <>
                  {permissionStatusBlock()}

                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] text-muted-foreground">
                      Ubah peran untuk reset ke preset, atau aktifkan toggle per menu/aksi.
                    </span>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          toggleAll(
                            true
                          )
                        }
                        className="text-[10.5px] px-2 py-1 border border-border rounded hover:bg-muted"
                      >
                        Aktifkan Semua
                      </button>

                      <button
                        onClick={() =>
                          toggleAll(
                            false
                          )
                        }
                        className="text-[10.5px] px-2 py-1 border border-border rounded hover:bg-muted"
                      >
                        Kosongkan
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {menusByGroup.map(
                      ({
                        group,
                        items,
                      }) => (
                        <div key={group}>
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
                            {
                              GROUP_LABEL[
                                group
                              ]
                            }
                          </div>

                          <div className="border border-border rounded-md overflow-hidden">
                            {items.map(
                              (
                                m,
                                idx
                              ) => {
                                const row =
                                  editForm
                                    .permissions[
                                    m.key
                                  ] ||
                                  {};

                                const allOn =
                                  m.actions.every(
                                    a =>
                                      row[
                                        a
                                      ]
                                  );

                                return (
                                  <div
                                    key={
                                      m.key
                                    }
                                    className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 ${
                                      idx >
                                      0
                                        ? 'border-t border-border/40'
                                        : ''
                                    } hover:bg-muted/20`}
                                  >
                                    <div className="w-40 shrink-0">
                                      <div className="text-[12.5px] font-medium">
                                        {
                                          m.label
                                        }
                                      </div>

                                      <button
                                        onClick={() =>
                                          toggleMenuAll(
                                            m.key,
                                            !allOn
                                          )
                                        }
                                        className="text-[10px] text-primary hover:underline"
                                      >
                                        {
                                          allOn
                                            ? 'Kosongkan'
                                            : 'Pilih Semua'
                                        }
                                      </button>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                      {m.actions.map(
                                        a => (
                                          <label
                                            key={
                                              a
                                            }
                                            className="flex items-center gap-1.5 cursor-pointer select-none"
                                          >
                                            <Switch
                                              checked={
                                                !!row[
                                                  a
                                                ]
                                              }
                                              onCheckedChange={() =>
                                                togglePerm(
                                                  m.key,
                                                  a
                                                )
                                              }
                                              className="scale-75"
                                            />

                                            <span className="text-[11px] text-muted-foreground">
                                              {
                                                actionLabel[
                                                  a
                                                ] ||
                                                a
                                              }
                                            </span>
                                          </label>
                                        )
                                      )}
                                    </div>
                                  </div>
                                );
                              }
                            )}
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="bg-white border border-border rounded-lg p-12 text-center text-muted-foreground">
              <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <div className="text-[13px]">
                Pilih pengguna untuk mengatur hak akses
              </div>
            </div>
          )}
        </div>
      </div>

      {/* INVITE MODAL */}
      <FormModal
        open={inviteOpen}
        onClose={() =>
          setInviteOpen(false)
        }
        title="Undang Pengguna"
        onSubmit={handleInvite}
        submitting={
          submittingInvite
        }
        submitLabel="Kirim Undangan"
      >
        <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-[11.5px] text-blue-700 mb-2">
          Pengguna akan menerima email undangan. Role & nama terpasang otomatis saat login pertama.
        </div>

        <div className="space-y-3">
          <div>
            <Label className="text-[12.5px] mb-1">
              Nama Lengkap *
            </Label>

            <Input
              value={
                inviteForm.full_name
              }
              onChange={e =>
                setInviteForm({
                  ...inviteForm,
                  full_name:
                    e.target.value,
                })
              }
              className="h-9 text-[13px]"
              placeholder="Operator Lab"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Email *
            </Label>

            <Input
              type="email"
              value={
                inviteForm.email
              }
              onChange={e =>
                setInviteForm({
                  ...inviteForm,
                  email:
                    e.target.value,
                })
              }
              className="h-9 text-[13px]"
              placeholder="nama@perusahaan.com"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Peran
            </Label>

            <Select
              value={
                inviteForm.role
              }
              onValueChange={v =>
                setInviteForm({
                  ...inviteForm,
                  role: v,
                })
              }
            >
              <SelectTrigger className="h-9 text-[13px]">
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                {
                  ROLES.map(
                    r => (
                      <SelectItem
                        key={
                          r.value
                        }
                        value={
                          r.value
                        }
                      >
                        {
                          r.label
                        }
                      </SelectItem>
                    )
                  )
                }
              </SelectContent>
            </Select>
          </div>
        </div>
      </FormModal>

      {/* DELETE / DEACTIVATE */}
      <AlertDialog
        open={
          !!deleteTarget
        }
        onOpenChange={o =>
          !o &&
          setDeleteTarget(null)
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Nonaktifkan{' '}
              {
                deleteTarget?.full_name ||
                deleteTarget?.email
              }
              ?
            </AlertDialogTitle>

            <AlertDialogDescription>
              Pengguna tidak akan dapat mengakses aplikasi, histori transaksi tetap dipertahankan.
              Email:{' '}
              {
                deleteTarget?.email
              }
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div>
            <Label className="text-[12.5px] mb-1">
              Alasan (opsional)
            </Label>

            <Textarea
              value={
                deleteReason
              }
              onChange={e =>
                setDeleteReason(
                  e.target.value
                )
              }
              className="min-h-[60px] text-[13px]"
              placeholder="Contoh: resign, pindah divisi, dll."
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={
                deleting
              }
            >
              Batal
            </AlertDialogCancel>

            <AlertDialogAction
              onClick={
                handleDelete
              }
              disabled={
                deleting
              }
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {
                deleting
                  ? 'Memproses...'
                  : 'Nonaktifkan'
              }
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}