import { base44 } from '@/api/base44Client';
import { createAuditLog } from '@/lib/stockUtils';

/**
 * Lab PRO — Premix Cost Recalculate (backfill HPP snapshot)
 * Scope: ONLY memperbaiki cost snapshot premix (Material.last_purchase_price).
 * TIDAK membuat mutasi stok, tidak menambah/mengurangi ledger quantity,
 * tidak memposting ulang produksi, tidak mengubah komposisi/quantity/status.
 *
 * Root cause: batch premix lama di-posting saat ingredient.last_purchase_price
 * masih per-KG mentah (belum /conversion_factor), sehingga HPP premix 1000x.
 */

// ── 1. Validasi ingredient (base unit) ──────────────────────────────
export function validatePremixIngredient(mat, requiredGram) {
  const errors = [];
  if (!mat) return { valid: false, errors: ['Material tidak ditemukan'], baseUnitCost: 0, cost: null };
  const unit = (mat.unit || '').toLowerCase();
  // Base unit yang didukung: gram / mililiter (sesuai base unit pembelian).
  if (unit && unit !== 'gram' && unit !== 'mililiter') {
    errors.push(`Unit "${mat.name}" = ${mat.unit} (bukan gram/mililiter). Recalc hanya mendukung base unit gram/mililiter.`);
  }
  const lpp = Number(mat.last_purchase_price);
  if (lpp == null || Number.isNaN(lpp)) errors.push(`last_purchase_price "${mat.name}" null/invalid`);
  if (lpp < 0) errors.push(`last_purchase_price "${mat.name}" negatif`);
  const req = Number(requiredGram);
  if (!(req > 0)) errors.push(`required_gram "${mat.name}" tidak valid (<=0)`);
  const valid = errors.length === 0;
  return { valid, errors, baseUnitCost: valid ? lpp : 0, cost: valid ? req * lpp : null };
}

// ── Anomaly detection: harga ingredient terlihat seperti purchase-unit mentah ──
// Tidak hardcoded pembagian 1000; pakai metadata unit + rasio terhadap reference base cost.
export function detectIngredientAnomaly(mat, referenceBaseCost) {
  if (!mat || !referenceBaseCost || referenceBaseCost <= 0) return null;
  const lpp = Number(mat.last_purchase_price || 0);
  if (lpp <= 0) return null;
  const ratio = lpp / referenceBaseCost;
  if (ratio >= 99 && ratio <= 1001) {
    return {
      material_id: mat.id, name: mat.name, last_purchase_price: lpp,
      reference_base_cost: referenceBaseCost, ratio,
      warning: 'Unit cost bahan terindikasi tidak normal. Pastikan harga sudah dalam satuan gram, bukan kilogram.',
    };
  }
  return null;
}

// ── 2. Preview recalc satu batch premix (NO write) ───────────────────
export async function previewPremixRecalc(productionId) {
  const prod = await base44.entities.ProductionOrder.get(productionId);
  if (!prod) throw new Error('ProductionOrder tidak ditemukan');
  if (prod.production_type !== 'PREMIX') throw new Error('Bukan produksi PREMIX');

  const mats = await base44.entities.ProductionMaterial.filter({ production_id: productionId });
  const ingredients = [];
  for (const m of mats) {
    const mat = await base44.entities.Material.get(m.material_id).catch(() => null);
    const req = Number(m.required_gram) || 0;
    const v = validatePremixIngredient(mat, req);
    ingredients.push({
      material_id: m.material_id,
      name: mat?.name,
      unit: mat?.unit,
      required_gram: req,
      last_purchase_price: Number(mat?.last_purchase_price || 0),
      base_unit_cost: v.baseUnitCost,
      cost: v.cost,
      valid: v.valid,
      errors: v.errors,
    });
  }

  const outputQty = Number(prod.actual_output_quantity) || Number(prod.target_quantity) || 0;
  const allValid = ingredients.length > 0 && ingredients.every(i => i.valid) && outputQty > 0;
  const totalInputCost = allValid ? ingredients.reduce((s, i) => s + i.cost, 0) : null;
  const hppPerGram = allValid && outputQty > 0 ? totalInputCost / outputQty : null;

  const outMat = prod.output_material_id ? await base44.entities.Material.get(prod.output_material_id).catch(() => null) : null;
  const currentUnitCost = Number(outMat?.last_purchase_price || 0);
  const ratio = allValid && currentUnitCost > 0 && hppPerGram > 0 ? currentUnitCost / hppPerGram : null;

  return {
    production_id: productionId,
    production_number: prod.production_number,
    batch_number: prod.batch_number,
    output_material: {
      id: outMat?.id, name: outMat?.name, code: outMat?.code, unit: outMat?.unit,
      current_last_purchase_price: currentUnitCost,
    },
    output_quantity: outputQty,
    valid: allValid,
    ingredients,
    total_input_cost: totalInputCost,
    recalculated_unit_cost: hppPerGram,
    current_unit_cost: currentUnitCost,
    current_inventory_value: currentUnitCost * outputQty,
    recalculated_inventory_value: allValid ? hppPerGram * outputQty : null,
    difference: allValid ? (hppPerGram * outputQty) - (currentUnitCost * outputQty) : null,
    ratio,
    suspect_1000x: allValid && ratio != null && ratio >= 999 && ratio <= 1001,
  };
}

