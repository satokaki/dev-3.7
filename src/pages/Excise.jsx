import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
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
  const [submitting, setSubmitting] = useState(false);
  const [bottlingSizeLookup, setBottlingSizeLookup] = useState({});

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
      const [
        items,
        balances,
        prods,
        brs,
        mats,
        matBal,
        boxMats,
        bottlingOrders,
        bottlingOutputs
      ] = await Promise.all([
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
        base44.entities.BottlingOrder.list('-created_date', 500),
        base44.entities.BottlingOutput.list('-created_date', 500),
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

      /*
       * v3.7 UI READ MODEL — BOTTLE SIZE FROM BOTTLING
       * Join BottlingOutput -> BottlingOrder.batch_number.
       * Exact batch+product match is preferred; batch-only fallback
       * supports Labeling that changes product identity (e.g. maklon).
       */
      const orderById = Object.fromEntries(
        (bottlingOrders || []).map(order => [order.id, order])
      );

      const sizeLookup = {};

      for (const output of bottlingOutputs || []) {
        const order = orderById[output?.bottling_id];
        const batchNumber = String(order?.batch_number || '').trim();
        const bottleSize = Number(
          output?.bottle_size ??
          output?.volume_per_bottle ??
          0
        );

        if (!batchNumber || bottleSize <= 0) continue;

        if (output?.product_id) {
          const exactKey = `${batchNumber}|${output.product_id}`;
          if (sizeLookup[exactKey] == null) {
            sizeLookup[exactKey] = bottleSize;
          }
        }

        const batchKey = `${batchNumber}|*`;
        if (sizeLookup[batchKey] == null) {
          sizeLookup[batchKey] = bottleSize;
        }
      }

      setBottlingSizeLookup(sizeLookup);
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

  const resetForm = () => {
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
  };

  const onStockChange = (v) => {
    const stock = belumCukaiStock.find(s => s.id === v);
    const prod = products.find(p => p.id === stock?.item_id);
    const batchNumber = String(stock?.batch_number || '').trim();

    const bottlingBottleSize =
      Number(
        bottlingSizeLookup[
          `${batchNumber}|${stock?.item_id || ''}`
        ] ??
        bottlingSizeLookup[
          `${batchNumber}|*`
        ] ??
        0
      ) || '';

    setForm(f => ({
      ...f,
      stock_id: v,
      product_id: stock?.item_id || '',
      brand_id: prod?.brand_id || '',
      bottle_size: bottlingBottleSize,
      quantity: String(
        stock?.available_quantity ??
        stock?.quantity ??
        ''
      ),
      excise_material_id: '',
      excise_material_name: '',
      excise_quantity_per_unit: '1',
      excise_label_type: '',
    }));
  };

  /*
   * v3.7 UI ONLY — PITA CUKAI RECOMMENDATION BY BOTTLING SIZE
   * Material EXCISE has no dedicated bottle_size field, so size is
   * inferred from specification/name/code text such as "30ml".
   */
  const inferExciseBottleSize = (material) => {
    const text = [
      material?.specification,
      material?.name,
      material?.code,
    ]
      .filter(Boolean)
      .join(' ');

    const match =
      text.match(/(\d+(?:[.,]\d+)?)\s*ml\b/i);

    return match
      ? Number(String(match[1]).replace(',', '.'))
      : 0;
  };

  const selectedBottleSize =
    Number(form.bottle_size) || 0;

  const recommendedExciseMaterials =
    [...exciseMaterials]
      .sort((a, b) => {
        const aMatch =
          selectedBottleSize > 0 &&
          inferExciseBottleSize(a) === selectedBottleSize;

        const bMatch =
          selectedBottleSize > 0 &&
          inferExciseBottleSize(b) === selectedBottleSize;

        if (aMatch !== bMatch) {
          return aMatch ? -1 : 1;
        }

        return String(a?.name || '').localeCompare(
          String(b?.name || ''),
          'id'
        );
      });

  const recommendedExciseCount =
    recommendedExciseMaterials.filter(
      material =>
        selectedBottleSize > 0 &&
        inferExciseBottleSize(material) === selectedBottleSize &&
        Number(exciseStocks[material.id] || 0) > 0
    ).length;

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

    const quantityProcessed =
      Number(form.quantity) || 0;

    if (quantityProcessed <= 0) {
      toast({
        variant: 'destructive',
        title: 'Jumlah harus lebih dari 0'
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

    setSubmitting(true);

    let excise = null;
    let excNumber = '';
    let sourceBalance = null;
    let sourceAvailableBefore = 0;

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

      /*
       * ========================================================
       * v3.7 EXCISE ATOMIC POSTING
       * ========================================================
       *
       * Preflight seluruh stok dilakukan sebelum movement pertama.
       * Semua konsumsi memakai StockBalance identity aktual.
       * Jika salah satu langkah gagal setelah movement dimulai,
       * seluruh movement pada ExciseOrder tersebut dibalik otomatis.
       */

      /*
       * 0A. PREFLIGHT SOURCE UNEXCISED
       */
      const sourceRows =
        await base44.entities.StockBalance.filter({
          item_id: stockItem.item_id,
          item_type: 'product',
          inventory_status: 'UNEXCISED'
        });

      sourceBalance =
        (sourceRows || []).find(
          row => row.id === stockItem.id
        ) ||
        (sourceRows || []).find(
          row =>
            (row.batch_id || '') === (stockItem.batch_id || '') &&
            (row.warehouse_id || '') === (stockItem.warehouse_id || '') &&
            (row.inventory_status || '') === 'UNEXCISED'
        ) ||
        null;

      sourceAvailableBefore =
        Number(
          sourceBalance?.available_quantity ??
          sourceBalance?.quantity ??
          0
        );

      if (
        !sourceBalance ||
        sourceAvailableBefore < quantityProcessed
      ) {
        throw new Error(
          `Preflight stok UNEXCISED gagal. Tersedia ${sourceAvailableBefore}, dibutuhkan ${quantityProcessed}.`
        );
      }

      /*
       * 0B. PREFLIGHT PITA CUKAI
       */
      let exciseMat = null;
      let exciseLots = [];
      let exactExciseStock = 0;

      if (form.excise_material_id) {
        exciseMat =
          exciseMaterials.find(
            m => m.id === form.excise_material_id
          );

        if (!exciseMat) {
          throw new Error(
            'Material pita cukai tidak ditemukan'
          );
        }

        const exciseBalanceRows =
          await base44.entities.StockBalance.filter({
            item_id: form.excise_material_id,
            item_type: 'material'
          });

        exciseLots =
          (exciseBalanceRows || [])
            .filter(
              row =>
                Number(
                  row.available_quantity ??
                  row.quantity ??
                  0
                ) > 0
            )
            .sort((a, b) => {
              const da =
                a.created_date ||
                a.updated_date ||
                '';
              const db =
                b.created_date ||
                b.updated_date ||
                '';
              return da.localeCompare(db);
            });

        exactExciseStock =
          exciseLots.reduce(
            (sum, row) =>
              sum +
              Number(
                row.available_quantity ??
                row.quantity ??
                0
              ),
            0
          );

        if (exciseTotalRequired > exactExciseStock) {
          throw new Error(
            `Preflight pita cukai gagal. Butuh ${exciseTotalRequired}, stok aktual ${exactExciseStock}.`
          );
        }
      }

      /*
       * 0C. PREFLIGHT BOX
       */
      let boxMat = null;
      let boxLots = [];
      let exactBoxStock = 0;

      if (
        form.use_box &&
        form.box_material_id
      ) {
        boxMat =
          boxMaterials.find(
            m => m.id === form.box_material_id
          );

        if (!boxMat) {
          throw new Error(
            'Material box tidak ditemukan'
          );
        }

        const boxBalanceRows =
          await base44.entities.StockBalance.filter({
            item_id: form.box_material_id,
            item_type: 'material'
          });

        boxLots =
          (boxBalanceRows || [])
            .filter(
              row =>
                Number(
                  row.available_quantity ??
                  row.quantity ??
                  0
                ) > 0
            )
            .sort((a, b) => {
              const da =
                a.created_date ||
                a.updated_date ||
                '';
              const db =
                b.created_date ||
                b.updated_date ||
                '';
              return da.localeCompare(db);
            });

        exactBoxStock =
          boxLots.reduce(
            (sum, row) =>
              sum +
              Number(
                row.available_quantity ??
                row.quantity ??
                0
              ),
            0
          );

        if (boxTotalRequired > exactBoxStock) {
          throw new Error(
            `Preflight box gagal. Butuh ${boxTotalRequired}, stok aktual ${exactBoxStock}.`
          );
        }
      }

      /*
       * 0D. HPP SOURCE — frozen dari labeling_output
       */
      const labelingLedgers =
        await base44.entities.StockLedger.filter({
          batch_id: stockItem.batch_id || '',
          item_id: stockItem.item_id,
          inventory_status: 'UNEXCISED',
          transaction_type: 'labeling_output',
        });

      const latestLabelingLedger =
        [...(labelingLedgers || [])].sort(
          (a, b) =>
            new Date(
              b.transaction_date ||
              b.created_date ||
              0
            ).getTime() -
            new Date(
              a.transaction_date ||
              a.created_date ||
              0
            ).getTime()
        )[0];

      const hppLabelingPerBottle =
        Number(latestLabelingLedger?.unit_cost) || 0;

      if (
        !labelingLedgers.length ||
        hppLabelingPerBottle <= 0
      ) {
        throw new Error(
          `HPP hasil Labeling tidak ditemukan untuk ${product.name} · batch ${stockItem.batch_number || '-'}`
        );
      }

      /*
       * 1. CREATE HEADER — BELUM FINAL
       */
      excNumber =
        await generateOrderNumber(
          'EXC',
          'ExciseOrder'
        );

      excise =
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
            quantityProcessed,
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
            'sedang_diproses',
          notes:
            form.notes,
        });

      const previousProductCost =
        quantityProcessed *
        hppLabelingPerBottle;

      let exciseCost = 0;
      let packagingCost = 0;

      /*
       * 2. CONSUME UNEXCISED — exact source identity
       */
      await recordStockMovement({
        item_type: 'product',
        item_id: product.id,
        item_name: product.name || '',
        item_code: product.code || '',
        batch_id:
          sourceBalance.batch_id ||
          stockItem.batch_id ||
          '',
        batch_number:
          sourceBalance.batch_number ||
          stockItem.batch_number ||
          '',
        warehouse_id:
          sourceBalance.warehouse_id ||
          '',
        warehouse_name:
          sourceBalance.warehouse_name ||
          '',
        inventory_status:
          sourceBalance.inventory_status ||
          'UNEXCISED',
        quantity_out: quantityProcessed,
        unit: 'unit',
        unit_cost: hppLabelingPerBottle,
        transaction_type: 'excise_consumption',
        transaction_number: excNumber,
        reference_type: 'excise',
        reference_id: excise.id,
        notes: `Proses cukai ${excNumber}`,
      });

      /*
       * 3. CONSUME PITA CUKAI FIFO
       */
      if (form.excise_material_id) {
        const exciseHbt =
          Number(exciseMat?.last_purchase_price) || 0;

        exciseCost =
          exciseTotalRequired *
          exciseHbt;

        let remainingExciseQty =
          exciseTotalRequired;

        for (const lot of exciseLots) {
          if (remainingExciseQty <= 0) break;

          const available =
            Number(
              lot.available_quantity ??
              lot.quantity ??
              0
            );

          const take =
            Math.min(
              remainingExciseQty,
              available
            );

          await recordStockMovement({
            item_type: 'material',
            item_id:
              form.excise_material_id,
            item_name:
              form.excise_material_name,
            item_code:
              exciseMat?.code || '',
            batch_id:
              lot.batch_id || '',
            batch_number:
              lot.batch_number || '',
            warehouse_id:
              lot.warehouse_id || '',
            warehouse_name:
              lot.warehouse_name || '',
            inventory_status:
              lot.inventory_status || '',
            quantity_out:
              take,
            unit:
              exciseMat?.unit || 'unit',
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

          remainingExciseQty -= take;
        }

        if (remainingExciseQty > 0) {
          throw new Error(
            `Konsumsi pita cukai tidak lengkap. Sisa ${remainingExciseQty} belum terpotong.`
          );
        }
      }

      /*
       * 4. CONSUME BOX FIFO
       */
      if (
        form.use_box &&
        form.box_material_id
      ) {
        const packagingHbt =
          Number(boxMat?.last_purchase_price) || 0;

        packagingCost =
          boxTotalRequired *
          packagingHbt;

        let remainingBoxQty =
          boxTotalRequired;

        for (const lot of boxLots) {
          if (remainingBoxQty <= 0) break;

          const available =
            Number(
              lot.available_quantity ??
              lot.quantity ??
              0
            );

          const take =
            Math.min(
              remainingBoxQty,
              available
            );

          await recordStockMovement({
            item_type: 'material',
            item_id:
              form.box_material_id,
            item_name:
              form.box_material_name,
            item_code:
              boxMat?.code || '',
            batch_id:
              lot.batch_id || '',
            batch_number:
              lot.batch_number || '',
            warehouse_id:
              lot.warehouse_id || '',
            warehouse_name:
              lot.warehouse_name || '',
            inventory_status:
              lot.inventory_status || '',
            quantity_out:
              take,
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

          remainingBoxQty -= take;
        }

        if (remainingBoxQty > 0) {
          throw new Error(
            `Konsumsi box tidak lengkap. Sisa ${remainingBoxQty} belum terpotong.`
          );
        }
      }

      /*
       * 5. CREATE READY_FOR_SALE OUTPUT
       */
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
        batch_id:
          sourceBalance.batch_id ||
          stockItem.batch_id ||
          '',
        batch_number:
          sourceBalance.batch_number ||
          stockItem.batch_number ||
          '',
        warehouse_id:
          sourceBalance.warehouse_id ||
          '',
        warehouse_name:
          sourceBalance.warehouse_name ||
          '',
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

      /*
       * 6. FINALIZE HEADER LAST
       */
      await base44.entities.ExciseOrder.update(
        excise.id,
        {
          status: 'siap_jual'
        }
      );

      /*
       * Audit dibuat NON-FATAL.
       * Gagal audit tidak boleh membuat user mengira transaksi stok gagal.
       */
      try {
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
      } catch {
        // Audit failure tidak membatalkan transaksi stok yang sudah valid.
      }

      toast({
        title:
          product.excise_required === false
            ? 'Produk non cukai selesai'
            : 'Proses cukai selesai',
        description:
          `${excNumber} · ${product.name}`,
      });

      resetForm();
      await loadData();

    } catch (e) {
      /*
       * ========================================================
       * AUTO ROLLBACK
       * ========================================================
       *
       * Reverse hanya movement milik ExciseOrder attempt ini.
       * Identity dan unit_cost diambil dari StockLedger asli.
       */
      let rollbackOk = true;
      const rollbackErrors = [];

      if (excise?.id) {
        try {
          const referenceRows =
            await base44.entities.StockLedger.filter({
              reference_type: 'excise',
              reference_id: excise.id
            });

          const numberRows =
            excNumber
              ? await base44.entities.StockLedger.filter({
                  transaction_number: excNumber
                })
              : [];

          const reversibleTypes = [
            'excise_consumption',
            'excise_output'
          ];

          const rowsToReverse =
            Array.from(
              new Map(
                [
                  ...(referenceRows || []),
                  ...(numberRows || [])
                ].map(row => [row.id, row])
              ).values()
            )
              .filter(
                row =>
                  reversibleTypes.includes(
                    row.transaction_type
                  )
              )
              .sort((a, b) => {
                const da =
                  new Date(
                    a.created_date ||
                    a.transaction_date ||
                    0
                  ).getTime();

                const db =
                  new Date(
                    b.created_date ||
                    b.transaction_date ||
                    0
                  ).getTime();

                return db - da;
              });

          for (const row of rowsToReverse) {
            try {
              await recordStockMovement({
                item_type:
                  row.item_type,
                item_id:
                  row.item_id,
                item_code:
                  row.item_code || '',
                item_name:
                  row.item_name || '',
                batch_id:
                  row.batch_id || '',
                batch_number:
                  row.batch_number || '',
                warehouse_id:
                  row.warehouse_id || '',
                warehouse_name:
                  row.warehouse_name || '',
                inventory_status:
                  row.inventory_status || '',
                quantity_in:
                  Number(
                    row.quantity_out || 0
                  ),
                quantity_out:
                  Number(
                    row.quantity_in || 0
                  ),
                unit:
                  row.unit || '',
                unit_cost:
                  Number(
                    row.unit_cost || 0
                  ),
                transaction_type:
                  'excise_auto_reversal',
                transaction_number:
                  `ROLLBACK-${excNumber}`,
                reference_type:
                  'excise',
                reference_id:
                  excise.id,
                notes:
                  `AUTO ROLLBACK Cukai · ${row.transaction_type} · ${excNumber}`
              });
            } catch (rollbackMovementError) {
              rollbackOk = false;
              rollbackErrors.push(
                rollbackMovementError?.message ||
                'Gagal reversal stock movement'
              );
            }
          }

          /*
           * Failed order tetap disimpan untuk traceability,
           * tetapi tidak boleh tetap siap_jual.
           */
          try {
            await base44.entities.ExciseOrder.update(
              excise.id,
              {
                status:
                  rollbackOk
                    ? 'dibatalkan'
                    : 'rollback_gagal',
                notes:
                  [
                    form.notes,
                    `AUTO ROLLBACK: ${e?.message || 'Proses cukai gagal'}`
                  ]
                    .filter(Boolean)
                    .join('\n')
              }
            );
          } catch (orderResetError) {
            rollbackOk = false;
            rollbackErrors.push(
              orderResetError?.message ||
              'Gagal menandai ExciseOrder hasil rollback'
            );
          }

          try {
            await createAuditLog({
              module: 'Cukai',
              action:
                rollbackOk
                  ? 'Auto Rollback'
                  : 'Auto Rollback Partial',
              entity_type: 'ExciseOrder',
              entity_id: excise.id,
              reference_number: excNumber,
              reason:
                e?.message ||
                'Excise posting failed',
              data_after: {
                rollback_ok:
                  rollbackOk,
                rollback_errors:
                  rollbackErrors
              }
            });
          } catch {
            // Audit failure tidak boleh menggagalkan rollback stok.
          }

        } catch (rollbackFatalError) {
          rollbackOk = false;
          rollbackErrors.push(
            rollbackFatalError?.message ||
            'Rollback fatal error'
          );
        }
      }

      toast({
        variant: 'destructive',
        title:
          rollbackOk
            ? 'Proses cukai gagal · stok dikembalikan'
            : 'Proses cukai gagal · rollback perlu diperiksa',
        description:
          rollbackOk
            ? (
                `${e?.message || 'Terjadi kesalahan'} · ` +
                'Tidak ada perubahan stok bersih.'
              )
            : (
                `${e?.message || 'Terjadi kesalahan'} · ` +
                `Rollback tidak lengkap: ${rollbackErrors.join('; ')}`
              )
      });

      await loadData();

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
        description="Produk hasil Labeling (UNEXCISED) → READY_FOR_SALE. Ukuran botol dibaca dari proses Bottling sebelumnya."
      />

      {/* FORM CUKAI DEDICATED — TIDAK POPUP */}
      <div className="rounded-lg border bg-white mb-5 overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-[14px]">
              Form Proses Cukai
            </div>
            <div className="text-[11px] text-muted-foreground">
              Pilih produk UNEXCISED → ukuran botol dari Bottling → pita cukai rekomendasi.
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={resetForm}
            disabled={submitting}
          >
            Reset Form
          </Button>
        </div>

        <div className="p-4 space-y-4">
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

            <Input
              value={
                form.bottle_size
                  ? `${form.bottle_size} ml`
                  : ''
              }
              disabled
              placeholder="Terbaca otomatis dari Bottling"
              className="h-9 text-[13px] bg-muted/40"
            />

            {form.stock_id && !form.bottle_size && (
              <p className="text-[11px] text-amber-600 mt-1">
                Data ukuran Bottling untuk batch ini belum ditemukan.
              </p>
            )}
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
              {recommendedExciseMaterials.map(m => {
                const stk =
                  exciseStocks[m.id] || 0;

                const materialSize =
                  inferExciseBottleSize(m);

                const recommended =
                  selectedBottleSize > 0 &&
                  materialSize === selectedBottleSize;

                return (
                  <SelectItem
                    key={m.id}
                    value={m.id}
                    disabled={stk <= 0}
                  >
                    {recommended ? '★ ' : ''}
                    {m.name}
                    {materialSize > 0 ? ` · ${materialSize}ml` : ''}
                    {' · '}
                    Stok {stk} {m.unit || 'pcs'}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          {selectedBottleSize > 0 && (
            <p className="text-[11px] text-violet-700 mt-1">
              ★ Rekomendasi pita untuk ukuran {selectedBottleSize} ml
              {recommendedExciseCount > 0
                ? ` · ${recommendedExciseCount} pilihan stok tersedia`
                : ' · belum ada material ukuran cocok di master/stok'}
            </p>
          )}

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
        </div>

        <div className="px-4 py-3 border-t bg-muted/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-[11px] text-muted-foreground">
            {form.stock_id
              ? (
                  form.bottle_size
                    ? `Ukuran Bottling: ${form.bottle_size} ml`
                    : 'Ukuran Bottling belum ditemukan untuk batch ini.'
                )
              : 'Pilih produk belum cukai untuk mulai.'
            }
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={resetForm}
              disabled={submitting}
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
                : 'Proses Cukai'
              }
            </Button>
          </div>
        </div>
      </div>

      {/* RIWAYAT CUKAI */}
      <div className="mb-2">
        <div className="font-semibold text-[14px]">
          Riwayat Proses Cukai
        </div>
        <div className="text-[11px] text-muted-foreground">
          Dokumen proses cukai yang sudah diproses.
        </div>
      </div>

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
    </div>
  );
}