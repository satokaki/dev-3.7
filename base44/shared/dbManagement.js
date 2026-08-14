// Shared constants & helpers for Database Management (backup / reset / restore / download).
// Pure logic + web-standard APIs only (no SDK import). Backend functions pass `base44`
// (service-role) into the helpers. Imported from Deno backend functions.

export const APP_ENVIRONMENT = 'development'; // 'development' | 'staging' | 'production'
export const APP_VERSION = '1.0.0';
export const SCHEMA_VERSION = '2026.08';
export const APPLICATION_NAME = 'LAB PRO';
export const MAX_RESTORE_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

// Entities NEVER touched by reset/restore (users/auth/permissions managed by platform).
export const PRESERVED_ENTITIES = [
  'User',
  'UserInvitation',
  'DocumentSequence',
  'AuditLog',
  'DatabaseBackup',
];

// Transactional entities — deleted in BOTH reset modes. Order: child first (FK safety).
export const TRANSACTION_ENTITIES = [
  'PaymentAllocation',
  'CustomerPayment',
  'SaleItem',
  'Sale',
  'SupplierPayable',
  'PurchaseItem',
  'Purchase',
  'LabelingMaterial',
  'LabelingOrder',
  'BottlingOutput',
  'BottlingOrder',
  'PremixBatchComponent',
  'PremixBatch',
  'ProductionMaterial',
  'ProductionOrder',
  'ExciseOrder',
  'OperationalCost',
  'StockAdjustment',
  'StockLedger',
  'StockBalance',
];

// Master + recipe entities — deleted only in FULL mode. Order: child first.
export const FULL_ONLY_ENTITIES = [
  'RecipeIngredient',
  'Recipe',
  'ProductComponentMapping',
  'Material',
  'Product',
  'Brand',
  'Category',
  'Supplier',
  'Customer',
  'Warehouse',
];

// DATA ONLY backup:
// master + recipe + product component mapping/configuration only.
// No transaction, stock, operational batch, audit, user/auth.
export const DATA_ONLY_BACKUP_ENTITIES = [
  'Brand',
  'Category',
  'Supplier',
  'Customer',
  'Warehouse',
  'Material',
  'Product',
  'ProductComponentMapping',
  'Recipe',
  'RecipeIngredient',
];

// Operational backup entities (master + recipes + transactions + stock + HPP + batch).
// No User / auth / secrets.
export const BACKUP_ENTITIES = [
  'Brand',
  'Category',
  'Supplier',
  'Customer',
  'Warehouse',
  'Material',
  'Product',
  'ProductComponentMapping',
  'Recipe',
  'RecipeIngredient',
  'ProductionOrder',
  'ProductionMaterial',
  'PremixBatch',
  'PremixBatchComponent',
  'BottlingOrder',
  'BottlingOutput',
  'LabelingOrder',
  'LabelingMaterial',
  'ExciseOrder',
  'Purchase',
  'PurchaseItem',
  'SupplierPayable',
  'Sale',
  'SaleItem',
  'CustomerPayment',
  'PaymentAllocation',
  'OperationalCost',
  'StockLedger',
  'StockBalance',
  'StockAdjustment',
];

// FULL backup = operational + User (export-only; User is NOT restored — platform-managed).
export const FULL_BACKUP_ENTITIES = [
  ...BACKUP_ENTITIES,
  'User',
];

// Restore order: parent first (so FK idMaps exist before children reference them).
// User intentionally excluded — cannot be recreated via SDK (platform-managed).
export const RESTORE_ORDER = [
  'Brand',
  'Category',
  'Supplier',
  'Customer',
  'Warehouse',
  'Material',
  'Product',
  'ProductComponentMapping',
  'Recipe',
  'RecipeIngredient',
  'ProductionOrder',
  'ProductionMaterial',
  'PremixBatch',
  'PremixBatchComponent',
  'BottlingOrder',
  'BottlingOutput',
  'LabelingOrder',
  'LabelingMaterial',
  'ExciseOrder',
  'Purchase',
  'PurchaseItem',
  'SupplierPayable',
  'Sale',
  'SaleItem',
  'CustomerPayment',
  'PaymentAllocation',
  'OperationalCost',
  'StockLedger',
  'StockBalance',
  'StockAdjustment',
];

