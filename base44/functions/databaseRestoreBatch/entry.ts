import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

import {
  APP_ENVIRONMENT,
  RESTORE_ORDER,
  TRANSACTION_ENTITIES,
  FULL_ONLY_ENTITIES,
  RESTORE_REFS,
  stripBuiltins,
  remapRecord,
  isReferencedByOthers,
} from '../../shared/dbManagement.js';

/**
 * DATABASE RESTORE BATCH — V1
 *
 * Satu invocation hanya mengerjakan SATU unit kerja:
 *
 * DELETE phase:
 *   maksimal satu entity per invocation.
 *
 * RESTORE phase:
 *   maksimal satu batch record per invocation.
 *
 * VERIFY phase:
 *   membandingkan expected vs restored.
 *
 * Progress disimpan ke DatabaseRestoreSession sehingga frontend
 * dapat memanggil function ini berulang sampai COMPLETED.
 */

const MAX_BATCH_SIZE = 50;
const DEFAULT_BATCH_SIZE = 10;
const DELETE_BATCH_SIZE = 10;
const MAX_RETRIES = 5;
const ID_MAP_FILE_PREFIX = '@file:';
const MAX_INLINE_ID_MAP_SIZE = 6000;

/* ==========================================================
   GENERAL HELPERS
========================================================== */

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

function safeJsonParse(
  value,
  fallback
) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function clampBatchSize(value) {
  return Math.max(
    1,
    Math.min(
      Number(value) ||
        DEFAULT_BATCH_SIZE,
      MAX_BATCH_SIZE
    )
  );
}

function getErrorMessage(error) {
  return String(
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    error?.message ||
    error ||
    'Unknown error'
  );
}

function isRateLimitError(error) {
  const msg =
    getErrorMessage(error)
      .toLowerCase();

  return (
    msg.includes('rate limit') ||
    msg.includes(
      'too many requests'
    ) ||
    msg.includes('429')
  );
}

async function retryOperation(
  fn,
  label,
  maxRetries = MAX_RETRIES
) {
  let lastError;

  for (
    let attempt = 1;
    attempt <= maxRetries;
    attempt++
  ) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (
        attempt >= maxRetries
      ) {
        break;
      }

      const waitMs =
        isRateLimitError(error)
          ? Math.min(
              2000 *
                Math.pow(
                  2,
                  attempt - 1
                ),
              16000
            )
          : Math.min(
              500 *
                Math.pow(
                  2,
                  attempt - 1
                ),
              4000
            );

      await sleep(waitMs);
    }
  }

  throw new Error(
    `${label} gagal setelah ` +
    `${maxRetries} percobaan: ` +
    `${getErrorMessage(
      lastError
    )}`
  );
}

/* ==========================================================
   SESSION HELPERS
========================================================== */

async function getSession(
  base44,
  sessionId
) {
  const entity =
    base44.asServiceRole
      .entities
      .DatabaseRestoreSession;

  /*
   * Gunakan filter ID supaya tidak
   * bergantung pada get() tersedia
   * atau tidak di SDK.
   */
  const rows =
    await entity.filter({
      id: sessionId,
    });

  if (
    !rows ||
    rows.length === 0
  ) {
    throw new Error(
      'Restore session tidak ditemukan.'
    );
  }

  return rows[0];
}

async function updateSession(
  base44,
  session,
  patch
) {
  await base44
    .asServiceRole
    .entities
    .DatabaseRestoreSession
    .update(
      session.id,
      {
        ...patch,

        last_checkpoint_at:
          new Date()
            .toISOString(),
      }
    );

  return {
    ...session,
    ...patch,
  };
}

/* ==========================================================
   BACKUP FILE
========================================================== */

