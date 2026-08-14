import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

function normalizeEmail(e) {
  return (e || '').trim().toLowerCase();
}

/**
 * Soft-delete / deactivate a user. Admin-only.
 * - Blocks self-deletion.
 * - Blocks deleting the last active administrator.
 * - Soft-deletes the User entity record (status=inactive, deleted_at, deleted_by, delete_reason).
 * - Cancels any pending/accepted invitation for the same email.
 * - Writes an AuditLog entry.
 * Works for users backed by a User record OR by an accepted invitation.
 */
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me();
    if (!me) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (me.role !== 'admin') {
      return Response.json({ error: 'Forbidden: hanya admin yang dapat menonaktifkan pengguna.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    const reason = (body.reason || '').trim();
    if (!email) return Response.json({ error: 'Email wajib diisi.' }, { status: 400 });
    if (email === normalizeEmail(me.email)) {
      return Response.json({ error: 'Anda tidak dapat menghapus akun sendiri.' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const sr = base44.asServiceRole;

    // Find User record by email.
    let userRec = null;
    try {
      const found = await sr.entities.User.filter({ email });
      userRec = found && found[0] ? found[0] : null;
    } catch { userRec = null; }

    // Last active administrator guard.
    if (userRec && userRec.role === 'admin' && userRec.status === 'active') {
      let activeAdmins = 1;
      try {
        const all = await sr.entities.User.list('-created_date', 500);
        activeAdmins = all.filter((u) => u.role === 'admin' && u.status === 'active').length;
      } catch { /* assume single */ }
      if (activeAdmins <= 1) {
        return Response.json({ error: 'Sistem harus memiliki minimal satu Administrator aktif.' }, { status: 400 });
      }
    }

    // Soft-delete the User record.
    if (userRec) {
      try {
        await sr.entities.User.update(userRec.id, {
          status: 'inactive',
          deleted_at: now,
          deleted_by: me.email,
          delete_reason: reason,
        });
      } catch { /* best-effort */ }
    }

    // Cancel invitations for the email.
    try {
      const invs = await sr.entities.UserInvitation.filter({ email });
      for (const inv of invs) {
        if (inv.status === 'pending' || inv.status === 'accepted') {
          try { await sr.entities.UserInvitation.update(inv.id, { status: 'cancelled' }); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }

    // Audit log.
    try {
      await sr.entities.AuditLog.create({
        action_time: now,
        user_name: me.full_name || me.email,
        module: 'users',
        action: 'deactivate',
        entity_type: 'User',
        entity_id: userRec ? userRec.id : email,
        data_before: userRec ? JSON.stringify({ role: userRec.role, status: userRec.status }) : '',
        data_after: JSON.stringify({ status: 'inactive', reason }),
        reason,
      });
    } catch { /* ignore */ }

    return Response.json({ success: true, message: 'Pengguna berhasil dinonaktifkan.' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}