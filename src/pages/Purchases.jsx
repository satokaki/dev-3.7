import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import FormModal from '@/components/FormModal';
import SearchableSelect from '@/components/SearchableSelect';
import StatusBadge from '@/components/StatusBadge';
import NumberInput from '@/components/NumberInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Pencil, Trash2, Eye, CheckCircle2, XCircle, Download } from 'lucide-react';
import { postPurchase, cancelPurchase, snapshotItem } from '@/lib/purchaseUtils';
import { generatePurchaseNumber } from '@/lib/sequence';
import PdfButton from '@/components/PdfButton';
import { exportDocumentToPDF } from '@/lib/pdfExport';
import { formatCurrency as fmtMoney } from '@/lib/format';

const itemTypes = [
  { value: 'material', label: 'Bahan Produksi' },
  { value: 'packaging', label: 'Kemasan' },
  { value: 'label', label: 'Labeling' },
  { value: 'excise_material', label: 'Cukai' },
  { value: 'consumable', label: 'Consumable' },
  { value: 'supporting_item', label: 'Barang Pendukung' },
];
const itLabel = (v) => itemTypes.find(t => t.value === v)?.label || v;

// item_type diturunkan otomatis dari material_type barang yang dipilih.
const ITEM_TYPE_BY_MATERIAL_TYPE = {
  RAW_MATERIAL: 'material', PREMIX: 'material',
  PACKAGING: 'packaging', BOTTLE: 'packaging',
  LABEL: 'label', STICKER: 'label',
  EXCISE: 'excise_material',
  CONSUMABLE: 'consumable',
  FINISHED_GOOD: 'supporting_item',
};
const deriveItemType = (material_type) => ITEM_TYPE_BY_MATERIAL_TYPE[material_type] || 'supporting_item';

// item_type untuk produk diturunkan dari product_type.
const ITEM_TYPE_BY_PRODUCT_TYPE = {
  bahan_baku: 'material', kemasan: 'packaging', botol_kosong: 'packaging',
  label: 'label', barang_pendukung: 'supporting_item', barang_siap_jual: 'supporting_item',
};
const deriveProductItemType = (pt) => ITEM_TYPE_BY_PRODUCT_TYPE[pt] || 'supporting_item';

const UNIT_OPTIONS = [
  { value: 'GRAM', label: 'Gram' },
  { value: 'KG', label: 'Kg' },
  { value: 'PCS', label: 'Pcs' },
];
const unitProps = (unit) => unit === 'KG' ? { conversion_factor: '1000', base_unit: 'gram' }
  : unit === 'PCS' ? { conversion_factor: '1', base_unit: 'pcs' }
  : { conversion_factor: '1', base_unit: 'gram' };

const paymentMethods = [
  { value: 'cash', label: 'Tunai' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'tempo', label: 'Tempo' },
];
const pmLabel = (v) => paymentMethods.find(t => t.value === v)?.label || v;

const toNum = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

const emptyItem = () => ({
  item_type: '', item_id: '', item_code: '', item_name: '', category_name: '',
  batch_supplier: '', lot_number: '', production_date: '', expiry_date: '',
  quantity: '', unit: '', conversion_factor: '1', base_unit: '', base_quantity: '',
  unit_price: '', discount: '', tax: '', subtotal: '', notes: '',
});