// FK remap config: entity -> [{ field, ref }]. ref may be a string or an array
// (try each entity's idMap in order; first hit wins). item_id may be Material or Product.
export const RESTORE_REFS = {
  Product: [
    { field: 'brand_id', ref: 'Brand' },
    { field: 'category_id', ref: 'Category' },
  ],

  ProductComponentMapping: [
    { field: 'product_id', ref: 'Product' },
    { field: 'material_id', ref: 'Material' },
  ],

  Recipe: [
    { field: 'brand_id', ref: 'Brand' },
    { field: 'product_id', ref: 'Product' },
    { field: 'output_material_id', ref: 'Material' },
  ],

  RecipeIngredient: [
    { field: 'recipe_id', ref: 'Recipe' },
    { field: 'material_id', ref: 'Material' },
  ],

  ProductionOrder: [
    { field: 'recipe_id', ref: 'Recipe' },
    { field: 'product_id', ref: 'Product' },
    { field: 'brand_id', ref: 'Brand' },
    { field: 'output_material_id', ref: 'Material' },
    { field: 'output_batch_id', ref: 'PremixBatch' },
  ],

  ProductionMaterial: [
    { field: 'production_id', ref: 'ProductionOrder' },
    { field: 'material_id', ref: 'Material' },
  ],

  PremixBatch: [
    { field: 'material_id', ref: 'Material' },
    { field: 'recipe_id', ref: 'Recipe' },
    { field: 'production_id', ref: 'ProductionOrder' },
  ],

  PremixBatchComponent: [
    { field: 'premix_batch_id', ref: 'PremixBatch' },
    { field: 'component_material_id', ref: 'Material' },
  ],

  BottlingOrder: [
    { field: 'product_id', ref: 'Product' },
    { field: 'brand_id', ref: 'Brand' },
    { field: 'bottle_item_id', ref: 'Material' },
  ],

  BottlingOutput: [
    { field: 'bottling_id', ref: 'BottlingOrder' },
    { field: 'product_id', ref: 'Product' },
    { field: 'bottle_item_id', ref: 'Material' },
  ],

  LabelingOrder: [
    { field: 'product_id', ref: 'Product' },
    { field: 'brand_id', ref: 'Brand' },
    { field: 'label_item_id', ref: 'Material' },
  ],

  LabelingMaterial: [
    { field: 'labeling_id', ref: 'LabelingOrder' },
    { field: 'label_item_id', ref: 'Material' },
  ],

  ExciseOrder: [
    { field: 'product_id', ref: 'Product' },
    { field: 'brand_id', ref: 'Brand' },
  ],

  Purchase: [
    { field: 'supplier_id', ref: 'Supplier' },
    { field: 'warehouse_id', ref: 'Warehouse' },
  ],

  PurchaseItem: [
    { field: 'purchase_id', ref: 'Purchase' },
    { field: 'item_id', ref: ['Material', 'Product'] },
    { field: 'warehouse_id', ref: 'Warehouse' },
  ],

  SupplierPayable: [
    { field: 'purchase_id', ref: 'Purchase' },
    { field: 'supplier_id', ref: 'Supplier' },
  ],

  Sale: [
    { field: 'customer_id', ref: 'Customer' },
    { field: 'warehouse_id', ref: 'Warehouse' },
  ],

  SaleItem: [
    { field: 'sale_id', ref: 'Sale' },
    { field: 'product_id', ref: 'Product' },
  ],

  CustomerPayment: [
    { field: 'customer_id', ref: 'Customer' },
  ],

  PaymentAllocation: [
    { field: 'sale_id', ref: 'Sale' },
    { field: 'payment_id', ref: 'CustomerPayment' },
  ],

  StockLedger: [
    { field: 'item_id', ref: ['Material', 'Product'] },
    { field: 'warehouse_id', ref: 'Warehouse' },
  ],

  StockBalance: [
    { field: 'item_id', ref: ['Material', 'Product'] },
    { field: 'warehouse_id', ref: 'Warehouse' },
  ],

  StockAdjustment: [
    { field: 'item_id', ref: ['Material', 'Product'] },
    { field: 'warehouse_id', ref: 'Warehouse' },
  ],
};

