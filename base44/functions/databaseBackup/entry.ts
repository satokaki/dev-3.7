import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Base44 editor dapat menandai import JS dari function TS sebagai missing declaration.
// @ts-ignore
import { createBackup, APP_ENVIRONMENT } from '../../shared/dbManagement.js';

export default async function (req) {
  let base44;
  let user;

  try {
    base44 = createClientFromRequest(req);
    user = await base44.auth.me();

    if (!user) {
      return Response.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    if (user.role !== 'admin') {
      return Response.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));

    const {
      name,
      notes,
      backup_type = 'operational',
      encrypt = false,
      password,
    } = body;

    if (encrypt && !password) {
      return Response.json(
        {
          error: 'Password enkripsi wajib saat Encrypt Backup aktif.',
        },
        { status: 400 }
      );
    }

    // v3.4: data_only + existing operational/full
    if (
      backup_type &&
      !['data_only', 'operational', 'full'].includes(backup_type)
    ) {
      return Response.json(
        {
          error:
            'backup_type tidak valid (data_only / operational / full).',
        },
        { status: 400 }
      );
    }

    const result = await createBackup(base44, {
      name,
      notes,
      createdBy: user.email || user.id,
      environment: APP_ENVIRONMENT,
      backupType: backup_type,
      encrypt: !!encrypt,
      password,
    });

    await base44.asServiceRole.entities.AuditLog.create({
      action_time: new Date().toISOString(),
      user_name: user.email || user.full_name || 'admin',
      module: 'database',
      action: 'DATABASE_BACKUP_FILE_CREATED',
      entity_type: 'DatabaseBackup',
      entity_id: result.record.id,
      reference_number: result.record.backup_code,
      reason: notes || 'Backup created',
      data_after: JSON.stringify({
        recordCount: result.recordCount,
        checksum: result.checksum,
        fileSize: result.fileSize,
        fileName: result.fileName,
        backupType: backup_type,
        encrypted: !!encrypt,
        environment: APP_ENVIRONMENT,
      }),
    });

    return Response.json({
      ok: true,
      backup: result.record,
    });
  } catch (error) {
    try {
      if (base44 && user) {
        await base44.asServiceRole.entities.AuditLog.create({
          action_time: new Date().toISOString(),
          user_name: user.email || '',
          module: 'database',
          action: 'DATABASE_BACKUP_FAILED',
          reason: error.message,
        });
      }
    } catch {}

    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }
}