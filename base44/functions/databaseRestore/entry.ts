import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { APP_ENVIRONMENT, parseAndValidateBackup, performRestore } from '../../shared/dbManagement.js';

export default async function (req) {
  let base44;
  let user;
  try {
    base44 = createClientFromRequest(req);
    user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    if (APP_ENVIRONMENT === 'production') {
      return Response.json({ error: 'Restore tidak tersedia pada environment Production.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { backup_id, mode = 'operational', confirm, autoBackup = true } = body;
    if (!backup_id) return Response.json({ error: 'backup_id wajib' }, { status: 400 });
    if (confirm !== 'RESTORE DATABASE LAB PRO') {
      return Response.json({ error: 'Kalimat konfirmasi tidak sesuai.' }, { status: 400 });
    }

    const backup = await base44.asServiceRole.entities.DatabaseBackup.get(backup_id).catch(() => null);
    if (!backup) return Response.json({ error: 'Backup tidak ditemukan' }, { status: 404 });
    if (backup.status !== 'COMPLETED') return Response.json({ error: 'Backup belum selesai atau gagal' }, { status: 400 });

    const signed = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: backup.storage_path, expires_in: 120 });
    const resp = await fetch(signed.signed_url);
    if (!resp.ok) return Response.json({ error: 'Gagal mengambil file backup' }, { status: 500 });
    const text = await resp.text();

    const v = await parseAndValidateBackup(text, { recordChecksum: backup.checksum });
    if (!v.ok) {
      await base44.asServiceRole.entities.AuditLog.create({
        action_time: new Date().toISOString(),
        user_name: user.email || '',
        module: 'database',
        action: 'DATABASE_RESTORE_FAILED',
        reference_number: backup.backup_code,
        reason: v.error,
      });
      return Response.json({ error: v.error }, { status: 400 });
    }

    const result = await performRestore(base44, v.tables, { mode, autoBackup, createdBy: user.email || user.id });

    await base44.asServiceRole.entities.AuditLog.create({
      action_time: new Date().toISOString(),
      user_name: user.email || user.full_name || 'admin',
      module: 'database',
      action: 'DATABASE_RESTORE_COMPLETED',
      reference_number: backup.backup_code,
      reason: `mode=${mode}; autoBackup=${result.autoBackupCode || 'none'}; environment=${APP_ENVIRONMENT}`,
      data_after: JSON.stringify(result.restored),
    });

    return Response.json({ ok: true, mode, backup_code: backup.backup_code, autoBackup: result.autoBackupCode, restored: result.restored });
  } catch (error) {
    try {
      if (base44 && user) {
        await base44.asServiceRole.entities.AuditLog.create({
          action_time: new Date().toISOString(),
          user_name: user.email || '',
          module: 'database',
          action: 'DATABASE_RESTORE_FAILED',
          reason: error.message,
        });
      }
    } catch {}
    return Response.json({ error: error.message }, { status: 500 });
  }
}