async function loadBackupTables(
  base44,
  session
) {
  const signed =
    await base44
      .asServiceRole
      .integrations
      .Core
      .CreateFileSignedUrl({
        file_uri:
          session.file_uri,

        expires_in: 120,
      });

  const response =
    await fetch(
      signed.signed_url
    );

  if (!response.ok) {
    throw new Error(
      `Gagal membaca file backup ` +
      `(HTTP ${response.status}).`
    );
  }

  const text =
    await response.text();

  let parsed;

  try {
    parsed =
      JSON.parse(text);
  } catch {
    throw new Error(
      'File backup tidak dapat diparse.'
    );
  }

  /*
   * Batch engine V1 tidak menyimpan password
   * di DatabaseRestoreSession.
   *
   * Karena itu backup encrypted belum dapat
   * diproses lintas invocation.
   *
   * Kita fail secara eksplisit daripada
   * menghasilkan restore parsial.
   */
  if (
    parsed?.encrypted === true
  ) {
    throw new Error(
      'Batch restore V1 belum mendukung file terenkripsi lintas request. Gunakan backup tanpa enkripsi untuk pengujian batch.'
    );
  }

  if (
    !parsed?.tables ||
    typeof parsed.tables !==
      'object'
  ) {
    throw new Error(
      'Struktur tables tidak ditemukan pada backup.'
    );
  }

  return parsed.tables;
}

/* ==========================================================
   FILE-BACKED ID MAP CHECKPOINT
========================================================== */

async function loadIdMaps(
  base44,
  session
) {
  const stored =
    session.id_maps_json ||
    '';

  if (
    !stored.startsWith(
      ID_MAP_FILE_PREFIX
    )
  ) {
    return safeJsonParse(
      stored,
      {}
    );
  }

  const fileUri =
    stored.slice(
      ID_MAP_FILE_PREFIX.length
    );

  if (!fileUri) {
    return {};
  }

  const signed =
    await base44
      .asServiceRole
      .integrations
      .Core
      .CreateFileSignedUrl({
        file_uri:
          fileUri,

        expires_in: 120,
      });

  const response =
    await fetch(
      signed.signed_url
    );

  if (!response.ok) {
    throw new Error(
      `Gagal membaca checkpoint ID map ` +
      `(HTTP ${response.status}).`
    );
  }

  try {
    return JSON.parse(
      await response.text()
    );
  } catch {
    throw new Error(
      'Checkpoint ID map tidak dapat diparse.'
    );
  }
}

async function saveIdMaps(
  base44,
  session,
  idMaps
) {
  const content =
    JSON.stringify(
      idMaps || {}
    );

  /*
   * Map kecil tetap inline agar invocation awal hemat storage.
   * Setelah melewati batas atau sudah file-backed, seluruh map
   * disimpan sebagai private file dan field hanya menyimpan URI.
   */
  if (
    content.length <=
      MAX_INLINE_ID_MAP_SIZE &&
    !String(
      session.id_maps_json || ''
    ).startsWith(
      ID_MAP_FILE_PREFIX
    )
  ) {
    return content;
  }

  const safeSessionCode =
    String(
      session.session_code ||
      session.id ||
      'restore'
    ).replace(
      /[^a-zA-Z0-9_-]/g,
      '_'
    );

  const checkpoint =
    Number(
      session.total_processed ||
      session.current_offset ||
      0
    );

  const file =
    new File(
      [
        new Blob(
          [content]
        ),
      ],
      `RESTORE_IDMAP_${safeSessionCode}_${checkpoint}_${Date.now()}.json`,
      {
        type:
          'application/json',
      }
    );

  const uploaded =
    await retryOperation(
      () =>
        base44
          .asServiceRole
          .integrations
          .Core
          .UploadPrivateFile({
            file,
          }),

      'Upload checkpoint ID map'
    );

  if (!uploaded?.file_uri) {
    throw new Error(
      'Upload checkpoint ID map tidak mengembalikan file_uri.'
    );
  }

  return (
    ID_MAP_FILE_PREFIX +
    uploaded.file_uri
  );
}

/* ==========================================================
   PROGRESS
========================================================== */

function calculateProgress(
  session,
  restored,
  phase
) {
  const total =
    Number(
      session.total_records ||
      0
    );

  const processed =
    Object.values(
      restored || {}
    ).reduce(
      (sum, value) =>
        sum +
        Number(value || 0),
      0
    );

  if (
    phase === 'COMPLETED'
  ) {
    return {
      processed,
      percent: 100,
    };
  }

  if (total <= 0) {
    return {
      processed,
      percent:
        phase === 'RESTORE'
          ? 50
          : 0,
    };
  }

  /*
   * DELETE = 0–5%
   * RESTORE = 5–95%
   * VERIFY = 95–99%
   * COMPLETE = 100%
   */
  let percent;

  if (phase === 'DELETE') {
    percent = 2;
  } else if (
    phase === 'VERIFY'
  ) {
    percent = 97;
  } else {
    percent =
      5 +
      (
        Math.min(
          processed,
          total
        ) /
        total
      ) *
        90;
  }

  return {
    processed,
    percent:
      Math.min(
        99,
        Math.max(
          0,
          Number(
            percent.toFixed(2)
          )
        )
      ),
  };
}