// DocumentSequence prefixes eligible for reset in development. USER sequence kept.
export const RESET_SEQUENCE_PREFIXES = [
  'MRK',
  'KAT',
  'SPL',
  'GUD',
  'BHN',
  'PMX',
  'PMXB',
  'RCP',
  'BRG',
  'CUS',
  'PRD',
  'BATCH',
  'BTL',
  'LBL',
  'CUK',
  'PO',
  'AP',
  'INV',
  'PAY',
  'ADJ',
];

const BUILTIN_FIELDS = [
  'id',
  'created_date',
  'updated_date',
  'created_by_id',
  'created_by',
];

const SENSITIVE_FIELD_PATTERNS = [
  'password',
  'secret',
  'token',
  'api_key',
  'apikey',
  'session',
  'refresh_token',
  'access_token',
];

export function stripBuiltins(rec) {
  const out = {};

  for (const [k, v] of Object.entries(rec)) {
    if (BUILTIN_FIELDS.includes(k)) continue;
    out[k] = v;
  }

  return out;
}

// Strip fields that look like credentials / secrets / tokens — never written to a backup file.
export function sanitizeRecord(rec) {
  const out = {};

  for (const [k, v] of Object.entries(rec)) {
    const lower = String(k).toLowerCase();

    if (
      SENSITIVE_FIELD_PATTERNS.some(
        p => lower.includes(p)
      )
    ) {
      continue;
    }

    out[k] = v;
  }

  return out;
}

export async function sha256hex(str) {
  const buf = new TextEncoder().encode(str);

  const h = await crypto.subtle.digest(
    'SHA-256',
    buf
  );

  return [...new Uint8Array(h)]
    .map(
      b =>
        b
          .toString(16)
          .padStart(2, '0')
    )
    .join('');
}

export function nowYMD() {
  const d = new Date();

  const p = n =>
    String(n).padStart(2, '0');

  return (
    `${d.getFullYear()}` +
    `${p(d.getMonth() + 1)}` +
    `${p(d.getDate())}`
  );
}

// Portable backup file name: LABPRO_BACKUP_YYYY-MM-DD_HHMMSS.json
export function backupFileName() {
  const d = new Date();

  const p = n =>
    String(n).padStart(2, '0');

  const ymd =
    `${d.getFullYear()}-` +
    `${p(d.getMonth() + 1)}-` +
    `${p(d.getDate())}`;

  const ts =
    `${p(d.getHours())}` +
    `${p(d.getMinutes())}` +
    `${p(d.getSeconds())}`;

  return (
    `LABPRO_BACKUP_` +
    `${ymd}_${ts}.json`
  );
}

