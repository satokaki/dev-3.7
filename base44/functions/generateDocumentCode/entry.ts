import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

const PADDING = 5;
const PADDING_3 = 3;

function pad(n, d) { return String(n).padStart(d, '0'); }
function nowYM() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}`;
}
function nowYMD() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
}
function nowYear() { return new Date().getFullYear(); }

// doc_type -> { key(params), prefix, build(params, n) }
const FORMATS = {
  brand:      { key: () => `BRAND-${nowYear()}`, prefix: 'MRK', build: () => `MRK-${pad(1, PADDING)}`.replace('00001', '00001') },
  category:   { key: () => `CATEGORY-${nowYear()}`, prefix: 'KAT', build: (p, n) => `KAT-${pad(n, PADDING)}` },
  supplier:   { key: () => `SUPPLIER-${nowYear()}`, prefix: 'SPL', build: (p, n) => `SPL-${pad(n, PADDING)}` },
  warehouse:  { key: () => `WAREHOUSE-${nowYear()}`, prefix: 'GUD', build: (p, n) => `GUD-${pad(n, PADDING)}` },
  material:   { key: () => `MATERIAL-${nowYear()}`, prefix: 'BHN', build: (p, n) => `BHN-${pad(n, PADDING)}` },
  premix_material: { key: (p) => `PREMIX-MAT-${(p.short_name||'XX').substring(0,4).toUpperCase()}-${(p.concentration||0)}-${nowYear()}`, prefix: 'PMX', build: (p, n) => `PMX-${(p.short_name||'XX').substring(0,4).toUpperCase()}-${(p.concentration||0)}-${pad(n, PADDING)}` },
  premix_batch:    { key: (p) => `PREMIX-BATCH-${(p.short_name||'XX').substring(0,3).toUpperCase()}${(p.concentration||0)}-${nowYMD()}`, prefix: 'PMXB', build: (p, n) => `PMX-${(p.short_name||'XX').substring(0,3).toUpperCase()}${(p.concentration||0)}-${nowYMD()}-${pad(n, PADDING_3)}` },
  recipe:     { key: () => `RECIPE-${nowYear()}`, prefix: 'RCP', build: (p, n) => `RCP-${pad(n, PADDING)}` },
  product:    { key: (p) => `PRODUCT-${(p.category_code || 'XX').substring(0, 3).toUpperCase()}`, prefix: 'BRG', build: (p, n) => `BRG-${(p.category_code || 'XX').substring(0, 3).toUpperCase()}-${pad(n, PADDING)}` },
  customer:   { key: () => `CUSTOMER-${nowYear()}`, prefix: 'CUS', build: (p, n) => `CUS-${nowYear()}-${pad(n, PADDING)}` },
  user:       { key: () => `USER-${nowYear()}`, prefix: 'USR', build: (p, n) => `USR-${pad(n, PADDING)}` },
  production: { key: () => `PRODUCTION-${nowYM()}`, prefix: 'PRD', build: (p, n) => `PRD-${nowYM()}-${pad(n, PADDING)}` },
  batch:      { key: (p) => `BATCH-${(p.brand_code || 'GEN').substring(0, 3).toUpperCase()}-${nowYMD()}`, prefix: 'BATCH', build: (p, n) => `BATCH-${(p.brand_code || 'GEN').substring(0, 3).toUpperCase()}-${nowYMD()}-${pad(n, PADDING_3)}` },
  bottling:   { key: () => `BOTTLING-${nowYM()}`, prefix: 'BTL', build: (p, n) => `BTL-${nowYM()}-${pad(n, PADDING)}` },
  labeling:   { key: () => `LABELING-${nowYM()}`, prefix: 'LBL', build: (p, n) => `LBL-${nowYM()}-${pad(n, PADDING)}` },
  excise:     { key: () => `EXCISE-${nowYM()}`, prefix: 'CUK', build: (p, n) => `CUK-${nowYM()}-${pad(n, PADDING)}` },
  purchase:   { key: () => `PURCHASE-${nowYM()}`, prefix: 'PO', build: (p, n) => `PO-${nowYM()}-${pad(n, PADDING)}` },
  payable:    { key: () => `PAYABLE-${nowYM()}`, prefix: 'AP', build: (p, n) => `AP-${nowYM()}-${pad(n, PADDING)}` },
  invoice:    { key: () => `INVOICE-${nowYM()}`, prefix: 'INV', build: (p, n) => `INV-${nowYM()}-${pad(n, PADDING)}` },
  payment:    { key: () => `PAYMENT-${nowYM()}`, prefix: 'PAY', build: (p, n) => `PAY-${nowYM()}-${pad(n, PADDING)}` },
  adjustment: { key: () => `ADJUSTMENT-${nowYM()}`, prefix: 'ADJ', build: (p, n) => `ADJ-${nowYM()}-${pad(n, PADDING)}` },
};

// Fix brand build (no year, plain)
FORMATS.brand.build = (p, n) => `MRK-${pad(n, PADDING)}`;

// Seed map: when creating a sequence for the first time, scan existing codes to avoid collisions
const SEED = {
  brand:      { entity: 'Brand', field: 'code' },
  category:   { entity: 'Category', field: 'code' },
  supplier:   { entity: 'Supplier', field: 'code' },
  warehouse:  { entity: 'Warehouse', field: 'code' },
  material:   { entity: 'Material', field: 'code' },
  recipe:     { entity: 'Recipe', field: 'code' },
  product:    { entity: 'Product', field: 'code' },
  customer:   { entity: 'Customer', field: 'code' },
  user:       { entity: 'User', field: 'user_code' },
  production: { entity: 'ProductionOrder', field: 'production_number' },
  bottling:   { entity: 'BottlingOrder', field: 'bottling_number' },
  labeling:   { entity: 'LabelingOrder', field: 'labeling_number' },
  excise:     { entity: 'ExciseOrder', field: 'excise_number' },
  purchase:   { entity: 'Purchase', field: 'purchase_number' },
  payable:    { entity: 'SupplierPayable', field: 'payable_number' },
  invoice:    { entity: 'Sale', field: 'invoice_number' },
  payment:    { entity: 'CustomerPayment', field: 'payment_number' },
  adjustment: { entity: 'StockAdjustment', field: 'adjustment_number' },
};

const TRAILING_NUM = /(\d+)\s*$/;

async function computeSeedStart(base44, doc_type, sequenceKey) {
  try {
    const seed = SEED[doc_type];
    if (!seed) return 1;
    const records = await base44.asServiceRole.entities[seed.entity].list('-created_date', 1000);
    let max = 0;
    for (const r of records) {
      const v = r[seed.field];
      if (!v || typeof v !== 'string') continue;
      const m = v.match(TRAILING_NUM);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return max + 1;
  } catch {
    return 1;
  }
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { doc_type, params = {} } = body;
    const fmt = FORMATS[doc_type];
    if (!fmt) return Response.json({ error: `Unknown doc_type: ${doc_type}` }, { status: 400 });

    const sequenceKey = fmt.key(params);
    const ds = base44.asServiceRole.entities.DocumentSequence;

    let number = 0;
    for (let attempt = 0; attempt < 8 && !number; attempt++) {
      const existing = await ds.filter({ sequence_key: sequenceKey });
      if (existing.length > 0) {
        const seq = existing[0];
        const current = seq.last_number || 0;
        const next = current + 1;
        // Optimistic lock: only update if last_number is still `current`
        const res = await ds.updateMany(
          { sequence_key: sequenceKey, last_number: current },
          { $set: { last_number: next } }
        );
        if (res && (res.updated || res.modifiedCount) > 0) {
          number = next;
        }
        // else: someone else moved it; retry
      } else {
        const start = await computeSeedStart(base44, doc_type, sequenceKey);
        try {
          await ds.create({
            sequence_key: sequenceKey,
            prefix: fmt.prefix,
            year: nowYear(),
            last_number: start,
          });
          number = start;
        } catch {
          // concurrent create by another worker; retry the update path
        }
      }
    }

    if (!number) return Response.json({ error: 'Failed to generate code' }, { status: 500 });
    const code = fmt.build(params, number);
    return Response.json({ code, sequence_key: sequenceKey, last_number: number });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}