// ── 6. Audit seluruh batch premix (NO write) ────────────────────────
export async function auditAllPremixBatches() {
  const prods = await base44.entities.ProductionOrder.filter({ production_type: 'PREMIX' });
  const rows = [];
  for (const p of prods) {
    try {
      const pv = await previewPremixRecalc(p.id);
      rows.push({
        production_id: p.id,
        production_number: pv.production_number,
        batch_number: pv.batch_number,
        premix: pv.output_material?.name,
        output_quantity: pv.output_quantity,
        stored_cost: pv.current_unit_cost,
        recalculated_cost: pv.recalculated_cost === undefined ? pv.recalculated_unit_cost : pv.recalculated_unit_cost,
        ratio: pv.ratio,
        suspect_1000x: pv.suspect_1000x,
        valid: pv.valid,
        ingredient_errors: pv.ingredients.filter(i => !i.valid).flatMap(i => i.errors),
      });
    } catch (e) {
      rows.push({ production_id: p.id, production_number: p.production_number, batch_number: p.batch_number, error: e.message });
    }
  }
  return rows;
}

// ── 4. Apply recalc (WRITE) — HANYA setelah konfirmasi ───────────────
// Update MINIMAL: Material.last_purchase_price (cost snapshot) + AuditLog.
// Tidak mengubah quantity / batch / status / ledger / komposisi.
export async function applyPremixRecalc(productionId, reason, user) {
  const pv = await previewPremixRecalc(productionId);
  if (!pv.valid) {
    throw new Error('Preview tidak valid, backfill dibatalkan: ' +
      JSON.stringify(pv.ingredients.filter(i => !i.valid).flatMap(i => i.errors)));
  }
  const oldCost = pv.current_unit_cost;
  const newCost = Number((pv.recalculated_unit_cost).toFixed(4));
  const oldInvValue = pv.current_inventory_value;
  const newInvValue = pv.recalculated_inventory_value;

  // Satu-satunya write data: cost snapshot premix.
  await base44.entities.Material.update(pv.output_material.id, {
    last_purchase_price: newCost,
  });

  // Audit log backfill.
  await createAuditLog({
    module: 'Premix Cost',
    action: 'PREMIX_COST_RECALCULATED',
    entity_type: 'ProductionOrder',
    entity_id: productionId,
    reference_number: pv.batch_number,
    data_after: {
      production_id: productionId,
      batch_number: pv.batch_number,
      output_material: pv.output_material.name,
      output_quantity: pv.output_quantity,
      old_unit_cost: oldCost,
      new_unit_cost: newCost,
      old_inventory_value: oldInvValue,
      new_inventory_value: newInvValue,
      ingredient_breakdown: pv.ingredients.map(i => ({
        name: i.name,
        required_gram: i.required_gram,
        base_unit_cost: i.base_unit_cost,
        cost: i.cost,
      })),
      user: user || 'system',
      reason: reason || 'Backfill development akibat konversi purchase unit KG ke base unit gram yang sebelumnya salah.',
    },
  });

  return {
    applied: true,
    batch_number: pv.batch_number,
    output_material: pv.output_material.name,
    old_unit_cost: oldCost,
    new_unit_cost: newCost,
    old_inventory_value: oldInvValue,
    new_inventory_value: newInvValue,
  };
}

// ── 8. Preview ingredient untuk posting premix baru (validasi pre-post) ──
// Mengembalikan breakdown + flag validasi/anomali. Dipakai UI sebelum tombol Posting.
export async function previewPremixPost(productionId, referenceBaseCosts = {}) {
  const prod = await base44.entities.ProductionOrder.get(productionId);
  const mats = await base44.entities.ProductionMaterial.filter({ production_id: productionId });
  const outputQty = Number(prod.actual_output_quantity) || Number(prod.target_quantity) || 0;
  const rows = [];
  let totalInputCost = 0;
  for (const m of mats) {
    const mat = await base44.entities.Material.get(m.material_id).catch(() => null);
    const req = Number(m.required_gram) || 0;
    const v = validatePremixIngredient(mat, req);
    const ref = referenceBaseCosts[m.material_id];
    const anomaly = ref ? detectIngredientAnomaly(mat, ref) : null;
    rows.push({
      material_id: m.material_id, name: mat?.name, unit: mat?.unit,
      required_gram: req, price_per_gram: v.baseUnitCost, total_cost: v.cost,
      valid: v.valid, errors: v.errors, anomaly,
    });
    if (v.valid) totalInputCost += v.cost;
  }
  const hppPerGram = outputQty > 0 ? totalInputCost / outputQty : 0;
  return { production_number: prod.production_number, ingredients: rows, output_quantity: outputQty, total_input_cost: totalInputCost, hpp_per_gram: hppPerGram };
}