import { base44 } from '@/api/base44Client';

/**
 * Stock identity helper.
 *
 * IMPORTANT:
 * StockBalance adalah entitas stok terpisah berdasarkan:
 * item + batch + gudang + stage.
 *
 * Jangan pernah mengambil balances[0] dari query parsial,
 * karena stok tanpa batch dapat bercampur dengan stok batch lain.
 */
const stockIdentityKey = ({
  batch_id = '',
  batch_number = '',
  warehouse_id = '',
  warehouse_name = '',
  inventory_status = '',
}) => {
  const batchKey =
    String(batch_id || batch_number || '').trim();

  const warehouseKey =
    String(warehouse_id || warehouse_name || '').trim();

  const stageKey =
    String(inventory_status || '').trim();

  return `${batchKey}|${warehouseKey}|${stageKey}`;
};

/**
 * Record a stock movement:
 * - resolve exact target StockBalance
 * - validate target StockBalance first
 * - create StockLedger
 * - update/create StockBalance
 *
 * NOTE:
 * Idealnya proses ini dijalankan di backend/database transaction.
 * Untuk arsitektur frontend Base44 saat ini, pre-validation dilakukan
 * sebelum ledger dibuat agar transaksi yang pasti gagal karena stok minus
 * tidak meninggalkan StockLedger yatim.
 */
export async function recordStockMovement({
  item_type,
  item_id,
  item_code,
  item_name,

  batch_id = '',
  batch_number = '',

  warehouse_id = '',
  warehouse_name = '',

  inventory_status = '',

  quantity_in = 0,
  quantity_out = 0,

  unit,
  unit_cost = 0,

  transaction_type,
  transaction_number,

  reference_type = '',
  reference_id = '',

  notes = '',
}) {
  const qtyIn = Number(quantity_in) || 0;
  const qtyOut = Number(quantity_out) || 0;

  if (!item_id) {
    throw new Error('Item stok tidak valid.');
  }

  if (qtyIn < 0 || qtyOut < 0) {
    throw new Error('Quantity masuk/keluar tidak boleh negatif.');
  }

  if (qtyIn === 0 && qtyOut === 0) {
    throw new Error('Transaksi stok harus memiliki quantity masuk atau keluar.');
  }

  /**
   * ============================================================
   * RESOLVE EXACT STOCK BALANCE
   * ============================================================
   *
   * BUG FIX:
   *
   * Versi lama membuat filter parsial:
   * item_id + optional batch_id + optional warehouse_id + stage
   *
   * Jika batch_id kosong, filter batch tidak dikirim sama sekali.
   * Akibatnya:
   *
   * SAMPLE tanpa batch = 33
   * SAMPLE batch A      = 17
   *
   * dapat kembali dalam query yang sama lalu balances[0] dipakai.
   * Bila row pertama saldo 0, transaksi gagal walaupun row tanpa batch
   * sebenarnya masih memiliki stok 33.
   *
   * Sekarang kandidat diambil berdasarkan item_id, lalu dipilih dengan
   * EXACT identity:
   *
   * batch + warehouse + inventory_status.
   */

  const candidates =
    await base44.entities.StockBalance.filter({
      item_id,
    });

  const targetIdentity =
    stockIdentityKey({
      batch_id,
      batch_number,
      warehouse_id,
      warehouse_name,
      inventory_status,
    });

  const exactBalances =
    (candidates || []).filter(candidate => {
      if (
        item_type &&
        candidate.item_type &&
        candidate.item_type !== item_type
      ) {
        return false;
      }

      return (
        stockIdentityKey(candidate) ===
        targetIdentity
      );
    });

  /**
   * Duplicate exact StockBalance seharusnya tidak terjadi.
   * Jangan diam-diam pilih balances[0], karena dapat merusak stok.
   */
  if (exactBalances.length > 1) {
    throw new Error(
      `Ditemukan duplicate StockBalance untuk ${item_name}. ` +
      `Batch: ${batch_number || 'TANPA BATCH'}, ` +
      `Gudang: ${warehouse_name || 'TANPA GUDANG'}, ` +
      `Stage: ${inventory_status || 'TANPA STAGE'}. ` +
      `Transaksi diblokir agar stok tidak salah potong.`
    );
  }

  const balance =
    exactBalances[0] || null;

  const currentQty =
    Number(balance?.quantity) || 0;

  const reservedQty =
    Number(balance?.reserved_quantity) || 0;

  const newQty =
    currentQty + qtyIn - qtyOut;

  /**
   * ============================================================
   * PRE-VALIDATION
   * ============================================================
   */
  if (newQty < 0) {
    throw new Error(
      `Stok tidak mencukupi untuk ${item_name}. ` +
      `Stok: ${currentQty}, dibutuhkan: ${qtyOut}`
    );
  }

  const availableQty =
    newQty - reservedQty;

  if (availableQty < 0) {
    throw new Error(
      `Stok tersedia tidak mencukupi untuk ${item_name}. ` +
      `Stok: ${currentQty}, reserved: ${reservedQty}, dibutuhkan: ${qtyOut}`
    );
  }

  /**
   * ============================================================
   * CREATE STOCK LEDGER
   * ============================================================
   */
  await base44.entities.StockLedger.create({
    transaction_date:
      new Date().toISOString(),

    transaction_number,
    transaction_type,

    item_type,
    inventory_status,

    item_id,
    item_code:
      item_code || '',
    item_name,

    batch_id,
    batch_number,

    warehouse_id,
    warehouse_name,

    quantity_in:
      qtyIn,

    quantity_out:
      qtyOut,

    /**
     * Tetap dipertahankan untuk backward compatibility.
     * Kartu Stok menghitung running balance sendiri.
     */
    balance_quantity:
      0,

    unit:
      unit || '',

    unit_cost:
      Number(unit_cost) || 0,

    reference_type,
    reference_id,

    notes,
  });

  /**
   * ============================================================
   * UPDATE / CREATE STOCK BALANCE
   * ============================================================
   */
  if (balance) {
    await base44.entities.StockBalance.update(
      balance.id,
      {
        quantity:
          newQty,

        available_quantity:
          availableQty,
      }
    );

    return {
      balance_id:
        balance.id,

      quantity:
        newQty,

      available_quantity:
        availableQty,
    };
  }

  /**
   * Tidak ada EXACT balance sebelumnya.
   *
   * Untuk OUT, pre-validation di atas sudah memblokir karena currentQty = 0.
   * Untuk IN, aman membuat StockBalance identity baru.
   */
  const createdBalance =
    await base44.entities.StockBalance.create({
      item_type,
      item_id,

      inventory_status,

      item_name,
      item_code:
        item_code || '',

      batch_id,
      batch_number,

      warehouse_id,
      warehouse_name,

      quantity:
        newQty,

      reserved_quantity:
        0,

      available_quantity:
        newQty,

      unit:
        unit || '',
    });

  return {
    balance_id:
      createdBalance?.id || '',

    quantity:
      newQty,

    available_quantity:
      newQty,
  };
}