/* ==========================================================
   RESTORE PLAN
========================================================== */

function getPlan(session) {
  const state =
    safeJsonParse(
      session
        .completed_entities_json,
      {}
    );

  const plan =
    Array.isArray(state.plan)
      ? state.plan
      : [];

  return {
    ...state,

    plan,

    completed:
      Array.isArray(
        state.completed
      )
        ? state.completed
        : [],

    deleted:
      Array.isArray(
        state.deleted
      )
        ? state.deleted
        : [],

    phase:
      state.phase ||
      'DELETE',
  };
}

function getDeletePlan(
  session,
  tables
) {
  const names =
    session.mode ===
    'data_only'
      ? FULL_ONLY_ENTITIES
      : [
          ...TRANSACTION_ENTITIES,
          ...FULL_ONLY_ENTITIES,
        ];

  /*
   * Sama seperti restore lama:
   * jangan delete entity yang
   * tidak terdapat pada snapshot.
   */
  return names.filter(
    name =>
      Object.prototype
        .hasOwnProperty.call(
          tables || {},
          name
        )
  );
}

/* ==========================================================
   PAYLOAD / FIELD INFO
========================================================== */

function buildPayload(
  entityName,
  row,
  idMaps
) {
  const cleaned =
    stripBuiltins(
      row || {}
    );

  delete cleaned.__source_id;

  return remapRecord(
    entityName,
    cleaned,
    idMaps
  );
}

function getFieldNames(
  payload
) {
  return Object.keys(
    payload || {}
  );
}

/* ==========================================================
   DELETE PHASE
========================================================== */

