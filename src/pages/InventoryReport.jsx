import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Boxes, Package, Layers, AlertTriangle, Wallet, Download } from 'lucide-react';
import { resolveBalanceUnitCost, buildStageCostIndex, resolvePgVgMaterials } from '@/lib/inventoryCost';
import { getInventoryDisplayName } from '@/lib/inventoryDisplay';
import { formatCurrency as fmtMoney, formatNumber } from '@/lib/format';

const STATUS_LABEL = {
  RAW_MATERIAL: 'Bahan Baku',
  PREMIX: 'Premix',
  BULK: 'Hasil Mixing',
  READY_FOR_LABELING: 'Siap Labeling',
  UNEXCISED: 'Belum Cukai',
  READY_FOR_SALE: 'Siap Jual',
  QUARANTINE: 'Karantina',
  REJECTED: 'Ditolak',
};

// Materials keep inventory_status '' (backward-compat with purchase-created
// balances) — normalize to RAW_MATERIAL for display & filtering.
const normalizeStatus = (b) =>
  (!b.inventory_status && b.item_type === 'material') ? 'RAW_MATERIAL' : (b.inventory_status || '');

const fmtQty = (v) => formatNumber(v, 3);

function MiniKpi({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-white border border-border rounded-lg p-3.5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</div>
          <div className="text-lg font-bold mt-1 tabular-nums">{value}</div>
        </div>
        <div className={`w-9 h-9 rounded-md flex items-center justify-center ${color}`}>
          <Icon className="w-4.5 h-4.5" />
        </div>
      </div>
    </div>
  );
}

