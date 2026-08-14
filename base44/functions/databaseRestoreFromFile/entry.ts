import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

import {
  APP_ENVIRONMENT,
  MAX_RESTORE_FILE_SIZE,
  SCHEMA_VERSION,
  RESTORE_ORDER,
  DATA_ONLY_BACKUP_ENTITIES,
  BACKUP_ENTITIES,
  parseAndValidateBackup,
  createBackup,
} from '../../shared/dbManagement.js';

/**
 * DATABASE RESTORE FROM FILE — BATCH RESTORE V1
 *
 * Function ini hanya PREPARE:
 * - auth admin
 * - download file
 * - validate manifest/checksum/schema
 * - auto backup sekali
 * - buat DatabaseRestoreSession
 *
 * Function ini TIDAK menghapus / restore data bisnis.
 * Actual restore dilakukan oleh databaseRestoreBatch.
 */

function createRestoreSessionCode() {
  const now = new Date();

  const pad = value =>
    String(value).padStart(2, '0');

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
    name =>
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
    /* =====================================================
       AUTH
    ===================================================== */

    base44 =
      createClientFromRequest(req);

    user =
      await base44.auth.me();

    if (!user) {
      return Response.json(
        {
          error: 'Unauthorized',
        },
        {
          status: 401,
        }
      );
    }

    if (user.role !== 'admin') {
      return Response.json(
        {
          error: 'Forbidden',
        },
        {
          status: 403,
        }
      );
    }

    if (
      APP_ENVIRONMENT === 'production'
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

    /* =====================================================
       REQUEST
    ===================================================== */

    const body =
      await req
        .json()
        .catch(() => ({}));

    const {
      file_uri,
      file_name,
      mode = 'operational',
      confirm,
      autoBackup = true,
      password,
    } = body;

    if (!file_uri) {
      return Response.json(
        {
          error: 'file_uri wajib',
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

    /* =====================================================
       DOWNLOAD BACKUP
    ===================================================== */

    const signed =
      await base44
        .asServiceRole
        .integrations
        .Core
        .CreateFileSignedUrl({
          file_uri,
          expires_in: 120,
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

    const fileSize =
      new Blob([text]).size;

    if (
      fileSize >
      MAX_RESTORE_FILE_SIZE
    ) {
      return Response.json(
        {
          error:
            `Ukuran file melebihi batas (` +
            `${
              MAX_RESTORE_FILE_SIZE /
              1048576
            } MB).`,
        },
        {
          status: 400,
        }
      );
    }

    /* =====================================================
       VALIDATE BACKUP
    ===================================================== */

    const validation =
      await parseAndValidateBackup(
        text,
        {
          password,
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
              'DATABASE_RESTORE_FROM_LOCAL_FAILED',

            reference_number:
              file_name || '',

            reason:
              validation.error,
          });
      } catch {}

      return Response.json(
        {
          error:
            validation.error,

          needsPassword:
            validation.needsPassword ||
            false,
        },
        {
          status: 400,
        }
      );
    }

    /* =====================================================
       SCHEMA CHECK
    ===================================================== */

    if (!validation.schemaOk) {
      const reason =
        `Schema version tidak kompatibel ` +
        `(file: ${
          validation.metadata
            .schemaVersion
        }, aplikasi: ${
          SCHEMA_VERSION
        })`;

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
              'DATABASE_RESTORE_FROM_LOCAL_FAILED',

            reference_number:
              file_name || '',

            reason,
          });
      } catch {}

      return Response.json(
        {
          error:
            `Schema version tidak kompatibel ` +
            `(file: ${
              validation.metadata
                .schemaVersion
            }, aplikasi saat ini: ${
              SCHEMA_VERSION
            }). Restore ditolak.`,
        },
        {
          status: 400,
        }
      );
    }

    /* =====================================================
       BUILD RESTORE PLAN
    ===================================================== */

    const tables =
      validation.tables || {};

    const restoreEntities =
      resolveRestoreEntities(
        mode,
        tables
      );

    if (
      restoreEntities.length === 0
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

      totalRecords += count;
    }

    const initialBatchSize =
      resolveInitialBatchSize(
        totalRecords
      );

    /* =====================================================
       AUTO BACKUP — ONCE
    ===================================================== */

    let autoBackupCode =
      null;

    if (false) {
      const ab =
        await createBackup(
          base44,
          {
            name:
              'Auto-backup sebelum restore batch',

            notes:
              `Auto backup sebelum restore ` +
              `dari ${
                file_name ||
                'file upload'
              }`,

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

    /* =====================================================
       CREATE SESSION
    ===================================================== */

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

          file_uri,

          file_name:
            file_name || '',

          mode,

          status:
            'READY',

          /*
           * Batch worker akan memulai
           * dari phase DELETE.
           */
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

          /*
           * Dipakai juga untuk menyimpan
           * restore plan + phase.
           */
          completed_entities_json:
            JSON.stringify(
              progressState
            ),

          auto_backup_code:
            autoBackupCode || '',

          backup_code:
            validation.metadata
              .backupId || '',

          password_required:
            !!validation.encrypted,

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

    /* =====================================================
       AUDIT
    ===================================================== */

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
            'DATABASE_RESTORE_BATCH_PREPARED',

          reference_number:
            sessionCode,

          reason:
            `backup=${
              validation.metadata
                .backupId
            }; ` +
            `mode=${mode}; ` +
            `entities=${
              restoreEntities.length
            }; ` +
            `records=${
              totalRecords
            }; ` +
            `batchSize=${
              initialBatchSize
            }; ` +
            `autoBackup=${
              autoBackupCode ||
              'none'
            }; ` +
            `source=${
              file_name ||
              'upload'
            }`,
        });
    } catch {}

    /* =====================================================
       RESPONSE
    ===================================================== */

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
        validation.metadata
          .backupId,

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
        !!validation.encrypted,

      /*
       * Frontend selanjutnya memanggil:
       * databaseRestoreBatch
       */
      next:
        'databaseRestoreBatch',
    });

  } catch (error) {
    console.error(
      '[DATABASE RESTORE PREPARE ERROR]',
      error
    );

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
              'DATABASE_RESTORE_FROM_LOCAL_FAILED',

            reason:
              error?.message ||
              'Unknown restore preparation error',
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