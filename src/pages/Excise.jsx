import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import FormModal from '@/components/FormModal';
import SearchableSelect from '@/components/SearchableSelect';
import StatusBadge from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import NumberInput from '@/components/NumberInput';
import PdfButton from '@/components/PdfButton';
import { exportDocumentToPDF } from '@/lib/pdfExport';
import { Plus } from 'lucide-react';
import { generateOrderNumber } from '@/lib/sequence';
import { recordStockMovement, getAllStockBalances, createAuditLog } from '@/lib/stockUtils';
import { getInventoryDisplayName } from '@/lib/inventoryDisplay';

export default function Excise() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [belumCukaiStock, setBelumCukaiStock] = useState([]);
  const [products, setProducts] = useState([]);
  const [brands, setBrands] = useState([]);
  const [exciseMaterials, setExciseMaterials] = useState([]);
  const [boxMaterials, setBoxMaterials] = useState([]);
  const [exciseStocks, setExciseStocks] = useState({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    product_id: '',
    stock_id: '',
    brand_id: '',
    bottle_size: '',
    quantity: '',
    excise_material_id: '',
    excise_material_name: '',
    excise_quantity_per_unit: '1',
    excise_label_type: '',
    document_number: '',
    excise_reference_number: '',
    excise_date: new Date().toISOString().slice(0, 10),
    operator: '',
    notes: '',
    use_box: false,
    box_material_id: '',
    box_material_name: '',
    box_quantity_per_unit: '1',
  });

  const loadData = useCallback(async () => {
    setLoading(true);

    try {
      const [items, balances, prods, brs, mats, matBal, boxMats] = await Promise.all([
        base44.entities.ExciseOrder.list('-created_date', 100),
        getAllStockBalances('product'),
        base44.entities.Product.filter({ is_active: true }),
        base44.entities.Brand.filter({ is_active: true }),
        base44.entities.Material.filter(
          { material_type: 'EXCISE', is_active: true },
          '-created_date',
          500
        ),
        getAllStockBalances('material'),
        base44.entities.Material.filter(
          { material_type: 'PACKAGING', is_active: true },
          '-created_date',
          500
        ),
      ]);

      setData(items);
      setBelumCukaiStock(
        balances.filter(
          b =>
            b.inventory_status === 'UNEXCISED' &&
            b.quantity > 0
        )
      );
      setProducts(prods);
      setBrands(brs);
      setExciseMaterials(mats);
      setBoxMaterials(boxMats);

      const sm = {};
      matBal.forEach(b => {
        sm[b.item_id] =
          (sm[b.item_id] || 0) +
          (b.available_quantity || 0);
      });

      setExciseStocks(sm);
    } catch {
      toast({
        variant: 'destructive',
        title: 'Gagal memuat data'
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const exciseTotalRequired =
    (Number(form.quantity) || 0) *
    (Number(form.excise_quantity_per_unit) || 0);

  const boxTotalRequired =
    (Number(form.quantity) || 0) *
    (Number(form.box_quantity_per_unit) || 0);

  const selectedProduct =
    products.find(p => p.id === form.product_id) || null;

  const exciseRequired =
    selectedProduct?.excise_required !== false;

  const openAdd = () => {
    setForm({
      product_id: '',
      stock_id: '',
      brand_id: '',
      bottle_size: '',
      quantity: '',
      excise_material_id: '',
      excise_material_name: '',
      excise_quantity_per_unit: '1',
      excise_label_type: '',
      document_number: '',
      excise_reference_number: '',
      excise_date: new Date().toISOString().slice(0, 10),
      operator: '',
      notes: '',
      use_box: false,
      box_material_id: '',
      box_material_name: '',
      box_quantity_per_unit: '1',
    });

    setModalOpen(true);
  };

  const onStockChange = (v) => {
    const stock = belumCukaiStock.find(s => s.id === v);
    const prod = products.find(p => p.id === stock?.item_id);

    setForm(f => ({
      ...f,
      stock_id: v,
      product_id: stock?.item_id || '',
      brand_id: prod?.brand_id || '',
      bottle_size: prod?.bottle_size ?? '',
      excise_material_id: '',
      excise_material_name: '',
      excise_quantity_per_unit: '1',
      excise_label_type: '',
    }));
  };

  const onCukaiChange = (materialId) => {
    const m = exciseMaterials.find(x => x.id === materialId);

    setForm(f => ({
      ...f,
      excise_material_id: materialId,
      excise_material_name: m?.name || '',
      excise_label_type: m?.name || '',
    }));
  };

  const handleSubmit = async () => {
    if (!form.product_id || !form.quantity || !form.operator) {
      toast({
        variant: 'destructive',
        title: 'Produk, jumlah, dan operator wajib diisi'
      });
      return;
    }

    const stockItem =
      belumCukaiStock.find(s => s.id === form.stock_id);

    if (!stockItem) {
      toast({
        variant: 'destructive',
        title: 'Stok belum cukai tidak ditemukan'
      });
      return;
    }

    if (
      Number(form.quantity) >
      Number(stockItem.available_quantity)
    ) {
      toast({
        variant: 'destructive',
        title: 'Jumlah melebihi stok belum cukai',
        description: `Tersedia: ${stockItem.available_quantity}`,
      });
      return;
    }

    const productForValidation =
      products.find(p => p.id === stockItem.item_id);

    if (
      productForValidation?.excise_required !== false &&
      !form.excise_material_id
    ) {
      toast({
        variant: 'destructive',
        title: 'Pita cukai wajib dipilih',
        description:
          `${productForValidation?.name || 'Produk'} ditandai sebagai Wajib Cukai di Master Barang.`,
      });
      return;
    }

    if (form.excise_material_id) {
      const stk =
        exciseStocks[form.excise_material_id] || 0;

      if (exciseTotalRequired > stk) {
        toast({
          variant: 'destructive',
          title: 'Stok pita cukai tidak cukup',
          description:
            `Butuh ${exciseTotalRequired}, stok ${stk}`,
        });
        return;
      }
    }

    if (
      form.use_box &&
      form.box_material_id
    ) {
      const stk =
        exciseStocks[form.box_material_id] || 0;

      if (boxTotalRequired > stk) {
        toast({
          variant: 'destructive',
          title: 'Stok box tidak cukup',
          description:
            `Butuh ${boxTotalRequired}, stok ${stk}`,
        });
        return;
      }
    }

    setSubmitting(true);

    try {
      const product =
        products.find(p => p.id === stockItem.item_id);

      if (!product) {
        throw new Error(
          'Produk hasil Labeling tidak ditemukan'
        );
      }

      if (
        form.product_id !==
        stockItem.item_id
      ) {
        throw new Error(
          'Identitas produk berubah setelah Labeling. Proses cukai dihentikan.'
        );
      }

      const brand =
        brands.find(b => b.id === product.brand_id);

      const excNumber =
        await generateOrderNumber(
          'EXC',
          'ExciseOrder'
        );

      const labelingLedgers =
        await base44.entities.StockLedger.filter({
          batch_id: stockItem.batch_id || '',
          item_id: stockItem.item_id,
          inventory_status: 'UNEXCISED',
          transaction_type: 'labeling_output',
        });

      const hppLabelingPerBottle =
        Number(labelingLedgers[0]?.unit_cost) || 0;

      if (
        !labelingLedgers.length ||
        hppLabelingPerBottle <= 0
      ) {
        throw new Error(
          `HPP hasil Labeling tidak ditemukan untuk ${product.name} · batch ${stockItem.batch_number || '-'}`
        );
      }

      const excise =
        await base44.entities.ExciseOrder.create({
          excise_number: excNumber,
          brand_id: product.brand_id || '',
          brand_name:
            brand?.name ||
            product.brand_name ||
            '',
          product_id: product.id,
          product_name: product.name || '',
          batch_number:
            stockItem.batch_number || '',
          bottle_size:
            Number(
              product.bottle_size ||
              form.bottle_size
            ),
          quantity:
            Number(form.quantity),
          excise_label_type:
            form.excise_label_type,
          document_number:
            form.document_number,
          excise_reference_number:
            form.excise_reference_number,
          excise_material_id:
            form.excise_material_id || '',
          excise_material_name:
            form.excise_material_name || '',
          excise_quantity_per_unit:
            Number(form.excise_quantity_per_unit) || 1,
          excise_total_required:
            form.excise_material_id
              ? exciseTotalRequired
              : 0,
          use_box:
            !!form.use_box,
          box_material_id:
            form.use_box
              ? form.box_material_id
              : '',
          box_material_name:
            form.use_box
              ? form.box_material_name
              : '',
          box_quantity_per_unit:
            form.use_box
              ? (
                  Number(form.box_quantity_per_unit) ||
                  1
                )
              : 0,
          box_total_required:
            form.use_box &&
            form.box_material_id
              ? boxTotalRequired
              : 0,
          excise_date:
            form.excise_date,
          operator:
            form.operator,
          status:
            'siap_jual',
          notes:
            form.notes,
        });

      const quantityProcessed =
        Number(form.quantity);

      const previousProductCost =
        quantityProcessed *
        hppLabelingPerBottle;

      let exciseCost = 0;
      let packagingCost = 0;

      await recordStockMovement({
        item_type: 'product',
        item_id: product.id,
        item_name: product.name || '',
        item_code: product.code || '',
        batch_id: stockItem.batch_id || '',
        batch_number: stockItem.batch_number || '',
        inventory_status: 'UNEXCISED',
        quantity_out: quantityProcessed,
        unit: 'unit',
        unit_cost: hppLabelingPerBottle,
        transaction_type: 'excise_consumption',
        transaction_number: excNumber,
        reference_type: 'excise',
        reference_id: excise.id,
        notes: `Proses cukai ${excNumber}`,
      });

      if (form.excise_material_id) {
        const mat =
          exciseMaterials.find(
            m =>
              m.id ===
              form.excise_material_id
          );

        const exciseHbt =
          Number(mat?.last_purchase_price) || 0;

        exciseCost =
          exciseTotalRequired *
          exciseHbt;

        await recordStockMovement({
          item_type: 'material',
          item_id:
            form.excise_material_id,
          item_name:
            form.excise_material_name,
          item_code:
            mat?.code || '',
          inventory_status: '',
          quantity_out:
            exciseTotalRequired,
          unit:
            mat?.unit || 'unit',
          unit_cost:
            exciseHbt,
          transaction_type:
            'excise_consumption',
          transaction_number:
            excNumber,
          reference_type:
            'excise',
          reference_id:
            excise.id,
          notes:
            `Pita cukai untuk ${excNumber}`,
        });
      }

      if (
        form.use_box &&
        form.box_material_id
      ) {
        const boxMat =
          boxMaterials.find(
            m =>
              m.id ===
              form.box_material_id
          );

        const packagingHbt =
          Number(boxMat?.last_purchase_price) || 0;

        packagingCost =
          boxTotalRequired *
          packagingHbt;

        await recordStockMovement({
          item_type: 'material',
          item_id:
            form.box_material_id,
          item_name:
            form.box_material_name,
          item_code:
            boxMat?.code || '',
          inventory_status: '',
          quantity_out:
            boxTotalRequired,
          unit:
            boxMat?.unit || 'pcs',
          unit_cost:
            packagingHbt,
          transaction_type:
            'excise_consumption',
          transaction_number:
            excNumber,
          reference_type:
            'excise',
          reference_id:
            excise.id,
          notes:
            `Box kemasan untuk ${excNumber}`,
        });
      }

      const totalFinalCost =
        previousProductCost +
        exciseCost +
        packagingCost;

      const hppFinalPerBottle =
        quantityProcessed > 0
          ? totalFinalCost /
            quantityProcessed
          : 0;

      const safeHppFinal =
        Number.isFinite(
          hppFinalPerBottle
        )
          ? hppFinalPerBottle
          : 0;

      await recordStockMovement({
        item_type: 'product',
        item_id: product.id,
        item_name: product.name || '',
        item_code: product.code || '',
        batch_id: stockItem.batch_id || '',
        batch_number: stockItem.batch_number || '',
        inventory_status: 'READY_FOR_SALE',
        quantity_in: quantityProcessed,
        unit: 'unit',
        unit_cost: safeHppFinal,
        transaction_type: 'excise_output',
        transaction_number: excNumber,
        reference_type: 'excise',
        reference_id: excise.id,
        notes: 'Barang siap jual',
      });

      await createAuditLog({
        module: 'Cukai',
        action:
          product.excise_required === false
            ? 'Selesai Non Cukai'
            : 'Selesai',
        entity_type: 'ExciseOrder',
        entity_id: excise.id,
        reference_number: excNumber,
      });

      toast({
        title:
          product.excise_required === false
            ? 'Produk non cukai selesai'
            : 'Proses cukai selesai',
        description:
          `${excNumber} · ${product.name}`,
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

  const exportExcisePDF = async (row) => {
    try {
      exportDocumentToPDF({
        title: 'Dokumen Proses Cukai',
        docNumber: row.excise_number,
        docDate: row.excise_date,
        partyLabel: 'Produk',
        party: {
          name: row.product_name
        },
        infoLines: [
          {
            label: 'Merk',
            value:
              row.brand_name || '-'
          },
          {
            label: 'No. Batch',
            value:
              row.batch_number || '-'
          },
          {
            label: 'Ukuran',
            value:
              row.bottle_size
                ? `${row.bottle_size} ml`
                : '-'
          },
          {
            label: 'Pita Cukai',
            value:
              row.excise_material_name ||
              row.excise_label_type ||
              '-'
          },
          {
            label: 'Box',
            value:
              row.use_box
                ? `${row.box_material_name || '-'} (${row.box_total_required || 0})`
                : 'Tanpa Box'
          },
          {
            label: 'No. Dokumen',
            value:
              row.document_number || '-'
          },
          {
            label: 'Ref. Cukai',
            value:
              row.excise_reference_number ||
              '-'
          },
          {
            label: 'Jumlah',
            value:
              row.quantity
          },
          {
            label: 'Operator',
            value:
              row.operator || '-'
          },
          {
            label: 'Status',
            value:
              row.status
          },
        ],
        itemColumns: [
          {
            key: 'desc',
            header: 'Keterangan'
          }
        ],
        itemRows: [
          {
            desc:
              `Proses cukai ${row.quantity} unit ${row.product_name} (batch ${row.batch_number || '-'}) — ref ${row.excise_reference_number || '-'}`
          }
        ],
        totals: [
          {
            label: 'Jumlah Unit',
            value:
              row.quantity,
            bold: true
          }
        ],
        notes:
          row.notes,
        signatures: [
          {
            label: 'Operator,',
            name:
              row.operator || ''
          }
        ],
        fileName:
          `cukai-${row.excise_number}.pdf`,
      });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Gagal membuat PDF'
      });
    }
  };

  const columns = [
    {
      key: 'excise_number',
      header: 'No. Cukai',
      sortable: true,
      className: 'font-mono font-medium'
    },
    {
      key: 'product_name',
      header: 'Produk',
      sortable: true,
      className: 'font-medium'
    },
    {
      key: 'brand_name',
      header: 'Merk',
      render:
        row =>
          row.brand_name || '—'
    },
    {
      key: 'batch_number',
      header: 'Batch',
      className: 'font-mono'
    },
    {
      key: 'quantity',
      header: 'Jumlah',
      render:
        row =>
          <span className="tabular-nums">
            {row.quantity}
          </span>
    },
    {
      key: 'excise_material_name',
      header: 'Pita Cukai',
      render:
        row =>
          row.excise_material_name ||
          row.excise_label_type ||
          '—'
    },
    {
      key: 'box_material_name',
      header: 'Box',
      render:
        row =>
          row.use_box
            ? (
                row.box_material_name ||
                '—'
              )
            : (
              <span className="text-muted-foreground">
                —
              </span>
            )
    },
    {
      key: 'excise_reference_number',
      header: 'Ref. Cukai',
      render:
        row =>
          row.excise_reference_number ||
          '—'
    },
    {
      key: 'excise_date',
      header: 'Tanggal',
      sortable: true
    },
    {
      key: 'status',
      header: 'Status',
      render:
        row =>
          <StatusBadge status={row.status} />
    },
    {
      key: 'actions',
      header: '',
      width: '56px',
      render:
        row =>
          <PdfButton
            onExport={() =>
              exportExcisePDF(row)
            }
            perm="excise"
            iconOnly
            label="Cetak Dokumen"
          />
    },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader
        title="Proses Cukai"
        description="Produk hasil Labeling (UNEXCISED) → READY_FOR_SALE. Identitas produk tidak berubah lagi di tahap Cukai."
        actions={
          <Button
            onClick={openAdd}
            size="sm"
            className="gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Proses Cukai Baru
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        emptyMessage="Belum ada proses cukai"
        searchKeys={[
          'excise_number',
          'product_name',
          'batch_number'
        ]}
        searchPlaceholder="Cari proses cukai..."
      />

      <FormModal
        open={modalOpen}
        onClose={() =>
          setModalOpen(false)
        }
        title="Proses Cukai Baru"
        onSubmit={handleSubmit}
        submitting={submitting}
        submitLabel="Proses Cukai"
        size="lg"
      >
        <div>
          <Label className="text-[12.5px] mb-1">
            Produk (Belum Cukai) *
          </Label>

          <Select
            value={form.stock_id}
            onValueChange={onStockChange}
          >
            <SelectTrigger className="h-9 text-[13px]">
              <SelectValue placeholder="Pilih produk belum cukai" />
            </SelectTrigger>

            <SelectContent>
              {belumCukaiStock.map(s => {
                const p =
                  products.find(
                    x =>
                      x.id ===
                      s.item_id
                  );

                return (
                  <SelectItem
                    key={s.id}
                    value={s.id}
                  >
                    {getInventoryDisplayName(
                      p?.name ||
                      s.item_name,
                      'UNEXCISED'
                    )}
                    {' '}
                    ({s.available_quantity} unit)
                    {
                      s.batch_number
                        ? ` · ${s.batch_number}`
                        : ''
                    }
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {selectedProduct && (
          <div
            className={`rounded-md border px-3 py-2 text-[12px] ${
              exciseRequired
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : 'border-blue-200 bg-blue-50 text-blue-700'
            }`}
          >
            <span className="font-semibold">
              {
                exciseRequired
                  ? 'WAJIB CUKAI'
                  : 'NON CUKAI / SAMPLE'
              }
            </span>
            {' · '}
            {
              exciseRequired
                ? 'Pita cukai wajib dipilih sebelum proses dapat disimpan.'
                : 'Produk boleh diproses ke READY_FOR_SALE tanpa pita cukai.'
            }
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[12.5px] mb-1">
              Produk
            </Label>

            <Input
              value={
                products.find(
                  p =>
                    p.id ===
                    form.product_id
                )?.name || ''
              }
              disabled
              className="h-9 text-[13px] bg-muted/40"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Merk
            </Label>

            <Input
              value={
                brands.find(
                  b =>
                    b.id ===
                    form.brand_id
                )?.name || ''
              }
              disabled
              className="h-9 text-[13px] bg-muted/40"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Ukuran Botol (ml)
            </Label>

            <NumberInput
              value={form.bottle_size}
              onChange={v =>
                setForm(f => ({
                  ...f,
                  bottle_size: v
                }))
              }
              allowDecimal
              maxDecimals={1}
              min={0}
              className="h-9 text-[13px]"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Jumlah *
            </Label>

            <NumberInput
              value={form.quantity}
              onChange={v =>
                setForm(f => ({
                  ...f,
                  quantity: v
                }))
              }
              allowDecimal={false}
              min={0}
              className="h-9 text-[13px]"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Tanggal Proses
            </Label>

            <Input
              type="date"
              value={form.excise_date}
              onChange={e =>
                setForm(f => ({
                  ...f,
                  excise_date:
                    e.target.value
                }))
              }
              className="h-9 text-[13px]"
            />
          </div>
        </div>

        <div>
          <Label className="text-[12.5px] mb-1">
            Pita Cukai (Tipe Pita Cukai)
            {exciseRequired ? ' *' : ''}
          </Label>

          <Select
            value={form.excise_material_id}
            onValueChange={onCukaiChange}
          >
            <SelectTrigger className="h-9 text-[13px]">
              <SelectValue
                placeholder={
                  exciseRequired
                    ? 'Pilih pita cukai dari stok'
                    : 'Opsional untuk Non Cukai / Sample'
                }
              />
            </SelectTrigger>

            <SelectContent>
              {exciseMaterials.map(m => {
                const stk =
                  exciseStocks[m.id] || 0;

                return (
                  <SelectItem
                    key={m.id}
                    value={m.id}
                    disabled={stk <= 0}
                  >
                    {m.name} · Stok {stk} {m.unit || 'pcs'}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          {!exciseRequired && selectedProduct && (
            <p className="text-[11px] text-blue-600 mt-1">
              Produk ini ditandai Non Cukai / Sample di Master Barang. Pita cukai boleh dikosongkan.
            </p>
          )}

          {exciseMaterials.length === 0 && (
            <p className="text-[11px] text-amber-600 mt-1">
              Belum ada bahan tipe Pita Cukai (EXCISE). Tambahkan di Master Bahan.
            </p>
          )}
        </div>

        <div className="rounded-md border border-border p-3 bg-muted/20">
          <div className="flex items-center gap-2 mb-2">
            <Switch
              checked={form.use_box}
              onCheckedChange={v =>
                setForm(f => ({
                  ...f,
                  use_box: v,
                  box_material_id:
                    v
                      ? f.box_material_id
                      : '',
                  box_material_name:
                    v
                      ? f.box_material_name
                      : '',
                }))
              }
            />

            <Label className="text-[12.5px]">
              Proses Lanjutan: Gunakan Box (Kemasan Luar)
            </Label>
          </div>

          {form.use_box && (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label className="text-[12.5px] mb-1">
                  Box (Kemasan)
                </Label>

                <SearchableSelect
                  value={form.box_material_id}
                  onValueChange={v => {
                    const m =
                      boxMaterials.find(
                        x =>
                          x.id === v
                      );

                    setForm(f => ({
                      ...f,
                      box_material_id: v,
                      box_material_name:
                        m?.name || '',
                    }));
                  }}
                  options={
                    boxMaterials
                      .filter(
                        m =>
                          (
                            exciseStocks[m.id] ||
                            0
                          ) > 0
                      )
                      .map(m => ({
                        value: m.id,
                        label:
                          `${m.name} · Stok ${exciseStocks[m.id] || 0} ${m.unit || 'pcs'}`,
                        keywords:
                          `${m.name || ''} ${m.code || ''} ${m.material_code || ''}`,
                      }))
                  }
                  placeholder="Cari nama / kode box..."
                  className="h-9 text-[13px]"
                />
              </div>

              <div>
                <Label className="text-[12.5px] mb-1">
                  Per Unit
                </Label>

                <NumberInput
                  value={
                    form.box_quantity_per_unit
                  }
                  onChange={v =>
                    setForm(f => ({
                      ...f,
                      box_quantity_per_unit: v
                    }))
                  }
                  allowDecimal
                  maxDecimals={4}
                  min={0}
                  className="h-9 text-[13px]"
                />
              </div>

              <div className="col-span-3 text-[11.5px] text-muted-foreground">
                Total butuh box:{' '}
                <span className="font-semibold tabular-nums">
                  {
                    form.box_material_id
                      ? boxTotalRequired
                      : '—'
                  }
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-[12.5px] mb-1">
              Per Unit
            </Label>

            <NumberInput
              value={
                form.excise_quantity_per_unit
              }
              onChange={v =>
                setForm(f => ({
                  ...f,
                  excise_quantity_per_unit: v
                }))
              }
              allowDecimal
              min={0}
              className="h-9 text-[13px]"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Total Butuh
            </Label>

            <Input
              value={
                form.excise_material_id
                  ? (
                      exciseTotalRequired ||
                      ''
                    )
                  : '—'
              }
              disabled
              className="h-9 text-[13px] bg-muted/40"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Jenis Pita (label)
            </Label>

            <Input
              value={
                form.excise_label_type
              }
              onChange={e =>
                setForm(f => ({
                  ...f,
                  excise_label_type:
                    e.target.value
                }))
              }
              className="h-9 text-[13px]"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Nomor Dokumen
            </Label>

            <Input
              value={
                form.document_number
              }
              onChange={e =>
                setForm(f => ({
                  ...f,
                  document_number:
                    e.target.value
                }))
              }
              className="h-9 text-[13px]"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Nomor Referensi Cukai
            </Label>

            <Input
              value={
                form.excise_reference_number
              }
              onChange={e =>
                setForm(f => ({
                  ...f,
                  excise_reference_number:
                    e.target.value
                }))
              }
              className="h-9 text-[13px]"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Operator *
            </Label>

            <Input
              value={form.operator}
              onChange={e =>
                setForm(f => ({
                  ...f,
                  operator:
                    e.target.value
                }))
              }
              className="h-9 text-[13px]"
            />
          </div>
        </div>

        <div>
          <Label className="text-[12.5px] mb-1">
            Catatan
          </Label>

          <Textarea
            value={form.notes}
            onChange={e =>
              setForm(f => ({
                ...f,
                notes:
                  e.target.value
              }))
            }
            rows={2}
            className="text-[13px]"
          />
        </div>
      </FormModal>
    </div>
  );
}
