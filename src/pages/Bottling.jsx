import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import FormModal from '@/components/FormModal';
import StatusBadge from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import NumberInput from '@/components/NumberInput';
import SearchableSelect from '@/components/SearchableSelect';
import { Eye, ChevronDown, ChevronUp, Package } from 'lucide-react';
import { generateOrderNumber } from '@/lib/sequence';
import { recordStockMovement, getAllStockBalances, createAuditLog } from '@/lib/stockUtils';
import { getInventoryDisplayName } from '@/lib/inventoryDisplay';

const EMPTY_FORM = () => ({
  stock_id: '',
  source_product_id: '',
  source_product_name: '',
  source_brand_id: '',
  source_brand_name: '',
  output_product_id: '',
  batch_id: '',
  batch_number: '',
  available_bulk: '',
  bottle_item_id: '',
  bottle_count: '',
  volume_per_bottle: '',
  bottling_date: new Date().toISOString().slice(0, 10),
  operator: '',
  notes: '',
});

export default function Bottling() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [bulkStock, setBulkStock] = useState([]);
  const [products, setProducts] = useState([]);
  const [bottleMaterials, setBottleMaterials] = useState([]);
  const [bottleStocks, setBottleStocks] = useState({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM());
  const [detailItem, setDetailItem] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [items, outputs, prodBal, prods, mats, matBal, bottleProds] = await Promise.all([
        base44.entities.BottlingOrder.list('-created_date', 100),
        base44.entities.BottlingOutput.list('-created_date', 500),
        getAllStockBalances('product'),
        base44.entities.Product.filter({ is_active: true }),
        base44.entities.Material.filter({ material_type: 'BOTTLE', is_active: true }, '-created_date', 500),
        getAllStockBalances('material'),
        base44.entities.Product.filter({ is_active: true, product_type: 'botol_kosong' }),
      ]);

      const outputByOrder = {};
      (outputs || []).forEach(o => {
        if (!o?.bottling_id) return;
        if (!outputByOrder[o.bottling_id]) outputByOrder[o.bottling_id] = [];
        outputByOrder[o.bottling_id].push(o);
      });

      setData(
        (items || []).map(order => {
          const orderOutputs = outputByOrder[order.id] || [];
          const bottleCount = orderOutputs.reduce(
            (sum, o) => sum + (Number(o.bottle_count) || 0),
            0
          );
          const productNames = [...new Set(
            orderOutputs.map(o => o.product_name).filter(Boolean)
          )];

          return {
            ...order,
            outputs: orderOutputs,
            output_product_name: productNames.join(', '),
            bottle_count: bottleCount,
          };
        })
      );
      setBulkStock(prodBal.filter(b => b.inventory_status === 'BULK' && b.quantity > 0));
      setProducts(prods);

      const combined = [...mats, ...bottleProds];
      setBottleMaterials(combined);

      const ids = new Set(combined.map(x => x.id));
      const stockMap = {};
      [...matBal, ...prodBal].forEach(b => {
        if (ids.has(b.item_id)) {
          stockMap[b.item_id] = (stockMap[b.item_id] || 0) + (Number(b.available_quantity) || 0);
        }
      });
      setBottleStocks(stockMap);
    } catch {
      toast({ variant: 'destructive', title: 'Gagal memuat data' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const openAdd = () => {
    setForm(EMPTY_FORM());
    setModalOpen(false);
  };

  const selectBulkStock = (stockId) => {
    const stock = bulkStock.find(b => b.id === stockId);
    const source = products.find(p => p.id === stock?.item_id);

    setForm(current => ({
      ...current,
      stock_id: stockId,
      source_product_id: stock?.item_id || '',
      source_product_name: source?.name || stock?.item_name || '',
      source_brand_id: source?.brand_id || '',
      source_brand_name: source?.brand_name || '',
      output_product_id: '',
      batch_id: stock?.batch_id || '',
      batch_number: stock?.batch_number || '',
      available_bulk:
        stock?.available_quantity ??
        stock?.quantity ??
        '',
      bottle_item_id: '',
      bottle_count: '',
      volume_per_bottle: '',
    }));
  };

  const totalVolume =
    (Number(form.bottle_count) || 0) *
    (Number(form.volume_per_bottle) || 0);

  const outputProducts = products.filter(p => p.product_type !== 'botol_kosong');

  const selectedOutputProduct =
    products.find(p => p.id === form.output_product_id);

  const inferBottleSize = (item) => {
    const direct = Number(
      item?.bottle_size ??
      item?.volume ??
      item?.size_ml ??
      item?.capacity_ml
    );

    if (direct > 0) return direct;

    const text = `${item?.name || ''} ${item?.code || ''}`;
    const match = text.match(/(\d+(?:[.,]\d+)?)\s*ml\b/i);

    return match
      ? Number(String(match[1]).replace(',', '.'))
      : 0;
  };

  const availableBottleSizes = [
    ...new Set(
      bottleMaterials
        .filter(m => Number(bottleStocks[m.id] || 0) > 0)
        .map(inferBottleSize)
        .filter(size => size > 0)
    )
  ].sort((a, b) => a - b);

  const selectedBottleSize =
    Number(form.volume_per_bottle) || 0;

  const filteredBottleMaterials =
    bottleMaterials
      .filter(m => {
        const stock = Number(bottleStocks[m.id] || 0);
        if (stock <= 0) return false;

        if (!selectedBottleSize) return true;

        return inferBottleSize(m) === selectedBottleSize;
      })
      .sort((a, b) =>
        String(a.name || '').localeCompare(
          String(b.name || '')
        )
      );

  const totalBulkAvailable =
    bulkStock.reduce(
      (sum, row) =>
        sum +
        Number(
          row.available_quantity ??
          row.quantity ??
          0
        ),
      0
    );

  const totalBottleAvailable =
    Object.values(bottleStocks).reduce(
      (sum, qty) =>
        sum +
        Number(qty || 0),
      0
    );

  const handleSubmit = async () => {
    if (
      !form.stock_id ||
      !form.output_product_id ||
      !form.bottle_item_id ||
      !form.bottle_count ||
      !form.volume_per_bottle ||
      !form.operator
    ) {
      toast({
        variant: 'destructive',
        title: 'Lengkapi: batch bulk, produk jadi, botol, jumlah botol, volume, operator',
      });
      return;
    }

    if (totalVolume > Number(form.available_bulk)) {
      toast({
        variant: 'destructive',
        title: 'Volume melebihi bulk tersedia',
        description: `Tersedia: ${form.available_bulk} ml`,
      });
      return;
    }

    const sourceProduct = products.find(p => p.id === form.source_product_id);
    const outputProduct = products.find(p => p.id === form.output_product_id);
    const bottleMat = bottleMaterials.find(m => m.id === form.bottle_item_id);
    const bottleStock = bottleStocks[form.bottle_item_id] || 0;

    if (!sourceProduct) {
      toast({ variant: 'destructive', title: 'Produk sumber bulk tidak ditemukan' });
      return;
    }

    if (!outputProduct) {
      toast({ variant: 'destructive', title: 'Produk jadi tidak ditemukan' });
      return;
    }

    if (!bottleMat) {
      toast({ variant: 'destructive', title: 'Botol tidak ditemukan' });
      return;
    }

    if (Number(form.bottle_count) > bottleStock) {
      toast({
        variant: 'destructive',
        title: 'Stok botol tidak cukup',
        description: `Tersedia: ${bottleStock}`,
      });
      return;
    }

    setSubmitting(true);

    try {
      const botNumber = await generateOrderNumber('BOT', 'BottlingOrder');

      const order = await base44.entities.BottlingOrder.create({
        bottling_number: botNumber,
        production_id: '',
        batch_number: form.batch_number,
        bottling_date: form.bottling_date,
        operator: form.operator,
        total_bulk_processed: totalVolume,
        total_output: totalVolume,
        waste: 0,
        remaining_bulk: Number(form.available_bulk) - totalVolume,
        status: 'siap_labeling',
        notes: form.notes,
      });

      await base44.entities.BottlingOutput.create({
        bottling_id: order.id,
        product_id: outputProduct.id,
        product_name: outputProduct.name,
        bottle_size: Number(form.volume_per_bottle),
        bottle_count: Number(form.bottle_count),
        volume_per_bottle: Number(form.volume_per_bottle),
        total_volume: totalVolume,
        bottle_item_id: bottleMat.id,
        bottle_item_code: bottleMat.code || '',
        bottle_item_name: bottleMat.name,
        bottle_stock_used: Number(form.bottle_count),
        output_status: 'siap_labeling',
      });

      /*
       * v3.4 — BOTTLING AS SKU GATEWAY
       *
       * Consumption tetap mengambil identitas PRODUCT SUMBER BULK.
       * Output memakai PRODUCT JADI yang dipilih pada Bottling.
       *
       * Dengan ini:
       * BULK parent  -> BOTL SKU 15 ml / 30 ml / dst
       *
       * HPP output:
       * (bulk frozen cost/ml × volume) + bottle HBT
       */
      const bulkLedgers = await base44.entities.StockLedger.filter({
        batch_id: form.batch_id,
        item_id: sourceProduct.id,
        inventory_status: 'BULK',
        transaction_type: 'production_output',
      });

      const latestBulkLedger = [...(bulkLedgers || [])].sort(
        (a, b) =>
          new Date(b.transaction_date || b.created_date || 0).getTime() -
          new Date(a.transaction_date || a.created_date || 0).getTime()
      )[0];

      const hppBulkPerMl = Number(latestBulkLedger?.unit_cost) || 0;
      const bottleHbt = Number(bottleMat?.last_purchase_price) || 0;
      const bottleQty = Number(form.bottle_count);

      const bulkCost = totalVolume * hppBulkPerMl;
      const bottleCost = bottleQty * bottleHbt;
      const totalBottlingCost = bulkCost + bottleCost;
      const hppBottlingPerBottle =
        bottleQty > 0 ? totalBottlingCost / bottleQty : 0;

      const safeHppBottling =
        Number.isFinite(hppBottlingPerBottle) ? hppBottlingPerBottle : 0;

      // 1) Consume BULK SOURCE
      await recordStockMovement({
        item_type: 'product',
        item_id: sourceProduct.id,
        item_name: sourceProduct.name || form.source_product_name,
        item_code: sourceProduct.code || '',
        batch_id: form.batch_id,
        batch_number: form.batch_number,
        inventory_status: 'BULK',
        quantity_out: totalVolume,
        unit: 'mililiter',
        unit_cost: hppBulkPerMl,
        transaction_type: 'bottling_consumption',
        transaction_number: botNumber,
        reference_type: 'bottling',
        reference_id: order.id,
        notes: `Bottling ${botNumber}`,
      });

      // 2) Consume BOTTLE
      await recordStockMovement({
        item_type: bottleMat.material_type ? 'material' : 'product',
        item_id: bottleMat.id,
        item_name: bottleMat.name,
        item_code: bottleMat.code || '',
        inventory_status: '',
        quantity_out: bottleQty,
        unit: bottleMat.unit || 'unit',
        unit_cost: bottleHbt,
        transaction_type: 'bottling_bottle_consumption',
        transaction_number: botNumber,
        reference_type: 'bottling',
        reference_id: order.id,
        notes: `Botol untuk ${botNumber}`,
      });

      // 3) Create BOTTLING OUTPUT as selected FINAL SKU
      await recordStockMovement({
        item_type: 'product',
        item_id: outputProduct.id,
        item_name: outputProduct.name,
        item_code: outputProduct.code || '',
        batch_id: form.batch_id,
        batch_number: form.batch_number,
        inventory_status: 'READY_FOR_LABELING',
        quantity_in: bottleQty,
        unit: 'unit',
        unit_cost: safeHppBottling,
        transaction_type: 'bottling_output',
        transaction_number: botNumber,
        reference_type: 'bottling',
        reference_id: order.id,
        notes: `Output bottling ${botNumber} · source ${sourceProduct.name || form.source_product_name}`,
      });

      await createAuditLog({
        module: 'Bottling',
        action: 'Selesai',
        entity_type: 'BottlingOrder',
        entity_id: order.id,
        reference_number: botNumber,
        data_after: {
          source_product_id: sourceProduct.id,
          source_product_name: sourceProduct.name,
          output_product_id: outputProduct.id,
          output_product_name: outputProduct.name,
          batch_number: form.batch_number,
          bottle_size: Number(form.volume_per_bottle),
          bottle_count: bottleQty,
          hpp_bulk_per_ml: hppBulkPerMl,
          hpp_bottling_per_bottle: safeHppBottling,
        },
      });

      toast({
        title: 'Bottling selesai',
        description: `${botNumber} · Output: ${outputProduct.name}`,
      });

      openAdd();
      loadData();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Gagal menyimpan',
        description: e.message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openDetail = (row) => {
    setDetailItem(row);
  };

  const detailOutputs = detailItem?.outputs || [];

  const detailColumns = [
    { key: 'product_name', header: 'Produk Output', className: 'font-medium', render: r => r.product_name || '—' },
    { key: 'bottle_size', header: 'Ukuran', render: r => `${Number(r.bottle_size || r.volume_per_bottle) || 0} ml` },
    { key: 'bottle_count', header: 'Jumlah Botol', render: r => <span className="tabular-nums">{Number(r.bottle_count) || 0} botol</span> },
    { key: 'total_volume', header: 'Volume Output', render: r => <span className="tabular-nums">{Number(r.total_volume) || 0} ml</span> },
    { key: 'bottle_item_name', header: 'Botol', render: r => r.bottle_item_name || '—' },
    { key: 'output_status', header: 'Status', render: r => <StatusBadge status={r.output_status} /> },
  ];

  const columns = [
    { key: 'bottling_number', header: 'No. Bottling', sortable: true, className: 'font-mono font-medium' },
    { key: 'bottling_date', header: 'Tanggal', sortable: true },
    { key: 'output_product_name', header: 'Produk Output', sortable: true, render: r => r.output_product_name || '—' },
    { key: 'bottle_count', header: 'Jumlah Botol', sortable: true, render: r => <span className="tabular-nums">{Number(r.bottle_count) || 0} botol</span> },
    { key: 'total_output', header: 'Volume Output', render: r => <span className="tabular-nums">{r.total_output} ml</span> },
    { key: 'remaining_bulk', header: 'Sisa Bulk', render: r => <span className="tabular-nums">{r.remaining_bulk} ml</span> },
    { key: 'operator', header: 'Operator', render: r => r.operator || '—' },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
    {
      key: 'actions',
      header: 'Aksi',
      width: '80px',
      render: row => (
        <button
          type="button"
          onClick={() => openDetail(row)}
          className="p-1.5 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground transition-colors"
          title="Lihat Work Order"
          aria-label={`Lihat Work Order ${row.bottling_number || ''}`}
        >
          <Eye className="w-4 h-4" />
        </button>
      ),
    },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader
        title="Bottling"
        description="Workstation bottling · pilih bulk siap bottling, SKU output, ukuran dan botol."
      />

      {/* MINI DASHBOARD */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg border bg-white p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Siap Bottling
          </div>
          <div className="mt-1 text-2xl font-bold text-violet-600">
            {bulkStock.length}
          </div>
          <div className="text-[10.5px] text-muted-foreground">
            batch bulk
          </div>
        </div>

        <div className="rounded-lg border bg-white p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Bulk Tersedia
          </div>
          <div className="mt-1 text-xl font-bold text-emerald-600 tabular-nums">
            {totalBulkAvailable.toLocaleString('id-ID')}
          </div>
          <div className="text-[10.5px] text-muted-foreground">
            ml
          </div>
        </div>

        <div className="rounded-lg border bg-white p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Botol Tersedia
          </div>
          <div className="mt-1 text-xl font-bold text-blue-600 tabular-nums">
            {totalBottleAvailable.toLocaleString('id-ID')}
          </div>
          <div className="text-[10.5px] text-muted-foreground">
            pcs semua ukuran
          </div>
        </div>

        <div className="rounded-lg border bg-white p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Ukuran Botol
          </div>
          <div className="mt-1 text-2xl font-bold">
            {availableBottleSizes.length}
          </div>
          <div className="text-[10.5px] text-muted-foreground">
            ukuran tersedia
          </div>
        </div>
      </div>

      {/* SIAP BOTTLING — COLLAPSIBLE */}
      <div className="rounded-lg border bg-white mb-4 overflow-hidden">
        <button
          type="button"
          onClick={() => setReadinessOpen(v => !v)}
          className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-muted/20"
        >
          <div>
            <div className="font-semibold text-[14px]">
              Siap Bottling
            </div>
            <div className="text-[11px] text-muted-foreground">
              Klik batch untuk langsung mengisi form.
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
              {bulkStock.length} batch
            </span>
            {readinessOpen
              ? <ChevronUp className="w-4 h-4" />
              : <ChevronDown className="w-4 h-4" />
            }
          </div>
        </button>

        {readinessOpen && (
          <div className="border-t overflow-x-auto max-h-[300px]">
            <table className="w-full text-[12px]">
              <thead className="bg-muted/40 text-muted-foreground sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left">Batch</th>
                  <th className="px-3 py-2 text-left">Produk</th>
                  <th className="px-3 py-2 text-left">Merk</th>
                  <th className="px-3 py-2 text-right">Bulk</th>
                  <th className="px-3 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {bulkStock.map(stock => {
                  const source =
                    products.find(
                      p => p.id === stock.item_id
                    );

                  const available =
                    Number(
                      stock.available_quantity ??
                      stock.quantity ??
                      0
                    );

                  return (
                    <tr
                      key={stock.id}
                      onClick={() =>
                        selectBulkStock(stock.id)
                      }
                      className={`border-t cursor-pointer hover:bg-violet-50/50 ${
                        form.stock_id === stock.id
                          ? 'bg-violet-50'
                          : ''
                      }`}
                    >
                      <td className="px-3 py-2 font-mono">
                        {stock.batch_number || '—'}
                      </td>
                      <td className="px-3 py-2 font-medium">
                        {getInventoryDisplayName(
                          source?.name ||
                          stock.item_name,
                          'BULK'
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {source?.brand_name || '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {available.toLocaleString('id-ID')} ml
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="inline-flex rounded bg-emerald-100 px-2 py-1 text-[10.5px] font-semibold text-emerald-700">
                          SIAP
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {!loading &&
                bulkStock.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-8 text-center text-muted-foreground"
                    >
                      Tidak ada bulk yang siap bottling.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* FORM BOTTLING DEDICATED */}
      <div className="rounded-lg border bg-white mb-5 overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-[14px]">
              Form Bottling
            </div>
            <div className="text-[11px] text-muted-foreground">
              Bulk → SKU output → ukuran botol → material botol.
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openAdd}
          >
            Reset Form
          </Button>
        </div>

        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-4">
            <div className="text-[12.5px] font-semibold">
              1. Informasi Sumber Bulk
            </div>

            <div>
              <Label className="text-[12.5px] mb-1">
                Batch Bulk (Siap Bottling) *
              </Label>
              <Select
                value={form.stock_id}
                onValueChange={
                  selectBulkStock
                }
              >
                <SelectTrigger className="h-9 text-[13px]">
                  <SelectValue placeholder="Pilih batch bulk" />
                </SelectTrigger>

                <SelectContent>
                  {bulkStock.map(stock => {
                    const source =
                      products.find(
                        p =>
                          p.id ===
                          stock.item_id
                      );

                    return (
                      <SelectItem
                        key={stock.id}
                        value={stock.id}
                      >
                        {getInventoryDisplayName(
                          source?.name ||
                          stock.item_name,
                          'BULK'
                        )}
                        {' '}(
                        {
                          stock.available_quantity ??
                          stock.quantity ??
                          0
                        } ml)
                        {stock.batch_number
                          ? ` · ${stock.batch_number}`
                          : ''
                        }
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[12.5px] mb-1">
                  Produk Sumber
                </Label>
                <Input
                  value={form.source_product_name}
                  disabled
                  className="h-9 text-[13px] bg-muted/40"
                />
              </div>

              <div>
                <Label className="text-[12.5px] mb-1">
                  Merk Sumber
                </Label>
                <Input
                  value={form.source_brand_name}
                  disabled
                  className="h-9 text-[13px] bg-muted/40"
                />
              </div>

              <div>
                <Label className="text-[12.5px] mb-1">
                  Batch
                </Label>
                <Input
                  value={form.batch_number}
                  disabled
                  className="h-9 text-[13px] bg-muted/40"
                />
              </div>

              <div>
                <Label className="text-[12.5px] mb-1">
                  Bulk Tersedia (ml)
                </Label>
                <Input
                  value={form.available_bulk}
                  disabled
                  className="h-9 text-[13px] bg-muted/40"
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="text-[12.5px] font-semibold mb-3">
                2. Produk Jadi / Output
              </div>

              <Label className="text-[12.5px] mb-1">
                Produk Jadi / SKU Output *
              </Label>

              <SearchableSelect
                value={form.output_product_id}
                onValueChange={v => {
                  const output =
                    products.find(
                      p => p.id === v
                    );

                  const size =
                    Number(
                      output?.bottle_size
                    ) > 0
                      ? Number(
                          output.bottle_size
                        )
                      : form.volume_per_bottle;

                  setForm(current => ({
                    ...current,
                    output_product_id: v,
                    volume_per_bottle: size,
                    bottle_item_id: ''
                  }));
                }}
                options={outputProducts.map(p => ({
                  value: p.id,
                  label:
                    `${p.name}` +
                    `${p.brand_name ? ` · ${p.brand_name}` : ''}` +
                    `${p.bottle_size ? ` (${p.bottle_size}ml)` : ''}`,
                  keywords:
                    `${p.code || ''} ${p.name || ''} ${p.brand_name || ''} ${p.bottle_size || ''}`,
                }))}
                placeholder="Cari & pilih produk jadi"
              />

              {selectedOutputProduct && (
                <div className="mt-3 rounded-md bg-muted/30 p-3">
                  <div className="text-[11px] text-muted-foreground mb-2">
                    Ukuran Output
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {availableBottleSizes.map(size => (
                      <button
                        key={size}
                        type="button"
                        onClick={() =>
                          setForm(current => ({
                            ...current,
                            volume_per_bottle: size,
                            bottle_item_id: ''
                          }))
                        }
                        className={`rounded-md border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                          selectedBottleSize === size
                            ? 'border-violet-500 bg-violet-600 text-white'
                            : 'bg-white hover:bg-muted'
                        }`}
                      >
                        {size} ml
                      </button>
                    ))}

                    {availableBottleSizes.length === 0 && (
                      <span className="text-[11px] text-amber-600">
                        Ukuran botol belum dapat dibaca dari nama/master botol.
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="text-[12.5px] font-semibold">
              3. Pilih Botol
              {selectedBottleSize > 0
                ? ` · ${selectedBottleSize} ml`
                : ''
              }
            </div>

            {!selectedBottleSize ? (
              <div className="rounded-lg border border-dashed p-5 text-center">
                <Package className="w-7 h-7 mx-auto mb-2 text-muted-foreground" />
                <div className="text-[12px] font-medium">
                  Pilih produk / ukuran output terlebih dahulu
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  Material botol akan difilter sesuai ukuran.
                </div>
              </div>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <div className="px-3 py-2 bg-blue-50 text-blue-700 text-[11px]">
                  Menampilkan botol ukuran <b>{selectedBottleSize} ml</b> yang stoknya tersedia.
                </div>

                <div className="divide-y max-h-[250px] overflow-y-auto">
                  {filteredBottleMaterials.map(m => {
                    const stock =
                      Number(
                        bottleStocks[m.id] ||
                        0
                      );

                    const selected =
                      form.bottle_item_id ===
                      m.id;

                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() =>
                          setForm(current => ({
                            ...current,
                            bottle_item_id: m.id
                          }))
                        }
                        className={`w-full px-3 py-2.5 flex items-center gap-3 text-left hover:bg-muted/30 ${
                          selected
                            ? 'bg-violet-50'
                            : ''
                        }`}
                      >
                        <span
                          className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                            selected
                              ? 'border-violet-600'
                              : 'border-muted-foreground/40'
                          }`}
                        >
                          {selected && (
                            <span className="w-2 h-2 rounded-full bg-violet-600" />
                          )}
                        </span>

                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-[12px] truncate">
                            {m.name}
                          </div>
                          <div className="text-[10.5px] text-muted-foreground">
                            {m.code || '—'}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-[12px] font-semibold tabular-nums">
                            {stock.toLocaleString('id-ID')}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {m.unit || 'pcs'}
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {filteredBottleMaterials.length === 0 && (
                    <div className="px-3 py-6 text-center text-[11px] text-amber-600">
                      Tidak ada stok botol {selectedBottleSize} ml.
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="border-t pt-4">
              <div className="text-[12.5px] font-semibold mb-3">
                4. Rencana Bottling
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[12.5px] mb-1">
                    Jumlah Botol *
                  </Label>
                  <NumberInput
                    value={form.bottle_count}
                    onChange={v =>
                      setForm(current => ({
                        ...current,
                        bottle_count: v
                      }))
                    }
                    allowDecimal={false}
                    min={0}
                    className="h-9 text-[13px]"
                  />
                </div>

                <div>
                  <Label className="text-[12.5px] mb-1">
                    Volume/Botol
                  </Label>
                  <Input
                    value={
                      selectedBottleSize
                        ? `${selectedBottleSize} ml`
                        : ''
                    }
                    disabled
                    className="h-9 text-[13px] bg-muted/40"
                  />
                </div>

                <div>
                  <Label className="text-[12.5px] mb-1">
                    Total Volume
                  </Label>
                  <Input
                    value={
                      totalVolume
                        ? `${totalVolume} ml`
                        : ''
                    }
                    disabled
                    className="h-9 text-[13px] bg-muted/40"
                  />
                </div>

                <div>
                  <Label className="text-[12.5px] mb-1">
                    Tanggal
                  </Label>
                  <Input
                    type="date"
                    value={form.bottling_date}
                    onChange={e =>
                      setForm(current => ({
                        ...current,
                        bottling_date:
                          e.target.value
                      }))
                    }
                    className="h-9 text-[13px]"
                  />
                </div>

                <div className="col-span-2">
                  <Label className="text-[12.5px] mb-1">
                    Operator *
                  </Label>
                  <Input
                    value={form.operator}
                    onChange={e =>
                      setForm(current => ({
                        ...current,
                        operator:
                          e.target.value
                      }))
                    }
                    className="h-9 text-[13px]"
                  />
                </div>
              </div>

              <div className="mt-3">
                <Label className="text-[12.5px] mb-1">
                  Catatan
                </Label>
                <Textarea
                  value={form.notes}
                  onChange={e =>
                    setForm(current => ({
                      ...current,
                      notes:
                        e.target.value
                    }))
                  }
                  rows={2}
                  className="text-[13px]"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t bg-muted/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-[11px] text-muted-foreground">
            {form.available_bulk
              ? `Bulk tersedia ${Number(form.available_bulk).toLocaleString('id-ID')} ml`
              : 'Pilih batch bulk untuk mulai.'
            }
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={openAdd}
            >
              Bersihkan
            </Button>

            <Button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting
                ? 'Memproses...'
                : 'Proses Bottling'
              }
            </Button>
          </div>
        </div>
      </div>

      {/* RIWAYAT */}
      <div className="mb-2">
        <div className="font-semibold text-[14px]">
          Riwayat Bottling
        </div>
        <div className="text-[11px] text-muted-foreground">
          Work order Bottling yang sudah diproses.
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        emptyMessage="Belum ada bottling"
        searchKeys={[
          'bottling_number',
          'batch_number',
          'operator',
          'output_product_name'
        ]}
        searchPlaceholder="Cari bottling..."
      />

      {/* Detail work order existing tetap popup */}
      <FormModal
        open={!!detailItem}
        onClose={() => setDetailItem(null)}
        title={
          detailItem
            ? `Work Order ${detailItem.bottling_number}`
            : 'Detail Work Order Bottling'
        }
        onSubmit={() => setDetailItem(null)}
        submitLabel="Tutup"
        size="lg"
      >
        {detailItem && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-[12.5px]">
              <div>
                <span className="text-muted-foreground">
                  No. Bottling
                </span>
                <div className="font-mono font-medium">
                  {detailItem.bottling_number || '—'}
                </div>
              </div>

              <div>
                <span className="text-muted-foreground">
                  Tanggal
                </span>
                <div>
                  {detailItem.bottling_date || '—'}
                </div>
              </div>

              <div>
                <span className="text-muted-foreground">
                  Batch
                </span>
                <div className="font-mono">
                  {detailItem.batch_number || '—'}
                </div>
              </div>

              <div>
                <span className="text-muted-foreground">
                  Operator
                </span>
                <div>
                  {detailItem.operator || '—'}
                </div>
              </div>

              <div>
                <span className="text-muted-foreground">
                  Status
                </span>
                <div className="mt-0.5">
                  <StatusBadge
                    status={detailItem.status}
                  />
                </div>
              </div>

              <div>
                <span className="text-muted-foreground">
                  Produk Output
                </span>
                <div className="font-medium">
                  {detailItem.output_product_name || '—'}
                </div>
              </div>

              <div>
                <span className="text-muted-foreground">
                  Jumlah Botol
                </span>
                <div className="tabular-nums font-medium">
                  {Number(detailItem.bottle_count) || 0} botol
                </div>
              </div>

              <div>
                <span className="text-muted-foreground">
                  Volume Output
                </span>
                <div className="tabular-nums">
                  {Number(detailItem.total_output) || 0} ml
                </div>
              </div>

              <div>
                <span className="text-muted-foreground">
                  Sisa Bulk
                </span>
                <div className="tabular-nums">
                  {Number(detailItem.remaining_bulk) || 0} ml
                </div>
              </div>
            </div>

            <div>
              <div className="text-[12.5px] font-semibold mb-2">
                Detail Output Bottling
              </div>

              <DataTable
                columns={detailColumns}
                data={detailOutputs}
                searchable={false}
                pageSize={50}
                emptyMessage="Tidak ada detail output"
              />
            </div>

            {detailItem.notes && (
              <div className="rounded-md border border-border bg-muted/20 p-3 text-[12px]">
                <span className="font-medium">
                  Catatan:
                </span>
                {' '}
                {detailItem.notes}
              </div>
            )}
          </div>
        )}
      </FormModal>
    </div>
  );
}