async function processDeletePhase({
  base44,
  session,
  tables,
  state,
}) {
  const entities =
    base44.asServiceRole
      .entities;

  const deletePlan =
    getDeletePlan(
      session,
      tables
    );

  const nextEntity =
    deletePlan.find(
      name =>
        !state.deleted.includes(
          name
        )
    );

  /*
   * Semua delete selesai.
   * Pindah ke RESTORE.
   */
  if (!nextEntity) {
    const nextState = {
      ...state,
      phase:
        'RESTORE',
    };

    const firstEntity =
      state.plan[0] ||
      '';

    session =
      await updateSession(
        base44,
        session,
        {
          status:
            'RUNNING',

          current_entity:
            firstEntity,

          entity_index:
            0,

          current_offset:
            0,

          current_batch:
            0,

          entity_records:
            firstEntity
              ? (
                  tables[
                    firstEntity
                  ] || []
                ).length
              : 0,

          entity_processed:
            0,

          completed_entities_json:
            JSON.stringify(
              nextState
            ),
        }
      );

    const progress =
      calculateProgress(
        session,
        safeJsonParse(
          session.restored_json,
          {}
        ),
        'RESTORE'
      );

    return {
      ok: true,

      session_id:
        session.id,

      session_code:
        session.session_code,

      status:
        'RUNNING',

      phase:
        'RESTORE',

      message:
        'Penghapusan data lama selesai. Siap menulis data backup.',

      current_entity:
        firstEntity,

      current_offset:
        0,

      total_processed:
        progress.processed,

      total_records:
        session.total_records,

      progress_percent:
        progress.percent,

      done: false,
    };
  }

  const continuingEntity =
    session.current_entity ===
    nextEntity;

  const previouslyDeleted =
    continuingEntity
      ? Number(
          session.entity_processed ||
          0
        )
      : 0;

  session =
    await updateSession(
      base44,
      session,
      {
        status:
          'RUNNING',

        current_entity:
          nextEntity,

        current_offset:
          previouslyDeleted,

        entity_processed:
          previouslyDeleted,

        error_entity:
          '',

        error_offset:
          0,

        error_message:
          '',
      }
    );

  /*
   * Jangan gunakan deleteMany({}) di sini. Pada entity besar,
   * satu request dapat membuat origin timeout sebelum Cloudflare
   * menerima response. Ambil halaman kecil dan hapus satu per satu;
   * invocation berikutnya akan mengambil halaman pertama yang tersisa.
   */
  const rows =
    await retryOperation(
      () =>
        entities[
          nextEntity
        ].list(
          '-created_date',
          DELETE_BATCH_SIZE
        ),

      `List delete batch ${nextEntity}`
    );

  if (
    Array.isArray(rows) &&
    rows.length > 0
  ) {
    let deletedInBatch = 0;

    for (const row of rows) {
      if (!row?.id) {
        continue;
      }

      try {
        await retryOperation(
          () =>
            entities[
              nextEntity
            ].delete(row.id),

          `Delete ${nextEntity} ${
            row.id
          }`
        );

        deletedInBatch += 1;
      } catch (error) {
        error.entity =
          nextEntity;

        error.offset =
          previouslyDeleted +
          deletedInBatch;

        throw error;
      }
    }

    const deletedTotal =
      previouslyDeleted +
      deletedInBatch;

    session =
      await updateSession(
        base44,
        session,
        {
          current_offset:
            deletedTotal,

          entity_processed:
            deletedTotal,
        }
      );

    return {
      ok: true,

      session_id:
        session.id,

      session_code:
        session.session_code,

      status:
        'RUNNING',

      phase:
        'DELETE',

      operation:
        'DELETE',

      current_entity:
        nextEntity,

      current_offset:
        deletedTotal,

      entity_processed:
        deletedTotal,

      batch_written:
        deletedInBatch,

      message:
        `${deletedTotal} record lama ${nextEntity} berhasil dihapus...`,

      delete_completed:
        state.deleted.length,

      delete_total:
        deletePlan.length,

      progress_percent:
        deletePlan.length
          ? Number(
              (
                (
                  state.deleted.length /
                  deletePlan.length
                ) *
                5
              ).toFixed(2)
            )
          : 5,

      done: false,
    };
  }

  const nextState = {
    ...state,

    deleted: [
      ...state.deleted,
      nextEntity,
    ],

    phase:
      'DELETE',
  };

  session =
    await updateSession(
      base44,
      session,
      {
        completed_entities_json:
          JSON.stringify(
            nextState
          ),

        current_offset:
          0,

        entity_processed:
          0,
      }
    );

  return {
    ok: true,

    session_id:
      session.id,

    session_code:
      session.session_code,

    status:
      'RUNNING',

    phase:
      'DELETE',

    operation:
      'DELETE',

    current_entity:
      nextEntity,

    message:
      `Data lama ${nextEntity} berhasil dihapus.`,

    delete_completed:
      nextState.deleted.length,

    delete_total:
      deletePlan.length,

    progress_percent:
      deletePlan.length
        ? Number(
            (
              (
                nextState
                  .deleted
                  .length /
                deletePlan.length
              ) *
              5
            ).toFixed(2)
          )
        : 5,

    done: false,
  };
}

/* ==========================================================
   REFERENCED ENTITY
========================================================== */

async function restoreReferencedBatch({
  entities,
  entityName,
  rows,
  offset,
  batchSize,
  idMaps,
}) {
  const end =
    Math.min(
      offset +
        batchSize,
      rows.length
    );

  let written = 0;

  let lastFields = [];

  for (
    let index = offset;
    index < end;
    index++
  ) {
    const row =
      rows[index];

    const sourceId =
      row?.__source_id ||
      row?.id ||
      null;

    const payload =
      buildPayload(
        entityName,
        row,
        idMaps
      );

    lastFields =
      getFieldNames(
        payload
      );

    const created =
      await retryOperation(
        () =>
          entities[
            entityName
          ].create(
            payload
          ),

        `${entityName} record ${
          index + 1
        }`
      );

    if (
      !created?.id
    ) {
      throw new Error(
        `${entityName} record ${
          index + 1
        }: create() tidak mengembalikan id.`
      );
    }

    if (sourceId) {
      idMaps[
        entityName
      ] =
        idMaps[
          entityName
        ] || {};

      idMaps[
        entityName
      ][sourceId] =
        created.id;
    }

    written++;

    /*
     * Small throttle.
     */
    await sleep(150);
  }

  return {
    written,
    end,
    fields:
      lastFields,
  };
}

/* ==========================================================
   LEAF ENTITY
========================================================== */