// Generate BKP-YYYYMMDD-NNNNN via DocumentSequence (optimistic lock, like generateDocumentCode).
export async function generateBackupCode(base44) {
  const ds =
    base44.asServiceRole.entities.DocumentSequence;

  const key = `BACKUP-${nowYMD()}`;

  for (let attempt = 0; attempt < 8; attempt++) {
    const existing =
      await ds.filter({
        sequence_key: key,
      });

    if (existing.length > 0) {
      const seq = existing[0];

      const current =
        seq.last_number || 0;

      const next =
        current + 1;

      const res =
        await ds.updateMany(
          {
            sequence_key: key,
            last_number: current,
          },
          {
            $set: {
              last_number: next,
            },
          }
        );

      if (
        res &&
        (res.updated ||
          res.modifiedCount) > 0
      ) {
        return (
          `BKP-${nowYMD()}-` +
          String(next).padStart(5, '0')
        );
      }
    } else {
      try {
        await ds.create({
          sequence_key: key,
          prefix: 'BKP',
          year: new Date().getFullYear(),
          last_number: 1,
        });

        return `BKP-${nowYMD()}-00001`;
      } catch {
        // concurrent create; retry update path
      }
    }
  }

  return (
    `BKP-${nowYMD()}-` +
    `${Date.now()}`
  );
}

/* ==========================================================
   ENCRYPTION
========================================================== */

function bufToB64(buf) {
  const bytes =
    new Uint8Array(buf);

  let bin = '';

  const CHUNK = 0x8000;

  for (
    let i = 0;
    i < bytes.length;
    i += CHUNK
  ) {
    bin +=
      String.fromCharCode.apply(
        null,
        bytes.subarray(
          i,
          i + CHUNK
        )
      );
  }

  return btoa(bin);
}

function b64ToBuf(b64) {
  const bin = atob(b64);

  const bytes =
    new Uint8Array(bin.length);

  for (
    let i = 0;
    i < bin.length;
    i++
  ) {
    bytes[i] =
      bin.charCodeAt(i);
  }

  return bytes;
}

async function deriveAesKey(
  password,
  saltBytes
) {
  const enc =
    new TextEncoder();

  const keyMaterial =
    await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptPayload(
  plaintext,
  password
) {
  const salt =
    crypto.getRandomValues(
      new Uint8Array(16)
    );

  const iv =
    crypto.getRandomValues(
      new Uint8Array(12)
    );

  const key =
    await deriveAesKey(
      password,
      salt
    );

  const ct =
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      new TextEncoder().encode(
        plaintext
      )
    );

  return {
    encrypted: true,

    kdf: {
      algorithm: 'PBKDF2',
      salt: bufToB64(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },

    iv: bufToB64(iv),
    ciphertext: bufToB64(ct),
  };
}

export async function decryptPayload(
  wrapper,
  password
) {
  const salt =
    b64ToBuf(
      wrapper.kdf.salt
    );

  const iv =
    b64ToBuf(
      wrapper.iv
    );

  const key =
    await deriveAesKey(
      password,
      salt
    );

  const pt =
    await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      b64ToBuf(
        wrapper.ciphertext
      )
    );

  return new TextDecoder().decode(pt);
}

/* ==========================================================
   BACKUP SNAPSHOT
========================================================== */

// Collect snapshot of given entities (service role, up to 10000 rows each), sanitized.
export async function collectSnapshot(
  base44,
  entities = BACKUP_ENTITIES
) {
  const tables = {};
  let recordCount = 0;

  for (const name of entities) {
    try {
      const rows =
        await base44
          .asServiceRole
          .entities[name]
          .list(
            '-created_date',
            10000
          );

      tables[name] =
        (rows || []).map(
          row => {
            const clean =
              sanitizeRecord(
                stripBuiltins(row)
              );

            /*
             * IMPORTANT:
             * Simpan ID asli untuk remapping
             * FK saat restore.
             *
             * Field ini hanya hidup di file
             * backup dan akan dibuang lagi
             * sebelum create().
             */
            if (row.id) {
              clean.__source_id =
                row.id;
            }

            return clean;
          }
        );

      recordCount +=
        tables[name].length;

    } catch (error) {
      /*
       * Backup tidak boleh diam-diam
       * menganggap tabel gagal sebagai [].
       */
      throw new Error(
        `Backup gagal membaca entity ${name}: ${error.message}`
      );
    }
  }

  return {
    tables,
    recordCount,
    tableCount: entities.length,
  };
}

/* ==========================================================
   CREATE BACKUP
========================================================== */

