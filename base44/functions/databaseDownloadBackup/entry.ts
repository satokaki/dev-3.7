import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { APP_ENVIRONMENT } from '../../shared/dbManagement.js';

// Returns a short-lived signed URL for downloading a backup file to the admin's local drive.
// The signed URL points to private storage; the frontend fetches it as a blob and triggers
// a forced download (so the JSON never renders inline in the browser).
export default async function (req) {
  let base44;
  let user;
  try {
    base44 = createClientFromRequest(req);
    user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { backup_id } = body;
    if (!backup_id) return Response.json({ error: 'backup_id wajib' }, { status: 400 });

    const backup = await base44.asServiceRole.entities.DatabaseBackup.get(backup_id).catch(() => null);
    if (!backup) return Response.json({ error: 'Backup tidak ditemukan' }, { status: 404 });
    if (backup.status !== 'COMPLETED') return Response.json({ error: 'Backup belum selesai atau gagal' }, { status: 400 });
    if (!backup.storage_path) return Response.json({ error: 'File backup tidak tersedia di storage' }, { status: 400 });

    const signed = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
      file_uri: backup.storage_path,
      expires_in: 120,
    });

    await base44.asServiceRole.entities.AuditLog.create({
      action_time: new Date().toISOString(),
      user_name: user.email || user.full_name || 'admin',
      module: 'database',
      action: 'DATABASE_BACKUP_DOWNLOADED',
      entity_type: 'DatabaseBackup',
      entity_id: backup.id,
      reference_number: backup.backup_code,
      reason: 'Backup file downloaded to local drive',
      data_after: JSON.stringify({
        fileName: backup.file_name,
        fileSize: backup.file_size,
        checksum: backup.checksum,
        environment: APP_ENVIRONMENT,
        expiresIn: 120,
      }),
    });

    return Response.json({
      ok: true,
      signed_url: signed.signed_url,
      file_name: backup.file_name,
      file_size: backup.file_size,
      backup_code: backup.backup_code,
      expires_in: 120,
    });
  } catch (error) {
    try {
      if (base44 && user) {
        await base44.asServiceRole.entities.AuditLog.create({
          action_time: new Date().toISOString(),
          user_name: user.email || '',
          module: 'database',
          action: 'DATABASE_BACKUP_DOWNLOADED',
          reason: 'FAILED: ' + error.message,
        });
      }
    } catch {}
    return Response.json({ error: error.message }, { status: 500 });
  }
}