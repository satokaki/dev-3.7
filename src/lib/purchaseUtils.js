import { base44 } from '@/api/base44Client';
import {
  recordStockMovement,
  createAuditLog
} from '@/lib/stockUtils';
import {
  generatePurchaseNumber,
  generatePayableNumber
} from '@/lib/sequence';

export {
  generatePurchaseNumber,
  generatePayableNumber
};

/* ==========================================================
   HELPERS
========================================================== */

const toNum = (v) =>
  v === '' ||
  v === null ||
  v === undefined
    ? null
    : Number(v);

const POSTING_LOCKS = new Set();

/**
 * BUG-01 PATCH
 *
 * Local runtime lock.
 *
 * Tujuan:
 * mencegah fungsi postPurchase() dijalankan dua kali
 * secara bersamaan dari browser/runtime yang sama.
 *
 * Ini BUKAN satu-satunya proteksi.
 * Di bawah juga ada pengecekan ulang status purchase
 * dan pengecekan StockLedger.
 */
function acquirePostingLock(purchaseId) {
  if (POSTING_LOCKS.has(purchaseId)) {
    throw new Error(
      'Pembelian sedang diposting. Tunggu proses pertama selesai.'
    );
  }

  POSTING_LOCKS.add(purchaseId);
}

function releasePostingLock(purchaseId) {
  POSTING_LOCKS.delete(purchaseId);
}

/* ==========================================================
   VALIDATE PURCHASE
========================================================== */

/**
 * Validate purchase items before posting.
 *
 * Throws Error with user-friendly message
 * on first violation.
 */
function validatePurchase(purchase, items) {
  if (!purchase) {
    throw new Error(
      'Dokumen pembelian tidak ditemukan'
    );
  }

  if (purchase.purchase_status === 'posted') {
    throw new Error(
      'Pembelian sudah diposting, tidak dapat diposting ulang'
    );
  }

  if (purchase.purchase_status === 'cancelled') {
    throw new Error(
      'Pembelian telah dibatalkan'
    );
  }

  if (!purchase.supplier_id) {
    throw new Error(
      'Supplier wajib diisi sebelum posting'
    );
  }

  if (!purchase.warehouse_id) {
    throw new Error(
      'Gudang tujuan wajib diisi sebelum posting'
    );
  }

  if (!items || items.length === 0) {
    throw new Error(
      'Minimal satu item wajib ada sebelum posting'
    );
  }

  for (const it of items) {
    const qty = toNum(it.quantity);

    if (
      qty === null ||
      Number.isNaN(qty)
    ) {
      throw new Error(
        `Quantity item "${it.item_name}" tidak valid`
      );
    }

    if (qty <= 0) {
      throw new Error(
        `Quantity item "${it.item_name}" harus lebih dari nol`
      );
    }

    const price = toNum(it.unit_price);

    if (
      price === null ||
      Number.isNaN(price)
    ) {
      throw new Error(
        `Harga item "${it.item_name}" tidak valid`
      );
    }

    if (price < 0) {
      throw new Error(
        `Harga item "${it.item_name}" tidak boleh negatif`
      );
    }

    const cf =
      toNum(it.conversion_factor) ?? 1;

    if (cf <= 0) {
      throw new Error(
        `Faktor konversi item "${it.item_name}" harus lebih dari nol`
      );
    }
  }
}

/* ==========================================================
   IDEMPOTENCY CHECK
========================================================== */

/**
 * BUG-01 PATCH
 *
 * Cari apakah purchase ini sudah pernah menghasilkan
 * stock receipt.
 *
 * reference_id adalah identity utama.
 * transaction_type memastikan ledger memang berasal
 * dari posting pembelian.
 */
async function getExistingPurchaseReceipts(
  purchaseId
) {
  try {
    const rows =
      await base44.entities.StockLedger.filter({
        reference_id: purchaseId,
        reference_type: 'purchase',
        transaction_type: 'purchase_receipt'
      });

    return rows || [];
  } catch {
    /*
     * Jangan langsung menganggap sudah aman jika query gagal.
     * Error dilempar supaya posting tidak diteruskan tanpa
     * idempotency check.
     */
    throw new Error(
      'Gagal memeriksa histori posting pembelian. Posting dibatalkan untuk mencegah transaksi ganda.'
    );
  }
}

/**
 * BUG-01 PATCH
 *
 * Check payable existing untuk purchase tempo.
 */
