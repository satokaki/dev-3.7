/**
 * Display name helper untuk inventory per stage.
 * Prefix hanya untuk display/operasional — database tetap membedakan via
 * product_id + batch_id + inventory_status + package_size + warehouse_id.
 */
export const INVENTORY_STAGE_PREFIX = {
  BULK: 'BULK_',
  READY_FOR_LABELING: 'BOTL_',
  UNEXCISED: 'LBL_',
  READY_FOR_SALE: '',
};

export const STAGE_LABEL = {
  BULK: 'Bulk (Produksi)',
  READY_FOR_LABELING: 'Siap Labeling',
  UNEXCISED: 'Belum Cukai',
  READY_FOR_SALE: 'Siap Jual',
};

/**
 * getInventoryDisplayName(productName, inventoryStatus)
 * BULK -> BULK_<name>, READY_FOR_LABELING -> BOTL_<name>,
 * UNEXCISED -> LBL_<name>, READY_FOR_SALE -> <name>
 */
export function getInventoryDisplayName(productName, inventoryStatus) {
  const p = (productName || '').trim();
  const prefix = INVENTORY_STAGE_PREFIX[inventoryStatus] ?? '';
  return prefix ? `${prefix}${p}` : p;
}