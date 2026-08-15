import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import PdfButton from '@/components/PdfButton';
import SearchableSelect from '@/components/SearchableSelect';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { exportReportToPDF } from '@/lib/pdfExport';
import { Download, Factory, PackageCheck, Tags, Stamp, Warehouse, ArrowRight, Boxes, TrendingDown, TrendingUp } from 'lucide-react';

const TYPE_LABEL = {
  opening_balance: 'Saldo Awal', purchase_receipt: 'Pembelian', production_consumption: 'Konsumsi Produksi',
  production_output: 'Output Produksi', bottling_output: 'Output Bottling', labeling_output: 'Output Labeling',
  excise_output: 'Output Cukai', sales: 'Penjualan', sales_return: 'Retur Penjualan', stock_adjustment: 'Koreksi',
  transfer_gudang: 'Transfer Gudang', production_reversal: 'Reversal Produksi', bottling_reversal: 'Reversal Bottling',
  labeling_reversal: 'Reversal Labeling', excise_reversal: 'Reversal Cukai', sales_reversal: 'Reversal Penjualan',
};

const FLOW = [
  { key: 'production_output', label: 'Produksi', stage: 'BULK', icon: Factory },
  { key: 'bottling_output', label: 'Bottling', stage: 'READY_FOR_LABELING', icon: PackageCheck },
  { key: 'labeling_output', label: 'Labeling', stage: 'UNEXCISED', stageLabel: 'Belum Cukai', icon: Tags },
  { key: 'excise_output', label: 'Cukai', stage: 'READY_FOR_SALE', icon: Stamp },
];

const MODE_LABEL = {
  batch: 'Batch Produksi',
  ready_for_sale: 'Produk Siap Jual',
  essence: 'Bahan Essence',
  bottle: 'Bahan Botol',
  box: 'Bahan Box',
  label: 'Bahan Label',
};

const localDate = (date) => {
  if (!date) return '—';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
};
const qty = value => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(value) || 0);
const isoDay = date => new Date(date).toISOString().slice(0, 10);
const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const unitLabel = unit => unit === 'mililiter' ? 'ml' : (unit || 'unit');
const movementUnit = (row, productUnit = 'unit') => (
  row?.inventory_status === 'BULK' || row?.transaction_type === 'production_output'
    ? 'ml'
    : unitLabel(row?.unit || productUnit)
);