async function getExistingPayables(
  purchaseId
) {
  try {
    const rows =
      await base44.entities.SupplierPayable.filter({
        purchase_id: purchaseId
      });

    return rows || [];
  } catch {
    throw new Error(
      'Gagal memeriksa histori hutang supplier. Posting dibatalkan untuk mencegah data ganda.'
    );
  }
}

/* ==========================================================
   POST PURCHASE
========================================================== */

/**
 * Post a purchase:
 *
 * 1. Local posting lock
 * 2. Load purchase
 * 3. Validate status
 * 4. Check existing StockLedger
 * 5. Create stock receipt
 * 6. Update last purchase price
 * 7. Create payable if tempo
 * 8. Update purchase status
 * 9. Audit log
 *
 * BUG-01:
 * Double Posting Pembelian
 *
 * Patch ini memberikan beberapa lapis proteksi:
 *
 * - frontend/runtime lock
 * - status validation
 * - re-fetch status sebelum stock movement
 * - StockLedger idempotency guard
 * - SupplierPayable duplicate guard
 *
 * Catatan:
 * true atomic transaction tetap paling ideal dilakukan
 * di backend/server transaction.
 */
export async function postPurchase(
  purchaseId
) {
  if (!purchaseId) {
    throw new Error(
      'ID pembelian tidak valid'
    );
  }

  acquirePostingLock(purchaseId);

  try {
    /* ======================================================
       LOAD INITIAL DATA
    ====================================================== */

    let purchase =
      await base44.entities.Purchase.get(
        purchaseId
      );

    const items =
      await base44.entities.PurchaseItem.filter({
        purchase_id: purchaseId
      });

    validatePurchase(
      purchase,
      items
    );

    /* ======================================================
       BUG-01 GUARD #1
       CHECK EXISTING STOCK RECEIPT
    ====================================================== */

    const existingReceipts =
      await getExistingPurchaseReceipts(
        purchaseId
      );

    if (existingReceipts.length > 0) {
      /*
       * Kalau ledger sudah ada tetapi status purchase belum
       * posted, berarti kemungkinan proses sebelumnya
       * berhenti di tengah.
       *
       * JANGAN membuat ledger kedua.
       */
      if (
        purchase.purchase_status !==
        'posted'
      ) {
        throw new Error(
          'Pembelian ini sudah memiliki penerimaan stok. Posting ulang diblokir untuk mencegah stok ganda. Periksa Kartu Stok sebelum melanjutkan.'
        );
      }

      throw new Error(
        'Pembelian sudah diposting, tidak dapat diposting ulang'
      );
    }

    /* ======================================================
       BUG-01 GUARD #2
       RE-FETCH PURCHASE SEBELUM WRITE
    ====================================================== */

    purchase =
      await base44.entities.Purchase.get(
        purchaseId
      );

    if (!purchase) {
      throw new Error(
        'Dokumen pembelian tidak ditemukan'
      );
    }

    if (
      purchase.purchase_status ===
      'posted'
    ) {
      throw new Error(
        'Pembelian sudah diposting, tidak dapat diposting ulang'
      );
    }

    if (
      purchase.purchase_status ===
      'cancelled'
    ) {
      throw new Error(
        'Pembelian telah dibatalkan'
      );
    }

    /* ======================================================
       USER
    ====================================================== */

    const user =
      await base44.auth
        .me()
        .catch(() => null);

    const userName =
      user?.full_name ||
      user?.email ||
      'System';

    /* ======================================================
       STOCK MOVEMENTS
    ====================================================== */

    for (const it of items) {
      /*
       * BUG-01 GUARD #3
       *
       * Sebelum setiap stock movement,
       * cek apakah receipt untuk purchase ini
       * sudah muncul.
       *
       * Ini mempersempit race window jika ada
       * request kedua yang sempat lolos.
       */
      const currentReceipts =
        await getExistingPurchaseReceipts(
          purchaseId
        );

      const itemAlreadyPosted =
        currentReceipts.some(
          ledger =>
            ledger.item_id ===
              it.item_id &&
            ledger.reference_id ===
              purchaseId &&
            ledger.transaction_type ===
              'purchase_receipt'
        );

      if (itemAlreadyPosted) {
        throw new Error(
          `Item "${it.item_name}" sudah tercatat pada penerimaan stok. Posting dihentikan untuk mencegah duplikasi.`
        );
      }

      const qty =
        Number(it.quantity);

      const cf =
        Number(
          it.conversion_factor
        ) || 1;

      const baseQty =
        Number(
          it.base_quantity
        ) ||
        qty * cf;

      await recordStockMovement({
        item_type:
          'material',

        item_id:
          it.item_id,

        item_code:
          it.item_code || '',

        item_name:
          it.item_name,

        batch_id:
          it.lot_number ||
          it.batch_supplier ||
          '',

        batch_number:
          it.batch_supplier ||
          it.lot_number ||
          '',

        warehouse_id:
          it.warehouse_id ||
          purchase.warehouse_id ||
          '',

        warehouse_name:
          it.warehouse_name ||
          purchase.warehouse_name ||
          '',

        quantity_in:
          baseQty,

        unit:
          it.base_unit ||
          it.unit ||
          'unit',

        transaction_type:
          'purchase_receipt',

        transaction_number:
          purchase.purchase_number,

        reference_type:
          'purchase',

        reference_id:
          purchase.id,

        notes:
          `Penerimaan pembelian ${purchase.purchase_number}`
      });

      /* ====================================================
         UPDATE LAST PURCHASE PRICE
      ==================================================== */

      /*
       * unit_price =
       * harga per SATUAN BELI.
       *
       * contoh:
       *
       * Rp600.000 / KG
       *
       * conversion_factor = 1000
       *
       * last_purchase_price =
       * Rp600 / gram
       *
       * HPP & inventory valuation menggunakan
       * harga per base unit.
       */

      const conv =
        Number(
          it.conversion_factor
        ) || 1;

      const unitPrice =
        Number(
          it.unit_price
        ) || 0;

      const baseUnitCost =
        conv > 0
          ? unitPrice / conv
          : unitPrice;

      try {
        await base44.entities.Material.update(
          it.item_id,
          {
            last_purchase_price:
              baseUnitCost
          }
        );
      } catch {
        /*
         * Harga gagal update tidak boleh membuat
         * stock receipt diduplikasi oleh retry.
         *
         * Ledger sudah menjadi source of truth bahwa
         * penerimaan telah terjadi.
         */
      }
    }

    /* ======================================================
       SUPPLIER PAYABLE
    ====================================================== */

    let payableNumber = '';

    if (
      purchase.payment_method ===
      'tempo'
    ) {
      /*
       * BUG-01 GUARD #4
       *
       * Jangan create payable kedua
       * untuk purchase yang sama.
       */
      const existingPayables =
        await getExistingPayables(
          purchaseId
        );

      if (
        existingPayables.length > 0
      ) {
        payableNumber =
          existingPayables[0]
            .payable_number || '';
      } else {
        payableNumber =
          await generatePayableNumber();

        await base44.entities.SupplierPayable.create({
          payable_number:
            payableNumber,

          purchase_id:
            purchase.id,

          purchase_number:
            purchase.purchase_number,

          supplier_id:
            purchase.supplier_id,

          supplier_name:
            purchase.supplier_name,

          invoice_date:
            purchase.purchase_date,

          due_date:
            purchase.due_date,

          total_amount:
            Number(
              purchase.total
            ) || 0,

          total_paid:
            0,

          remaining_balance:
            Number(
              purchase.total
            ) || 0,

          payment_status:
            'belum_dibayar',

          notes:
            purchase.notes || ''
        });
      }
    }

    /* ======================================================
       UPDATE PURCHASE STATUS
    ====================================================== */

    const paidNow =
      purchase.payment_method ===
      'tempo'
        ? 0
        : (
            Number(
              purchase.total
            ) || 0
          );

    const remaining =
      purchase.payment_method ===
      'tempo'
        ? (
            Number(
              purchase.total
            ) || 0
          )
        : 0;

    const paymentStatus =
      purchase.payment_method ===
      'tempo'
        ? 'belum_dibayar'
        : 'lunas';

    await base44.entities.Purchase.update(
      purchase.id,
      {
        purchase_status:
          'posted',

        posted_by:
          userName,

        posted_at:
          new Date().toISOString(),

        total_paid:
          paidNow,

        remaining_payable:
          remaining,

        payment_status:
          paymentStatus
      }
    );

    /* ======================================================
       AUDIT LOG
    ====================================================== */

    await createAuditLog({
      module:
        'Pembelian',

      action:
        'Posting',

      entity_type:
        'Purchase',

      entity_id:
        purchase.id,

      reference_number:
        purchase.purchase_number,

      data_after: {
        status:
          'posted',

        items:
          items.length,

        payable:
          payableNumber || null,

        double_post_guard:
          true
      }
    });

    return {
      posted:
        true,

      payableNumber
    };
  } finally {
    /*
     * WAJIB release lock baik sukses maupun error.
     */
    releasePostingLock(
      purchaseId
    );
  }
}