export async function createBackup(
  base44,
  {
    name,
    notes,
    createdBy,
    environment,
    backupType = 'operational',
    encrypt = false,
    password,
  }
) {
  const entities =
    backupType === 'data_only'
      ? DATA_ONLY_BACKUP_ENTITIES
      : backupType === 'full'
        ? FULL_BACKUP_ENTITIES
        : BACKUP_ENTITIES;

  const {
    tables,
    recordCount,
    tableCount,
  } =
    await collectSnapshot(
      base44,
      entities
    );

  const backupCode =
    await generateBackupCode(
      base44
    );

  const createdAt =
    new Date().toISOString();

  const env =
    environment ||
    APP_ENVIRONMENT;

  const fileName =
    backupFileName();

  const tablesJson =
    JSON.stringify(tables);

  const checksum =
    await sha256hex(
      tablesJson
    );

  const manifest = {
    application: APPLICATION_NAME,
    backupId: backupCode,
    backupName:
      name || backupCode,
    createdAt,
    createdBy:
      createdBy || 'system',
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    environment: env,
    backupType,
    encrypted: !!encrypt,
    recordCount,
    tableCount,
    checksumAlgorithm: 'SHA-256',
    checksum,
  };

  const plaintext =
    JSON.stringify({
      metadata: manifest,
      tables,
    });

  let fileContent =
    plaintext;

  if (encrypt) {
    if (!password) {
      throw new Error(
        'Password enkripsi wajib'
      );
    }

    fileContent =
      JSON.stringify(
        await encryptPayload(
          plaintext,
          password
        )
      );
  }

  const fileSize =
    new Blob(
      [fileContent]
    ).size;

  const db =
    base44.asServiceRole
      .entities
      .DatabaseBackup;

  const rec =
    await db.create({
      backup_code: backupCode,
      backup_name:
        name || backupCode,
      storage_path: '',
      file_name: fileName,
      file_size: fileSize,
      checksum,
      schema_version:
        SCHEMA_VERSION,
      app_version:
        APP_VERSION,
      environment: env,
      record_count:
        recordCount,
      table_count:
        tableCount,
      backup_type:
        backupType,
      encrypted:
        !!encrypt,
      status: 'CREATING',
      created_by:
        createdBy || 'system',
      created_at:
        createdAt,
      notes: notes || '',
    });

  try {
    const file =
      new File(
        [
          new Blob(
            [fileContent]
          ),
        ],
        fileName,
        {
          type:
            'application/json',
        }
      );

    const up =
      await base44
        .asServiceRole
        .integrations
        .Core
        .UploadPrivateFile({
          file,
        });

    const fileUri =
      up.file_uri;

    await db.update(
      rec.id,
      {
        storage_path:
          fileUri,
        status:
          'COMPLETED',
        completed_at:
          new Date()
            .toISOString(),
      }
    );

    rec.storage_path =
      fileUri;

    rec.status =
      'COMPLETED';

    rec.completed_at =
      new Date()
        .toISOString();

    return {
      record: rec,
      checksum,
      recordCount,
      tableCount,
      fileSize,
      fileName,
    };

  } catch (e) {
    try {
      await db.update(
        rec.id,
        {
          status:
            'FAILED',
          notes:
            (notes || '') +
            ' | ERROR: ' +
            e.message,
        }
      );
    } catch {}

    throw e;
  }
}

/* ==========================================================
   VALIDATE BACKUP
========================================================== */