export default function Purchases() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [postingId, setPostingId] = useState(null);
  const [detailItem, setDetailItem] = useState(null);
  const [detailItems, setDetailItems] = useState([]);
  const [filters, setFilters] = useState({ supplier: 'all', payment_method: 'all', status: 'all' });

  const [form, setForm] = useState({
    supplier_invoice_number: '', purchase_date: new Date().toISOString().slice(0, 10),
    supplier_id: '', supplier_name: '', warehouse_id: '', warehouse_name: '',
    payment_method: 'cash', payment_terms: '', due_date: '',
    discount: '', tax: '', additional_cost: '', notes: '',
    items: [emptyItem()],
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [items, sups, whs, mats, prods] = await Promise.all([
        base44.entities.Purchase.list('-created_date', 200),
        base44.entities.Supplier.filter({ is_active: true }),
        base44.entities.Warehouse.filter({ is_active: true }),
        base44.entities.Material.filter({ is_active: true }, '-created_date', 500),
        base44.entities.Product.filter({ is_active: true }, '-created_date', 500),
      ]);
      setData(items);
      setSuppliers(sups); setWarehouses(whs); setMaterials(mats); setProducts(prods);
    } catch { toast({ type: 'error', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  // Realtime: setiap material baru/berubah langsung sinkron ke picker (mencegah stale list).
  useEffect(() => {
    const unsubscribe = base44.entities.Material.subscribe((event) => {
      setMaterials(prev => {
        if (event.type === 'create') {
          if (!event.data?.is_active || prev.some(m => m.id === event.data.id)) return prev;
          return [event.data, ...prev];
        }
        if (event.type === 'update') {
          return prev.map(m => m.id === event.data.id ? { ...m, ...event.data } : m);
        }
        if (event.type === 'delete') {
          return prev.filter(m => m.id !== event.data.id);
        }
        return prev;
      });
    });
    return unsubscribe;
  }, []);

  // Realtime: setiap produk baru/berubah dari Master Barang langsung sinkron ke picker.
  useEffect(() => {
    const unsubscribe = base44.entities.Product.subscribe((event) => {
      setProducts(prev => {
        if (event.type === 'create') {
          if (!event.data?.is_active || prev.some(p => p.id === event.data.id)) return prev;
          return [event.data, ...prev];
        }
        if (event.type === 'update') {
          return prev.map(p => p.id === event.data.id ? { ...p, ...event.data } : p);
        }
        if (event.type === 'delete') {
          return prev.filter(p => p.id !== event.data.id);
        }
        return prev;
      });
    });
    return unsubscribe;
  }, []);

  // Picker Pembelian:
  // - semua Material aktif boleh dibeli
  // - Product hanya yang memang merupakan barang pembelian
  // - finished goods / barang siap jual TIDAK boleh muncul
  const PURCHASABLE_PRODUCT_TYPES = new Set([
    'bahan_baku',
    'kemasan',
    'botol_kosong',
    'label',
    'barang_pendukung',
  ]);

  const masterList = useMemo(() => [
    ...materials.map(m => ({ ...m, _kind: 'material' })),
    ...products
      .filter(p => PURCHASABLE_PRODUCT_TYPES.has(p.product_type))
      .map(p => ({ ...p, _kind: 'product' })),
  ], [materials, products]);
  const masterOptions = useMemo(() => masterList.map(o => ({
    value: o.id, label: o.name,
    keywords: `${o.code || ''} ${o.category_name || ''} ${o.material_type || ''} ${o.product_type || ''} ${o._kind || ''}`,
  })), [masterList]);

  const getMaster = (id) => masterList.find(m => m.id === id);

  const computeSubtotal = (it) => {
    const qty = toNum(it.quantity) || 0;
    const price = toNum(it.unit_price) || 0;
    const disc = toNum(it.discount) || 0;
    const tax = toNum(it.tax) || 0;
    const lineGross = qty * price;
    return Math.max(0, lineGross - disc) + tax;
  };

  const totals = useMemo(() => {
    const subtotal = form.items.reduce((s, it) => s + computeSubtotal(it), 0);
    const discount = toNum(form.discount) || 0;
    const tax = toNum(form.tax) || 0;
    const addCost = toNum(form.additional_cost) || 0;
    const total = Math.max(0, subtotal - discount) + tax + addCost;
    return { subtotal, total };
  }, [form.items, form.discount, form.tax, form.additional_cost]);

  // recompute base_quantity on the fly
  const recalcItem = (it) => {
    const qty = toNum(it.quantity);
    const cf = toNum(it.conversion_factor) ?? 1;
    return { ...it, base_quantity: (qty === null ? '' : String(qty * cf)) };
  };

  const refreshMasters = useCallback(async () => {
    try {
      const [mats, prods] = await Promise.all([
        base44.entities.Material.filter({ is_active: true }, '-created_date', 500),
        base44.entities.Product.filter({ is_active: true }, '-created_date', 500),
      ]);
      setMaterials(mats);
      setProducts(prods);
    } catch { /* silent; keep existing list */ }
  }, []);

  const openAdd = () => {
    setEditing(null);
    setForm({
      supplier_invoice_number: '', purchase_date: new Date().toISOString().slice(0, 10),
      supplier_id: '', supplier_name: '', warehouse_id: '', warehouse_name: '',
      payment_method: 'cash', payment_terms: '', due_date: '',
      discount: '', tax: '', additional_cost: '', notes: '',
      items: [emptyItem()],
    });
    setModalOpen(true);
    refreshMasters();
  };

  const openEdit = async (row) => {
    setEditing(row);
    const items = await base44.entities.PurchaseItem.filter({ purchase_id: row.id });
    setForm({
      supplier_invoice_number: row.supplier_invoice_number || '',
      purchase_date: row.purchase_date || new Date().toISOString().slice(0, 10),
      supplier_id: row.supplier_id || '', supplier_name: row.supplier_name || '',
      warehouse_id: row.warehouse_id || '', warehouse_name: row.warehouse_name || '',
      payment_method: row.payment_method || 'cash',
      payment_terms: row.payment_terms ?? '',
      due_date: row.due_date || '',
      discount: row.discount ?? '', tax: row.tax ?? '',
      additional_cost: row.additional_cost ?? '', notes: row.notes || '',
      items: (items.length ? items : [emptyItem()]).map(it => ({
        item_type: it.item_type, item_id: it.item_id, item_code: it.item_code, item_name: it.item_name,
        category_name: it.category_name || '', batch_supplier: it.batch_supplier || '', lot_number: it.lot_number || '',
        production_date: it.production_date || '', expiry_date: it.expiry_date || '',
        quantity: it.quantity ?? '', unit: it.unit || '', conversion_factor: it.conversion_factor ?? '1',
        base_unit: it.base_unit || '', base_quantity: it.base_quantity ?? '',
        unit_price: it.unit_price ?? '', discount: it.discount ?? '', tax: it.tax ?? '',
        subtotal: it.subtotal ?? '', notes: it.notes || '',
      })),
    });
    setModalOpen(true);
    refreshMasters();
    };

    const onSupplierChange = (v) => {
    const sup = suppliers.find(s => s.id === v);
    setForm(prev => ({ ...prev, supplier_id: v, supplier_name: sup?.name || '', payment_terms: prev.payment_terms || '' }));
  };

  const onWarehouseChange = (v) => {
    const wh = warehouses.find(w => w.id === v);
    setForm(prev => ({ ...prev, warehouse_id: v, warehouse_name: wh?.name || '' }));
  };

  const onPaymentMethod = (v) => {
    setForm(prev => {
      const next = { ...prev, payment_method: v };
      if (v === 'tempo') {
        const terms = toNum(prev.payment_terms);
        const days = terms && terms > 0 ? terms : 30;
        const due = new Date(prev.purchase_date || new Date());
        due.setDate(due.getDate() + days);
        next.payment_terms = String(days);
        next.due_date = due.toISOString().slice(0, 10);
      } else {
        next.due_date = '';
      }
      return next;
    });
  };

  const onPurchaseDate = (d) => {
    setForm(prev => {
      if (prev.payment_method !== 'tempo') return { ...prev, purchase_date: d };
      const days = toNum(prev.payment_terms) || 30;
      const due = new Date(d); due.setDate(due.getDate() + days);
      return { ...prev, purchase_date: d, due_date: due.toISOString().slice(0, 10) };
    });
  };

  const onTermsChange = (val) => {
    setForm(prev => {
      const days = toNum(val) || 0;
      const due = new Date(prev.purchase_date || new Date());
      due.setDate(due.getDate() + days);
      return { ...prev, payment_terms: val, due_date: due.toISOString().slice(0, 10) };
    });
  };

  const updateItem = (idx, patch) => {
    setForm(prev => {
      const items = [...prev.items];
      items[idx] = recalcItem({ ...items[idx], ...patch });
      items[idx].subtotal = computeSubtotal(items[idx]);
      return { ...prev, items };
    });
  };

  const onSelectItem = (idx, id) => {
    const master = getMaster(id);
    const isProduct = master?._kind === 'product';
    const itemType = isProduct ? deriveProductItemType(master?.product_type) : deriveItemType(master?.material_type);
    const snap = snapshotItem(itemType, master);
    const unit = itemType === 'material' ? 'GRAM' : 'PCS';
    updateItem(idx, { item_type: itemType, item_id: id, ...snap, unit, ...unitProps(unit) });
  };

  const onUnitChange = (idx, unit) => {
    updateItem(idx, { unit, ...unitProps(unit) });
  };

  const addItemRow = () => setForm(prev => ({ ...prev, items: [...prev.items, emptyItem()] }));
  const duplicateRow = (idx) => setForm(prev => ({ ...prev, items: [...prev.items, { ...prev.items[idx] }] }));
  const removeItemRow = (idx) => setForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!form.supplier_id) { toast({ type: 'warning', title: 'Supplier wajib dipilih' }); return; }
    if (!form.warehouse_id) { toast({ type: 'warning', title: 'Gudang tujuan wajib dipilih' }); return; }
    const validItems = form.items.filter(it => it.item_type && it.item_id && toNum(it.quantity) > 0 && it.unit);
    if (validItems.length === 0) { toast({ type: 'warning', title: 'Minimal satu item lengkap (jenis, item, qty > 0, unit)' }); return; }
    for (const it of validItems) {
      if (toNum(it.unit_price) === null || toNum(it.unit_price) < 0) { toast({ type: 'warning', title: `Harga ${it.item_name} tidak valid` }); return; }
    }
    const itemIds = validItems.map(i => i.item_id);
    if (new Set(itemIds).size !== itemIds.length) { toast({ type: 'warning', title: 'Ada item duplikat', description: 'Gabungkan quantity atau hapus baris ganda' }); return; }
    setSubmitting(true);
    try {
      const payload = {
        supplier_invoice_number: form.supplier_invoice_number,
        purchase_date: form.purchase_date,
        supplier_id: form.supplier_id, supplier_name: form.supplier_name,
        warehouse_id: form.warehouse_id, warehouse_name: form.warehouse_name,
        payment_method: form.payment_method,
        payment_terms: toNum(form.payment_terms) ?? 0,
        due_date: form.due_date || null,
        subtotal: totals.subtotal,
        discount: toNum(form.discount) ?? 0,
        tax: toNum(form.tax) ?? 0,
        additional_cost: toNum(form.additional_cost) ?? 0,
        total: totals.total,
        total_paid: 0,
        remaining_payable: form.payment_method === 'tempo' ? totals.total : 0,
        purchase_status: 'draft',
        payment_status: 'belum_dibayar',
        notes: form.notes,
      };
      let purchaseId;
      let purchaseNumber;
      if (editing) {
        purchaseId = editing.id;
        purchaseNumber = editing.purchase_number;
        await base44.entities.Purchase.update(editing.id, payload);
        // Replace items
        const oldItems = await base44.entities.PurchaseItem.filter({ purchase_id: editing.id });
        await Promise.all(oldItems.map(it => base44.entities.PurchaseItem.delete(it.id)));
      } else {
        purchaseNumber = await generatePurchaseNumber();
        const created = await base44.entities.Purchase.create({ ...payload, purchase_number: purchaseNumber });
        purchaseId = created.id;
      }
      await base44.entities.PurchaseItem.bulkCreate(
        validItems.map(it => {
          const qty = toNum(it.quantity) || 0;
          const cf = toNum(it.conversion_factor) || 1;
          return {
            purchase_id: purchaseId,
            item_type: it.item_type, item_id: it.item_id,
            item_code: it.item_code, item_name: it.item_name, category_name: it.category_name,
            batch_supplier: it.batch_supplier, lot_number: it.lot_number,
            production_date: it.production_date || null, expiry_date: it.expiry_date || null,
            quantity: qty, unit: it.unit, conversion_factor: cf,
            base_unit: it.base_unit, base_quantity: qty * cf,
            unit_price: toNum(it.unit_price) || 0,
            discount: toNum(it.discount) ?? 0, tax: toNum(it.tax) ?? 0,
            subtotal: computeSubtotal(it),
            warehouse_id: form.warehouse_id, warehouse_name: form.warehouse_name,
            notes: it.notes,
          };
        })
      );
      toast({ type: 'success', title: editing ? 'Pembelian diperbarui' : 'Pembelian dibuat', description: purchaseNumber });
      setModalOpen(false);
      loadData();
    } catch (e2) { toast({ type: 'error', title: 'Gagal menyimpan', description: e2.message }); }
    finally { setSubmitting(false); }
  };

  const handlePost = async (row) => {
    if (!row?.id) return;

    if (postingId === row.id) {
      toast({
        type: 'warning',
        title: 'Posting sedang diproses',
        description: `${row.purchase_number} masih diproses. Tunggu sampai selesai.`,
      });
      return;
    }

    if (postingId) {
      toast({
        type: 'warning',
        title: 'Ada posting yang sedang diproses',
        description: 'Tunggu posting pembelian sebelumnya selesai.',
      });
      return;
    }

    if (!confirm(`Posting pembelian ${row.purchase_number}? Stok akan bertambah dan tidak dapat diubah.`)) return;

    if (row.purchase_status !== 'draft') {
      toast({
        type: 'warning',
        title: 'Pembelian tidak dapat diposting',
        description: 'Status pembelian bukan Draft.',
      });
      return;
    }

    setPostingId(row.id);

    try {
      await postPurchase(row.id);

      toast({
        type: 'success',
        title: 'Pembelian diposting',
        description: row.purchase_number,
      });

      await loadData();
    } catch (e) {
      toast({
        type: 'error',
        title: 'Gagal posting',
        description: e.message,
      });
    } finally {
      setPostingId(null);
    }
  };

  const handleCancel = async (row) => {
    const reason = prompt(`Alasan pembatalan ${row.purchase_number}:`);
    if (reason === null) return;
    try {
      await cancelPurchase(row.id, reason || 'tanpa alasan');
      toast({ type: 'success', title: 'Pembelian dibatalkan', description: row.purchase_number });
      loadData();
    } catch (e) { toast({ type: 'error', title: 'Gagal membatalkan', description: e.message }); }
  };

  const openDetail = async (row) => {
    setDetailItem(row);
    const items = await base44.entities.PurchaseItem.filter({ purchase_id: row.id });
    setDetailItems(items);
  };

  const exportPurchasePDF = async (row) => {
    try {
      const items = await base44.entities.PurchaseItem.filter({ purchase_id: row.id });
      const sup = suppliers.find(s => s.id === row.supplier_id);
      exportDocumentToPDF({
        title: 'Purchase Order',
        docNumber: row.purchase_number, docDate: row.purchase_date,
        partyLabel: 'Supplier', party: { name: row.supplier_name, address: [sup?.city || ''].filter(Boolean), phone: sup?.phone || '' },
        infoLines: [
          { label: 'Inv. Supplier', value: row.supplier_invoice_number || '-' },
          { label: 'Gudang', value: row.warehouse_name || '-' },
          { label: 'Metode', value: pmLabel(row.payment_method) },
          { label: 'Jatuh Tempo', value: row.due_date || '-' },
          { label: 'Status', value: row.purchase_status },
        ],
        itemColumns: [
          { key: 'no', header: '#', width: 22, align: 'right' },
          { key: 'item_name', header: 'Item' },
          { key: 'item_type', header: 'Jenis', width: 70, align: 'center' },
          { key: 'quantity', header: 'Qty', width: 50, align: 'right' },
          { key: 'unit', header: 'Sat', width: 40 },
          { key: 'unit_price', header: 'Harga', width: 80, align: 'right' },
          { key: 'subtotal', header: 'Subtotal', width: 90, align: 'right' },
        ],
        itemRows: items.map((it, i) => ({
          no: i + 1, item_name: it.item_name, item_type: itLabel(it.item_type),
          quantity: it.quantity, unit: it.unit || '', unit_price: fmtMoney(it.unit_price), subtotal: fmtMoney(it.subtotal),
        })),
        totals: [
          { label: 'Subtotal', value: fmtMoney(row.subtotal) },
          ...(row.discount ? [{ label: 'Diskon', value: fmtMoney(row.discount) }] : []),
          ...(row.tax ? [{ label: 'Pajak', value: fmtMoney(row.tax) }] : []),
          ...(row.additional_cost ? [{ label: 'Biaya Tambahan', value: fmtMoney(row.additional_cost) }] : []),
          { label: 'Total', value: fmtMoney(row.total), bold: true },
        ],
        notes: row.notes,
        signatures: [{ label: 'Dibuat oleh,', name: row.created_by || '' }, { label: 'Disetujui oleh,', name: row.posted_by || '' }],
        fileName: `po-${row.purchase_number}.pdf`,
      });
    } catch { toast({ type: 'error', title: 'Gagal membuat PDF' }); }
  };

  const handleExport = () => {
    const rows = filteredData.map(r => ({
      'No Pembelian': r.purchase_number, 'Tanggal': r.purchase_date, 'Supplier': r.supplier_name,
      'Invoice Supplier': r.supplier_invoice_number || '', 'Jumlah Item': r.item_count || 0,
      'Total': r.total || 0, 'Metode': pmLabel(r.payment_method), 'Jatuh Tempo': r.due_date || '',
      'Status': r.purchase_status, 'Pembayaran': r.payment_status,
    }));
    const headers = Object.keys(rows[0] || {});
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `pembelian-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ type: 'success', title: 'Export berhasil' });
  };

  const filteredData = useMemo(() => {
    return data.filter(r => {
      if (filters.supplier !== 'all' && r.supplier_id !== filters.supplier) return false;
      if (filters.payment_method !== 'all' && r.payment_method !== filters.payment_method) return false;
      if (filters.status !== 'all' && r.purchase_status !== filters.status) return false;
      return true;
    });
  }, [data, filters]);

  const columns = [
    { key: 'purchase_number', header: 'No. Pembelian', sortable: true, className: 'font-mono font-medium' },
    { key: 'purchase_date', header: 'Tanggal', sortable: true },
    { key: 'supplier_name', header: 'Supplier', sortable: true, className: 'font-medium' },
    { key: 'supplier_invoice_number', header: 'Inv. Supplier', render: (r) => r.supplier_invoice_number || '—' },
    { key: 'total', header: 'Total', sortable: true, render: (r) => <span className="tabular-nums">{fmtMoney(r.total)}</span> },
    { key: 'payment_method', header: 'Metode', render: (r) => <span className="text-[11px] px-2 py-0.5 bg-muted rounded">{pmLabel(r.payment_method)}</span> },
    { key: 'due_date', header: 'Jatuh Tempo', render: (r) => r.due_date || '—' },
    { key: 'purchase_status', header: 'Status', render: (r) => <StatusBadge status={r.purchase_status} /> },
    { key: 'payment_status', header: 'Pembayaran', render: (r) => <StatusBadge status={r.payment_status} /> },
    {
      key: 'actions', header: '', width: '150px',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button onClick={() => openDetail(row)} className="p-1.5 hover:bg-muted rounded" title="Detail"><Eye className="w-3.5 h-3.5" /></button>
          <PdfButton onExport={() => exportPurchasePDF(row)} perm="purchases" iconOnly label="Cetak PDF" />
          {row.purchase_status === 'draft' && (
            <>
              <button onClick={() => openEdit(row)} className="p-1.5 hover:bg-muted rounded" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
              <button
                onClick={() => handlePost(row)}
                disabled={!!postingId}
                className={`p-1.5 rounded text-emerald-600 ${
                  postingId
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:bg-emerald-50'
                }`}
                title={postingId === row.id ? 'Sedang posting...' : 'Posting'}
              >
                <CheckCircle2 className={`w-3.5 h-3.5 ${postingId === row.id ? 'animate-pulse' : ''}`} />
              </button>
            </>
          )}
          {(row.purchase_status === 'draft' || row.purchase_status === 'posted') && (
            <button onClick={() => handleCancel(row)} className="p-1.5 hover:bg-red-50 rounded text-red-500" title="Batal"><XCircle className="w-3.5 h-3.5" /></button>
          )}
        </div>
      )
    },
  ];

  const detailColumns = [
    { key: 'item_code', header: 'Kode', className: 'font-mono' },
    { key: 'item_name', header: 'Nama Item', className: 'font-medium' },
    { key: 'item_type', header: 'Jenis', render: (r) => <span className="text-[10.5px] px-1.5 py-0.5 bg-muted rounded">{itLabel(r.item_type)}</span> },
    { key: 'quantity', header: 'Qty Beli', render: (r) => `${r.quantity} ${r.unit || ''}` },
    { key: 'conversion_factor', header: 'Konversi', render: (r) => `x ${r.conversion_factor || 1}` },
    { key: 'base_quantity', header: 'Qty Dasar', render: (r) => `${r.base_quantity} ${r.base_unit || ''}` },
    { key: 'unit_price', header: 'Harga', render: (r) => fmtMoney(r.unit_price) },
    { key: 'batch_supplier', header: 'Batch', render: (r) => r.batch_supplier || '—' },
    { key: 'expiry_date', header: 'Exp', render: (r) => r.expiry_date || '—' },
    { key: 'subtotal', header: 'Subtotal', render: (r) => fmtMoney(r.subtotal) },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Pembelian" description="Pencatatan pembelian bahan, kemasan, label, dan barang pendukung"
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={handleExport} size="sm" variant="outline" className="gap-1.5"><Download className="w-4 h-4" /> Export</Button>
            <Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Pembelian Baru</Button>
          </div>
        } />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 mb-3">
        <Select value={filters.supplier} onValueChange={v => setFilters(f => ({ ...f, supplier: v }))}>
          <SelectTrigger className="h-8 w-full sm:w-48 text-[12px]"><SelectValue placeholder="Semua Supplier" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Supplier</SelectItem>
            {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.payment_method} onValueChange={v => setFilters(f => ({ ...f, payment_method: v }))}>
          <SelectTrigger className="h-8 w-full sm:w-36 text-[12px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Metode</SelectItem>
            {paymentMethods.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={v => setFilters(f => ({ ...f, status: v }))}>
          <SelectTrigger className="h-8 w-full sm:w-40 text-[12px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="posted">Posted</SelectItem>
            <SelectItem value="received">Diterima</SelectItem>
            <SelectItem value="cancelled">Dibatalkan</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable columns={columns} data={filteredData} loading={loading} emptyMessage="Belum ada pembelian" searchKeys={['purchase_number', 'supplier_name', 'supplier_invoice_number']} searchPlaceholder="Cari pembelian..." />

      {/* Form modal */}
      <FormModal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Pembelian' : 'Pembelian Baru'} onSubmit={handleSubmit} submitting={submitting} size="xl" submitLabel="Simpan Draft">
        {/* Header fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-[12.5px] mb-1">Supplier *</Label>
            <Select value={form.supplier_id} onValueChange={onSupplierChange}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih supplier" /></SelectTrigger>
              <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-[12.5px] mb-1">Tanggal Pembelian *</Label><Input type="date" value={form.purchase_date} onChange={e => onPurchaseDate(e.target.value)} className="h-9 text-[13px]" /></div>
          <div>
            <Label className="text-[12.5px] mb-1">Gudang Tujuan *</Label>
            <Select value={form.warehouse_id} onValueChange={onWarehouseChange}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih gudang" /></SelectTrigger>
              <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[12.5px] mb-1">Metode Pembayaran</Label>
            <Select value={form.payment_method} onValueChange={onPaymentMethod}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>{paymentMethods.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-[12.5px] mb-1">No. Invoice Supplier</Label><Input value={form.supplier_invoice_number} onChange={e => setForm({ ...form, supplier_invoice_number: e.target.value })} className="h-9 text-[13px]" /></div>
          {form.payment_method === 'tempo' && (
            <>
              <div><Label className="text-[12.5px] mb-1">Termin (hari)</Label><NumberInput value={form.payment_terms} onChange={v => onTermsChange(v)} allowDecimal={false} min={0} className="h-9 text-[13px]" /></div>
              <div><Label className="text-[12.5px] mb-1">Jatuh Tempo</Label><Input type="date" value={form.due_date} disabled className="h-9 text-[13px] bg-muted/40" /></div>
            </>
          )}
        </div>

        {/* Items */}
        <div className="pt-2">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-[12.5px] font-semibold">Item Pembelian</Label>
            <Button type="button" size="sm" variant="outline" onClick={addItemRow} className="gap-1.5 h-7 text-[12px]"><Plus className="w-3.5 h-3.5" /> Tambah Baris</Button>
          </div>
          {/* Mobile item cards */}
          <div className="md:hidden space-y-3">
            {form.items.map((it, idx) => (
              <div key={idx} className="border border-border rounded-lg p-3 bg-muted/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10.5px] font-semibold text-muted-foreground">ITEM {idx + 1}</span>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => duplicateRow(idx)} className="p-1 hover:bg-muted rounded" title="Duplikasi"><Plus className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => removeItemRow(idx)} className="p-1 hover:bg-red-50 rounded text-red-500" title="Hapus"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                <div className="space-y-2">
                  <div>
                    <Label className="text-[11.5px] mb-1">Item (cari nama / kode / kategori)</Label>
                    <SearchableSelect
                      value={it.item_id}
                      onValueChange={v => onSelectItem(idx, v)}
                      placeholder="Pilih barang / bahan"
                      options={masterOptions}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-[11.5px] mb-1">Qty</Label><NumberInput value={it.quantity} onChange={v => updateItem(idx, { quantity: v })} allowDecimal min={0} className="h-9 text-[13px]" /></div>
                    <div>
                      <Label className="text-[11.5px] mb-1">Unit</Label>
                      <Select value={it.unit} onValueChange={v => onUnitChange(idx, v)}>
                        <SelectTrigger className="h-9 text-[13px] w-full"><SelectValue placeholder="Pilih unit" /></SelectTrigger>
                        <SelectContent>{UNIT_OPTIONS.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-[11.5px] mb-1">Harga</Label><NumberInput value={it.unit_price} onChange={v => updateItem(idx, { unit_price: v })} allowDecimal min={0} className="h-9 text-[13px]" /></div>
                    <div><Label className="text-[11.5px] mb-1">Diskon</Label><NumberInput value={it.discount} onChange={v => updateItem(idx, { discount: v })} allowDecimal min={0} className="h-9 text-[13px]" /></div>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-border/50">
                    <span className="text-[11.5px] text-muted-foreground">Subtotal</span>
                    <span className="text-[13px] font-medium tabular-nums">{fmtMoney(computeSubtotal(it))}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* Desktop item table */}
          <div className="hidden md:block border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-[12px]">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-semibold">Item</th>
                <th className="px-2 py-1.5 text-right font-semibold">Qty</th>
                <th className="px-2 py-1.5 text-left font-semibold">Unit</th>
                <th className="px-2 py-1.5 text-right font-semibold">Qty Dasar</th>
                <th className="px-2 py-1.5 text-right font-semibold">Harga</th>
                <th className="px-2 py-1.5 text-right font-semibold">Diskon</th>
                <th className="px-2 py-1.5 text-right font-semibold">Subtotal</th>
                <th className="px-2 py-1.5 text-center font-semibold w-16">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {form.items.map((it, idx) => (
                <tr key={idx} className="border-t border-border/50 align-top">
                  <td className="px-1 py-1 min-w-[200px]">
                    <SearchableSelect
                      value={it.item_id}
                      onValueChange={v => onSelectItem(idx, v)}
                      placeholder="Pilih barang / bahan"
                      options={masterOptions}
                      className="h-8 text-[11.5px]"
                    />
                  </td>
                    <td className="px-1 py-1"><NumberInput value={it.quantity} onChange={v => updateItem(idx, { quantity: v })} allowDecimal min={0} className="h-8 w-16 text-right text-[11.5px]" /></td>
                    <td className="px-1 py-1">
                      <Select value={it.unit} onValueChange={v => onUnitChange(idx, v)}>
                        <SelectTrigger className="h-8 w-20 text-[11.5px]"><SelectValue placeholder="Pilih" /></SelectTrigger>
                        <SelectContent>{UNIT_OPTIONS.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="px-1 py-1 text-right tabular-nums text-[11.5px] text-muted-foreground">{(() => { const q = toNum(it.quantity); const c = toNum(it.conversion_factor) || 1; return q === null ? '—' : (q * c); })()}</td>
                    <td className="px-1 py-1"><NumberInput value={it.unit_price} onChange={v => updateItem(idx, { unit_price: v })} allowDecimal min={0} className="h-8 w-24 text-right text-[11.5px]" /></td>
                    <td className="px-1 py-1"><NumberInput value={it.discount} onChange={v => updateItem(idx, { discount: v })} allowDecimal min={0} className="h-8 w-20 text-right text-[11.5px]" /></td>
                    <td className="px-1 py-1 text-right tabular-nums font-medium text-[11.5px]">{fmtMoney(computeSubtotal(it))}</td>
                    <td className="px-1 py-1">
                      <div className="flex items-center justify-center gap-0.5">
                        <button type="button" onClick={() => duplicateRow(idx)} className="p-1 hover:bg-muted rounded" title="Duplikasi"><Plus className="w-3 h-3" /></button>
                        <button type="button" onClick={() => removeItemRow(idx)} className="p-1 hover:bg-red-50 rounded text-red-500" title="Hapus"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totals */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-border">
          <div><Label className="text-[12.5px] mb-1">Subtotal</Label><div className="text-[13px] font-semibold tabular-nums">{fmtMoney(totals.subtotal)}</div></div>
          <div><Label className="text-[12.5px] mb-1">Diskon Total</Label><NumberInput value={form.discount} onChange={v => setForm({ ...form, discount: v })} allowDecimal min={0} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Pajak</Label><NumberInput value={form.tax} onChange={v => setForm({ ...form, tax: v })} allowDecimal min={0} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Biaya Tambahan</Label><NumberInput value={form.additional_cost} onChange={v => setForm({ ...form, additional_cost: v })} allowDecimal min={0} className="h-9 text-[13px]" /></div>
        </div>
        <div className="flex items-center justify-between pt-2">
          <div className="text-[12.5px] text-muted-foreground">Grand Total</div>
          <div className="text-[16px] font-bold tabular-nums">{fmtMoney(totals.total)}</div>
        </div>
        <div><Label className="text-[12.5px] mb-1">Catatan</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="text-[13px]" /></div>
      </FormModal>

      {/* Detail modal */}
      <FormModal open={!!detailItem} onClose={() => setDetailItem(null)} title={detailItem ? `Detail ${detailItem.purchase_number}` : ''} onSubmit={() => setDetailItem(null)} submitLabel="Tutup">
        {detailItem && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-[12.5px]">
              <div><span className="text-muted-foreground">Supplier</span><div className="font-medium">{detailItem.supplier_name}</div></div>
              <div><span className="text-muted-foreground">Tanggal</span><div>{detailItem.purchase_date}</div></div>
              <div><span className="text-muted-foreground">Invoice Supplier</span><div>{detailItem.supplier_invoice_number || '—'}</div></div>
              <div><span className="text-muted-foreground">Gudang</span><div>{detailItem.warehouse_name}</div></div>
              <div><span className="text-muted-foreground">Metode</span><div>{pmLabel(detailItem.payment_method)}</div></div>
              <div><span className="text-muted-foreground">Jatuh Tempo</span><div>{detailItem.due_date || '—'}</div></div>
              <div><span className="text-muted-foreground">Status</span><div><StatusBadge status={detailItem.purchase_status} /></div></div>
              <div><span className="text-muted-foreground">Pembayaran</span><div><StatusBadge status={detailItem.payment_status} /></div></div>
              <div><span className="text-muted-foreground">Diposting oleh</span><div>{detailItem.posted_by || '—'}</div></div>
            </div>
            <DataTable columns={detailColumns} data={detailItems} searchable={false} pageSize={50} emptyMessage="Tidak ada item" />
            <div className="flex items-center justify-between border-t border-border pt-3">
              <div className="text-[12.5px] text-muted-foreground">Grand Total</div>
              <div className="text-[16px] font-bold tabular-nums">{fmtMoney(detailItem.total)}</div>
            </div>
            {detailItem.notes && <div className="text-[12px] text-muted-foreground bg-muted/30 rounded p-2"><span className="font-medium">Catatan: </span>{detailItem.notes}</div>}
          </div>
        )}
      </FormModal>
    </div>
  );
}