/* ==========================================================
   CANCEL PURCHASE
========================================================== */

/**
 * Cancel purchase.
 *
 * Draft:
 * -> cancelled
 *
 * Posted:
 * -> reversal stock movement
 * -> close payable
 * -> cancelled
 */
export async function cancelPurchase(
  purchaseId,
  reason = ''
) {
  const purchase =
    await base44.entities.Purchase.get(
      purchaseId
    );

  if (!purchase) {
    throw new Error(
      'Dokumen pembelian tidak ditemukan'
    );
  }

  if (
    purchase.purchase_status ===
    'cancelled'
  ) {
    throw new Error(
      'Pembelian sudah dibatalkan'
    );
  }

  /* ========================================================
     POSTED PURCHASE REVERSAL
  ======================================================== */

  if (
    purchase.purchase_status ===
    'posted'
  ) {
    const items =
      await base44.entities.PurchaseItem.filter({
        purchase_id:
          purchaseId
      });

    for (const it of items) {
      const qty =
        Number(
          it.quantity
        );

      const cf =
        Number(
          it.conversion_factor
        ) || 1;

      const baseQty =
        Number(
          it.base_quantity
        ) ||
        qty * cf;

      await recordStockMovement({
        item_type:
          'material',

        item_id:
          it.item_id,

        item_code:
          it.item_code || '',

        item_name:
          it.item_name,

        batch_id:
          it.lot_number ||
          it.batch_supplier ||
          '',

        batch_number:
          it.batch_supplier ||
          it.lot_number ||
          '',

        warehouse_id:
          it.warehouse_id ||
          purchase.warehouse_id ||
          '',

        warehouse_name:
          it.warehouse_name ||
          purchase.warehouse_name ||
          '',

        quantity_out:
          baseQty,

        unit:
          it.base_unit ||
          it.unit ||
          'unit',

        transaction_type:
          'stock_adjustment',

        transaction_number:
          purchase.purchase_number,

        reference_type:
          'purchase',

        reference_id:
          purchase.id,

        notes:
          `Pembatalan pembelian ${purchase.purchase_number} - ${reason || 'reversal'}`
      });
    }

    /* ======================================================
       CLOSE PAYABLE
    ====================================================== */

    const payables =
      await base44.entities.SupplierPayable.filter({
        purchase_id:
          purchaseId
      });

    for (const ap of payables) {
      if (
        ap.payment_status !==
        'lunas'
      ) {
        await base44.entities.SupplierPayable.update(
          ap.id,
          {
            payment_status:
              'lunas',

            remaining_balance:
              0,

            notes:
              (
                ap.notes || ''
              ) +
              `\nDibatalkan: ${reason}`
          }
        );
      }
    }
  }

  /* ========================================================
     UPDATE CANCEL STATUS
  ======================================================== */

  await base44.entities.Purchase.update(
    purchase.id,
    {
      purchase_status:
        'cancelled',

      notes:
        (
          purchase.notes || ''
        ) +
        `\nDibatalkan: ${reason}`
    }
  );

  /* ========================================================
     AUDIT
  ======================================================== */

  await createAuditLog({
    module:
      'Pembelian',

    action:
      'Cancel',

    entity_type:
      'Purchase',

    entity_id:
      purchase.id,

    reference_number:
      purchase.purchase_number,

    reason
  });

  return {
    cancelled:
      true
  };
}

/* ==========================================================
   SNAPSHOT ITEM
========================================================== */

/**
 * Snapshot helper:
 *
 * pick item code/name/unit
 * from material or product master.
 */
export function snapshotItem(
  itemType,
  master
) {
  if (!master) {
    return {
      item_code:
        '',

      item_name:
        '',

      base_unit:
        'unit',

      category_name:
        ''
    };
  }

  return {
    item_code:
      master.code || '',

    item_name:
      master.name || '',

    base_unit:
      master.unit || 'unit',

    category_name:
      master.category_name || ''
  };
}