import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
// @ts-ignore
import {
  APP_ENVIRONMENT,
  SCHEMA_VERSION,
  RESTORE_ORDER,
  DATA_ONLY_BACKUP_ENTITIES,
  BACKUP_ENTITIES,
  parseAndValidateBackup,
  createBackup,
} from '../../shared/dbManagement.js';

/**
 * DATABASE RESTORE — STORED BACKUP → SESSION ENGINE
 *
 * Tidak lagi menjalankan performRestore() satu request panjang.
 * Function ini hanya:
 * - auth + validasi backup tersimpan
 * - validasi manifest/checksum/schema
 * - optional auto-backup sekali
 * - membuat DatabaseRestoreSession
 *
 * Actual DELETE / RESTORE / VERIFY dilakukan oleh databaseRestoreBatch.
 */

function createRestoreSessionCode() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');

  const date =
    `${now.getFullYear()}` +
    `${pad(now.getMonth() + 1)}` +
    `${pad(now.getDate())}`;

  const time =
    `${pad(now.getHours())}` +
    `${pad(now.getMinutes())}` +
    `${pad(now.getSeconds())}`;

  const random =
    Math.floor(
      1000 + Math.random() * 9000
    );

  return `RST-${date}-${time}-${random}`;
}

function resolveRestoreEntities(
  mode,
  tables
) {
  const allowed =
    mode === 'data_only'
      ? DATA_ONLY_BACKUP_ENTITIES
      : BACKUP_ENTITIES;

  return RESTORE_ORDER.filter(
    (name) =>
      allowed.includes(name) &&
      Object.prototype.hasOwnProperty.call(
        tables || {},
        name
      )
  );
}

function resolveInitialBatchSize(
  totalRecords
) {
  if (totalRecords > 5000) {
    return 10;
  }

  if (totalRecords > 2000) {
    return 15;
  }

  if (totalRecords > 500) {
    return 25;
  }

  return 50;
}