async function restoreLeafBatch({
  entities,
  entityName,
  rows,
  offset,
  batchSize,
  idMaps,
}) {
  const chunk =
    rows.slice(
      offset,
      offset +
        batchSize
    );

  const payload =
    chunk.map(row =>
      buildPayload(
        entityName,
        row,
        idMaps
      )
    );

  const fields =
    payload.length
      ? getFieldNames(
          payload[0]
        )
      : [];

  /*
   * Bulk create dulu.
   */
  try {
    await retryOperation(
      () =>
        entities[
          entityName
        ].bulkCreate(
          payload
        ),

      `${entityName} bulk ${
        offset + 1
      }-${
        offset +
        payload.length
      }`
    );

    return {
      written:
        payload.length,

      end:
        offset +
        payload.length,

      fields,

      strategy:
        'bulkCreate',
    };

  } catch (bulkError) {
    /*
     * Bulk gagal.
     *
     * Fallback record satu per satu
     * supaya kita tahu record mana
     * yang bermasalah.
     */

    let written = 0;

    for (
      let i = 0;
      i < payload.length;
      i++
    ) {
      const absoluteIndex =
        offset + i;

      try {
        await retryOperation(
          () =>
            entities[
              entityName
            ].create(
              payload[i]
            ),

          `${entityName} record ${
            absoluteIndex +
            1
          }`
        );

        written++;

      } catch (recordError) {
        const error =
          new Error(
            `${entityName} record ${
              absoluteIndex + 1
            } gagal. ` +
            `Fields: ${
              Object.keys(
                payload[i] || {}
              ).join(', ')
            }. ` +
            `Error: ${
              getErrorMessage(
                recordError
              )
            }`
          );

        error.entity =
          entityName;

        error.offset =
          absoluteIndex;

        error.fields =
          Object.keys(
            payload[i] || {}
          );

        error.sourceId =
          chunk[i]
            ?.__source_id ||
          null;

        error.bulkError =
          getErrorMessage(
            bulkError
          );

        throw error;
      }

      await sleep(150);
    }

    return {
      written,

      end:
        offset +
        payload.length,

      fields,

      strategy:
        'record-fallback',
    };
  }
}

/* ==========================================================
   RESTORE PHASE
========================================================== */