/**
 * Get total available balance for an item.
 */
export async function getStockBalance(
  item_id,
  item_type = 'material'
) {
  const balances =
    await base44.entities.StockBalance.filter({
      item_id,
      item_type,
    });

  return balances.reduce(
    (sum, balance) =>
      sum +
      (
        Number(
          balance.available_quantity
        ) || 0
      ),
    0
  );
}


/**
 * Get all stock balances.
 *
 * Optional item_type:
 * material / product
 */
export async function getAllStockBalances(
  item_type
) {
  const filter = {};

  if (item_type) {
    filter.item_type =
      item_type;
  }

  return base44.entities.StockBalance.filter(
    filter
  );
}


/**
 * Create audit log.
 *
 * Audit failure tidak menggagalkan transaksi utama.
 */
export async function createAuditLog({
  module,
  action,

  entity_type = '',
  entity_id = '',

  reference_number = '',

  data_before,
  data_after,

  reason = '',
}) {
  try {
    const user =
      await base44.auth
        .me()
        .catch(() => null);

    return base44.entities.AuditLog.create({
      action_time:
        new Date().toISOString(),

      user_name:
        user?.full_name ||
        user?.email ||
        'System',

      module,
      action,

      entity_type,
      entity_id,

      reference_number,

      data_before:
        data_before
          ? JSON.stringify(
              data_before
            )
          : '',

      data_after:
        data_after
          ? JSON.stringify(
              data_after
            )
          : '',

      reason,
    });
  } catch {
    return null;
  }
}
