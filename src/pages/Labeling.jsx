import React, { useEffect, useState, useCallback, useMemo } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import NumberInput from '@/components/NumberInput';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Ban, Eye, X } from 'lucide-react';
import { generateOrderNumber } from '@/lib/sequence';
import {
  recordStockMovement,
  getAllStockBalances,
  createAuditLog,
} from '@/lib/stockUtils';
import { getInventoryDisplayName } from '@/lib/inventoryDisplay';


const normalizeWarehouseName = value =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, '');

const findWarehouseByAliases = (warehouses, aliases) => {
  const wanted = new Set(
    aliases.map(normalizeWarehouseName)
  );

  return (warehouses || []).find(
    warehouse =>
      wanted.has(
        normalizeWarehouseName(
          warehouse?.name
        )
      )
  ) || null;
};

const emptyForm = () => ({
  stock_id: '',
  source_product_id: '',
  source_product_name: '',
  result_brand_id: '',
  result_brand_name: '',
  result_product_id: '',
  result_product_name: '',
  batch_id: '',
  batch_number: '',
  bottle_size: '',
  available_qty: '',
  quantity: '',
  labeling_date: new Date().toISOString().slice(0, 10),
  operator: '',
  notes: '',
  labels: [],
});

const ledgerTime = row =>
  new Date(
    row?.transaction_date ||
    row?.created_date ||
    0
  ).getTime();

const sameValue = (a, b) =>
  String(a || '') === String(b || '');

