import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import FormModal from '@/components/FormModal';
import SearchableSelect from '@/components/SearchableSelect';
import NumberInput from '@/components/NumberInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Plus, DatabaseZap } from 'lucide-react';
import PdfButton from '@/components/PdfButton';
import { exportReportToPDF } from '@/lib/pdfExport';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/permissions';
import { STAGE_LABEL, getInventoryDisplayName } from '@/lib/inventoryDisplay';
import { loadInventoryCostContext, resolveBalanceUnitCost } from '@/lib/inventoryCost';
import { formatCurrency as fmtMoney } from '@/lib/format';
import { recordStockMovement, createAuditLog } from '@/lib/stockUtils';
const transactionTypeLabels = {
  opening_balance: 'Opening Balance',
  purchase_receipt: 'Purchase Receipt',
  production_consumption: 'Production Consumption',
  production_output: 'Production Output',
  production_waste: 'Production Waste',
  bottling_consumption: 'Bottling Consumption',
  bottling_bottle_consumption: 'Bottle Consumption',
  bottling_output: 'Bottling Output',
  bottling_waste: 'Bottling Waste',
  labeling_consumption: 'Labeling Consumption',
  label_consumption: 'Label Consumption',
  labeling_output: 'Labeling Output',
  labeling_waste: 'Labeling Waste',
  excise_consumption: 'Excise Consumption',
  excise_output: 'Excise Output',
  sales: 'Sales',
  sales_return: 'Sales Return',
  production_reversal: 'Production Reversal',
  bottling_reversal: 'Bottling Reversal',
  labeling_reversal: 'Labeling Reversal',
  excise_reversal: 'Excise Reversal',
  sales_reversal: 'Sales Reversal',
  stock_adjustment: 'Stock Adjustment',
  transfer_gudang: 'Transfer Gudang',
  premix_consumption: 'Premix Consumption',
  premix_output: 'Premix Output',
  premix_waste: 'Premix Waste',
  premix_reversal: 'Premix Reversal',
};
const adjustmentReasons = [
  'Stock Opname',
  'Barang Rusak',
  'Barang Hilang',
  'Salah Input',
  'Selisih Fisik',
  'Retur / Internal Adjustment',
  'Lainnya',
];
const openingStagesByType = {
  material: [
    { value: 'RAW_MATERIAL', label: 'Bahan Baku' },
    { value: 'PREMIX', label: 'Premix' },
  ],
  product: [
    { value: 'BULK', label: 'Bulk (Produksi)' },
    { value: 'READY_FOR_LABELING', label: 'Siap Labeling' },
    { value: 'UNEXCISED', label: 'Belum Cukai' },
    { value: 'READY_FOR_SALE', label: 'Siap Jual' },
  ],
};
const emptyAdjustment = (operator = '') => ({
  balance_id: '',
  adjustment_type: 'increase',
  quantity: '',
  reason: '',
  notes: '',
  operator,
});
const emptyOpening = (operator = '') => ({
  item_type: 'product',
  item_id: '',
  inventory_status: 'READY_FOR_SALE',
  warehouse_id: '',
  quantity: '',
  unit_cost: '',
  batch_number: '',
  notes: '',
  operator,
});
const pad2 = n => String(n).padStart(2, '0');
const makeAdjustmentNumber = () => {
  const d = new Date();
  return `ADJ-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
};
const makeOpeningNumber = () => {
  const d = new Date();
  return `OPEN-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
};

const ledgerDate = row => row?.transaction_date || row?.created_date || '';

const sortLedgerAscending = (a, b) => {
  const byDate = ledgerDate(a).localeCompare(ledgerDate(b));
  if (byDate !== 0) return byDate;
  return (a?.created_date || a?.id || '').localeCompare(b?.created_date || b?.id || '');
};

const sortLedgerDescending = (a, b) => sortLedgerAscending(b, a);