async function processRestorePhase({
  base44,
  session,
  tables,
  state,
}) {
  const entities =
    base44.asServiceRole
      .entities;

  const expected =
    safeJsonParse(
      session.expected_json,
      {}
    );

  const restored =
    safeJsonParse(
      session.restored_json,
      {}
    );

  const idMaps =
    await loadIdMaps(
      base44,
      session
    );

  /*
   * Cari entity pertama yang
   * belum selesai.
   */
  let entityIndex =
    state.plan.findIndex(
      name =>
        !state.completed.includes(
          name
        )
    );

  /*
   * Semua entity selesai.
   */
  if (entityIndex < 0) {
    const nextState = {
      ...state,
      phase:
        'VERIFY',
    };

    session =
      await updateSession(
        base44,
        session,
        {
          status:
            'VERIFYING',

          current_entity:
            '__VERIFY__',

          completed_entities_json:
            JSON.stringify(
              nextState
            ),
        }
      );

    return {
      ok: true,

      session_id:
        session.id,

      session_code:
        session.session_code,

      status:
        'VERIFYING',

      phase:
        'VERIFY',

      progress_percent:
        97,

      total_processed:
        Object.values(
          restored
        ).reduce(
          (sum, n) =>
            sum +
            Number(n || 0),
          0
        ),

      total_records:
        session.total_records,

      message:
        'Semua batch selesai. Menunggu verifikasi.',

      done: false,
    };
  }

  const entityName =
    state.plan[
      entityIndex
    ];

  const rows =
    Array.isArray(
      tables[
        entityName
      ]
    )
      ? tables[
          entityName
        ]
      : [];

  idMaps[
    entityName
  ] =
    idMaps[
      entityName
    ] || {};

  restored[
    entityName
  ] =
    Number(
      restored[
        entityName
      ] || 0
    );

  /*
   * Offset berasal dari jumlah record
   * yang SUDAH checkpoint.
   *
   * Jadi request berikutnya tidak
   * mengulang batch yang sukses.
   */
  const offset =
    restored[
      entityName
    ];

  /*
   * Entity kosong / sudah selesai.
   */
  if (
    offset >=
    rows.length
  ) {
    const completed =
      state.completed.includes(
        entityName
      )
        ? state.completed
        : [
            ...state.completed,
            entityName,
          ];

    const nextState = {
      ...state,
      completed,
    };

    const nextEntity =
      state.plan[
        entityIndex + 1
      ] || '';

    session =
      await updateSession(
        base44,
        session,
        {
          current_entity:
            nextEntity,

          entity_index:
            entityIndex + 1,

          current_offset:
            0,

          current_batch:
            0,

          entity_records:
            nextEntity
              ? (
                  tables[
                    nextEntity
                  ] || []
                ).length
              : 0,

          entity_processed:
            0,

          completed_entities_json:
            JSON.stringify(
              nextState
            ),
        }
      );

    return {
      ok: true,

      session_id:
        session.id,

      session_code:
        session.session_code,

      status:
        'RUNNING',

      phase:
        'RESTORE',

      operation:
        'ENTITY_COMPLETE',

      completed_entity:
        entityName,

      current_entity:
        nextEntity,

      progress_percent:
        calculateProgress(
          session,
          restored,
          'RESTORE'
        ).percent,

      total_processed:
        calculateProgress(
          session,
          restored,
          'RESTORE'
        ).processed,

      total_records:
        session.total_records,

      done: false,
    };
  }

  const batchSize =
    clampBatchSize(
      session.batch_size
    );

  const end =
    Math.min(
      offset +
        batchSize,
      rows.length
    );

  const totalBatches =
    Math.ceil(
      rows.length /
      batchSize
    );

  const currentBatch =
    Math.floor(
      offset /
      batchSize
    ) + 1;

  /*
   * Informasi ini di-checkpoint
   * sebelum write agar UI tahu
   * apa yang sedang dikerjakan.
   */
  const firstPayload =
    buildPayload(
      entityName,
      rows[offset],
      idMaps
    );

  const currentFields =
    getFieldNames(
      firstPayload
    );

  session =
    await updateSession(
      base44,
      session,
      {
        status:
          'RUNNING',

        current_entity:
          entityName,

        entity_index:
          entityIndex,

        current_offset:
          offset,

        batch_size:
          batchSize,

        current_batch:
          currentBatch,

        total_batches:
          totalBatches,

        entity_records:
          rows.length,

        entity_processed:
          offset,

        error_entity:
          '',

        error_offset:
          0,

        error_message:
          '',
      }
    );

  let result;

  if (
    isReferencedByOthers(
      entityName
    )
  ) {
    result =
      await restoreReferencedBatch({
        entities,
        entityName,
        rows,
        offset,
        batchSize,
        idMaps,
      });
  } else {
    result =
      await restoreLeafBatch({
        entities,
        entityName,
        rows,
        offset,
        batchSize,
        idMaps,
      });
  }

  /*
   * CRITICAL CHECKPOINT:
   *
   * Hanya setelah seluruh batch sukses,
   * restored count + idMaps disimpan.
   */
  restored[
    entityName
  ] =
    offset +
    result.written;

  const entityFinished =
    restored[
      entityName
    ] >=
    rows.length;

  let completed =
    state.completed;

  if (
    entityFinished &&
    !completed.includes(
      entityName
    )
  ) {
    completed = [
      ...completed,
      entityName,
    ];
  }

  const nextState = {
    ...state,
    completed,
    phase:
      'RESTORE',
  };

  const progress =
    calculateProgress(
      session,
      restored,
      'RESTORE'
    );

  const idMapsCheckpoint =
    await saveIdMaps(
      base44,
      {
        ...session,
        total_processed:
          progress.processed,
        current_offset:
          restored[
            entityName
          ],
      },
      idMaps
    );

  session =
    await updateSession(
      base44,
      session,
      {
        current_offset:
          restored[
            entityName
          ],

        entity_processed:
          restored[
            entityName
          ],

        total_processed:
          progress.processed,

        restored_json:
          JSON.stringify(
            restored
          ),

        id_maps_json:
          idMapsCheckpoint,

        completed_entities_json:
          JSON.stringify(
            nextState
          ),
      }
    );

  return {
    ok: true,

    session_id:
      session.id,

    session_code:
      session.session_code,

    status:
      'RUNNING',

    phase:
      'RESTORE',

    operation:
      'WRITE',

    current_entity:
      entityName,

    /*
     * UI dapat menampilkan:
     * "Writing Sale fields:
     * customer_id, warehouse_id..."
     */
    current_fields:
      result.fields ||
      currentFields,

    strategy:
      result.strategy ||
      'create',

    batch:
      currentBatch,

    total_batches:
      totalBatches,

    batch_size:
      batchSize,

    batch_from:
      offset + 1,

    batch_to:
      result.end,

    batch_written:
      result.written,

    entity_processed:
      restored[
        entityName
      ],

    entity_records:
      rows.length,

    total_processed:
      progress.processed,

    total_records:
      session.total_records,

    progress_percent:
      progress.percent,

    entity_complete:
      entityFinished,

    done: false,
  };
}

