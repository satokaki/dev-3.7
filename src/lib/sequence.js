import { base44 } from '@/api/base44Client';

/**
 * All document codes are generated atomically by the backend function
 * `generateDocumentCode` (base44/functions/generateDocumentCode/entry.ts).
 * It uses DocumentSequence with optimistic locking to guarantee uniqueness
 * and sequential numbering under concurrent saves — never based on record count.
 *
 * Frontend wrappers keep the same names so existing pages work unchanged.
 */

async function gen(doc_type, params = {}) {
  const res = await base44.functions.invoke('generateDocumentCode', { doc_type, params });
  return res.data.code;
}

// Master data
export const generateBrandCode = () => gen('brand');
export const generateCategoryCode = () => gen('category');
export const generateSupplierCode = () => gen('supplier');
export const generateWarehouseCode = () => gen('warehouse');
export const generateMaterialCode = () => gen('material');
export const generatePremixMaterialCode = (short_name, concentration) => gen('premix_material', { short_name, concentration });
export const generatePremixBatchCode = (short_name, concentration) => gen('premix_batch', { short_name, concentration });
export const generateRecipeCode = () => gen('recipe');
export const generateProductCode = (category_code) => gen('product', { category_code });
export const generateCustomerCode = () => gen('customer');
export const generateUserCode = () => gen('user');

// Transactions
export const generateProductionNumber = () => gen('production');
export const generateBatchNumber = (brand_code) => gen('batch', { brand_code });
export const generateBottlingNumber = () => gen('bottling');
export const generateLabelingNumber = () => gen('labeling');
export const generateExciseNumber = () => gen('excise');
export const generatePurchaseNumber = () => gen('purchase');
export const generatePayableNumber = () => gen('payable');
export const generateInvoiceNumber = () => gen('invoice');
export const generatePaymentNumber = () => gen('payment');
export const generateAdjustmentNumber = () => gen('adjustment');

/**
 * Legacy generic order-number generator kept for backward compatibility.
 * Maps the previously-used prefixes to their canonical doc_type.
 */
export async function generateOrderNumber(prefix, entityName) {
  const map = { BLG: 'bottling', BTL: 'bottling', LBL: 'labeling', EXC: 'excise', CUK: 'excise' };
  const doc_type = map[prefix] || 'bottling';
  return gen(doc_type);
}