const loadStockLedgerHistory = async () => {
  const pageSize = 500;
  const maxPages = 20; // Safety cap: at most 10,000 ledger rows in the browser.
  const rows = [];
  const seen = new Set();

  const loadBy = async orderBy => {
    for (let page = 0; page < maxPages; page += 1) {
      const batch = await base44.entities.StockLedger.list(orderBy, pageSize, page * pageSize);
      if (!Array.isArray(batch) || batch.length === 0) break;

      let added = 0;
      batch.forEach((row, index) => {
        const key = row.id || [
          row.transaction_number,
          row.item_id,
          row.inventory_status,
          row.transaction_date,
          row.created_date,
          page,
          index,
        ].join('|');
        if (seen.has(key)) return;
        seen.add(key);
        rows.push(row);
        added += 1;
      });

      if (batch.length < pageSize || added === 0) break;
    }
  };

  try {
    await loadBy('-transaction_date');
  } catch {
    // Compatibility fallback for deployments where transaction_date cannot be
    // used as a server-side ordering field.
    rows.length = 0;
    seen.clear();
    await loadBy('-created_date');
  }

  return rows.sort(sortLedgerDescending);
};
export default function StockCard() {
  const { toast } = useToast();
  const { user } = useAuth();
  // SECURITY: HPP/Nominal hanya boleh terlihat oleh Admin atau user dengan permission HPP view.
  const canViewHpp = user?.role === 'admin' || hasPermission(user, 'hpp', 'view');
  const [data, setData] = useState([]);
  const [balances, setBalances] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [products, setProducts] = useState([]);
  const [materialById, setMaterialById] = useState({});
  const [stageCostIndex, setStageCostIndex] = useState({});
  const [loading, setLoading] = useState(true);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);
  const [adjustForm, setAdjustForm] = useState(emptyAdjustment());
  const [openingOpen, setOpeningOpen] = useState(false);
  const [openingSubmitting, setOpeningSubmitting] = useState(false);
  const [openingForm, setOpeningForm] = useState(emptyOpening());
  const [filters, setFilters] = useState({
    item_type: '',
    transaction_type: '',
    inventory_status: '',
    warehouse_id: '',
    item_name: '',
    date_from: '',
    date_to: '',
  });
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [items, bals, whs, mats, prods, ctx] = await Promise.all([
        loadStockLedgerHistory(),
        base44.entities.StockBalance.list('-updated_date', 2000),
        base44.entities.Warehouse.filter({ is_active: true }).catch(() => []),
        base44.entities.Material.filter({ is_active: true }).catch(() => []),
        base44.entities.Product.filter({ is_active: true }).catch(() => []),
        loadInventoryCostContext().catch(() => null),
      ]);
      setData(items);
      setBalances(bals);
      setWarehouses(whs);
      setMaterials(mats);
      setProducts(prods);
      if (ctx) {
        setMaterialById(ctx.materialById);
        setStageCostIndex(ctx.stageCostIndex);
      }
    } catch {
      toast({
        variant: 'destructive',
        title: 'Gagal memuat data',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => {
    loadData();
  }, [loadData]);
  /* =========================================================
     KOREKSI STOK
     Tetap hanya untuk balance yang sudah ada dan > 0.
  ========================================================= */
  const selectableBalances = useMemo(
    () => balances.filter(b => b.item_id && Number(b.quantity) > 0),
    [balances]
  );
  const selectedBalance = useMemo(
    () => selectableBalances.find(b => b.id === adjustForm.balance_id) || null,
    [selectableBalances, adjustForm.balance_id]
  );
  const selectedUnitCost = useMemo(() => {
    if (!selectedBalance) return 0;
    const latestLedger = data.find(r =>
      r.item_id === selectedBalance.item_id &&
      (r.batch_id || '') === (selectedBalance.batch_id || '') &&
      (r.warehouse_id || '') === (selectedBalance.warehouse_id || '') &&
      (r.inventory_status || '') === (selectedBalance.inventory_status || '') &&
      Number(r.unit_cost) > 0
    );
    if (latestLedger) return Number(latestLedger.unit_cost) || 0;
    return resolveBalanceUnitCost(selectedBalance, {
      materialById,
      stageCostIndex,
    });
  }, [selectedBalance, data, materialById, stageCostIndex]);
  const openAdjustment = () => {
    setAdjustForm(emptyAdjustment(user?.full_name || user?.email || ''));
    setAdjustOpen(true);
  };
  const submitAdjustment = async () => {
    const balance = selectedBalance;
    const qty = Number(adjustForm.quantity) || 0;
    if (!balance) {
      toast({ variant: 'destructive', title: 'Pilih item/stok yang akan dikoreksi' });
      return;
    }
    if (qty <= 0) {
      toast({ variant: 'destructive', title: 'Qty koreksi harus lebih dari 0' });
      return;
    }
    if (!adjustForm.reason) {
      toast({ variant: 'destructive', title: 'Alasan koreksi wajib dipilih' });
      return;
    }
    if (adjustForm.reason === 'Lainnya' && !adjustForm.notes.trim()) {
      toast({ variant: 'destructive', title: 'Keterangan wajib diisi untuk alasan Lainnya' });
      return;
    }
    if (!adjustForm.operator.trim()) {
      toast({ variant: 'destructive', title: 'Operator wajib diisi' });
      return;
    }
    const isDecrease = adjustForm.adjustment_type === 'decrease';
    if (
      isDecrease &&
      qty > Number(balance.available_quantity ?? balance.quantity ?? 0)
    ) {
      toast({
        variant: 'destructive',
        title: 'Qty koreksi melebihi stok tersedia',
        description: `Tersedia: ${Number(balance.available_quantity ?? balance.quantity ?? 0)} ${balance.unit || ''}`,
      });
      return;
    }
    const adjustmentNumber = makeAdjustmentNumber();
    const note = [
      adjustForm.reason,
      adjustForm.notes.trim(),
      `Operator: ${adjustForm.operator.trim()}`,
    ].filter(Boolean).join(' · ');
    setAdjustSubmitting(true);
    try {
      await recordStockMovement({
        item_type: balance.item_type,
        item_id: balance.item_id,
        item_code: balance.item_code || '',
        item_name: balance.item_name,
        batch_id: balance.batch_id || '',
        batch_number: balance.batch_number || '',
        warehouse_id: balance.warehouse_id || '',
        warehouse_name: balance.warehouse_name || '',
        inventory_status: balance.inventory_status || '',
        quantity_in: isDecrease ? 0 : qty,
        quantity_out: isDecrease ? qty : 0,
        unit: balance.unit || '',
        unit_cost: selectedUnitCost,
        transaction_type: 'stock_adjustment',
        transaction_number: adjustmentNumber,
        reference_type: 'stock_adjustment',
        reference_id: balance.id,
        notes: note,
      });
      await createAuditLog({
        module: 'Kartu Stok',
        action: isDecrease ? 'Koreksi Kurang' : 'Koreksi Tambah',
        entity_type: 'StockBalance',
        entity_id: balance.id,
        reference_number: adjustmentNumber,
        reason: note,
        data_before: {
          quantity: Number(balance.quantity) || 0,
          available_quantity: Number(balance.available_quantity) || 0,
        },
        data_after: {
          delta: isDecrease ? -qty : qty,
          estimated_quantity: (Number(balance.quantity) || 0) + (isDecrease ? -qty : qty),
        },
      });
      toast({
        title: 'Koreksi stok berhasil',
        description: `${adjustmentNumber} · ${isDecrease ? '-' : '+'}${qty} ${balance.unit || ''}`,
      });
      setAdjustOpen(false);
      await loadData();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Koreksi stok gagal',
        description: e?.message || 'Terjadi kesalahan',
      });
    } finally {
      setAdjustSubmitting(false);
    }
  };
  /* =========================================================
     OPENING BALANCE / SALDO AWAL
     ADMIN ONLY.
     Untuk stok fisik yang sudah ada sebelum implementasi LAB PRO.
  ========================================================= */
  const openingItems = useMemo(() => {
    return openingForm.item_type === 'material' ? materials : products;
  }, [openingForm.item_type, materials, products]);
  const selectedOpeningItem = useMemo(
    () => openingItems.find(x => x.id === openingForm.item_id) || null,
    [openingItems, openingForm.item_id]
  );
  const selectedOpeningWarehouse = useMemo(
    () => warehouses.find(w => w.id === openingForm.warehouse_id) || null,
    [warehouses, openingForm.warehouse_id]
  );
  const openingStageOptions = openingStagesByType[openingForm.item_type] || [];
  const openingDuplicateBalance = useMemo(() => {
    if (!openingForm.item_id || !openingForm.warehouse_id || !openingForm.inventory_status) {
      return null;
    }
    const batch = openingForm.batch_number.trim();
    return balances.find(b => {
      if (b.item_id !== openingForm.item_id) return false;
      if ((b.warehouse_id || '') !== openingForm.warehouse_id) return false;
      const status = (!b.inventory_status && b.item_type === 'material') ? 'RAW_MATERIAL' : (b.inventory_status || '');
      if (status !== openingForm.inventory_status) return false;
      if (batch) {
        return ((b.batch_id || '') === batch || (b.batch_number || '') === batch);
      }
      return true;
    }) || null;
  }, [balances, openingForm.item_id, openingForm.warehouse_id, openingForm.inventory_status, openingForm.batch_number]);
  const openOpeningBalance = () => {
    setOpeningForm(emptyOpening(user?.full_name || user?.email || ''));
    setOpeningOpen(true);
  };
  const onOpeningItemTypeChange = value => {
    setOpeningForm(f => ({ ...f, item_type: value, item_id: '', inventory_status: value === 'material' ? 'RAW_MATERIAL' : 'READY_FOR_SALE', quantity: '', unit_cost: '', batch_number: '' }));
  };
  const submitOpeningBalance = async () => {
    if (user?.role !== 'admin') {
      toast({ variant: 'destructive', title: 'Opening Balance hanya dapat diposting Administrator' });
      return;
    }
    const item = selectedOpeningItem;
    const warehouse = selectedOpeningWarehouse;
    const qty = Number(openingForm.quantity) || 0;
    const unitCost = Number(openingForm.unit_cost) || 0;
    const batch = openingForm.batch_number.trim();
    if (!item) { toast({ variant: 'destructive', title: 'Pilih item untuk Saldo Awal' }); return; }
    if (!openingForm.inventory_status) { toast({ variant: 'destructive', title: 'Stage stok wajib dipilih' }); return; }
    if (!warehouse) { toast({ variant: 'destructive', title: 'Gudang wajib dipilih' }); return; }
    if (qty <= 0) { toast({ variant: 'destructive', title: 'Qty Saldo Awal harus lebih dari 0' }); return; }
    if (unitCost < 0) { toast({ variant: 'destructive', title: 'HPP/Unit tidak boleh negatif' }); return; }
    if (!openingForm.operator.trim()) { toast({ variant: 'destructive', title: 'Operator wajib diisi' }); return; }
    if (!openingForm.notes.trim()) { toast({ variant: 'destructive', title: 'Catatan Saldo Awal wajib diisi', description: 'Contoh: Stok existing sebelum implementasi LAB PRO.' }); return; }
    if (openingDuplicateBalance) {
      const existingQty = Number(openingDuplicateBalance.available_quantity ?? openingDuplicateBalance.quantity ?? 0);
      toast({ variant: 'destructive', title: 'Saldo Awal untuk kombinasi ini sudah memiliki StockBalance', description: `Stok sistem: ${existingQty} ${openingDuplicateBalance.unit || ''}. Gunakan Koreksi Stok bila stok tersebut memang sudah tercatat.` });
      return;
    }
    const openingNumber = makeOpeningNumber();
    const note = ['SALDO AWAL / OPENING BALANCE', openingForm.notes.trim(), `Operator: ${openingForm.operator.trim()}`].join(' · ');
    setOpeningSubmitting(true);
    try {
      const result = await recordStockMovement({ item_type: openingForm.item_type, item_id: item.id, item_code: item.code || '', item_name: item.name || '', batch_id: batch, batch_number: batch, warehouse_id: warehouse.id, warehouse_name: warehouse.name || '', inventory_status: openingForm.inventory_status, quantity_in: qty, quantity_out: 0, unit: item.unit || 'unit', unit_cost: unitCost, transaction_type: 'opening_balance', transaction_number: openingNumber, reference_type: 'opening_balance', reference_id: item.id, notes: note });
      await createAuditLog({ module: 'Kartu Stok', action: 'Opening Balance', entity_type: openingForm.item_type === 'product' ? 'Product' : 'Material', entity_id: item.id, reference_number: openingNumber, reason: openingForm.notes.trim(), data_before: { quantity: 0 }, data_after: { item_type: openingForm.item_type, item_id: item.id, item_name: item.name || '', inventory_status: openingForm.inventory_status, warehouse_id: warehouse.id, warehouse_name: warehouse.name || '', batch_number: batch, quantity: qty, unit: item.unit || 'unit', unit_cost: unitCost, stock_balance_id: result?.balance_id || '' } });
      toast({ title: 'Saldo Awal berhasil diposting', description: `${openingNumber} · ${item.name} · +${qty} ${item.unit || 'unit'} · HPP ${fmtMoney(unitCost)}` });
      setOpeningOpen(false);
      await loadData();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Posting Saldo Awal gagal', description: e?.message || 'Terjadi kesalahan' });
    } finally {
      setOpeningSubmitting(false);
    }
  };
  /* =========================================================
     FILTER / RUNNING BALANCE
  ========================================================= */
  const filtered = useMemo(() => {
    const rows = data.filter(item => {
      if (filters.item_type && item.item_type !== filters.item_type) return false;
      if (filters.transaction_type && item.transaction_type !== filters.transaction_type) return false;
      if (filters.inventory_status) {
        const norm = (!item.inventory_status && item.item_type === 'material') ? 'RAW_MATERIAL' : item.inventory_status;
        if (norm !== filters.inventory_status) return false;
      }
      if (filters.warehouse_id && item.warehouse_id !== filters.warehouse_id) return false;
      if (filters.item_name && !item.item_name?.toLowerCase().includes(filters.item_name.toLowerCase())) return false;
      if (filters.date_from && item.transaction_date?.slice(0, 10) < filters.date_from) return false;
      if (filters.date_to && item.transaction_date?.slice(0, 10) > filters.date_to) return false;
      return true;
    });
    const sorted = [...rows].sort(sortLedgerAscending);
    const running = {};
    const result = sorted.map(r => {
      const key = `${r.item_id}|${r.inventory_status || ''}`;
      const delta = (Number(r.quantity_in) || 0) - (Number(r.quantity_out) || 0);
      running[key] = (running[key] || 0) + delta;
      const unitCost = resolveBalanceUnitCost(r, { materialById, stageCostIndex });
      return { ...r, running_balance: running[key], unit_cost: unitCost, nominal: delta * unitCost };
    });
    return result.sort(sortLedgerDescending);
  }, [data, filters, materialById, stageCostIndex]);
  /* =========================================================
     EXPORT — SECURITY PATCH v3.6.1
     HPP/Unit dan Nominal wajib mengikuti permission HPP view.
     User tanpa hak HPP tidak mendapat field biaya di CSV/PDF.
  ========================================================= */
  const exportCSV = () => {
    const baseHeaders = [
      'Tanggal','No. Transaksi','Tipe','Item','Batch','Gudang',
      'Masuk','Keluar','Sisa','Satuan',
    ];
    const headers = canViewHpp
      ? [...baseHeaders, 'HPP/Unit', 'Nominal', 'Referensi', 'Keterangan']
      : [...baseHeaders, 'Referensi', 'Keterangan'];

    const rows = filtered.map(r => {
      const baseRow = [
        r.transaction_date?.slice(0, 19).replace('T', ' '),
        r.transaction_number || '',
        transactionTypeLabels[r.transaction_type] || r.transaction_type,
        r.item_name || '',
        r.batch_number || '',
        r.warehouse_name || '',
        r.quantity_in || 0,
        r.quantity_out || 0,
        r.running_balance ?? 0,
        r.unit || '',
      ];
      return canViewHpp
        ? [...baseRow, r.unit_cost || 0, r.nominal || 0, r.reference_number || '', r.notes || '']
        : [...baseRow, r.reference_number || '', r.notes || ''];
    });

    const csv = [headers, ...rows]
      .map(r => r.map(c => `\"${String(c ?? '').replace(/\"/g, '\"\"')}\"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kartu-stok-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Kartu stok diexport' });
  };
  const exportPDF = () => {
    const baseColumns = [
      { key: 'transaction_date', header: 'Tanggal' },
      { key: 'transaction_number', header: 'No. Transaksi' },
      { key: 'transaction_type', header: 'Tipe' },
      { key: 'item_name', header: 'Item' },
      { key: 'batch_number', header: 'Batch' },
      { key: 'warehouse_name', header: 'Gudang' },
      { key: 'quantity_in', header: 'Masuk', align: 'right' },
      { key: 'quantity_out', header: 'Keluar', align: 'right' },
      { key: 'running_balance', header: 'Sisa', align: 'right' },
      { key: 'unit', header: 'Satuan' },
    ];
    const reportColumns = canViewHpp
      ? [
          ...baseColumns,
          { key: 'unit_cost', header: 'HPP/Unit', align: 'right' },
          { key: 'nominal', header: 'Nominal', align: 'right' },
          { key: 'reference_number', header: 'Referensi' },
          { key: 'notes', header: 'Keterangan' },
        ]
      : [
          ...baseColumns,
          { key: 'reference_number', header: 'Referensi' },
          { key: 'notes', header: 'Keterangan' },
        ];

    const reportRows = filtered.map(r => {
      const row = {
        transaction_date: r.transaction_date?.slice(0, 19).replace('T', ' '),
        transaction_number: r.transaction_number || '',
        transaction_type: transactionTypeLabels[r.transaction_type] || r.transaction_type,
        item_name: r.item_name || '',
        batch_number: r.batch_number || '',
        warehouse_name: r.warehouse_name || '',
        quantity_in: r.quantity_in || '',
        quantity_out: r.quantity_out || '',
        running_balance: r.running_balance ?? 0,
        unit: r.unit || '',
        reference_number: r.reference_number || '',
        notes: r.notes || '',
      };
      if (canViewHpp) {
        row.unit_cost = r.unit_cost || 0;
        row.nominal = r.nominal || 0;
      }
      return row;
    });

    return exportReportToPDF({
      title: 'Kartu Stok',
      subtitle: `${filtered.length} mutasi`,
      meta: { printedBy: user?.full_name },
      columns: reportColumns,
      rows: reportRows,
      fileName: `kartu-stok-${Date.now()}.pdf`,
    });
  };
  /* =========================================================
     TABLE
  ========================================================= */
  const columns = [
    { key: 'transaction_date', header: 'Tanggal', sortable: true, render: row => row.transaction_date?.slice(0, 19).replace('T', ' ') },
    { key: 'transaction_number', header: 'No. Transaksi', className: 'font-mono' },
    { key: 'transaction_type', header: 'Tipe', render: row => <span className="text-[10.5px] px-1.5 py-0.5 bg-muted rounded">{transactionTypeLabels[row.transaction_type] || row.transaction_type}</span> },
    { key: 'item_name', header: 'Item', className: 'font-medium', render: row => row.item_type === 'product' ? getInventoryDisplayName(row.item_name, row.inventory_status) : (row.item_name || '—') },
    { key: 'inventory_status', header: 'Stage', render: row => row.inventory_status ? <span className="text-[10.5px] px-1.5 py-0.5 bg-muted rounded">{STAGE_LABEL[row.inventory_status] || row.inventory_status}</span> : '—' },
    { key: 'batch_number', header: 'Batch', className: 'font-mono', render: row => row.batch_number || '—' },
    { key: 'warehouse_name', header: 'Gudang', render: row => row.warehouse_name || '—' },
    { key: 'quantity_in', header: 'Masuk', render: row => row.quantity_in > 0 ? <span className="text-emerald-600 tabular-nums">+{row.quantity_in}</span> : '' },
    { key: 'quantity_out', header: 'Keluar', render: row => row.quantity_out > 0 ? <span className="text-red-600 tabular-nums">-{row.quantity_out}</span> : '' },
    { key: 'running_balance', header: 'Sisa', render: row => <span className="tabular-nums font-semibold text-foreground">{row.running_balance ?? 0}</span> },
    { key: 'unit', header: 'Satuan' },
    ...(canViewHpp
      ? [
          { key: 'unit_cost', header: 'HPP/Unit', render: row => <span className="tabular-nums text-muted-foreground">{fmtMoney(row.unit_cost)}</span> },
          { key: 'nominal', header: 'Nominal', render: row => <span className={`tabular-nums ${row.nominal >= 0 ? 'text-foreground' : 'text-red-600'}`}>{fmtMoney(row.nominal)}</span> },
        ]
      : []),
    { key: 'reference_number', header: 'Referensi', className: 'font-mono', render: row => row.reference_number || '—' },
    { key: 'notes', header: 'Keterangan', render: row => row.notes || '—' },
  ];
  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader
        title="Kartu Stok"
        description="Mutasi persediaan berdasarkan stock ledger"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {user?.role === 'admin' && (
              <Button onClick={openOpeningBalance} size="sm" variant="outline" className="gap-1.5"><DatabaseZap className="w-4 h-4" />Saldo Awal</Button>
            )}
            <Button onClick={openAdjustment} size="sm" className="gap-1.5"><Plus className="w-4 h-4" />Koreksi Stok</Button>
            <Button onClick={exportCSV} size="sm" variant="outline" className="gap-1.5"><Download className="w-4 h-4" />Export CSV</Button>
            <PdfButton onExport={exportPDF} />
          </div>
        }
      />
      <div className="bg-white border border-border rounded-lg p-3 mb-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <div><Label className="text-[11px] mb-1">Jenis Item</Label><Select value={filters.item_type} onValueChange={v => setFilters({ ...filters, item_type: v })}><SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Semua" /></SelectTrigger><SelectContent><SelectItem value="material">Bahan</SelectItem><SelectItem value="product">Barang</SelectItem></SelectContent></Select></div>
        <div><Label className="text-[11px] mb-1">Tipe Transaksi</Label><Select value={filters.transaction_type} onValueChange={v => setFilters({ ...filters, transaction_type: v })}><SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Semua" /></SelectTrigger><SelectContent>{Object.entries(transactionTypeLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
        <div><Label className="text-[11px] mb-1">Stage</Label><Select value={filters.inventory_status} onValueChange={v => setFilters({ ...filters, inventory_status: v })}><SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Semua" /></SelectTrigger><SelectContent><SelectItem value="RAW_MATERIAL">Bahan Baku</SelectItem><SelectItem value="PREMIX">Premix</SelectItem><SelectItem value="BULK">Bulk (Produksi)</SelectItem><SelectItem value="READY_FOR_LABELING">Siap Labeling</SelectItem><SelectItem value="UNEXCISED">Belum Cukai</SelectItem><SelectItem value="READY_FOR_SALE">Siap Jual</SelectItem></SelectContent></Select></div>
        <div><Label className="text-[11px] mb-1">Gudang</Label><Select value={filters.warehouse_id} onValueChange={v => setFilters({ ...filters, warehouse_id: v })}><SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Semua" /></SelectTrigger><SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label className="text-[11px] mb-1">Nama Item</Label><Input value={filters.item_name} onChange={e => setFilters({ ...filters, item_name: e.target.value })} className="h-8 text-[12px]" placeholder="Cari item..." /></div>
        <div className="grid grid-cols-2 gap-1.5"><div><Label className="text-[11px] mb-1">Dari</Label><Input type="date" value={filters.date_from} onChange={e => setFilters({ ...filters, date_from: e.target.value })} className="h-8 text-[12px]" /></div><div><Label className="text-[11px] mb-1">Sampai</Label><Input type="date" value={filters.date_to} onChange={e => setFilters({ ...filters, date_to: e.target.value })} className="h-8 text-[12px]" /></div></div>
      </div>
      <FormModal open={openingOpen} onClose={() => setOpeningOpen(false)} title="Saldo Awal Stok" onSubmit={submitOpeningBalance} submitting={openingSubmitting} submitLabel="Posting Saldo Awal" size="lg">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">Digunakan untuk memasukkan stok fisik yang sudah ada sebelum LAB PRO. Jika stok sudah tercatat di sistem, gunakan Koreksi Stok.</div>
        <div className="grid grid-cols-2 gap-3"><div><Label className="text-[12.5px] mb-1">Jenis Item *</Label><Select value={openingForm.item_type} onValueChange={onOpeningItemTypeChange}><SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="product">Barang / Produk</SelectItem><SelectItem value="material">Bahan</SelectItem></SelectContent></Select></div><div><Label className="text-[12.5px] mb-1">Stage *</Label><Select value={openingForm.inventory_status} onValueChange={v => setOpeningForm(f => ({ ...f, inventory_status: v }))}><SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger><SelectContent>{openingStageOptions.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select></div></div>
        <div><Label className="text-[12.5px] mb-1">{openingForm.item_type === 'product' ? 'Barang / Produk' : 'Bahan'} *</Label><SearchableSelect value={openingForm.item_id} onValueChange={v => setOpeningForm(f => ({ ...f, item_id: v }))} options={openingItems.map(item => ({ value: item.id, label: openingForm.item_type === 'product' ? getInventoryDisplayName(item.name || '—', openingForm.inventory_status) : (item.name || '—'), keywords: `${item.code || ''} ${item.name || ''} ${item.category_name || ''} ${item.unit || ''}` }))} placeholder="Cari nama / kode item..." className="h-9 text-[13px]" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-[12.5px] mb-1">Gudang *</Label><SearchableSelect value={openingForm.warehouse_id} onValueChange={v => setOpeningForm(f => ({ ...f, warehouse_id: v }))} options={warehouses.map(w => ({ value: w.id, label: w.name, keywords: `${w.code || ''} ${w.name || ''}` }))} placeholder="Cari gudang..." className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Batch Legacy</Label><Input value={openingForm.batch_number} onChange={e => setOpeningForm(f => ({ ...f, batch_number: e.target.value }))} placeholder="Opsional" className="h-9 text-[13px] font-mono" /></div>
          <div><Label className="text-[12.5px] mb-1">Qty Saldo Awal *</Label><NumberInput value={openingForm.quantity} onChange={v => setOpeningForm(f => ({ ...f, quantity: v }))} allowDecimal min={0} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">HPP / Unit *</Label><NumberInput value={openingForm.unit_cost} onChange={v => setOpeningForm(f => ({ ...f, unit_cost: v }))} allowDecimal maxDecimals={4} min={0} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Satuan</Label><Input value={selectedOpeningItem?.unit || ''} disabled className="h-9 text-[13px] bg-muted/40" /></div>
          <div><Label className="text-[12.5px] mb-1">Operator *</Label><Input value={openingForm.operator} onChange={e => setOpeningForm(f => ({ ...f, operator: e.target.value }))} className="h-9 text-[13px]" /></div>
        </div>
        {openingDuplicateBalance && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11.5px] text-red-700">Kombinasi item + stage + gudang{openingForm.batch_number.trim() ? ' + batch' : ''}{' '}sudah memiliki StockBalance. Gunakan Koreksi Stok agar Opening Balance tidak terposting dua kali.</div>}
        {selectedOpeningItem && <div className="rounded-md border bg-muted/20 p-3 text-[12px] grid grid-cols-2 gap-2"><div><span className="text-muted-foreground">Item</span><div className="font-medium">{selectedOpeningItem.name || '—'}</div></div><div><span className="text-muted-foreground">Stage</span><div className="font-medium">{STAGE_LABEL[openingForm.inventory_status] || openingForm.inventory_status}</div></div><div><span className="text-muted-foreground">Gudang</span><div className="font-medium">{selectedOpeningWarehouse?.name || '—'}</div></div><div><span className="text-muted-foreground">Nilai Opening</span><div className="font-semibold tabular-nums">{fmtMoney((Number(openingForm.quantity) || 0) * (Number(openingForm.unit_cost) || 0))}</div></div></div>}
        <div><Label className="text-[12.5px] mb-1">Catatan *</Label><Textarea value={openingForm.notes} onChange={e => setOpeningForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Contoh: Stok existing sebelum implementasi LAB PRO." className="text-[13px]" /></div>
      </FormModal>
      <FormModal open={adjustOpen} onClose={() => setAdjustOpen(false)} title="Koreksi Stok" onSubmit={submitAdjustment} submitting={adjustSubmitting} submitLabel="Posting Koreksi" size="lg">
        <div><Label className="text-[12.5px] mb-1">Item / Stok *</Label><SearchableSelect value={adjustForm.balance_id} onValueChange={v => setAdjustForm(f => ({ ...f, balance_id: v }))} options={selectableBalances.map(b => { const status = (!b.inventory_status && b.item_type === 'material') ? 'RAW_MATERIAL' : (b.inventory_status || ''); const display = b.item_type === 'product' ? getInventoryDisplayName(b.item_name, status) : (b.item_name || '—'); return { value: b.id, label: `${display} · ${Number(b.available_quantity ?? b.quantity ?? 0)} ${b.unit || ''}${b.batch_number ? ` · ${b.batch_number}` : ''}`, keywords: `${b.item_code || ''} ${b.item_name || ''} ${b.batch_number || ''} ${b.warehouse_name || ''} ${STAGE_LABEL[status] || status}` }; })} placeholder="Cari item / batch / stage..." className="h-9 text-[13px]" /></div>
        {selectedBalance && <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/20 p-3 text-[12px]"><div><span className="text-muted-foreground">Stage</span><div className="font-medium">{STAGE_LABEL[(!selectedBalance.inventory_status && selectedBalance.item_type === 'material') ? 'RAW_MATERIAL' : selectedBalance.inventory_status] || selectedBalance.inventory_status || 'Bahan Baku'}</div></div><div><span className="text-muted-foreground">Stok Sistem</span><div className="font-semibold tabular-nums">{Number(selectedBalance.available_quantity ?? selectedBalance.quantity ?? 0)} {selectedBalance.unit || ''}</div></div><div><span className="text-muted-foreground">Batch</span><div className="font-mono">{selectedBalance.batch_number || '—'}</div></div>{canViewHpp && <div><span className="text-muted-foreground">HPP/Unit</span><div className="font-medium tabular-nums">{fmtMoney(selectedUnitCost)}</div></div>}</div>}
        <div className="grid grid-cols-2 gap-3"><div><Label className="text-[12.5px] mb-1">Jenis Koreksi *</Label><Select value={adjustForm.adjustment_type} onValueChange={v => setAdjustForm(f => ({ ...f, adjustment_type: v }))}><SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="increase">Tambah Stok</SelectItem><SelectItem value="decrease">Kurangi Stok</SelectItem></SelectContent></Select></div><div><Label className="text-[12.5px] mb-1">Qty Koreksi *</Label><NumberInput value={adjustForm.quantity} onChange={v => setAdjustForm(f => ({ ...f, quantity: v }))} allowDecimal min={0} className="h-9 text-[13px]" /></div><div><Label className="text-[12.5px] mb-1">Alasan *</Label><Select value={adjustForm.reason} onValueChange={v => setAdjustForm(f => ({ ...f, reason: v }))}><SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih alasan" /></SelectTrigger><SelectContent>{adjustmentReasons.map(reason => <SelectItem key={reason} value={reason}>{reason}</SelectItem>)}</SelectContent></Select></div><div><Label className="text-[12.5px] mb-1">Operator *</Label><Input value={adjustForm.operator} onChange={e => setAdjustForm(f => ({ ...f, operator: e.target.value }))} className="h-9 text-[13px]" /></div></div>
        <div><Label className="text-[12.5px] mb-1">Keterangan {adjustForm.reason === 'Lainnya' ? '*' : ''}</Label><Textarea value={adjustForm.notes} onChange={e => setAdjustForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Contoh: hasil stock opname fisik, 3 botol pecah, salah input qty..." className="text-[13px]" /></div>
      </FormModal>
      <DataTable columns={columns} data={filtered} loading={loading} emptyMessage="Belum ada mutasi stok" searchKeys={['transaction_number','item_name','batch_number','notes']} searchPlaceholder="Cari transaksi..." />
    </div>
  );
}