/* ==========================================================
   VERIFY PHASE
========================================================== */

async function processVerifyPhase({
  base44,
  session,
  state,
}) {
  const expected =
    safeJsonParse(
      session.expected_json,
      {}
    );

  const restored =
    safeJsonParse(
      session.restored_json,
      {}
    );

  const mismatches =
    Object.keys(
      expected
    )
      .filter(
        name =>
          Number(
            expected[
              name
            ] || 0
          ) !==
          Number(
            restored[
              name
            ] || 0
          )
      )
      .map(
        name => ({
          entity:
            name,

          expected:
            Number(
              expected[
                name
              ] || 0
            ),

          restored:
            Number(
              restored[
                name
              ] || 0
            ),

          missing:
            Number(
              expected[
                name
              ] || 0
            ) -
            Number(
              restored[
                name
              ] || 0
            ),
        })
      );

  if (
    mismatches.length > 0
  ) {
    session =
      await updateSession(
        base44,
        session,
        {
          status:
            'FAILED',

          current_entity:
            '__VERIFY__',

          error_entity:
            mismatches[0]
              .entity,

          error_message:
            `Verifikasi gagal: ` +
            JSON.stringify(
              mismatches
            ),
        }
      );

    return {
      ok: false,

      session_id:
        session.id,

      session_code:
        session.session_code,

      status:
        'FAILED',

      phase:
        'VERIFY',

      error:
        'Restore selesai diproses tetapi hasil verifikasi tidak cocok.',

      mismatches,

      progress_percent:
        99,

      done: true,
    };
  }

  const completedAt =
    new Date()
      .toISOString();

  const nextState = {
    ...state,
    phase:
      'COMPLETED',
  };

  const totalProcessed =
    Object.values(
      restored
    ).reduce(
      (sum, n) =>
        sum +
        Number(n || 0),
      0
    );

  session =
    await updateSession(
      base44,
      session,
      {
        status:
          'COMPLETED',

        current_entity:
          '__COMPLETED__',

        total_processed:
          totalProcessed,

        completed_at:
          completedAt,

        completed_entities_json:
          JSON.stringify(
            nextState
          ),

        error_entity:
          '',

        error_offset:
          0,

        error_message:
          '',
      }
    );

  /*
   * Audit completion.
   */
  try {
    await base44
      .asServiceRole
      .entities
      .AuditLog
      .create({
        action_time:
          completedAt,

        user_name:
          session.created_by ||
          'admin',

        module:
          'database',

        action:
          'DATABASE_RESTORE_BATCH_COMPLETED',

        reference_number:
          session.session_code,

        reason:
          `backup=${
            session.backup_code ||
            ''
          }; ` +
          `mode=${
            session.mode
          }; ` +
          `records=${
            totalProcessed
          }; ` +
          `autoBackup=${
            session
              .auto_backup_code ||
            'none'
          }`,

        data_after:
          JSON.stringify(
            restored
          ),
      });
  } catch {}

  return {
    ok: true,

    session_id:
      session.id,

    session_code:
      session.session_code,

    status:
      'COMPLETED',

    phase:
      'COMPLETED',

    backup_code:
      session.backup_code,

    restored,

    total_processed:
      totalProcessed,

    total_records:
      session.total_records,

    progress_percent:
      100,

    verified:
      true,

    done: true,
  };
}

/* ==========================================================
   MAIN
========================================================== */

