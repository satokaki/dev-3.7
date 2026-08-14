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
import { Plus } from 'lucide-react';
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
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM());

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
    setModalOpen(true);
  };

  const totalVolume =
    (Number(form.bottle_count) || 0) *
    (Number(form.volume_per_bottle) || 0);

  const outputProducts = products.filter(p => p.product_type !== 'botol_kosong');

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

      setModalOpen(false);
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

  const columns = [
    { key: 'bottling_number', header: 'No. Bottling', sortable: true, className: 'font-mono font-medium' },
    { key: 'bottling_date', header: 'Tanggal', sortable: true },
    { key: 'output_product_name', header: 'Produk Output', sortable: true, render: r => r.output_product_name || '—' },
    { key: 'bottle_count', header: 'Jumlah Botol', sortable: true, render: r => <span className="tabular-nums">{Number(r.bottle_count) || 0} botol</span> },
    { key: 'total_output', header: 'Volume Output', render: r => <span className="tabular-nums">{r.total_output} ml</span> },
    { key: 'remaining_bulk', header: 'Sisa Bulk', render: r => <span className="tabular-nums">{r.remaining_bulk} ml</span> },
    { key: 'operator', header: 'Operator', render: r => r.operator || '—' },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader
        title="Bottling"
        description="Bottling bulk → SKU botol (siap labeling). Produk Jadi dipilih saat Bottling."
        actions={
          <Button onClick={openAdd} size="sm" className="gap-1.5">
            <Plus className="w-4 h-4" /> Bottling Baru
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        emptyMessage="Belum ada bottling"
        searchKeys={['bottling_number', 'batch_number', 'operator', 'output_product_name']}
        searchPlaceholder="Cari bottling..."
      />

      <FormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Bottling Baru"
        onSubmit={handleSubmit}
        submitting={submitting}
        submitLabel="Proses Bottling"
        size="lg"
      >
        <div>
          <Label className="text-[12.5px] mb-1">Batch Bulk (Siap Bottling) *</Label>
          <Select
            value={form.stock_id}
            onValueChange={v => {
              const stock = bulkStock.find(b => b.id === v);
              const source = products.find(p => p.id === stock?.item_id);

              setForm(current => ({
                ...current,
                stock_id: v,
                source_product_id: stock?.item_id || '',
                source_product_name: source?.name || stock?.item_name || '',
                source_brand_id: source?.brand_id || '',
                source_brand_name: source?.brand_name || '',
                output_product_id: '',
                batch_id: stock?.batch_id || '',
                batch_number: stock?.batch_number || '',
                available_bulk: stock?.available_quantity || '',
                volume_per_bottle: '',
              }));
            }}
          >
            <SelectTrigger className="h-9 text-[13px]">
              <SelectValue placeholder="Pilih batch bulk" />
            </SelectTrigger>
            <SelectContent>
              {bulkStock.map(stock => {
                const source = products.find(p => p.id === stock.item_id);
                return (
                  <SelectItem key={stock.id} value={stock.id}>
                    {getInventoryDisplayName(source?.name || stock.item_name, 'BULK')}
                    {' '}({stock.available_quantity} ml)
                    {stock.batch_number ? ` · ${stock.batch_number}` : ''}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[12.5px] mb-1">Produk Sumber</Label>
            <Input value={form.source_product_name} disabled className="h-9 text-[13px] bg-muted/40" />
          </div>
          <div>
            <Label className="text-[12.5px] mb-1">Merk Sumber</Label>
            <Input value={form.source_brand_name} disabled className="h-9 text-[13px] bg-muted/40" />
          </div>
          <div>
            <Label className="text-[12.5px] mb-1">Batch</Label>
            <Input value={form.batch_number} disabled className="h-9 text-[13px] bg-muted/40" />
          </div>
          <div>
            <Label className="text-[12.5px] mb-1">Bulk Tersedia (ml)</Label>
            <Input value={form.available_bulk} disabled className="h-9 text-[13px] bg-muted/40" />
          </div>
        </div>

        <div>
          <Label className="text-[12.5px] mb-1">Produk Jadi / SKU Output *</Label>
          <SearchableSelect
            value={form.output_product_id}
            onValueChange={v => {
              const output = products.find(p => p.id === v);
              setForm(current => ({
                ...current,
                output_product_id: v,
                volume_per_bottle:
                  Number(output?.bottle_size) > 0
                    ? Number(output.bottle_size)
                    : current.volume_per_bottle,
              }));
            }}
            options={outputProducts.map(p => ({
              value: p.id,
              label: `${p.name}${p.brand_name ? ` · ${p.brand_name}` : ''}${p.bottle_size ? ` (${p.bottle_size}ml)` : ''}`,
              keywords: `${p.code || ''} ${p.name || ''} ${p.brand_name || ''} ${p.bottle_size || ''}`,
            }))}
            placeholder="Cari & pilih produk jadi / ukuran output"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Produk ini menjadi identitas stok setelah Bottling. Bulk sumber tetap tercatat pada batch yang sama.
          </p>
        </div>

        <div>
          <Label className="text-[12.5px] mb-1">Botol (Tipe Botol) *</Label>
          <SearchableSelect
            value={form.bottle_item_id}
            onValueChange={v => setForm(current => ({ ...current, bottle_item_id: v }))}
            options={bottleMaterials.map(m => {
              const stock = bottleStocks[m.id] || 0;
              return {
                value: m.id,
                label: `${m.name} · Stok ${stock} ${m.unit || 'pcs'}${stock <= 0 ? ' (habis)' : ''}`,
                keywords: `${m.code || ''} ${m.name}`,
              };
            })}
            placeholder="Cari & pilih botol dari stok"
          />
          {bottleMaterials.length === 0 && (
            <p className="text-[11px] text-amber-600 mt-1">
              Belum ada barang tipe Botol. Tambahkan di Master Barang (Tipe: Botol).
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-[12.5px] mb-1">Jumlah Botol *</Label>
            <NumberInput
              value={form.bottle_count}
              onChange={v => setForm(current => ({ ...current, bottle_count: v }))}
              allowDecimal={false}
              min={0}
              className="h-9 text-[13px]"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">Volume/Botol (ml) *</Label>
            <NumberInput
              value={form.volume_per_bottle}
              onChange={v => setForm(current => ({ ...current, volume_per_bottle: v }))}
              allowDecimal
              maxDecimals={1}
              min={0}
              className="h-9 text-[13px]"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">Total Volume (ml)</Label>
            <Input value={totalVolume || ''} disabled className="h-9 text-[13px] bg-muted/40" />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">Tanggal</Label>
            <Input
              type="date"
              value={form.bottling_date}
              onChange={e => setForm(current => ({ ...current, bottling_date: e.target.value }))}
              className="h-9 text-[13px]"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">Operator *</Label>
            <Input
              value={form.operator}
              onChange={e => setForm(current => ({ ...current, operator: e.target.value }))}
              className="h-9 text-[13px]"
            />
          </div>
        </div>

        <div>
          <Label className="text-[12.5px] mb-1">Catatan</Label>
          <Textarea
            value={form.notes}
            onChange={e => setForm(current => ({ ...current, notes: e.target.value }))}
            rows={2}
            className="text-[13px]"
          />
        </div>
      </FormModal>
    </div>
  );
}
