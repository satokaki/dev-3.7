import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { MAX_RESTORE_FILE_SIZE, parseAndValidateBackup } from '../../shared/dbManagement.js';

// Validates an uploaded backup file (already in private storage via UploadPrivateFile).
// Returns a preview of the backup contents for admin confirmation. Never restores.
export default async function (req) {
  let base44;
  let user;
  try {
    base44 = createClientFromRequest(req);
    user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { file_uri, file_name, file_size, password } = body;
    if (!file_uri) return Response.json({ error: 'file_uri wajib' }, { status: 400 });
    if (file_size && file_size > MAX_RESTORE_FILE_SIZE) {
      return Response.json({ error: `Ukuran file melebihi batas (${MAX_RESTORE_FILE_SIZE / 1048576} MB).` }, { status: 400 });
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action_time: new Date().toISOString(),
      user_name: user.email || user.full_name || 'admin',
      module: 'database',
      action: 'DATABASE_RESTORE_FILE_UPLOADED',
      reference_number: file_name || '',
      reason: 'Backup file uploaded for validation',
      data_after: JSON.stringify({ fileName: file_name, fileSize: file_size, encrypted: !!password }),
    });

    const signed = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri, expires_in: 120 });
    const resp = await fetch(signed.signed_url);
    if (!resp.ok) return Response.json({ error: 'Gagal mengambil file yang diupload' }, { status: 500 });
    const text = await resp.text();
    const actualSize = new Blob([text]).size;
    if (actualSize > MAX_RESTORE_FILE_SIZE) {
      return Response.json({ error: `Ukuran file melebihi batas (${MAX_RESTORE_FILE_SIZE / 1048576} MB).` }, { status: 400 });
    }

    const v = await parseAndValidateBackup(text, { password });
    if (!v.ok) {
      await base44.asServiceRole.entities.AuditLog.create({
        action_time: new Date().toISOString(),
        user_name: user.email || '',
        module: 'database',
        action: 'DATABASE_RESTORE_FILE_VALIDATED',
        reference_number: file_name || '',
        reason: 'VALIDATION FAILED: ' + v.error,
      });
      const status = v.needsPassword ? 449 : 400;
      return Response.json({ error: v.error, needsPassword: !!v.needsPassword }, { status });
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action_time: new Date().toISOString(),
      user_name: user.email || user.full_name || 'admin',
      module: 'database',
      action: 'DATABASE_RESTORE_FILE_VALIDATED',
      reference_number: file_name || '',
      reason: 'Backup file validated',
      data_after: JSON.stringify({
        backupId: v.metadata.backupId,
        application: v.metadata.application,
        appVersion: v.metadata.appVersion,
        schemaVersion: v.metadata.schemaVersion,
        backupType: v.metadata.backupType,
        encrypted: v.encrypted,
        recordCount: v.metadata.recordCount,
        schemaOk: v.schemaOk,
        fileSize: actualSize,
        checksum: v.metadata.checksum,
      }),
    });

    return Response.json({
      ok: true,
      preview: {
        backupId: v.metadata.backupId,
        application: v.metadata.application,
        createdAt: v.metadata.createdAt,
        createdBy: v.metadata.createdBy,
        appVersion: v.metadata.appVersion,
        schemaVersion: v.metadata.schemaVersion,
        backupType: v.metadata.backupType,
        encrypted: v.encrypted,
        recordCount: v.metadata.recordCount,
        tableCount: v.metadata.tableCount,
        checksumStatus: 'valid',
        schemaOk: v.schemaOk,
        environment: v.metadata.environment,
        fileSize: actualSize,
        entities: Object.keys(v.tables),
      },
    });
  } catch (error) {
    try {
      if (base44 && user) {
        await base44.asServiceRole.entities.AuditLog.create({
          action_time: new Date().toISOString(),
          user_name: user.email || '',
          module: 'database',
          action: 'DATABASE_RESTORE_FILE_VALIDATED',
          reason: 'ERROR: ' + error.message,
        });
      }
    } catch {}
    return Response.json({ error: error.message }, { status: 500 });
  }
}