export default function InventoryReport() {
  const { toast } = useToast();
  const [balances, setBalances] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [products, setProducts] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [b, m, p, recs, ings, maps] = await Promise.all([
        base44.entities.StockBalance.list('-updated_date', 1000),
        base44.entities.Material.list(),
        base44.entities.Product.list(),
        base44.entities.Recipe.list('-created_date', 500),
        base44.entities.RecipeIngredient.list('-created_date', 3000),
        base44.entities.ProductComponentMapping.list('-created_date', 3000),
      ]);
      setBalances(b);
      setMaterials(m);
      setProducts(p);
      setRecipes(recs);
      setIngredients(ings);
      setMappings(maps);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data inventaris' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const materialById = useMemo(() => {
    const map = {};
    materials.forEach((x) => { map[x.id] = x; });
    return map;
  }, [materials]);

  const { pgMaterial, vgMaterial } = useMemo(() => resolvePgVgMaterials(materials), [materials]);

  const stageCostIndex = useMemo(
    () => buildStageCostIndex({ products, recipes, ingredients, materials, mappings, pgMaterial, vgMaterial }),
    [products, recipes, ingredients, materials, mappings, pgMaterial, vgMaterial]
  );

  const rows = useMemo(() => {
    return balances
      .filter((b) => {
        if (!b.item_id) return false;
        if (!filterStatus) return true;
        return normalizeStatus(b) === filterStatus;
      })
      .map((b) => {
        const qty = Number(b.quantity) || 0;
        const normalizedStatus = normalizeStatus(b);
        const unitCost = resolveBalanceUnitCost(
          { item_type: b.item_type, item_id: b.item_id, inventory_status: normalizedStatus },
          { materialById, stageCostIndex }
        );
        const isProduct = b.item_type === 'product';
        return {
          ...b,
          inventory_status: normalizedStatus,
          status_label: STATUS_LABEL[normalizedStatus] || normalizedStatus || '—',
          display_name: isProduct ? getInventoryDisplayName(b.item_name, normalizedStatus) : (b.item_name || '—'),
          unit_cost: unitCost,
          nilai_stok: qty * unitCost,
        };
      });
  }, [balances, materialById, stageCostIndex, filterStatus]);

  const summary = useMemo(() => {
    const activeMaterials = materials.filter((m) => m.is_active).length;
    const activeProducts = products.filter((p) => p.is_active).length;
    const totalBaris = balances.length;
    const lowStock = materials.filter((m) => {
      const mBalances = balances.filter((b) => b.item_id === m.id && b.item_type === 'material');
      const avail = mBalances.reduce((s, b) => s + (Number(b.available_quantity) || 0), 0);
      return m.min_stock > 0 && avail <= m.min_stock;
    }).length;
    const totalNilai = rows.reduce((s, r) => s + (Number(r.nilai_stok) || 0), 0);
    return { activeMaterials, activeProducts, totalBaris, lowStock, totalNilai };
  }, [materials, products, rows]);

  const exportCSV = () => {
    const headers = ['Kode', 'Nama', 'Status', 'Batch', 'Gudang', 'Qty', 'Reserved', 'Tersedia', 'Unit', 'HPP/Unit', 'Nilai Stok'];
    const csv = [headers, ...rows.map((r) => [
      r.item_code || '', r.display_name || r.item_name || '', r.status_label, r.batch_number || '',
      r.warehouse_name || '', r.quantity, r.reserved_quantity, r.available_quantity,
      r.unit || '', r.unit_cost, r.nilai_stok,
    ])].map((row) => row.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `laporan-inventaris-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Laporan inventaris diexport' });
  };

  const columns = [
    { key: 'item_code', header: 'Kode', sortable: true, className: 'font-mono font-medium' },
    { key: 'display_name', header: 'Nama', sortable: true, className: 'font-medium' },
    { key: 'status_label', header: 'Status', render: (r) => <span className="text-[11.5px] px-2 py-0.5 rounded bg-muted">{r.status_label}</span> },
    { key: 'batch_number', header: 'Batch', render: (r) => r.batch_number || '—' },
    { key: 'warehouse_name', header: 'Gudang', render: (r) => r.warehouse_name || '—' },
    { key: 'quantity', header: 'Qty', sortable: true, render: (r) => <span className="tabular-nums">{fmtQty(r.quantity)} {r.unit || ''}</span> },
    { key: 'reserved_quantity', header: 'Reserved', render: (r) => <span className="tabular-nums text-muted-foreground">{fmtQty(r.reserved_quantity)}</span> },
    { key: 'available_quantity', header: 'Tersedia', render: (r) => <span className="tabular-nums font-medium">{fmtQty(r.available_quantity)}</span> },
    { key: 'unit_cost', header: 'HPP/Unit', sortable: true, render: (r) => <span className="tabular-nums text-muted-foreground">{fmtMoney(r.unit_cost)}</span> },
    { key: 'nilai_stok', header: 'Nilai Stok', sortable: true, render: (r) => <span className="tabular-nums font-medium">{fmtMoney(r.nilai_stok)}</span> },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader
        title="Laporan Inventaris"
        description="Ringkasan stok per tahapan dan estimasi nilai persediaan (admin only)"
        actions={<Button onClick={exportCSV} size="sm" variant="outline" className="gap-1.5"><Download className="w-4 h-4" /> Export CSV</Button>}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        <MiniKpi icon={Boxes} label="Jenis Bahan" value={summary.activeMaterials} color="bg-blue-50 text-blue-600" />
        <MiniKpi icon={Package} label="Jenis Barang" value={summary.activeProducts} color="bg-violet-50 text-violet-600" />
        <MiniKpi icon={Layers} label="Baris Stok" value={summary.totalBaris} color="bg-slate-100 text-slate-600" />
        <MiniKpi icon={AlertTriangle} label="Stok Rendah" value={summary.lowStock} color="bg-red-50 text-red-600" />
        <MiniKpi icon={Wallet} label="Estimasi Nilai" value={fmtMoney(summary.totalNilai)} color="bg-emerald-50 text-emerald-600" />
      </div>

      <div className="bg-white border border-border rounded-lg p-3 mb-3 flex flex-col sm:flex-row sm:items-end gap-2.5">
        <div className="w-full sm:w-64">
          <Label className="text-[11px] mb-1">Filter Status Stok</Label>
          <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Semua Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        emptyMessage="Belum ada data stok"
        searchKeys={['item_code', 'item_name', 'display_name', 'batch_number', 'warehouse_name']}
        searchPlaceholder="Cari item, batch, gudang..."
      />
    </div>
  );
}