export async function parseAndValidateBackup(
  text,
  {
    password,
    recordChecksum,
  } = {}
) {
  let parsed;

  try {
    parsed =
      JSON.parse(text);
  } catch {
    return {
      ok: false,
      error:
        'File backup tidak valid atau bukan berasal dari LAB PRO.',
    };
  }

  let metadata;
  let tables;
  let encrypted = false;

  if (
    parsed &&
    parsed.encrypted === true
  ) {
    encrypted = true;

    if (!password) {
      return {
        ok: false,
        error:
          'File backup terenkripsi. Masukkan password.',
        needsPassword: true,
      };
    }

    try {
      const pt =
        await decryptPayload(
          parsed,
          password
        );

      const inner =
        JSON.parse(pt);

      metadata =
        inner.metadata;

      tables =
        inner.tables;

    } catch {
      return {
        ok: false,
        error:
          'Password salah atau file terenkripsi rusak.',
        needsPassword: true,
      };
    }

  } else {
    metadata =
      parsed &&
      parsed.metadata;

    tables =
      parsed &&
      parsed.tables;
  }

  if (
    !metadata ||
    !metadata.application
  ) {
    return {
      ok: false,
      error:
        'Manifest tidak tersedia. Bukan file backup LAB PRO.',
    };
  }

  if (
    metadata.application !==
    APPLICATION_NAME
  ) {
    return {
      ok: false,
      error:
        'File backup bukan berasal dari LAB PRO.',
    };
  }

  if (
    !tables ||
    typeof tables !==
      'object'
  ) {
    return {
      ok: false,
      error:
        'Struktur entity tidak lengkap.',
    };
  }

  const recomputed =
    await sha256hex(
      JSON.stringify(tables)
    );

  let checksumOk = false;

  if (metadata.checksum) {
    checksumOk =
      recomputed ===
      metadata.checksum;

  } else if (
    recordChecksum
  ) {
    checksumOk =
      (
        await sha256hex(
          text
        )
      ) ===
      recordChecksum;
  }

  if (!checksumOk) {
    return {
      ok: false,
      error:
        'Checksum tidak cocok. File backup mungkin rusak atau telah diubah.',
    };
  }

  const schemaOk =
    metadata.schemaVersion ===
    SCHEMA_VERSION;

  return {
    ok: true,
    metadata,
    tables,
    schemaOk,
    encrypted,
  };
}

/* ==========================================================
   SAFE RESTORE
========================================================== */