export default function Labeling() {
  const { toast } = useToast();

  const [data, setData] = useState([]);
  const [siapLabelStock, setSiapLabelStock] = useState([]);
  const [products, setProducts] = useState([]);
  const [brands, setBrands] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [labelMaterials, setLabelMaterials] = useState([]);
  const [labelStocks, setLabelStocks] = useState({});
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [voidingId, setVoidingId] = useState('');

  /*
   * =========================================================
   * VIEW LABELING DETAIL
   * NON-DATA-AFFECTING / READ ONLY
   * =========================================================
   */
  const [viewOpen, setViewOpen] = useState(false);
  const [viewOrder, setViewOrder] = useState(null);
  const [viewMaterials, setViewMaterials] = useState([]);
  const [viewLoading, setViewLoading] = useState(false);

  const [form, setForm] = useState(emptyForm());
  const [labelSearch, setLabelSearch] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);

    try {
      const [
        orders,
        productBalances,
        productRows,
        brandRows,
        materials,
        materialBalances,
        labelProducts,
        warehouseRows,
      ] = await Promise.all([
        base44.entities.LabelingOrder.list('-created_date', 100),
        getAllStockBalances('product'),
        base44.entities.Product.filter({ is_active: true }),
        base44.entities.Brand.filter({ is_active: true }),
        base44.entities.Material.filter(
          { is_active: true },
          '-created_date',
          500
        ),
        getAllStockBalances('material'),
        base44.entities.Product.filter({
          is_active: true,
          product_type: 'label',
        }),
        base44.entities.Warehouse.filter({ is_active: true }),
      ]);

      setData(orders || []);

      setSiapLabelStock(
        (productBalances || []).filter(
          b =>
            b.inventory_status === 'READY_FOR_LABELING' &&
            Number(b.quantity) > 0
        )
      );

      setProducts(productRows || []);
      setBrands(brandRows || []);
      setWarehouses(warehouseRows || []);

      const materialLabels = (materials || []).filter(
        m =>
          m.material_type === 'LABEL' ||
          m.material_type === 'STICKER'
      );

      const combinedLabels = [
        ...materialLabels,
        ...(labelProducts || []),
      ];

      setLabelMaterials(combinedLabels);

      const labelIds = new Set(
        combinedLabels.map(item => item.id)
      );

      const stockMap = {};

      [
        ...(materialBalances || []),
        ...(productBalances || []),
      ].forEach(balance => {
        if (!labelIds.has(balance.item_id)) return;

        stockMap[balance.item_id] =
          (stockMap[balance.item_id] || 0) +
          (Number(balance.available_quantity) || 0);
      });

      setLabelStocks(stockMap);
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

  const buildLabels = useCallback(
    () =>
      labelMaterials.map(item => ({
        material_id: item.id,
        material_name: item.name,
        material_code: item.code || '',
        unit: item.unit || 'unit',
        quantity_per_unit: '1',
        stock: labelStocks[item.id] || 0,
        checked: false,
      })),
    [labelMaterials, labelStocks]
  );

  const openAdd = () => {
    if (submitting || voidingId) return;

    setForm({
      ...emptyForm(),
      labels: buildLabels(),
    });

    setLabelSearch('');
    setModalOpen(true);
  };

  const onStockChange = stockId => {
    const stock = siapLabelStock.find(
      item => item.id === stockId
    );

    const sourceProduct = products.find(
      item => item.id === stock?.item_id
    );

    const sourceBrand = brands.find(
      item => item.id === sourceProduct?.brand_id
    );

    setForm(current => ({
      ...current,

      stock_id: stockId,

      source_product_id:
        stock?.item_id || '',

      source_product_name:
        sourceProduct?.name ||
        stock?.item_name ||
        '',

      result_brand_id:
        sourceProduct?.brand_id || '',

      result_brand_name:
        sourceBrand?.name ||
        sourceProduct?.brand_name ||
        '',

      result_product_id:
        sourceProduct?.id || '',

      result_product_name:
        sourceProduct?.name || '',

      batch_id:
        stock?.batch_id || '',

      batch_number:
        stock?.batch_number || '',

      bottle_size:
        sourceProduct?.bottle_size ?? '',

      available_qty:
        stock?.available_quantity || '',

      quantity:
        String(stock?.available_quantity || ''),
    }));
  };

  const resultProducts = useMemo(() => {
    if (!form.result_brand_id) return [];

    return products
      .filter(
        product =>
          product.brand_id === form.result_brand_id &&
          product.product_type !== 'label' &&
          product.is_active !== false
      )
      .sort((a, b) =>
        String(a.name || '').localeCompare(
          String(b.name || '')
        )
      );
  }, [
    products,
    form.result_brand_id,
  ]);

  const onResultBrandChange = brandId => {
    const brand = brands.find(
      item => item.id === brandId
    );

    const sourceProduct = products.find(
      item => item.id === form.source_product_id
    );

    const sameBrand =
      sourceProduct?.brand_id === brandId;

    setForm(current => ({
      ...current,

      result_brand_id:
        brandId,

      result_brand_name:
        brand?.name || '',

      result_product_id:
        sameBrand
          ? sourceProduct?.id || ''
          : '',

      result_product_name:
        sameBrand
          ? sourceProduct?.name || ''
          : '',
    }));
  };

  const onResultProductChange = productId => {
    const product = products.find(
      item => item.id === productId
    );

    setForm(current => ({
      ...current,

      result_product_id:
        product?.id || '',

      result_product_name:
        product?.name || '',

      bottle_size:
        product?.bottle_size ??
        current.bottle_size,
    }));
  };

  const updateLabel = (index, patch) => {
    setForm(current => ({
      ...current,

      labels:
        current.labels.map(
          (label, i) =>
            i === index
              ? {
                  ...label,
                  ...patch,
                }
              : label
        ),
    }));
  };

  /*
   * =========================================================
   * OPENING BALANCE / LEGACY HPP COMPATIBILITY
   * =========================================================
   *
   * READY_FOR_LABELING boleh berasal dari:
   *
   * - bottling_output
   * - opening_balance
   * - inbound ledger valid lainnya
   *
   * Tidak lagi wajib transaction_type === bottling_output.
   */

  const resolveReadyForLabelingHpp = async ({
    stock,
    sourceProduct,
  }) => {
    const balanceCost =
      Number(stock?.unit_cost) || 0;

    if (balanceCost > 0) {
      return balanceCost;
    }

    const filter = {
      item_id:
        sourceProduct.id,

      inventory_status:
        'READY_FOR_LABELING',
    };

    if (stock?.batch_id) {
      filter.batch_id =
        stock.batch_id;
    } else if (stock?.batch_number) {
      filter.batch_number =
        stock.batch_number;
    }

    if (stock?.warehouse_id) {
      filter.warehouse_id =
        stock.warehouse_id;
    }

    let rows =
      await base44.entities.StockLedger.filter(
        filter
      );

    /*
     * Compatibility fallback:
     * beberapa ledger lama mungkin tidak
     * membawa warehouse_id.
     */

    if (
      (!rows || rows.length === 0) &&
      stock?.warehouse_id
    ) {
      const fallbackFilter = {
        item_id:
          sourceProduct.id,

        inventory_status:
          'READY_FOR_LABELING',
      };

      if (stock?.batch_id) {
        fallbackFilter.batch_id =
          stock.batch_id;
      } else if (stock?.batch_number) {
        fallbackFilter.batch_number =
          stock.batch_number;
      }

      rows =
        await base44.entities.StockLedger.filter(
          fallbackFilter
        );
    }

    const sourceLedger =
      [...(rows || [])]
        .filter(
          row =>
            Number(row.quantity_in) > 0 &&
            Number(row.unit_cost) > 0
        )
        .sort(
          (a, b) =>
            ledgerTime(b) -
            ledgerTime(a)
        )[0];

    return (
      Number(sourceLedger?.unit_cost) || 0
    );
  };

  /*
   * =========================================================
   * CREATE LABELING
   * =========================================================
   */

  const handleSubmit = async () => {
    if (
      !form.stock_id ||
      !form.quantity ||
      !form.operator
    ) {
      toast({
        variant: 'destructive',
        title:
          'Batch, jumlah, operator wajib',
      });

      return;
    }

    if (
      !form.result_brand_id ||
      !form.result_product_id
    ) {
      toast({
        variant: 'destructive',
        title:
          'Merk hasil dan produk hasil labeling wajib dipilih',
      });

      return;
    }

    const qty =
      Number(form.quantity) || 0;

    const available =
      Number(form.available_qty) || 0;

    if (qty <= 0) {
      toast({
        variant: 'destructive',
        title:
          'Jumlah labeling harus lebih dari 0',
      });

      return;
    }

    if (qty > available) {
      toast({
        variant: 'destructive',
        title:
          'Jumlah melebihi stok siap labeling',
        description:
          `Tersedia: ${available}`,
      });

      return;
    }

    const usedLabels =
      form.labels.filter(
        label => label.checked
      );

    if (!usedLabels.length) {
      toast({
        variant: 'destructive',
        title:
          'Pilih minimal satu label/stiker',
      });

      return;
    }

    for (const label of usedLabels) {
      const required =
        qty *
        (
          Number(
            label.quantity_per_unit
          ) || 0
        );

      if (
        required >
        Number(label.stock || 0)
      ) {
        toast({
          variant: 'destructive',
          title:
            `Stok "${label.material_name}" tidak cukup`,
          description:
            `Butuh ${required}, stok ${label.stock}`,
        });

        return;
      }
    }

    const sourceStock =
      siapLabelStock.find(
        item =>
          item.id === form.stock_id
      );

    const sourceProduct =
      products.find(
        item =>
          item.id ===
          form.source_product_id
      );

    const resultProduct =
      products.find(
        item =>
          item.id ===
          form.result_product_id
      );

    const resultBrand =
      brands.find(
        item =>
          item.id ===
          form.result_brand_id
      );

    if (!sourceStock) {
      toast({
        variant: 'destructive',
        title:
          'Stock READY_FOR_LABELING tidak ditemukan',
      });

      return;
    }

    if (
      !sourceProduct ||
      !resultProduct
    ) {
      toast({
        variant: 'destructive',
        title:
          'Produk sumber / produk hasil tidak valid',
      });

      return;
    }

    if (
      resultProduct.brand_id !==
      form.result_brand_id
    ) {
      toast({
        variant: 'destructive',
        title:
          'Produk hasil tidak sesuai dengan merk hasil',
      });

      return;
    }

    const exciseRequired =
      resultProduct.excise_required !== false;

    const outputInventoryStatus =
      exciseRequired
        ? 'UNEXCISED'
        : 'READY_FOR_SALE';

    const labelingOrderStatus =
      exciseRequired
        ? 'belum_cukai'
        : 'siap_jual';

    /*
     * WAREHOUSE RULE
     *
     * Wajib cukai:
     * Labeling output tetap di SIAP CUKAI.
     *
     * Sample / non-cukai:
     * Labeling output langsung pindah ke SIAP JUAL.
     */
    const outputWarehouse =
      exciseRequired
        ? findWarehouseByAliases(
            warehouses,
            ['SIAP CUKAI', 'GUDANG SIAP CUKAI']
          )
        : findWarehouseByAliases(
            warehouses,
            ['SIAP JUAL', 'GUDANG SIAP JUAL']
          );

    if (!outputWarehouse) {
      toast({
        variant: 'destructive',
        title: exciseRequired
          ? 'Gudang SIAP CUKAI tidak ditemukan'
          : 'Gudang SIAP JUAL tidak ditemukan',
        description:
          'Periksa Master Gudang sebelum memproses Labeling.',
      });
      return;
    }

    setSubmitting(true);

    try {
      /*
       * =====================================================
       * HPP PREFLIGHT
       * =====================================================
       *
       * Dilakukan SEBELUM LabelingOrder.create.
       */

      const hppBottlingPerBottle =
        await resolveReadyForLabelingHpp({
          stock:
            sourceStock,

          sourceProduct,
        });

      if (
        !(hppBottlingPerBottle > 0)
      ) {
        throw new Error(
          `HPP READY_FOR_LABELING tidak ditemukan untuk ${sourceProduct.name}` +
          `${
            form.batch_number
              ? ` · ${form.batch_number}`
              : ''
          }. ` +
          `Untuk stok legacy, pastikan Opening Balance memiliki HPP/Unit.`
        );
      }

      /*
       * =====================================================
       * LABEL COST PREFLIGHT
       * =====================================================
       */

      const labelCostRows =
        usedLabels.map(label => {
          const quantityPerUnit =
            Number(
              label.quantity_per_unit
            ) || 1;

          const totalRequired =
            qty * quantityPerUnit;

          const labelItem =
            labelMaterials.find(
              item =>
                item.id ===
                label.material_id
            );

          const labelHpp =
            Number(
              labelItem?.last_purchase_price
            ) || 0;

          return {
            label,
            labelItem,
            quantityPerUnit,
            totalRequired,
            labelHpp,

            totalCost:
              totalRequired *
              labelHpp,
          };
        });

      const previousProductCost =
        qty *
        hppBottlingPerBottle;

      const totalLabelCost =
        labelCostRows.reduce(
          (sum, row) =>
            sum +
            row.totalCost,
          0
        );

      const totalLabelingCost =
        previousProductCost +
        totalLabelCost;

      const hppLabelingPerBottle =
        qty > 0
          ? totalLabelingCost / qty
          : 0;

      const safeHppLabeling =
        Number.isFinite(
          hppLabelingPerBottle
        )
          ? hppLabelingPerBottle
          : 0;

      if (
        !(safeHppLabeling > 0)
      ) {
        throw new Error(
          'HPP output Labeling tidak valid.'
        );
      }

      /*
       * =====================================================
       * WRITE START
       * =====================================================
       */

      const labelingNumber =
        await generateOrderNumber(
          'LBL',
          'LabelingOrder'
        );

      const defaultLabel =
        usedLabels[0];

      const order =
        await base44.entities.LabelingOrder.create({
          labeling_number:
            labelingNumber,

          brand_id:
            resultBrand?.id ||
            form.result_brand_id,

          brand_name:
            resultBrand?.name ||
            form.result_brand_name,

          product_id:
            resultProduct.id,

          product_name:
            resultProduct.name,

          batch_id:
            form.batch_id,

          batch_number:
            form.batch_number,

          bottle_size:
            Number(
              resultProduct.bottle_size ||
              form.bottle_size
            ) || 0,

          quantity:
            qty,

          label_type:
            defaultLabel.material_name,

          label_item_id:
            defaultLabel.material_id,

          label_item_code:
            defaultLabel.material_code,

          label_item_name:
            defaultLabel.material_name,

          label_quantity_per_unit:
            Number(
              defaultLabel.quantity_per_unit
            ) || 1,

          label_total_required:
            qty *
            (
              Number(
                defaultLabel.quantity_per_unit
              ) || 1
            ),

          labeling_date:
            form.labeling_date,

          operator:
            form.operator,

          status:
            labelingOrderStatus,

          notes:
            form.notes,
        });

      /*
       * =====================================================
       * LABEL / STICKER CONSUMPTION
       * =====================================================
       */

      for (const row of labelCostRows) {
        const {
          label,
          quantityPerUnit,
          totalRequired,
          labelHpp,
        } = row;

        await base44.entities.LabelingMaterial.create({
          labeling_id:
            order.id,

          labeling_number:
            labelingNumber,

          label_item_id:
            label.material_id,

          label_item_code:
            label.material_code,

          label_item_name:
            label.material_name,

          quantity_per_unit:
            quantityPerUnit,

          total_quantity_required:
            totalRequired,

          stock_before:
            Number(label.stock) || 0,

          stock_after:
            (
              Number(label.stock) || 0
            ) -
            totalRequired,

          unit:
            label.unit,
        });

        await recordStockMovement({
          item_type:
            'material',

          item_id:
            label.material_id,

          item_name:
            label.material_name,

          item_code:
            label.material_code,

          inventory_status:
            '',

          quantity_out:
            totalRequired,

          unit:
            label.unit,

          unit_cost:
            labelHpp,

          transaction_type:
            'label_consumption',

          transaction_number:
            labelingNumber,

          reference_type:
            'labeling',

          reference_id:
            order.id,

          notes:
            `Label untuk ${labelingNumber}`,
        });
      }

      /*
       * =====================================================
       * READY_FOR_LABELING SOURCE OUT
       * =====================================================
       *
       * Bisa berasal dari:
       *
       * - bottling_output
       * - opening_balance
       */

      await recordStockMovement({
        item_type:
          'product',

        item_id:
          sourceProduct.id,

        item_name:
          sourceProduct.name,

        item_code:
          sourceProduct.code || '',

        batch_id:
          form.batch_id,

        batch_number:
          form.batch_number,

        warehouse_id:
          sourceStock.warehouse_id || '',

        warehouse_name:
          sourceStock.warehouse_name || '',

        inventory_status:
          'READY_FOR_LABELING',

        quantity_out:
          qty,

        unit:
          'unit',

        unit_cost:
          hppBottlingPerBottle,

        transaction_type:
          'labeling_consumption',

        transaction_number:
          labelingNumber,

        reference_type:
          'labeling',

        reference_id:
          order.id,

        notes:
          `Labeling ${labelingNumber}`,
      });

      /*
       * =====================================================
       * IDENTITY GATE OUTPUT
       * =====================================================
       */

      await recordStockMovement({
        item_type:
          'product',

        item_id:
          resultProduct.id,

        item_name:
          resultProduct.name,

        item_code:
          resultProduct.code || '',

        batch_id:
          form.batch_id,

        batch_number:
          form.batch_number,

        warehouse_id:
          outputWarehouse.id,

        warehouse_name:
          outputWarehouse.name || '',

        inventory_status:
          outputInventoryStatus,

        quantity_in:
          qty,

        unit:
          'unit',

        unit_cost:
          safeHppLabeling,

        transaction_type:
          'labeling_output',

        transaction_number:
          labelingNumber,

        reference_type:
          'labeling',

        reference_id:
          order.id,

        notes:
          sourceProduct.id === resultProduct.id
            ? exciseRequired
              ? `Output labeling ${labelingNumber}`
              : `Output labeling non-cukai ${labelingNumber} → READY_FOR_SALE`
            : exciseRequired
              ? `Output maklon ${sourceProduct.name} → ${resultProduct.name}`
              : `Output maklon non-cukai ${sourceProduct.name} → ${resultProduct.name} → READY_FOR_SALE`,
      });

      /*
       * =====================================================
       * AUDIT CREATE
       * =====================================================
       */

      await createAuditLog({
        module:
          'Labeling',

        action:
          !exciseRequired
            ? sourceProduct.id === resultProduct.id
              ? 'Selesai Non Cukai'
              : 'Selesai Maklon Non Cukai'
            : sourceProduct.id === resultProduct.id
              ? 'Selesai'
              : 'Selesai Maklon',

        entity_type:
          'LabelingOrder',

        entity_id:
          order.id,

        reference_number:
          labelingNumber,

        data_after: {
          source_hpp_per_bottle:
            hppBottlingPerBottle,

          output_hpp_per_bottle:
            safeHppLabeling,

          output_inventory_status:
            outputInventoryStatus,
        },
      });

      toast({
        title:
          !exciseRequired
            ? 'Labeling selesai · Non Cukai / Sample siap jual'
            : 'Labeling selesai',

        description:
          sourceProduct.id === resultProduct.id
            ? labelingNumber
            : `${labelingNumber} · ${sourceProduct.name} → ${resultProduct.name}`,
      });

      setModalOpen(false);

      await loadData();
    } catch (error) {
      toast({
        variant:
          'destructive',

        title:
          'Gagal menyimpan',

        description:
          error?.message ||
          'Terjadi kesalahan',
      });
    } finally {
      setSubmitting(false);
    }
  };

  /*
   * =========================================================
   * VOID / REVERSAL LABELING
   * =========================================================
   *
   * RULE:
   *
   * VOID tidak menghapus StockLedger lama.
   *
   * Yang dilakukan:
   *
   * labeling_output
   *   IN → dibalik OUT
   *
   * labeling_consumption
   *   OUT → dibalik IN
   *
   * label_consumption
   *   OUT → dibalik IN
   *
   * Semua reversal memakai frozen unit_cost
   * dari StockLedger transaksi asli.
   *
   * DOWNSTREAM GUARD:
   *
   * jika output sudah digunakan Cukai,
   * Penjualan, adjustment, dll,
   * VOID Labeling diblok.
   */

  const voidLabeling = async order => {
    if (!order?.id) return;

    if (order.status === 'void') {
      toast({
        variant:
          'destructive',

        title:
          'Labeling sudah VOID',
      });

      return;
    }

    if (
      submitting ||
      voidingId
    ) {
      return;
    }

    /*
     * Alasan wajib agar AuditLog
     * lebih berguna.
     */

    const reasonInput =
      window.prompt(
        `VOID Labeling ${order.labeling_number}?\n\n` +
        `Masukkan alasan VOID.\n` +
        `Histori transaksi tidak akan dihapus.`
      );

    if (reasonInput === null) {
      return;
    }

    const voidReason =
      reasonInput.trim();

    if (!voidReason) {
      toast({
        variant:
          'destructive',

        title:
          'Alasan VOID wajib diisi',
      });

      return;
    }

    const confirmed =
      window.confirm(
        `Konfirmasi VOID ${order.labeling_number}?\n\n` +
        `Output Labeling akan ditarik kembali.\n` +
        `READY_FOR_LABELING akan dikembalikan.\n` +
        `Label / stiker akan dikembalikan.\n\n` +
        `Jika output sudah digunakan proses berikutnya, VOID akan diblok.`
      );

    if (!confirmed) return;

    setVoidingId(
      order.id
    );

    try {
      /*
       * =====================================================
       * LOAD ALL LEDGER FOR LABELING
       * =====================================================
       */

      const ledgerRows =
        await base44.entities.StockLedger.filter({
          reference_id:
            order.id,
        });

      /*
       * =====================================================
       * DOUBLE VOID GUARD
       * =====================================================
       */

      const existingReversal =
        (ledgerRows || []).filter(
          row =>
            row.reference_type === 'labeling' &&
            row.transaction_type ===
              'labeling_reversal'
        );

      if (
        existingReversal.length > 0
      ) {
        throw new Error(
          'Reversal Labeling sudah pernah dibuat. Double VOID diblokir.'
        );
      }

      /*
       * =====================================================
       * ORIGINAL TRANSACTION ROWS
       * =====================================================
       */

      const originalRows =
        (ledgerRows || [])
          .filter(
            row =>
              row.reference_type ===
                'labeling' &&
              [
                'label_consumption',
                'labeling_consumption',
                'labeling_output',
              ].includes(
                row.transaction_type
              )
          )
          .sort(
            (a, b) =>
              ledgerTime(a) -
              ledgerTime(b)
          );

      if (
        originalRows.length === 0
      ) {
        throw new Error(
          'StockLedger transaksi Labeling tidak ditemukan. VOID dibatalkan.'
        );
      }

      const outputRows =
        originalRows.filter(
          row =>
            row.transaction_type ===
              'labeling_output' &&
            Number(row.quantity_in) > 0
        );

      const sourceRows =
        originalRows.filter(
          row =>
            row.transaction_type ===
              'labeling_consumption' &&
            Number(row.quantity_out) > 0
        );

      const labelRows =
        originalRows.filter(
          row =>
            row.transaction_type ===
              'label_consumption' &&
            Number(row.quantity_out) > 0
        );

      if (
        outputRows.length === 0
      ) {
        throw new Error(
          'Output Labeling tidak ditemukan pada StockLedger.'
        );
      }

      if (
        sourceRows.length === 0
      ) {
        throw new Error(
          'Consumption READY_FOR_LABELING tidak ditemukan pada StockLedger.'
        );
      }

      /*
       * =====================================================
       * DOWNSTREAM LEDGER GUARD
       * =====================================================
       *
       * Cari movement OUT setelah labeling_output.
       *
       * Contoh:
       *
       * labeling_output UNEXCISED +100
       * excise_consumption UNEXCISED -100
       *
       * Maka VOID Labeling diblok.
       */

      for (
        const outputRow of
        outputRows
      ) {
        const downstreamFilter = {
          item_id:
            outputRow.item_id,

          inventory_status:
            outputRow.inventory_status ||
            '',
        };

        if (
          outputRow.batch_id
        ) {
          downstreamFilter.batch_id =
            outputRow.batch_id;
        } else if (
          outputRow.batch_number
        ) {
          downstreamFilter.batch_number =
            outputRow.batch_number;
        }

        if (
          outputRow.warehouse_id
        ) {
          downstreamFilter.warehouse_id =
            outputRow.warehouse_id;
        }

        let stageRows =
          await base44.entities.StockLedger.filter(
            downstreamFilter
          );

        /*
         * Legacy compatibility:
         * ledger lama mungkin tidak
         * mempunyai warehouse_id.
         */

        if (
          (!stageRows ||
            stageRows.length === 0) &&
          outputRow.warehouse_id
        ) {
          const fallback = {
            item_id:
              outputRow.item_id,

            inventory_status:
              outputRow.inventory_status ||
              '',
          };

          if (
            outputRow.batch_id
          ) {
            fallback.batch_id =
              outputRow.batch_id;
          } else if (
            outputRow.batch_number
          ) {
            fallback.batch_number =
              outputRow.batch_number;
          }

          stageRows =
            await base44.entities.StockLedger.filter(
              fallback
            );
        }

        const outputTime =
          ledgerTime(
            outputRow
          );

        const downstreamMovement =
          (stageRows || [])
            .filter(row => {
              /*
               * Skip row output original.
               */

              if (
                row.id ===
                outputRow.id
              ) {
                return false;
              }

              /*
               * Skip movement milik
               * Labeling yang sedang
               * di-VOID.
               */

              if (
                row.reference_type ===
                  'labeling' &&
                sameValue(
                  row.reference_id,
                  order.id
                )
              ) {
                return false;
              }

              /*
               * Yang dianggap penggunaan
               * downstream adalah OUT.
               */

              if (
                !(
                  Number(
                    row.quantity_out
                  ) > 0
                )
              ) {
                return false;
              }

              return (
                ledgerTime(row) >=
                outputTime
              );
            })
            .sort(
              (a, b) =>
                ledgerTime(a) -
                ledgerTime(b)
            )[0];

        if (
          downstreamMovement
        ) {
          throw new Error(
            `VOID diblokir. Output Labeling sudah digunakan proses berikutnya: ` +
            `${downstreamMovement.transaction_type || 'stock movement'}` +
            `${
              downstreamMovement.transaction_number
                ? ` · ${downstreamMovement.transaction_number}`
                : ''
            }. ` +
            `Batalkan proses paling akhir terlebih dahulu.`
          );
        }
      }

      /*
       * =====================================================
       * STOCK BALANCE PREFLIGHT
       * =====================================================
       *
       * Output Labeling harus masih tersedia
       * penuh sebelum satu reversal pun dibuat.
       */

      const productBalances =
        await getAllStockBalances(
          'product'
        );

      for (
        const outputRow of
        outputRows
      ) {
        const requiredQty =
          Number(
            outputRow.quantity_in
          ) || 0;

        /*
         * Strict match.
         */

        let matchingBalances =
          (productBalances || []).filter(
            balance =>
              sameValue(
                balance.item_id,
                outputRow.item_id
              ) &&
              sameValue(
                balance.batch_id,
                outputRow.batch_id
              ) &&
              sameValue(
                balance.batch_number,
                outputRow.batch_number
              ) &&
              sameValue(
                balance.warehouse_id,
                outputRow.warehouse_id
              ) &&
              sameValue(
                balance.inventory_status,
                outputRow.inventory_status
              )
          );

        /*
         * Legacy fallback:
         * kalau ledger lama tidak mempunyai
         * warehouse identity.
         */

        if (
          matchingBalances.length === 0 &&
          !outputRow.warehouse_id
        ) {
          matchingBalances =
            (productBalances || []).filter(
              balance =>
                sameValue(
                  balance.item_id,
                  outputRow.item_id
                ) &&
                sameValue(
                  balance.batch_id,
                  outputRow.batch_id
                ) &&
                sameValue(
                  balance.batch_number,
                  outputRow.batch_number
                ) &&
                sameValue(
                  balance.inventory_status,
                  outputRow.inventory_status
                )
            );
        }

        const availableQty =
          matchingBalances.reduce(
            (
              sum,
              balance
            ) =>
              sum +
              (
                Number(
                  balance.available_quantity ??
                  balance.quantity
                ) || 0
              ),
            0
          );

        if (
          availableQty <
          requiredQty
        ) {
          throw new Error(
            `VOID diblokir. Output Labeling sudah berkurang. ` +
            `${outputRow.item_name || 'Produk'}: ` +
            `dibutuhkan ${requiredQty}, tersedia ${availableQty}. ` +
            `Batalkan proses downstream terlebih dahulu.`
          );
        }
      }

      /*
       * =====================================================
       * REVERSAL NUMBER
       * =====================================================
       */

      const reversalNumber =
        `${order.labeling_number}-REV`;

      /*
       * =====================================================
       * STEP 1 — REMOVE LABELING OUTPUT
       * =====================================================
       *
       * Original:
       *
       * labeling_output
       * quantity_in
       *
       * Reversal:
       *
       * labeling_reversal
       * quantity_out
       *
       * STEP OUTPUT FIRST.
       *
       * Jika output tidak bisa ditarik,
       * source dan label belum dikembalikan.
       */

      for (
        const row of
        outputRows
      ) {
        await recordStockMovement({
          item_type:
            row.item_type ||
            'product',

          item_id:
            row.item_id,

          item_code:
            row.item_code ||
            '',

          item_name:
            row.item_name,

          batch_id:
            row.batch_id ||
            '',

          batch_number:
            row.batch_number ||
            '',

          warehouse_id:
            row.warehouse_id ||
            '',

          warehouse_name:
            row.warehouse_name ||
            '',

          inventory_status:
            row.inventory_status ||
            '',

          quantity_out:
            Number(
              row.quantity_in
            ) || 0,

          unit:
            row.unit ||
            'unit',

          /*
           * FROZEN COST ORIGINAL.
           * JANGAN RECOST.
           */

          unit_cost:
            Number(
              row.unit_cost
            ) || 0,

          transaction_type:
            'labeling_reversal',

          transaction_number:
            reversalNumber,

          reference_type:
            'labeling',

          reference_id:
            order.id,

          notes:
            `VOID output Labeling ${order.labeling_number} · ${voidReason}`,
        });
      }

      /*
       * =====================================================
       * STEP 2 — RESTORE READY_FOR_LABELING
       * =====================================================
       *
       * Original:
       *
       * labeling_consumption
       * quantity_out
       *
       * Reversal:
       *
       * quantity_in
       */

      for (
        const row of
        sourceRows
      ) {
        await recordStockMovement({
          item_type:
            row.item_type ||
            'product',

          item_id:
            row.item_id,

          item_code:
            row.item_code ||
            '',

          item_name:
            row.item_name,

          batch_id:
            row.batch_id ||
            '',

          batch_number:
            row.batch_number ||
            '',

          warehouse_id:
            row.warehouse_id ||
            '',

          warehouse_name:
            row.warehouse_name ||
            '',

          inventory_status:
            row.inventory_status ||
            '',

          quantity_in:
            Number(
              row.quantity_out
            ) || 0,

          unit:
            row.unit ||
            'unit',

          unit_cost:
            Number(
              row.unit_cost
            ) || 0,

          transaction_type:
            'labeling_reversal',

          transaction_number:
            reversalNumber,

          reference_type:
            'labeling',

          reference_id:
            order.id,

          notes:
            `VOID consumption Labeling ${order.labeling_number} · ${voidReason}`,
        });
      }

      /*
       * =====================================================
       * STEP 3 — RESTORE LABEL / STICKER
       * =====================================================
       */

      for (
        const row of
        labelRows
      ) {
        await recordStockMovement({
          item_type:
            row.item_type ||
            'material',

          item_id:
            row.item_id,

          item_code:
            row.item_code ||
            '',

          item_name:
            row.item_name,

          batch_id:
            row.batch_id ||
            '',

          batch_number:
            row.batch_number ||
            '',

          warehouse_id:
            row.warehouse_id ||
            '',

          warehouse_name:
            row.warehouse_name ||
            '',

          inventory_status:
            row.inventory_status ||
            '',

          quantity_in:
            Number(
              row.quantity_out
            ) || 0,

          unit:
            row.unit ||
            'unit',

          unit_cost:
            Number(
              row.unit_cost
            ) || 0,

          transaction_type:
            'labeling_reversal',

          transaction_number:
            reversalNumber,

          reference_type:
            'labeling',

          reference_id:
            order.id,

          notes:
            `VOID label/stiker ${order.labeling_number} · ${voidReason}`,
        });
      }

      /*
       * =====================================================
       * UPDATE LABELING ORDER
       * =====================================================
       *
       * Histori tetap dipertahankan.
       */

      await base44.entities.LabelingOrder.update(
        order.id,
        {
          status:
            'void',

          notes:
            [
              order.notes,

              `VOID ${new Date().toISOString()}`,

              `Alasan: ${voidReason}`,
            ]
              .filter(Boolean)
              .join('\n'),
        }
      );

      /*
       * =====================================================
       * AUDIT LOG
       * =====================================================
       */

      await createAuditLog({
        module:
          'Labeling',

        action:
          'Void',

        entity_type:
          'LabelingOrder',

        entity_id:
          order.id,

        reference_number:
          order.labeling_number,

        reason:
          voidReason,

        data_before: {
          status:
            order.status,

          quantity:
            order.quantity,

          product_id:
            order.product_id,

          product_name:
            order.product_name,

          batch_number:
            order.batch_number,
        },

        data_after: {
          status:
            'void',

          reversal_number:
            reversalNumber,

          output_reversed:
            outputRows.map(
              row => ({
                item_id:
                  row.item_id,

                item_name:
                  row.item_name,

                inventory_status:
                  row.inventory_status,

                quantity:
                  Number(
                    row.quantity_in
                  ) || 0,

                unit_cost:
                  Number(
                    row.unit_cost
                  ) || 0,
              })
            ),

          source_restored:
            sourceRows.map(
              row => ({
                item_id:
                  row.item_id,

                item_name:
                  row.item_name,

                inventory_status:
                  row.inventory_status,

                quantity:
                  Number(
                    row.quantity_out
                  ) || 0,

                unit_cost:
                  Number(
                    row.unit_cost
                  ) || 0,
              })
            ),

          labels_restored:
            labelRows.map(
              row => ({
                item_id:
                  row.item_id,

                item_name:
                  row.item_name,

                quantity:
                  Number(
                    row.quantity_out
                  ) || 0,

                unit_cost:
                  Number(
                    row.unit_cost
                  ) || 0,
              })
            ),
        },
      });

      toast({
        title:
          'Labeling berhasil di-VOID',

        description:
          `${order.labeling_number} · stok dikembalikan`,
      });

      await loadData();
    } catch (error) {
      toast({
        variant:
          'destructive',

        title:
          'Gagal VOID Labeling',

        description:
          error?.message ||
          'Terjadi kesalahan',
      });
    } finally {
      setVoidingId('');
    }
  };

  /*
   * =========================================================
   * VIEW LABELING DETAIL
   * READ ONLY — DOES NOT TOUCH STOCK / LEDGER
   * =========================================================
   */
  const openView = async order => {
    if (!order?.id) return;

    setViewOrder(order);
    setViewMaterials([]);
    setViewOpen(true);
    setViewLoading(true);

    try {
      const materials =
        await base44.entities.LabelingMaterial.filter({
          labeling_id: order.id,
        });

      setViewMaterials(materials || []);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal memuat detail labeling',
        description:
          error?.message ||
          'Detail label / stiker tidak dapat dimuat',
      });
    } finally {
      setViewLoading(false);
    }
  };

  const closeView = () => {
    setViewOpen(false);
    setViewOrder(null);
    setViewMaterials([]);
  };

  /*
   * =========================================================
   * TABLE
   * =========================================================
   */

  const columns = [
    {
      key:
        'labeling_number',

      header:
        'No. Labeling',

      sortable:
        true,

      className:
        'font-mono font-medium',
    },

    {
      key:
        'product_name',

      header:
        'Produk Hasil',

      sortable:
        true,

      className:
        'font-medium',
    },

    {
      key:
        'brand_name',

      header:
        'Merk Hasil',

      render:
        row =>
          row.brand_name ||
          '—',
    },

    {
      key:
        'batch_number',

      header:
        'Batch',

      className:
        'font-mono',
    },

    {
      key:
        'quantity',

      header:
        'Jumlah',

      render:
        row => (
          <span className="tabular-nums">
            {row.quantity}
          </span>
        ),
    },

    {
      key:
        'labeling_date',

      header:
        'Tanggal',

      sortable:
        true,
    },

    {
      key:
        'status',

      header:
        'Status',

      render:
        row => (
          <StatusBadge
            status={
              row.status
            }
          />
        ),
    },

    /*
     * =======================================================
     * VIEW + VOID ACTION
     * =======================================================
     */

    {
      key:
        'actions',

      header:
        'Aksi',

      width:
        '100px',

      render:
        row => {
          const isVoid =
            row.status === 'void';

          const isVoiding =
            voidingId === row.id;

          return (
            <div className="flex items-center gap-1">
              <button
                type="button"

                onClick={() =>
                  openView(row)
                }

                title="Lihat Detail"

                className="p-1.5 rounded hover:bg-blue-50 text-blue-600 transition-colors"
              >
                <Eye className="w-4 h-4" />
              </button>

              <button
                type="button"

                onClick={() =>
                  voidLabeling(row)
                }

                disabled={
                  isVoid ||
                  isVoiding ||
                  submitting ||
                  !!voidingId
                }

                title={
                  isVoid
                    ? 'Sudah VOID'
                    : 'VOID Labeling'
                }

                className="p-1.5 rounded hover:bg-red-50 text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Ban className="w-4 h-4" />
              </button>
            </div>
          );
        },
    },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader
        title="Labeling"

        description="Labeling = identity gate. Produk sumber READY_FOR_LABELING dapat tetap menjadi produk asal atau berubah menjadi produk/merk lain untuk maklon."

        actions={
          <Button
            onClick={
              openAdd
            }

            size="sm"

            className="gap-1.5"

            disabled={
              submitting ||
              !!voidingId
            }
          >
            <Plus className="w-4 h-4" />
            Labeling Baru
          </Button>
        }
      />

      <DataTable
        columns={
          columns
        }

        data={
          data
        }

        loading={
          loading
        }

        emptyMessage="Belum ada labeling"

        searchKeys={[
          'labeling_number',
          'product_name',
          'brand_name',
          'batch_number',
        ]}

        searchPlaceholder="Cari labeling..."
      />

      {/* =====================================================
          VIEW LABELING DETAIL — READ ONLY
         ===================================================== */}
      {viewOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={closeView}
        >
          <div
            className="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl shadow-xl"
            onClick={event =>
              event.stopPropagation()
            }
          >
            <div className="sticky top-0 bg-white border-b px-5 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-base font-semibold">
                  Detail Labeling
                </h2>

                <div className="text-xs text-muted-foreground mt-0.5">
                  {viewOrder?.labeling_number || '—'}
                </div>
              </div>

              <button
                type="button"
                onClick={closeView}
                className="p-2 rounded-md hover:bg-muted"
                title="Tutup"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {viewOrder && (
              <div className="p-5 space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] text-muted-foreground uppercase">
                      Status
                    </div>

                    <div className="mt-1">
                      <StatusBadge
                        status={viewOrder.status}
                      />
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-[11px] text-muted-foreground uppercase">
                      Tanggal
                    </div>

                    <div className="text-sm font-medium mt-1">
                      {viewOrder.labeling_date || '—'}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="border rounded-lg p-3">
                    <div className="text-[11px] text-muted-foreground">
                      No. Labeling
                    </div>

                    <div className="font-mono font-medium mt-1">
                      {viewOrder.labeling_number || '—'}
                    </div>
                  </div>

                  <div className="border rounded-lg p-3">
                    <div className="text-[11px] text-muted-foreground">
                      Batch
                    </div>

                    <div className="font-mono font-medium mt-1">
                      {viewOrder.batch_number || '—'}
                    </div>
                  </div>

                  <div className="border rounded-lg p-3">
                    <div className="text-[11px] text-muted-foreground">
                      Produk Hasil
                    </div>

                    <div className="font-medium mt-1">
                      {viewOrder.product_name || '—'}
                    </div>
                  </div>

                  <div className="border rounded-lg p-3">
                    <div className="text-[11px] text-muted-foreground">
                      Merk Hasil
                    </div>

                    <div className="font-medium mt-1">
                      {viewOrder.brand_name || '—'}
                    </div>
                  </div>

                  <div className="border rounded-lg p-3">
                    <div className="text-[11px] text-muted-foreground">
                      Bottle Size
                    </div>

                    <div className="font-medium mt-1">
                      {viewOrder.bottle_size
                        ? `${viewOrder.bottle_size} ml`
                        : '—'}
                    </div>
                  </div>

                  <div className="border rounded-lg p-3">
                    <div className="text-[11px] text-muted-foreground">
                      Jumlah
                    </div>

                    <div className="font-semibold tabular-nums mt-1">
                      {viewOrder.quantity || 0} unit
                    </div>
                  </div>

                  <div className="border rounded-lg p-3">
                    <div className="text-[11px] text-muted-foreground">
                      Operator
                    </div>

                    <div className="font-medium mt-1">
                      {viewOrder.operator || '—'}
                    </div>
                  </div>

                  <div className="border rounded-lg p-3">
                    <div className="text-[11px] text-muted-foreground">
                      Label Utama
                    </div>

                    <div className="font-medium mt-1">
                      {viewOrder.label_item_name ||
                        viewOrder.label_type ||
                        '—'}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-sm font-semibold mb-2">
                    Label / Stiker Digunakan
                  </div>

                  {viewLoading ? (
                    <div className="border rounded-lg px-4 py-5 text-sm text-muted-foreground">
                      Memuat detail label...
                    </div>
                  ) : viewMaterials.length === 0 ? (
                    <div className="border rounded-lg px-4 py-5 text-sm text-muted-foreground">
                      Tidak ada detail label/stiker.
                    </div>
                  ) : (
                    <div className="border rounded-lg overflow-hidden">
                      <div className="grid grid-cols-[1fr_80px_100px] gap-2 px-3 py-2 bg-muted/40 text-[11px] font-medium text-muted-foreground">
                        <div>Label / Stiker</div>
                        <div className="text-right">
                          Per Unit
                        </div>
                        <div className="text-right">
                          Total
                        </div>
                      </div>

                      {viewMaterials.map(material => (
                        <div
                          key={material.id}
                          className="grid grid-cols-[1fr_80px_100px] gap-2 px-3 py-2.5 border-t text-sm"
                        >
                          <div>
                            <div className="font-medium">
                              {material.label_item_name || '—'}
                            </div>

                            {material.label_item_code && (
                              <div className="text-[11px] text-muted-foreground">
                                {material.label_item_code}
                              </div>
                            )}
                          </div>

                          <div className="text-right tabular-nums">
                            {material.quantity_per_unit || 0}
                          </div>

                          <div className="text-right tabular-nums font-medium">
                            {material.total_quantity_required || 0}{' '}
                            {material.unit || 'unit'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-sm font-semibold mb-2">
                    Catatan
                  </div>

                  <div className="border rounded-lg px-3 py-3 text-sm whitespace-pre-wrap min-h-[48px]">
                    {viewOrder.notes || '—'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <FormModal
        open={
          modalOpen
        }

        onClose={() =>
          setModalOpen(false)
        }

        title="Labeling Baru"

        onSubmit={
          handleSubmit
        }

        submitting={
          submitting
        }

        submitLabel="Proses Labeling"

        size="lg"
      >
        <div>
          <Label className="text-[12.5px] mb-1">
            Batch Siap Labeling *
          </Label>

          <Select
            value={
              form.stock_id
            }

            onValueChange={
              onStockChange
            }
          >
            <SelectTrigger className="h-9 text-[13px]">
              <SelectValue placeholder="Pilih batch siap labeling" />
            </SelectTrigger>

            <SelectContent>
              {siapLabelStock.map(
                stock => {
                  const product =
                    products.find(
                      item =>
                        item.id ===
                        stock.item_id
                    );

                  return (
                    <SelectItem
                      key={
                        stock.id
                      }

                      value={
                        stock.id
                      }
                    >
                      {getInventoryDisplayName(
                        product?.name ||
                          stock.item_name,

                        'READY_FOR_LABELING'
                      )}

                      {' '}

                      (
                      {stock.available_quantity}
                      {' '}
                      unit
                      )

                      {stock.batch_number
                        ? ` · ${stock.batch_number}`
                        : ''}
                    </SelectItem>
                  );
                }
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[12.5px] mb-1">
              Produk Sumber
            </Label>

            <Input
              value={
                form.source_product_name
              }

              disabled

              className="h-9 text-[13px] bg-muted/40"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Merk Hasil *
            </Label>

            <Select
              value={
                form.result_brand_id
              }

              onValueChange={
                onResultBrandChange
              }
            >
              <SelectTrigger className="h-9 text-[13px]">
                <SelectValue placeholder="Pilih merk hasil" />
              </SelectTrigger>

              <SelectContent>
                {brands.map(
                  brand => (
                    <SelectItem
                      key={
                        brand.id
                      }

                      value={
                        brand.id
                      }
                    >
                      {brand.name}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Produk Hasil Labeling *
            </Label>

            <Select
              value={
                form.result_product_id
              }

              onValueChange={
                onResultProductChange
              }

              disabled={
                !form.result_brand_id
              }
            >
              <SelectTrigger className="h-9 text-[13px]">
                <SelectValue
                  placeholder={
                    form.result_brand_id
                      ? 'Pilih produk hasil'
                      : 'Pilih merk hasil dulu'
                  }
                />
              </SelectTrigger>

              <SelectContent>
                {resultProducts.map(
                  product => (
                    <SelectItem
                      key={
                        product.id
                      }

                      value={
                        product.id
                      }
                    >
                      {product.name}

                      {product.bottle_size
                        ? ` · ${product.bottle_size}ml`
                        : ''}
                    </SelectItem>
                  )
                )}

                {form.result_brand_id &&
                  resultProducts.length ===
                    0 && (
                    <div className="px-2 py-2 text-[11px] text-amber-600">
                      Tidak ada Product aktif yang memiliki brand_id merk ini.
                      Periksa relasi Brand → Product di Master Barang.
                    </div>
                  )}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Batch
            </Label>

            <Input
              value={
                form.batch_number
              }

              disabled

              className="h-9 text-[13px] bg-muted/40"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Stok Tersedia (unit)
            </Label>

            <Input
              value={
                form.available_qty
              }

              disabled

              className="h-9 text-[13px] bg-muted/40"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Jumlah Dilabeli *
            </Label>

            <NumberInput
              value={
                form.quantity
              }

              onChange={
                value =>
                  setForm(
                    current => ({
                      ...current,

                      quantity:
                        value,
                    })
                  )
              }

              allowDecimal={
                false
              }

              min={
                0
              }

              className="h-9 text-[13px]"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Tanggal
            </Label>

            <Input
              type="date"

              value={
                form.labeling_date
              }

              onChange={
                event =>
                  setForm(
                    current => ({
                      ...current,

                      labeling_date:
                        event.target.value,
                    })
                  )
              }

              className="h-9 text-[13px]"
            />
          </div>
        </div>

        <div>
          <Label className="text-[12.5px] mb-1">
            Label / Stiker
          </Label>

          {form.labels.length ===
            0 && (
            <p className="text-[11px] text-amber-600">
              Belum ada barang tipe Label/Stiker.
              Tambahkan di Master Barang.
            </p>
          )}

          <Input
            value={
              labelSearch
            }

            onChange={
              event =>
                setLabelSearch(
                  event.target.value
                )
            }

            onKeyDown={
              event => {
                if (
                  event.key ===
                  'Enter'
                ) {
                  event.preventDefault();
                }
              }
            }

            placeholder="Cari nama/kode label/stiker..."

            className="h-8 text-[12px] mb-2"
          />

          <div className="space-y-1.5 max-h-52 overflow-auto border border-border rounded p-2">
            {(() => {
              const query =
                labelSearch
                  .trim()
                  .toLowerCase();

              const filtered =
                form.labels.filter(
                  label =>
                    !query ||
                    String(
                      label.material_name ||
                      ''
                    )
                      .toLowerCase()
                      .includes(
                        query
                      ) ||
                    String(
                      label.material_code ||
                      ''
                    )
                      .toLowerCase()
                      .includes(
                        query
                      )
                );

              if (
                !filtered.length
              ) {
                return (
                  <p className="text-[11px] text-muted-foreground text-center py-3">
                    {form.labels.length
                      ? 'Tidak ditemukan.'
                      : 'Belum ada data.'}
                  </p>
                );
              }

              return filtered.map(
                label => {
                  const index =
                    form.labels.findIndex(
                      item =>
                        item.material_id ===
                        label.material_id
                    );

                  return (
                    <div
                      key={
                        label.material_id
                      }

                      className="flex items-center gap-2 border border-border rounded px-2 py-1.5 bg-muted/10"
                    >
                      <Checkbox
                        checked={
                          label.checked
                        }

                        onCheckedChange={
                          value =>
                            updateLabel(
                              index,
                              {
                                checked:
                                  value,
                              }
                            )
                        }
                      />

                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] font-medium truncate">
                          {label.material_name}
                        </div>

                        <div className="text-[11px] text-muted-foreground">
                          Stok:{' '}
                          {label.stock}{' '}
                          {label.unit}
                        </div>
                      </div>

                      <div className="w-24">
                        <NumberInput
                          value={
                            label.quantity_per_unit
                          }

                          onChange={
                            value =>
                              updateLabel(
                                index,
                                {
                                  quantity_per_unit:
                                    value,
                                }
                              )
                          }

                          allowDecimal

                          min={
                            0
                          }

                          disabled={
                            !label.checked
                          }

                          className="h-8 text-[12px]"
                        />
                      </div>

                      <span className="text-[11px] text-muted-foreground">
                        /unit
                      </span>

                      <span className="text-[11px] tabular-nums w-20 text-right">
                        Butuh:{' '}

                        {label.checked
                          ? (
                              Number(
                                form.quantity
                              ) || 0
                            ) *
                            (
                              Number(
                                label.quantity_per_unit
                              ) || 0
                            )
                          : 0}
                      </span>
                    </div>
                  );
                }
              );
            })()}
          </div>
        </div>

        <div>
          <Label className="text-[12.5px] mb-1">
            Operator *
          </Label>

          <Input
            value={
              form.operator
            }

            onChange={
              event =>
                setForm(
                  current => ({
                    ...current,

                    operator:
                      event.target.value,
                  })
                )
            }

            className="h-9 text-[13px]"
          />
        </div>

        <div>
          <Label className="text-[12.5px] mb-1">
            Catatan
          </Label>

          <Textarea
            value={
              form.notes
            }

            onChange={
              event =>
                setForm(
                  current => ({
                    ...current,

                    notes:
                      event.target.value,
                  })
                )
            }

            rows={
              2
            }

            className="text-[13px]"
          />
        </div>
      </FormModal>
    </div>
  );
}