export default async function (req) {
  let base44;
  let user;
  let session;

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

    /* =====================================================
       REQUEST
    ===================================================== */

    const body =
      await req
        .json()
        .catch(() => ({}));

    const {
      session_id,
    } = body;

    if (!session_id) {
      return Response.json(
        {
          error:
            'session_id wajib',
        },
        {
          status: 400,
        }
      );
    }

    /* =====================================================
       SESSION
    ===================================================== */

    session =
      await getSession(
        base44,
        session_id
      );

    /*
     * Completed bersifat idempotent.
     */
    if (
      session.status ===
      'COMPLETED'
    ) {
      return Response.json({
        ok: true,

        session_id:
          session.id,

        session_code:
          session.session_code,

        status:
          'COMPLETED',

        phase:
          'COMPLETED',

        progress_percent:
          100,

        total_processed:
          session
            .total_processed ||
          session
            .total_records ||
          0,

        total_records:
          session
            .total_records ||
          0,

        done: true,
      });
    }

    if (
      session.status ===
      'FAILED'
    ) {
      return Response.json(
        {
          ok: false,

          session_id:
            session.id,

          session_code:
            session
              .session_code,

          status:
            'FAILED',

          error_entity:
            session
              .error_entity,

          error_offset:
            session
              .error_offset,

          error:
            session
              .error_message ||
            'Restore session sebelumnya gagal.',

          done: true,
        },
        {
          status: 409,
        }
      );
    }

    /* =====================================================
       LOAD BACKUP
    ===================================================== */

    const tables =
      await loadBackupTables(
        base44,
        session
      );

    const state =
      getPlan(
        session
      );

    /* =====================================================
       ROUTE PHASE
    ===================================================== */

    let result;

    if (
      state.phase ===
      'DELETE'
    ) {
      result =
        await processDeletePhase({
          base44,
          session,
          tables,
          state,
        });

    } else if (
      state.phase ===
      'VERIFY'
    ) {
      result =
        await processVerifyPhase({
          base44,
          session,
          state,
        });

    } else if (
      state.phase ===
      'COMPLETED'
    ) {
      result = {
        ok: true,

        session_id:
          session.id,

        session_code:
          session.session_code,

        status:
          'COMPLETED',

        phase:
          'COMPLETED',

        progress_percent:
          100,

        done: true,
      };

    } else {
      result =
        await processRestorePhase({
          base44,
          session,
          tables,
          state,
        });
    }

    return Response.json(
      result
    );

  } catch (error) {
    const message =
      getErrorMessage(
        error
      );

    console.error(
      '[DATABASE RESTORE BATCH ERROR]',
      error
    );

    /*
     * Simpan titik kegagalan.
     */
    if (
      base44 &&
      session?.id
    ) {
      try {
        await base44
          .asServiceRole
          .entities
          .DatabaseRestoreSession
          .update(
            session.id,
            {
              status:
                'FAILED',

              error_entity:
                error?.entity ||
                session
                  .current_entity ||
                '',

              error_offset:
                Number.isFinite(
                  error?.offset
                )
                  ? error.offset
                  : Number(
                      session
                        .current_offset ||
                      0
                    ),

              error_message:
                message,

              last_checkpoint_at:
                new Date()
                  .toISOString(),
            }
          );
      } catch (
        sessionError
      ) {
        console.error(
          '[RESTORE SESSION ERROR WRITE FAILED]',
          sessionError
        );
      }
    }

    /*
     * Audit failure.
     */
    if (
      base44 &&
      user
    ) {
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
              'DATABASE_RESTORE_BATCH_FAILED',

            reference_number:
              session
                ?.session_code ||
              '',

            reason:
              message,

            data_after:
              JSON.stringify({
                entity:
                  error?.entity ||
                  session
                    ?.current_entity ||
                  '',

                offset:
                  Number.isFinite(
                    error?.offset
                  )
                    ? error.offset
                    : session
                        ?.current_offset ||
                      0,

                fields:
                  error?.fields ||
                  [],

                source_id:
                  error
                    ?.sourceId ||
                  null,

                bulk_error:
                  error
                    ?.bulkError ||
                  null,
              }),
          });
      } catch {}
    }

    return Response.json(
      {
        ok: false,

        session_id:
          session?.id ||
          null,

        session_code:
          session
            ?.session_code ||
          null,

        status:
          'FAILED',

        error:
          message,

        error_entity:
          error?.entity ||
          session
            ?.current_entity ||
          '',

        error_offset:
          Number.isFinite(
            error?.offset
          )
            ? error.offset
            : session
                ?.current_offset ||
              0,

        error_fields:
          error?.fields ||
          [],

        source_id:
          error?.sourceId ||
          null,

        done: true,
      },
      {
        status: 500,
      }
    );
  }
}