// Execute a restore from a validated tables snapshot.
// SAFE RESTORE:
// - source ID remap
// - throttling
// - rate-limit retry/backoff
// - verification
export async function performRestore(
  base44,
  tables,
  {
    mode = 'operational',
    autoBackup = true,
    createdBy,
    batchSize = 10,
    maxRetries = 5,
  } = {}
) {
  const entities =
    base44.asServiceRole
      .entities;

  const size =
    Math.max(
      1,
      Math.min(
        Number(batchSize) || 10,
        50
      )
    );

  const retries =
    Math.max(
      1,
      Math.min(
        Number(maxRetries) || 5,
        6
      )
    );

  let autoBackupCode =
    null;

  const idMaps = {};
  const restored = {};
  const expected = {};
  const errors = [];

  /* ========================================================
     STEP 1 — AUTO BACKUP
  ======================================================== */

  if (autoBackup) {
    const ab =
      await createBackup(
        base44,
        {
          name:
            'Auto-backup sebelum restore',

          notes:
            'Auto backup otomatis sebelum restore',

          createdBy,

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

  /* ========================================================
     STEP 2 — DELETE OLD DATA
  ======================================================== */

  const delEntities = [
    ...TRANSACTION_ENTITIES,
    ...FULL_ONLY_ENTITIES,
  ];

  for (
    const name
    of delEntities
  ) {
    /*
     * Jangan hapus tabel yang memang
     * tidak ada di backup.
     */
    if (
      !Object.prototype
        .hasOwnProperty
        .call(
          tables || {},
          name
        )
    ) {
      continue;
    }

    await retryRestoreOperation(
      () =>
        entities[
          name
        ].deleteMany({}),

      retries,

      `Delete ${name}`
    );

    /*
     * Throttle delete operation.
     */
    await restoreSleep(
      500
    );
  }

  /* ========================================================
     STEP 3 — RESTORE PARENT → CHILD
  ======================================================== */

  for (
    const name
    of RESTORE_ORDER
  ) {
    idMaps[name] =
      idMaps[name] || {};

    const rows =
      Array.isArray(
        tables?.[name]
      )
        ? tables[name]
        : [];

    expected[name] =
      rows.length;

    restored[name] =
      0;

    if (
      !rows.length
    ) {
      continue;
    }

    const captureIds =
      isReferencedByOthers(
        name
      );

    /* ======================================================
       CHUNK LOOP
    ====================================================== */

    for (
      let offset = 0;
      offset < rows.length;
      offset += size
    ) {
      const chunk =
        rows.slice(
          offset,
          offset + size
        );

      /* ====================================================
         REFERENCED ENTITY
      ==================================================== */

      if (captureIds) {
        /*
         * Dibuat satu-per-satu supaya
         * mendapatkan new id untuk FK mapping.
         */
        for (
          let i = 0;
          i < chunk.length;
          i++
        ) {
          const row =
            chunk[i];

          const sourceId =
            row?.__source_id ||
            row?.id ||
            null;

          const cleaned =
            stripBuiltins(
              row
            );

          /*
           * __source_id hanya metadata backup.
           * Tidak boleh dimasukkan ke entity.
           */
          delete cleaned.__source_id;

          const payload =
            remapRecord(
              name,
              cleaned,
              idMaps
            );

          try {
            const created =
              await retryRestoreOperation(
                () =>
                  entities[
                    name
                  ].create(
                    payload
                  ),

                retries,

                `${name} record ${
                  offset +
                  i +
                  1
                }`
              );

            if (
              !created?.id
            ) {
              throw new Error(
                'create() tidak mengembalikan id'
              );
            }

            if (sourceId) {
              idMaps[
                name
              ][sourceId] =
                created.id;
            }

            restored[
              name
            ] += 1;

          } catch (error) {
            errors.push({
              entity:
                name,

              index:
                offset + i,

              source_id:
                sourceId,

              message:
                error.message,
            });
          }

          /*
           * Rate-limit throttle
           * untuk create per-record.
           */
          await restoreSleep(
            250
          );
        }

      } else {
        /* ==================================================
           LEAF ENTITY
        ================================================== */

        const payload =
          chunk.map(
            row => {
              const cleaned =
                stripBuiltins(
                  row
                );

              delete cleaned.__source_id;

              return remapRecord(
                name,
                cleaned,
                idMaps
              );
            }
          );

        let bulkOk =
          false;

        /*
         * Coba bulkCreate chunk kecil.
         */
        try {
          await retryRestoreOperation(
            () =>
              entities[
                name
              ].bulkCreate(
                payload
              ),

            retries,

            `${name} bulk ${
              offset + 1
            }-${
              offset +
              payload.length
            }`
          );

          restored[
            name
          ] +=
            payload.length;

          bulkOk =
            true;

        } catch {
          bulkOk =
            false;
        }

        /*
         * Kalau bulk gagal,
         * fallback satu per satu.
         */
        if (!bulkOk) {
          for (
            let i = 0;
            i < payload.length;
            i++
          ) {
            try {
              await retryRestoreOperation(
                () =>
                  entities[
                    name
                  ].create(
                    payload[i]
                  ),

                retries,

                `${name} record ${
                  offset +
                  i +
                  1
                }`
              );

              restored[
                name
              ] += 1;

            } catch (error) {
              errors.push({
                entity:
                  name,

                index:
                  offset + i,

                source_id:
                  chunk[i]
                    ?.__source_id ||
                  null,

                message:
                  error.message,
              });
            }

            await restoreSleep(
              250
            );
          }
        }
      }

      /*
       * Delay antar chunk.
       */
      await restoreSleep(
        750
      );
    }
  }

  /* ========================================================
     STEP 4 — VERIFY
  ======================================================== */

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
            expected[
              name
            ] || 0,

          restored:
            restored[
              name
            ] || 0,

          missing:
            (
              expected[
                name
              ] || 0
            ) -
            (
              restored[
                name
              ] || 0
            ),
        })
      );

  /* ========================================================
     STEP 5 — PARTIAL RESTORE = FAILURE
  ======================================================== */

  if (
    errors.length ||
    mismatches.length
  ) {
    const error =
      new Error(
        `Restore tidak lengkap. ` +
        `${errors.length} record gagal, ` +
        `${mismatches.length} entity tidak cocok.`
      );

    error.code =
      'RESTORE_INCOMPLETE';

    error.restoreResult = {
      autoBackupCode,

      mode,

      batchSize:
        size,

      expected,

      restored,

      mismatches,

      errors:
        errors.slice(
          0,
          100
        ),

      totalErrors:
        errors.length,
    };

    throw error;
  }

  /* ========================================================
     SUCCESS
  ======================================================== */

  return {
    autoBackupCode,

    mode,

    batchSize:
      size,

    expected,

    restored,

    verified:
      true,
  };
}

