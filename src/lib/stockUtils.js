import { base44 } from '@/api/base44Client';

/**
 * Record a stock movement:
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
   * RESOLVE STOCK BALANCE
   * ============================================================
   *
   * Unique balance key:
   *
   * item_id
   * + batch_id
   * + warehouse_id
   * + inventory_status
   *
   * inventory_status memisahkan:
   * BULK
   * READY_FOR_LABELING
   * UNEXCISED
   * READY_FOR_SALE
   *
   * Material lama tetap bisa memakai inventory_status kosong.
   */
  const filter = {
    item_id,
  };

  if (batch_id) {
    filter.batch_id = batch_id;
  }

  if (warehouse_id) {
    filter.warehouse_id = warehouse_id;
  }

  if (inventory_status) {
    filter.inventory_status = inventory_status;
  }

  const balances =
    await base44.entities.StockBalance.filter(filter);

  const balance =
    balances.length > 0
      ? balances[0]
      : null;

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
   *
   * PATCH:
   * Validasi stok dilakukan SEBELUM StockLedger.create().
   *
   * Sebelumnya:
   *
   * Ledger dibuat
   * → baru cek balance
   * → transaksi gagal
   * → ledger palsu tertinggal.
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
   * Tidak ada balance sebelumnya.
   *
   * Karena pre-validation sudah dilakukan,
   * hanya transaksi dengan qty final >= 0
   * yang dapat mencapai bagian ini.
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