export default async function (req) {
  let base44;
  let user;

  try {
    base44 =
      createClientFromRequest(req);

    user =
      await base44.auth.me();

    if (!user) {
      return Response.json(
        {
          error:
            'Unauthorized',
        },
        {
          status: 401,
        }
      );
    }

    if (
      user.role !== 'admin'
    ) {
      return Response.json(
        {
          error:
            'Forbidden',
        },
        {
          status: 403,
        }
      );
    }

    if (
      APP_ENVIRONMENT ===
      'production'
    ) {
      return Response.json(
        {
          error:
            'Restore tidak tersedia pada environment Production.',
        },
        {
          status: 403,
        }
      );
    }

    const body =
      await req
        .json()
        .catch(() => ({}));

    const {
      backup_id,
      mode = 'operational',
      confirm,
      autoBackup = true,
    } = body;

    if (!backup_id) {
      return Response.json(
        {
          error:
            'backup_id wajib',
        },
        {
          status: 400,
        }
      );
    }

    if (
      confirm !==
      'RESTORE DATABASE LAB PRO'
    ) {
      return Response.json(
        {
          error:
            'Kalimat konfirmasi tidak sesuai.',
        },
        {
          status: 400,
        }
      );
    }

    if (
      ![
        'data_only',
        'operational',
        'full',
      ].includes(mode)
    ) {
      return Response.json(
        {
          error:
            `Mode restore tidak valid: ${mode}`,
        },
        {
          status: 400,
        }
      );
    }

    const backup =
      await base44
        .asServiceRole
        .entities
        .DatabaseBackup
        .get(backup_id)
        .catch(() => null);

    if (!backup) {
      return Response.json(
        {
          error:
            'Backup tidak ditemukan',
        },
        {
          status: 404,
        }
      );
    }

    if (
      backup.status !==
      'COMPLETED'
    ) {
      return Response.json(
        {
          error:
            'Backup belum selesai atau gagal',
        },
        {
          status: 400,
        }
      );
    }

    if (!backup.storage_path) {
      return Response.json(
        {
          error:
            'Backup tidak memiliki storage_path.',
        },
        {
          status: 400,
        }
      );
    }

    /*
     * Batch engine lintas invocation belum menyimpan password.
     * Jangan mulai session terenkripsi yang nanti berhenti setelah delete.
     */
    if (backup.encrypted) {
      return Response.json(
        {
          error:
            'Restore session belum mendukung backup tersimpan terenkripsi. Gunakan backup tanpa enkripsi.',
        },
        {
          status: 400,
        }
      );
    }

    const signed =
      await base44
        .asServiceRole
        .integrations
        .Core
        .CreateFileSignedUrl({
          file_uri:
            backup.storage_path,
          expires_in:
            120,
        });

    const resp =
      await fetch(
        signed.signed_url
      );

    if (!resp.ok) {
      return Response.json(
        {
          error:
            'Gagal mengambil file backup',
        },
        {
          status: 500,
        }
      );
    }

    const text =
      await resp.text();

    const validation =
      await parseAndValidateBackup(
        text,
        {
          recordChecksum:
            backup.checksum,
        }
      );

    if (!validation.ok) {
      try {
        await base44
          .asServiceRole
          .entities
          .AuditLog
          .create({
            action_time:
              new Date()
                .toISOString(),
            user_name:
              user.email || '',
            module:
              'database',
            action:
              'DATABASE_RESTORE_FAILED',
            reference_number:
              backup.backup_code,
            reason:
              validation.error,
          });
      } catch {}

      return Response.json(
        {
          error:
            validation.error,
        },
        {
          status: 400,
        }
      );
    }

    if (!validation.schemaOk) {
      return Response.json(
        {
          error:
            `Schema version tidak kompatibel ` +
            `(backup: ${
              validation.metadata
                .schemaVersion
            }, aplikasi: ${
              SCHEMA_VERSION
            }). Restore ditolak.`,
        },
        {
          status: 400,
        }
      );
    }

    const tables =
      validation.tables || {};

    const restoreEntities =
      resolveRestoreEntities(
        mode,
        tables
      );

    if (
      restoreEntities.length ===
      0
    ) {
      return Response.json(
        {
          error:
            'Tidak ada entity yang dapat direstore untuk mode ini.',
        },
        {
          status: 400,
        }
      );
    }

    const expected = {};
    const restored = {};
    let totalRecords = 0;

    for (
      const name
      of restoreEntities
    ) {
      const count =
        Array.isArray(
          tables[name]
        )
          ? tables[name].length
          : 0;

      expected[name] =
        count;

      restored[name] =
        0;

      totalRecords +=
        count;
    }

    const initialBatchSize =
      resolveInitialBatchSize(
        totalRecords
      );

    /*
     * AUTO BACKUP — sekali sebelum destructive phase.
     */
    let autoBackupCode =
      null;

    if (autoBackup) {
      const ab =
        await createBackup(
          base44,
          {
            name:
              'Auto-backup sebelum restore stored backup',
            notes:
              `Auto backup sebelum restore ${backup.backup_code}`,
            createdBy:
              user.email ||
              user.id,
            environment:
              APP_ENVIRONMENT,
            backupType:
              'operational',
          }
        );

      if (
        !ab?.record ||
        ab.record.status !==
          'COMPLETED'
      ) {
        throw new Error(
          'Auto-backup sebelum restore tidak selesai. Restore dibatalkan.'
        );
      }

      autoBackupCode =
        ab.record.backup_code;
    }

    const sessionCode =
      createRestoreSessionCode();

    const now =
      new Date()
        .toISOString();

    const progressState = {
      plan:
        restoreEntities,
      completed:
        [],
      deleted:
        [],
      phase:
        'DELETE',
    };

    const session =
      await base44
        .asServiceRole
        .entities
        .DatabaseRestoreSession
        .create({
          session_code:
            sessionCode,

          /*
           * Stored backup memakai storage file yang sama.
           * databaseRestoreBatch tidak perlu tahu sumbernya upload/stored.
           */
          file_uri:
            backup.storage_path,

          file_name:
            backup.file_name ||
            `${backup.backup_code}.json`,

          mode,

          status:
            'READY',

          current_entity:
            '__DELETE__',

          entity_index:
            0,

          current_offset:
            0,

          batch_size:
            initialBatchSize,

          current_batch:
            0,

          total_batches:
            0,

          entity_records:
            0,

          entity_processed:
            0,

          total_records:
            totalRecords,

          total_processed:
            0,

          expected_json:
            JSON.stringify(
              expected
            ),

          restored_json:
            JSON.stringify(
              restored
            ),

          id_maps_json:
            JSON.stringify({}),

          completed_entities_json:
            JSON.stringify(
              progressState
            ),

          auto_backup_code:
            autoBackupCode || '',

          backup_code:
            backup.backup_code ||
            validation.metadata
              .backupId ||
            '',

          password_required:
            false,

          error_entity:
            '',

          error_offset:
            0,

          error_message:
            '',

          started_at:
            now,

          last_checkpoint_at:
            now,

          created_by:
            user.email ||
            user.id ||
            'admin',
        });

    try {
      await base44
        .asServiceRole
        .entities
        .AuditLog
        .create({
          action_time:
            now,

          user_name:
            user.email ||
            user.full_name ||
            'admin',

          module:
            'database',

          action:
            'DATABASE_RESTORE_STORED_BATCH_PREPARED',

          reference_number:
            sessionCode,

          reason:
            `backup=${backup.backup_code}; ` +
            `mode=${mode}; ` +
            `entities=${restoreEntities.length}; ` +
            `records=${totalRecords}; ` +
            `batchSize=${initialBatchSize}; ` +
            `autoBackup=${autoBackupCode || 'none'}; ` +
            `environment=${APP_ENVIRONMENT}`,
        });
    } catch {}

    return Response.json({
      ok:
        true,

      prepared:
        true,

      session_id:
        session.id,

      session_code:
        sessionCode,

      status:
        'READY',

      mode,

      backup_code:
        backup.backup_code,

      autoBackup:
        autoBackupCode,

      entity_total:
        restoreEntities.length,

      entities:
        restoreEntities,

      expected,

      total_records:
        totalRecords,

      total_processed:
        0,

      batch_size:
        initialBatchSize,

      encrypted:
        false,

      source:
        'stored_backup',

      next:
        'databaseRestoreBatch',
    });

  } catch (error) {
    try {
      if (
        base44 &&
        user
      ) {
        await base44
          .asServiceRole
          .entities
          .AuditLog
          .create({
            action_time:
              new Date()
                .toISOString(),

            user_name:
              user.email || '',

            module:
              'database',

            action:
              'DATABASE_RESTORE_FAILED',

            reason:
              error?.message ||
              'Unknown stored restore prepare error',
          });
      }
    } catch {}

    return Response.json(
      {
        error:
          error?.message ||
          'Restore preparation gagal',
      },
      {
        status: 500,
      }
    );
  }
}