/* ==========================================================
   RATE LIMIT DETECTION
========================================================== */

function isRateLimitError(
  error
) {
  const msg =
    String(
      error?.message ||
      error
        ?.response
        ?.data
        ?.error ||
      error
        ?.response
        ?.data
        ?.message ||
      ''
    )
      .toLowerCase();

  return (
    msg.includes(
      'rate limit'
    ) ||
    msg.includes(
      'too many requests'
    ) ||
    msg.includes(
      '429'
    )
  );
}

/* ==========================================================
   RETRY ENGINE
========================================================== */

async function retryRestoreOperation(
  fn,
  maxRetries = 5,
  label = 'operation'
) {
  let lastError;

  for (
    let attempt = 1;
    attempt <= maxRetries;
    attempt++
  ) {
    try {
      return (
        await fn()
      );

    } catch (error) {
      lastError =
        error;

      if (
        attempt >=
        maxRetries
      ) {
        break;
      }

      /*
       * Rate limit:
       * 2s → 4s → 8s → 16s
       *
       * Error normal:
       * 0.5s → 1s → 2s → 4s
       */
      const waitMs =
        isRateLimitError(
          error
        )
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

      await restoreSleep(
        waitMs
      );
    }
  }

  throw new Error(
    `${label} gagal setelah ${maxRetries} percobaan: ${
      lastError?.message ||
      'unknown error'
    }`
  );
}

function restoreSleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}

/* ==========================================================
   FK REMAP
========================================================== */

// Remap FK string fields of a record using idMaps ({ entity: { oldId: newId } }).
// Best-effort: unmapped references are left as-is.
export function remapRecord(
  entityName,
  rec,
  idMaps
) {
  const refs =
    RESTORE_REFS[
      entityName
    ] || [];

  if (
    refs.length === 0
  ) {
    return rec;
  }

  const out = {
    ...rec,
  };

  for (
    const {
      field,
      ref,
    }
    of refs
  ) {
    const oldVal =
      out[field];

    if (!oldVal) {
      continue;
    }

    const refs2 =
      Array.isArray(ref)
        ? ref
        : [ref];

    let mapped =
      null;

    for (
      const r
      of refs2
    ) {
      const m =
        idMaps[r];

      if (
        m &&
        m[oldVal]
      ) {
        mapped =
          m[oldVal];

        break;
      }
    }

    if (mapped) {
      out[field] =
        mapped;
    }
  }

  return out;
}

/* ==========================================================
   REFERENCED ENTITY CHECK
========================================================== */

export function isReferencedByOthers(
  name
) {
  return (
    Object.values(
      RESTORE_REFS
    )
      .some(
        arr =>
          arr.some(
            r =>
              (
                Array.isArray(
                  r.ref
                )
                  ? r.ref
                  : [r.ref]
              )
                .includes(
                  name
                )
          )
      )
  );
}