export default function StockCardDedicated() {
  const { toast } = useToast();
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [mode, setMode] = useState('batch');
  const [products, setProducts] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [productionOrders, setProductionOrders] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [componentMappings, setComponentMappings] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [balances, setBalances] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [dateFrom, setDateFrom] = useState(isoDay(monthStart));
  const [dateTo, setDateTo] = useState(isoDay(today));
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [productRows, recipeRows, productionRows, materialRows, mappingRows, ledgerRows, balanceRows] = await Promise.all([
        base44.entities.Product.filter({ is_active: true }),
        base44.entities.Recipe.filter({ status: 'approved' }).catch(() => []),
        base44.entities.ProductionOrder.list('-production_date', 2000),
        base44.entities.Material.filter({ is_active: true }),
        base44.entities.ProductComponentMapping.filter({ is_active: true }).catch(() => []),
        base44.entities.StockLedger.list('-transaction_date', 5000),
        base44.entities.StockBalance.list('-updated_date', 3000),
      ]);
      setProducts(productRows || []);
      setRecipes(recipeRows || []);
      setProductionOrders(productionRows || []);
      setMaterials(materialRows || []);
      setComponentMappings(mappingRows || []);
      setLedger(ledgerRows || []);
      setBalances(balanceRows || []);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Gagal memuat stock card', description: error?.message });
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const bottleIds = useMemo(() => new Set(componentMappings.filter(m => m.component_type === 'bottle').map(m => m.material_id)), [componentMappings]);
  const boxIds = useMemo(() => new Set(componentMappings.filter(m => m.component_type === 'box').map(m => m.material_id)), [componentMappings]);
  const labelIds = useMemo(() => new Set(componentMappings.filter(m => m.component_type === 'label').map(m => m.material_id)), [componentMappings]);
  const isBottleMaterial = useCallback(m => bottleIds.has(m.id) || m.material_type === 'BOTTLE' || /botol|bottle/i.test(`${m.name} ${m.category_name || ''}`), [bottleIds]);
  const isLabelMaterial = useCallback(m => labelIds.has(m.id) || ['LABEL', 'STICKER'].includes(m.material_type) || /label|stiker|sticker/i.test(`${m.name} ${m.category_name || ''}`), [labelIds]);
  const isBoxMaterial = useCallback(m => boxIds.has(m.id) || (!isBottleMaterial(m) && !isLabelMaterial(m) && (m.material_type === 'PACKAGING' || /box|dus|karton/i.test(`${m.name} ${m.category_name || ''}`))), [boxIds, isBottleMaterial, isLabelMaterial]);
  const ledgerUntilDate = useCallback((order) => ledger.filter(row => {
    const day = (row.transaction_date || row.created_date || '').slice(0, 10);
    return row.item_type === 'product' &&
      row.batch_number === order.batch_number &&
      (!dateTo || day <= dateTo);
  }), [ledger, dateTo]);
  const stageBalanceFromRows = useCallback((ledgerRows, stage) => ledgerRows
    .filter(row => row.inventory_status === stage)
    .reduce((sum, row) => sum + Number(row.quantity_in || 0) - Number(row.quantity_out || 0), 0), []);
  const eligibleBatchOrders = useMemo(() => productionOrders.filter(order => {
    const status = String(order.status || '').toLowerCase();
    const isCancelled = ['dibatalkan', 'cancelled', 'canceled', 'void', 'voided'].includes(status);
    const isPremix = order.production_type === 'PREMIX' || order.recipe_type === 'PREMIX';
    if (isCancelled || isPremix || !order.product_id || !order.batch_number) return false;

    const history = ledgerUntilDate(order);
    return ['BULK', 'READY_FOR_LABELING', 'UNEXCISED', 'READY_FOR_SALE']
      .some(stage => stageBalanceFromRows(history, stage) > 0.000001);
  }), [productionOrders, ledgerUntilDate, stageBalanceFromRows]);
  const readyForSaleItems = useMemo(() => balances
    .filter(b =>
      b.item_type === 'product' &&
      b.inventory_status === 'READY_FOR_SALE' &&
      Number(b.available_quantity ?? b.quantity ?? 0) > 0
    )
    .map(b => {
      const product = products.find(p => p.id === b.item_id);
      return {
        ...b,
        id: b.id,
        name: product?.name || b.item_name || 'Produk',
        code: product?.code || product?.sku || b.item_code || '',
        product_id: b.item_id,
        product_name: product?.name || b.item_name || 'Produk',
      };
    })
    .sort((a, b) =>
      String(a.product_name || '').localeCompare(String(b.product_name || '')) ||
      String(a.batch_number || '').localeCompare(String(b.batch_number || ''))
    ), [balances, products]);

  const modeItems = useMemo(() => {
    if (mode === 'batch') return eligibleBatchOrders;
    if (mode === 'ready_for_sale') return readyForSaleItems;
    if (mode === 'essence') return materials.filter(m => m.material_type === 'RAW_MATERIAL' && m.material_category === 'flavor' && !isBottleMaterial(m) && !isBoxMaterial(m) && !isLabelMaterial(m));
    if (mode === 'bottle') return materials.filter(isBottleMaterial);
    if (mode === 'box') return materials.filter(isBoxMaterial);
    return materials.filter(isLabelMaterial);
  }, [mode, eligibleBatchOrders, readyForSaleItems, materials, isBottleMaterial, isBoxMaterial, isLabelMaterial]);
  useEffect(() => {
    if (!modeItems.some(item => item.id === selectedId)) {
      setSelectedId(modeItems[0]?.id || '');
    }
  }, [modeItems, selectedId]);
  const selectedBatch = mode === 'batch' ? eligibleBatchOrders.find(row => row.id === selectedId) : null;
  const selectedReadyStock = mode === 'ready_for_sale' ? readyForSaleItems.find(row => row.id === selectedId) : null;
  const selectedMaterial = !['batch', 'ready_for_sale'].includes(mode) ? materials.find(row => row.id === selectedId) : null;
  const productId = mode === 'ready_for_sale' ? selectedReadyStock?.item_id : selectedBatch?.product_id;
  const product = products.find(p => p.id === productId);
  const selectedRecipeForProduct = recipes.find(r => r.id === selectedBatch?.recipe_id) || recipes.find(r => r.product_id === productId && r.status === 'approved');
  const selectedItem = mode === 'batch' || mode === 'ready_for_sale' ? product : selectedMaterial;
  const selectedUnit = unitLabel((mode === 'batch' || mode === 'ready_for_sale') ? product?.unit : selectedMaterial?.unit);

  // Ambil seluruh histori item/batch sampai dateTo terlebih dahulu.
  // Running balance TIDAK boleh bergantung pada balance_quantity StockLedger,
  // karena field tersebut dapat 0/kosong pada data restore/ledger lama.
  const selectedHistoryUntilDate = useMemo(() => ledger
    .filter(row => {
      if (mode === 'batch') {
        return row.item_type === 'product' && row.batch_number === selectedBatch?.batch_number;
      }
      if (mode === 'ready_for_sale') {
        if (row.item_type !== 'product') return false;
        if (row.item_id !== selectedReadyStock?.item_id) return false;
        if (row.inventory_status !== 'READY_FOR_SALE') return false;
        if (selectedReadyStock?.batch_id && row.batch_id !== selectedReadyStock.batch_id) return false;
        if (!selectedReadyStock?.batch_id && selectedReadyStock?.batch_number &&
            (row.batch_number || '') !== (selectedReadyStock.batch_number || '')) return false;
        if (selectedReadyStock?.warehouse_id &&
            (row.warehouse_id || '') !== (selectedReadyStock.warehouse_id || '')) return false;
        return true;
      }
      return row.item_type === 'material' && row.item_id === selectedId;
    })
    .filter(row => {
      const day = (row.transaction_date || row.created_date || '').slice(0, 10);
      return !dateTo || day <= dateTo;
    })
    .sort((a, b) => String(a.transaction_date || a.created_date).localeCompare(String(b.transaction_date || b.created_date))),
  [ledger, mode, selectedId, selectedBatch?.batch_number, selectedReadyStock?.item_id, selectedReadyStock?.batch_id, selectedReadyStock?.batch_number, selectedReadyStock?.warehouse_id, dateTo]);

  const historyWithRunningBalance = useMemo(() => {
    const running = {};
    return selectedHistoryUntilDate.map(row => {
      // Saldo dipisah per stage. Ini penting untuk batch produksi karena BULK,
      // READY_FOR_LABELING, UNEXCISED, dan READY_FOR_SALE adalah stok berbeda.
      // Untuk material, inventory_status kosong dinormalisasi agar konsisten.
      const stage = row.inventory_status ||
        (row.item_type === 'material' ? 'RAW_MATERIAL' : '');
      const key = `${row.item_id || ''}|${row.batch_number || ''}|${stage}`;
      const delta =
        Number(row.quantity_in || 0) -
        Number(row.quantity_out || 0);

      running[key] = (running[key] || 0) + delta;

      return {
        ...row,
        running_balance: running[key],
      };
    });
  }, [selectedHistoryUntilDate]);

  const rows = useMemo(() => historyWithRunningBalance
    .filter(row => {
      const day = (row.transaction_date || row.created_date || '').slice(0, 10);
      return !dateFrom || day >= dateFrom;
    })
    .sort((a, b) => String(b.transaction_date || b.created_date).localeCompare(String(a.transaction_date || a.created_date))),
  [historyWithRunningBalance, dateFrom]);

  const batchHistoryRows = useMemo(() => selectedBatch ? ledgerUntilDate(selectedBatch) : [], [selectedBatch, ledgerUntilDate]);
  const historicalBatchBalances = useMemo(() => Object.values(batchHistoryRows.reduce((acc, row) => {
    const key = `${row.warehouse_id || row.warehouse_name || 'unknown'}|${row.inventory_status || ''}`;
    if (!acc[key]) acc[key] = {
      id: key, item_type: 'product', item_id: row.item_id, item_name: row.item_name,
      batch_number: row.batch_number, warehouse_id: row.warehouse_id, warehouse_name: row.warehouse_name,
      inventory_status: row.inventory_status, quantity: 0, available_quantity: 0, unit: row.unit,
    };
    acc[key].quantity += Number(row.quantity_in || 0) - Number(row.quantity_out || 0);
    acc[key].available_quantity = acc[key].quantity;
    return acc;
  }, {})).filter(row => Math.abs(row.quantity) > 0.000001), [batchHistoryRows]);
  const selectedBalances = useMemo(() => {
    if (mode === 'batch') return historicalBatchBalances;
    if (mode === 'ready_for_sale') {
      return balances.filter(b => {
        if (b.item_type !== 'product') return false;
        if (b.inventory_status !== 'READY_FOR_SALE') return false;
        if (b.item_id !== selectedReadyStock?.item_id) return false;
        if (selectedReadyStock?.batch_id && b.batch_id !== selectedReadyStock.batch_id) return false;
        if (!selectedReadyStock?.batch_id && selectedReadyStock?.batch_number &&
            (b.batch_number || '') !== (selectedReadyStock.batch_number || '')) return false;
        if (selectedReadyStock?.warehouse_id &&
            (b.warehouse_id || '') !== (selectedReadyStock.warehouse_id || '')) return false;
        return true;
      });
    }
    return balances.filter(b => b.item_type === 'material' && b.item_id === selectedId);
  }, [balances, mode, selectedId, selectedReadyStock, historicalBatchBalances]);
  const warehouseStock = useMemo(() => Object.values(selectedBalances.reduce((acc, b) => {
    const key = b.warehouse_id || b.warehouse_name || 'unknown';
    if (!acc[key]) acc[key] = { id: key, name: b.warehouse_name || 'Gudang tidak diketahui', quantity: 0, units: new Set() };
    acc[key].quantity += Number(b.available_quantity ?? b.quantity ?? 0);
    acc[key].units.add(b.inventory_status === 'BULK' ? 'ml' : unitLabel(b.unit || selectedUnit));
    return acc;
  }, {})).map(row => ({ ...row, unit: row.units.size === 1 ? [...row.units][0] : 'campuran' })).sort((a, b) => b.quantity - a.quantity), [selectedBalances, selectedUnit]);

  const totalIn = rows.reduce((sum, row) => sum + Number(row.quantity_in || 0), 0);
  const totalOut = rows.reduce((sum, row) => sum + Number(row.quantity_out || 0), 0);
  const available = mode === 'batch'
    ? selectedBalances.filter(b => b.inventory_status === 'READY_FOR_SALE').reduce((sum, b) => sum + Number(b.available_quantity ?? b.quantity ?? 0), 0)
    : selectedBalances.reduce((sum, b) => sum + Number(b.available_quantity ?? b.quantity ?? 0), 0);
  const inProcess = mode === 'batch' ? selectedBalances.filter(b => ['READY_FOR_LABELING', 'UNEXCISED'].includes(b.inventory_status)).reduce((sum, b) => sum + Number(b.available_quantity ?? b.quantity ?? 0), 0) : 0;
  const inProcessUnits = new Set(selectedBalances.filter(b => ['READY_FOR_LABELING', 'UNEXCISED'].includes(b.inventory_status) && Number(b.available_quantity ?? b.quantity ?? 0) !== 0).map(b => unitLabel(b.unit || selectedUnit)));
  const inProcessUnit = inProcessUnits.size === 1 ? [...inProcessUnits][0] : (inProcessUnits.size > 1 ? 'campuran' : selectedUnit);
  const incomingUnits = new Set(rows.filter(r => Number(r.quantity_in || 0) !== 0).map(r => movementUnit(r, selectedUnit)));
  const outgoingUnits = new Set(rows.filter(r => Number(r.quantity_out || 0) !== 0).map(r => movementUnit(r, selectedUnit)));
  const totalInUnit = incomingUnits.size === 1 ? [...incomingUnits][0] : (incomingUnits.size > 1 ? 'campuran' : selectedUnit);
  const totalOutUnit = outgoingUnits.size === 1 ? [...outgoingUnits][0] : (outgoingUnits.size > 1 ? 'campuran' : selectedUnit);
  // Ringkasan periode memakai delta histori sebelum dateFrom.
  // Untuk mode material seluruh stage dijumlahkan. Untuk batch, unit antar-stage
  // dapat berbeda sehingga ringkasan ini tetap mengikuti movement yang sedang tampil.
  const opening = useMemo(() => {
    if (!dateFrom) return 0;
    return selectedHistoryUntilDate
      .filter(row => (row.transaction_date || row.created_date || '').slice(0, 10) < dateFrom)
      .reduce((sum, row) =>
        sum + Number(row.quantity_in || 0) - Number(row.quantity_out || 0), 0);
  }, [selectedHistoryUntilDate, dateFrom]);
  const bottlingIn = batchHistoryRows.filter(row => row.transaction_type === 'bottling_output').reduce((sum, row) => sum + Number(row.quantity_in || 0), 0) -
    batchHistoryRows.filter(row => row.transaction_type === 'bottling_reversal' && row.inventory_status === 'READY_FOR_LABELING').reduce((sum, row) => sum + Number(row.quantity_out || 0), 0);
  const salesOut = batchHistoryRows.filter(row => row.transaction_type === 'sales').reduce((sum, row) => sum + Number(row.quantity_out || 0), 0) -
    batchHistoryRows.filter(row => ['sales_reversal', 'sales_return'].includes(row.transaction_type)).reduce((sum, row) => sum + Number(row.quantity_in || 0), 0);
  const quickTotalIn = mode === 'batch' ? Math.max(0, bottlingIn) : totalIn;
  const quickTotalOut = mode === 'batch' ? Math.max(0, salesOut) : totalOut;
  const quickTotalInUnit = (mode === 'batch' || mode === 'ready_for_sale') ? unitLabel(product?.unit) : totalInUnit;
  const quickTotalOutUnit = (mode === 'batch' || mode === 'ready_for_sale') ? unitLabel(product?.unit) : totalOutUnit;

  const flow = FLOW.map(step => {
    const outputRows = batchHistoryRows.filter(row => row.transaction_type === step.key);
    const reversalType = step.key.replace('_output', '_reversal');
    const reversalRows = batchHistoryRows.filter(row => row.transaction_type === reversalType && row.inventory_status === step.stage);
    const outputTotal = outputRows.reduce((sum, row) => sum + Number(row.quantity_in || 0), 0) -
      reversalRows.reduce((sum, row) => sum + Number(row.quantity_out || 0), 0);
    const event = outputRows.sort((a, b) => String(b.transaction_date || b.created_date).localeCompare(String(a.transaction_date || a.created_date)))[0];
    const remaining = stageBalanceFromRows(batchHistoryRows, step.stage);
    const remainingLabel = step.key === 'bottling_output' ? 'Belum dilabel' : step.key === 'labeling_output' ? 'Belum dicukai' : '';
    return {
      ...step, event, quantity: Math.max(0, outputTotal), remaining: Math.max(0, remaining), remainingLabel,
      unit: step.stage === 'BULK' ? 'ml' : unitLabel(event?.unit || product?.unit),
    };
  });

  const switchMode = value => {
    setMode(value);
    setSelectedId('');
  };

  const exportRows = rows.map(row => ({
    date: localDate(row.transaction_date || row.created_date), number: row.transaction_number || '',
    type: TYPE_LABEL[row.transaction_type] || row.transaction_type, warehouse: row.warehouse_name || '',
    batch: row.batch_number || '', in: row.quantity_in || 0, out: row.quantity_out || 0,
    balance: row.running_balance ?? 0, unit: movementUnit(row, selectedUnit), notes: row.notes || '',
  }));

  const exportCSV = () => {
    const headers = ['Tanggal', 'No. Transaksi', 'Tipe', 'Gudang', 'Batch', 'Masuk', 'Keluar', 'Saldo', 'Satuan', 'Keterangan'];
    const body = exportRows.map(r => Object.values(r).map(csvCell).join(','));
    const blob = new Blob(['\ufeff' + [headers.map(csvCell).join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url;
    link.download = `stock-card-${selectedItem?.code || selectedBatch?.batch_number || 'item'}-${dateFrom}-${dateTo}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const exportPDF = () => exportReportToPDF({
    title: 'Stock Card Dedicated',
    subtitle: mode === 'batch'
      ? `${selectedBatch?.batch_number || 'Batch belum dipilih'} · ${product?.name || ''}`
      : mode === 'ready_for_sale'
        ? `${product?.name || 'Produk siap jual'}${selectedReadyStock?.batch_number ? ` · ${selectedReadyStock.batch_number}` : ''}${selectedReadyStock?.warehouse_name ? ` · ${selectedReadyStock.warehouse_name}` : ''}`
        : (selectedMaterial?.name || 'Bahan belum dipilih'),
    fileName: `stock-card-${selectedItem?.code || selectedReadyStock?.batch_number || selectedBatch?.batch_number || 'item'}.pdf`,
    meta: { period: `${dateFrom} s/d ${dateTo}` }, rows: exportRows,
    columns: [
      { key: 'date', header: 'Tanggal', width: 80 }, { key: 'number', header: 'No. Transaksi', width: 105 },
      { key: 'type', header: 'Tipe', width: 85 }, { key: 'warehouse', header: 'Gudang', width: 75 },
      { key: 'batch', header: 'Batch', width: 90 }, { key: 'in', header: 'Masuk', align: 'right', width: 42 },
      { key: 'out', header: 'Keluar', align: 'right', width: 42 }, { key: 'balance', header: 'Saldo', align: 'right', width: 42 },
      { key: 'unit', header: 'Satuan', width: 42 }, { key: 'notes', header: 'Keterangan' },
    ],
  });

  const columns = [
    { key: 'transaction_date', header: 'Tanggal', sortable: true, render: r => localDate(r.transaction_date || r.created_date) },
    { key: 'transaction_number', header: 'No. Transaksi', className: 'font-mono' },
    { key: 'transaction_type', header: 'Tipe Transaksi', render: r => <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700">{TYPE_LABEL[r.transaction_type] || r.transaction_type}</span> },
    { key: 'warehouse_name', header: 'Gudang' }, { key: 'batch_number', header: 'Batch', className: 'font-mono' },
    { key: 'quantity_in', header: 'Masuk', render: r => r.quantity_in ? <span className="font-semibold text-emerald-600">{qty(r.quantity_in)}</span> : '—' },
    { key: 'quantity_out', header: 'Keluar', render: r => r.quantity_out ? <span className="font-semibold text-red-500">{qty(r.quantity_out)}</span> : '—' },
    { key: 'running_balance', header: 'Saldo', render: r => <span className="font-semibold">{qty(r.running_balance)}</span> },
    { key: 'unit', header: 'Satuan', render: r => movementUnit(r, selectedUnit) }, { key: 'notes', header: 'Keterangan' },
  ];

  return <div className="mx-auto max-w-[1500px] space-y-4 p-5">
    <PageHeader title="Kartu Stok Detail" description="Telusuri stok berdasarkan batch produksi, essence, botol, box, atau label" actions={<div className="flex flex-wrap items-center gap-2"><div className="flex items-center gap-2 rounded-md border bg-white px-2 py-1"><Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-7 w-[132px] border-0 p-1 text-xs"/><span className="text-muted-foreground">–</span><Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-7 w-[132px] border-0 p-1 text-xs"/></div><Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5"><Download className="h-4 w-4"/>Export CSV</Button><PdfButton onExport={exportPDF} perm="stock_card_detail" /></div>} />

    <div className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
      <Card><CardContent className="p-4"><Tabs value={mode} onValueChange={switchMode}><TabsList className="mb-4 grid h-auto w-full grid-cols-2 gap-1 md:grid-cols-3 xl:grid-cols-6"><TabsTrigger value="batch">Batch Produksi</TabsTrigger><TabsTrigger value="ready_for_sale">Siap Jual</TabsTrigger><TabsTrigger value="essence">Bahan Essence</TabsTrigger><TabsTrigger value="bottle">Bahan Botol</TabsTrigger><TabsTrigger value="box">Bahan Box</TabsTrigger><TabsTrigger value="label">Bahan Label</TabsTrigger></TabsList></Tabs><Label className="mb-1.5 text-xs">Pilih {MODE_LABEL[mode]}</Label><SearchableSelect value={selectedId} onValueChange={setSelectedId} options={modeItems.map(item => ({
        value: item.id,
        label: mode === 'batch'
          ? `${item.batch_number || item.production_number} · ${item.product_name || 'Tanpa produk'}`
          : mode === 'ready_for_sale'
            ? `${item.product_name || item.name}${item.batch_number ? ` · ${item.batch_number}` : ' · TANPA BATCH'} · ${qty(item.available_quantity ?? item.quantity)} ${unitLabel(item.unit || product?.unit)}${item.warehouse_name ? ` · ${item.warehouse_name}` : ''}`
            : item.name,
        keywords: mode === 'batch'
          ? `${item.batch_number || ''} ${item.production_number || ''} ${item.product_name || ''} ${item.recipe_code || ''}`
          : mode === 'ready_for_sale'
            ? `${item.product_name || ''} ${item.batch_number || ''} ${item.warehouse_name || ''} ${item.code || ''}`
            : `${item.code || ''} ${item.name || ''} ${item.category_name || ''}`
      }))} placeholder={mode === 'batch' ? 'Cari nomor batch atau produk...' : mode === 'ready_for_sale' ? 'Cari produk siap jual / batch / gudang...' : 'Cari nama atau kode bahan...'} className="h-12" /></CardContent></Card>
      <Card><CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Ringkasan Cepat</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-3 p-4 pt-2">
        {[['Stok Tersedia', available, selectedUnit, 'text-blue-600 bg-blue-50', Boxes], [mode === 'batch' ? 'Stok Dalam Proses' : 'Jumlah Gudang', mode === 'batch' ? inProcess : warehouseStock.length, mode === 'batch' ? inProcessUnit : 'lokasi', 'text-amber-600 bg-amber-50', Warehouse], ['Total Masuk', quickTotalIn, quickTotalInUnit, 'text-emerald-600 bg-emerald-50', TrendingUp], ['Total Keluar', quickTotalOut, quickTotalOutUnit, 'text-red-500 bg-red-50', TrendingDown]].map(([label, value, unit, color, Icon]) => <div key={label} className="flex items-center gap-2"><div className={`rounded-full p-2 ${color}`}><Icon className="h-4 w-4"/></div><div><div className="text-[11px] text-muted-foreground">{label}</div><div className={`font-bold ${color.split(' ')[0]}`}>{qty(value)} <span className="text-xs font-normal">{unit}</span></div></div></div>)}
      </CardContent></Card>
    </div>

    <div className={`grid gap-4 ${mode === 'batch' ? 'xl:grid-cols-[1.35fr_0.65fr]' : ''}`}>
      {mode === 'batch' && (
      <Card><CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Alur Proses (Recipe Flow)</CardTitle></CardHeader><CardContent className="flex min-h-52 items-stretch gap-2 overflow-x-auto p-4 pt-2">{flow.map((step, index) => { const Icon = step.icon; return <React.Fragment key={step.key}><div className="min-w-[125px] flex-1 rounded-lg border bg-slate-50 p-3 text-center"><div className="mx-auto mb-2 w-fit rounded-full bg-white p-2 shadow-sm"><Icon className="h-4 w-4"/></div><div className="text-xs font-semibold">{step.label}</div><div className="mt-1 text-[10px] text-muted-foreground">{step.stageLabel || step.stage.replaceAll('_', ' ')}</div><div className="mt-4 text-[10px] text-muted-foreground">Total Output</div><div className="text-sm font-bold text-emerald-600">{qty(step.quantity)} {step.unit}</div>{step.remainingLabel && <div className="mt-2 rounded bg-amber-50 px-1.5 py-1 text-[10px] text-amber-700">{step.remainingLabel}: <span className="font-semibold">{qty(step.remaining)} {step.unit}</span></div>}<div className="mt-2 text-[10px] text-muted-foreground">{step.event ? localDate(step.event.transaction_date || step.event.created_date) : 'Belum ada proses'}</div></div>{index < flow.length - 1 && <ArrowRight className="mt-20 h-4 w-4 shrink-0 text-muted-foreground"/>}</React.Fragment>; })}<ArrowRight className="mt-20 h-4 w-4 shrink-0 text-muted-foreground"/><div className="min-w-[125px] flex-1 rounded-lg border border-blue-200 bg-blue-50 p-3 text-center"><div className="mx-auto mb-2 w-fit rounded-full bg-white p-2"><Boxes className="h-4 w-4 text-blue-600"/></div><div className="text-xs font-semibold">Siap Jual</div><div className="mt-1 text-[10px] text-muted-foreground">READY FOR SALE</div><div className="mt-4 text-[10px] text-muted-foreground">Saldo per {dateTo || 'hari ini'}</div><div className="text-sm font-bold text-blue-600">{qty(available)} {unitLabel(product?.unit)}</div></div></CardContent></Card>
      )}
      <Card><CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Stok Saat Ini (Per Gudang)</CardTitle></CardHeader><CardContent className="space-y-3 p-4 pt-2">{warehouseStock.length ? warehouseStock.map((wh, index) => { const total = warehouseStock.reduce((s, x) => s + x.quantity, 0); const percent = total ? wh.quantity / total * 100 : 0; return <div key={wh.id}><div className="mb-1 flex justify-between text-xs"><span className="font-medium">{wh.name}</span><span>{qty(wh.quantity)} {wh.unit} ({percent.toFixed(1)}%)</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${index % 2 ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${percent}%` }}/></div></div>; }) : <div className="py-16 text-center text-sm text-muted-foreground">Belum ada stok per gudang</div>}</CardContent></Card>
    </div>

    <Card><CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Pergerakan Stok</CardTitle></CardHeader><CardContent className="p-4 pt-2"><DataTable columns={columns} data={rows} loading={loading} pageSize={20} emptyMessage="Tidak ada pergerakan stok pada periode ini" searchKeys={['transaction_number','reference_type','warehouse_name','batch_number','notes']} searchPlaceholder="Cari no. transaksi / gudang / batch / keterangan..."/></CardContent></Card>

    <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]"><Card><CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Detail Informasi</CardTitle></CardHeader><CardContent className="grid gap-4 p-4 pt-2 sm:grid-cols-[72px_1fr]"><div className="flex h-20 w-20 items-center justify-center rounded-lg border bg-slate-50"><PackageCheck className="h-8 w-8 text-blue-500"/></div><div><div className="text-base font-bold">{mode === 'batch' ? `${selectedBatch?.batch_number || 'Pilih batch'} · ${product?.name || ''}` : mode === 'ready_for_sale' ? `${product?.name || 'Pilih produk siap jual'}${selectedReadyStock?.batch_number ? ` · ${selectedReadyStock.batch_number}` : ' · TANPA BATCH'}` : (selectedMaterial?.name || 'Pilih bahan')}</div><div className="mt-3 grid grid-cols-2 gap-3 text-xs md:grid-cols-4"><div><span className="text-muted-foreground">Kode</span><div className="font-semibold">{mode === 'batch' ? (selectedBatch?.production_number || product?.sku || '—') : mode === 'ready_for_sale' ? (product?.code || product?.sku || '—') : (selectedMaterial?.code || '—')}</div></div><div><span className="text-muted-foreground">Kategori</span><div className="font-semibold">{mode === 'batch' || mode === 'ready_for_sale' ? (product?.category_name || '—') : (selectedMaterial?.category_name || selectedMaterial?.material_category || selectedMaterial?.material_type || '—')}</div></div><div><span className="text-muted-foreground">Satuan</span><div className="font-semibold">{selectedUnit}</div></div><div><span className="text-muted-foreground">{mode === 'batch' ? 'Recipe' : mode === 'ready_for_sale' ? 'Gudang' : 'Supplier'}</span><div className="font-semibold">{mode === 'batch' ? (selectedRecipeForProduct?.name || selectedBatch?.recipe_code || '—') : mode === 'ready_for_sale' ? (selectedReadyStock?.warehouse_name || 'Gudang tidak diketahui') : (selectedMaterial?.supplier_name || '—')}</div></div></div></div></CardContent></Card><Card><CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Ringkasan Periode</CardTitle></CardHeader><CardContent className="space-y-3 p-4 pt-2 text-sm">{[['Saldo Awal', opening, ''], ['Total Masuk', totalIn, 'text-emerald-600'], ['Total Keluar', totalOut, 'text-red-500'], ['Saldo Akhir', opening + totalIn - totalOut, 'text-blue-600']].map(([label, value, color]) => <div key={label} className="flex justify-between border-b pb-2 last:border-0"><span>{label}</span><span className={`font-bold ${color}`}>{qty(value)} {selectedUnit}</span></div>)}</CardContent></Card></div>
  </div>;
}
