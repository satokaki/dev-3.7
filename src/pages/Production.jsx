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
import { Plus, Play, CheckCircle, AlertTriangle, RefreshCw, RotateCcw, X } from 'lucide-react';
import { calculateRecipe } from '@/lib/recipeCalculator';
import { calculatePremixQuantities } from '@/lib/premix';
import { generateProductionNumber, generateBatchNumber } from '@/lib/sequence';
import { recordStockMovement, getStockBalance, createAuditLog } from '@/lib/stockUtils';
import NumberInput from '@/components/NumberInput';
import PdfButton from '@/components/PdfButton';
import { exportDocumentToPDF } from '@/lib/pdfExport';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission, canSelectRecipeForProduction, isRecipeFormulaHidden } from '@/lib/permissions';
import { Checkbox } from '@/components/ui/checkbox';
import { formatNumber, formatCurrency } from '@/lib/format';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel
} from '@/components/ui/alert-dialog';

/* ==========================================================
   PRODUCTION ORDER
========================================================== */
const PRODUCTION_ORDER = {
  flavor: 10,
  essence: 10,
  sweetener: 20,
  cooling: 30,
  additive: 40,
  premix: 40,
  nicotine: 50,
  vegetable_glycerin: 60,
  vg: 60,
  propylene_glycol: 70,
  pg: 70,
  lainnya: 80,
};

/* ==========================================================
   PREMIX BUSINESS RULE
========================================================== */
const isOneToOnePremix = (material) => {
  if (!material) return false;
  const type = String(material.material_type || '').toUpperCase();
  if (type !== 'PREMIX') return false;
  const category = String(material.material_category || '').toLowerCase();
  const name = String(material.name || '').toLowerCase();
  const isSweetener =
    category === 'sweetener' ||
    name.includes('sweetener') ||
    name.includes('sucralose');
  const isCooling =
    category === 'cooling' ||
    name.includes('cooling') ||
    name.includes('chiller') ||
    name.includes('ws23') ||
    name.includes('ws-23');
  return isSweetener || isCooling;
};

export default function Production() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [data, setData] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [productionMaterials, setProductionMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [calcItems, setCalcItems] = useState([]);
  const [stockCheck, setStockCheck] = useState([]);
  const [checked, setChecked] = useState({});
  const [gramasiTidakSinkron, setGramasiTidakSinkron] = useState(false);
  const [gramasiMap, setGramasiMap] = useState({});
  const [premixPreview, setPremixPreview] = useState(null);
  const [premixConfirmOpen, setPremixConfirmOpen] = useState(false);
  const [form, setForm] = useState({
    recipe_id: '',
    target_volume: 1000,
    production_date: new Date().toISOString().slice(0, 10),
    operator: '',
    notes: ''
  });

  /* ==========================================================
     LOAD DATA
  ========================================================== */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const items = await base44.entities.ProductionOrder.list('-created_date', 100);
      setData(items);
      const approved = await base44.entities.Recipe.filter({
        status: 'approved'
      });
      setRecipes(approved);
      const mats = await base44.entities.Material.filter({
        is_active: true
      });
      setMaterials(mats);
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

  /* ==========================================================
     MATERIAL STOCK SOURCE
     PREMIX materials must read only PREMIX StockBalance.
     Raw materials keep the existing aggregate stock behavior.
  ========================================================== */
  const getMaterialAvailableStock = useCallback(
    async (materialId, material) => {
      const isPremixMaterial =
        String(material?.material_type || '').toUpperCase() === 'PREMIX';

      if (!isPremixMaterial) {
        return getStockBalance(materialId, 'material');
      }

      const premixBalances =
        await base44.entities.StockBalance.filter({
          item_id: materialId,
          item_type: 'material',
          inventory_status: 'PREMIX'
        });

      return premixBalances.reduce(
        (sum, balance) =>
          sum +
          Number(
            balance.available_quantity ??
            balance.quantity ??
            0
          ),
        0
      );
    },
    []
  );

  /* ==========================================================
     PREMIX CONSUMPTION
     Consume PREMIX stock by its real StockBalance identity
     (stage + batch + warehouse), FIFO across available lots.
  ========================================================== */
  const consumeMaterialStock = useCallback(
    async ({
      productionMaterial,
      material,
      quantity,
      transactionType,
      production
    }) => {
      const isPremixMaterial =
        String(material?.material_type || '').toUpperCase() === 'PREMIX';

      const common = {
        item_type: 'material',
        item_id: productionMaterial.material_id,
        item_name: productionMaterial.material_name,
        item_code: material?.code || '',
        quantity_out: quantity,
        unit: 'gram',
        unit_cost: Number(
          material?.last_purchase_price || 0
        ),
        transaction_type: transactionType,
        transaction_number:
          production.production_number,
        reference_type: 'production',
        reference_id: production.id
      };

      if (!isPremixMaterial) {
        await recordStockMovement({
          ...common,
          notes:
            production.production_type === 'PREMIX'
              ? `Produksi premix ${production.batch_number}`
              : `Produksi ${production.batch_number}`
        });
        return;
      }

      const premixBalances =
        await base44.entities.StockBalance.filter({
          item_id: productionMaterial.material_id,
          item_type: 'material',
          inventory_status: 'PREMIX'
        });

      const availableLots =
        premixBalances
          .filter(
            balance =>
              Number(
                balance.available_quantity ??
                balance.quantity ??
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

      const totalAvailable =
        availableLots.reduce(
          (sum, balance) =>
            sum +
            Number(
              balance.available_quantity ??
              balance.quantity ??
              0
            ),
          0
        );

      if (totalAvailable < quantity) {
        throw new Error(
          `Stok PREMIX ${productionMaterial.material_name} tidak mencukupi. ` +
          `Stok: ${totalAvailable}, dibutuhkan: ${quantity}`
        );
      }

      let remaining = quantity;

      for (const balance of availableLots) {
        if (remaining <= 0) break;

        const available =
          Number(
            balance.available_quantity ??
            balance.quantity ??
            0
          );

        const take =
          Math.min(
            remaining,
            available
          );

        await recordStockMovement({
          ...common,
          batch_id:
            balance.batch_id || '',
          batch_number:
            balance.batch_number || '',
          warehouse_id:
            balance.warehouse_id || '',
          warehouse_name:
            balance.warehouse_name || '',
          inventory_status: 'PREMIX',
          quantity_out: take,
          notes:
            `Produksi ${production.batch_number} · ` +
            `konsumsi PREMIX ${balance.batch_number || '-'}`
        });

        remaining -= take;
      }
    },
    []
  );

  /* ==========================================================
     CALCULATE MATERIALS
  ========================================================== */
  const calculateMaterials = useCallback(
    async (recipeId, targetValue) => {
      if (!recipeId || !targetValue) return;
      const recipe = recipes.find(r => r.id === recipeId);
      if (!recipe) return;

      const ingredients = await base44.entities.RecipeIngredient.filter({
        recipe_id: recipeId
      });

      const matsById = Object.fromEntries(
        materials.map(m => [m.id, m])
      );

      const isPremix = recipe.recipe_type === 'PREMIX';
      const basis = recipe.calculation_basis || 'W_W';
      const targetQty = Number(targetValue);
      let items = [];

      if (isPremix) {
        const calc = calculatePremixQuantities({
          ingredients,
          targetQuantity: targetQty,
          basis,
          materialsById: matsById
        });

        items = calc.map(c => ({
          material_id: c.material_id,
          material_name: c.material_name,
          material_type: c.material_type,
          percentage: Number(c.percentage || 0),
          volumeMl: Number(c.ml || 0),
          gram: Number(c.gram || 0)
        }));
      } else {
        const pgMaterial = materials.find(
          m => m.material_category === 'propylene_glycol'
        );
        const vgMaterial = materials.find(
          m => m.material_category === 'vegetable_glycerin'
        );

        const result = calculateRecipe({
          ingredients: ingredients.map(i => ({ ...i })),
          targetVolume: targetQty,
          targetNicotine: recipe.target_nicotine,
          targetPG: recipe.target_pg,
          targetVG: recipe.target_vg,
          nicotineBaseStrength:
            ingredients.find(i => i.material_type === 'nicotine')?.nicotine_strength || 100,
          pgMaterial,
          vgMaterial
        });

        items = (result.items || []).map(item => {
          const mat = matsById[item.material_id];
          if (isOneToOnePremix(mat)) {
            return {
              ...item,
              gram: Number(item.volumeMl || 0)
            };
          }
          return item;
        });
      }

      const stockChecks = await Promise.all(
        items.map(async item => {
          const mat = materials.find(m => m.id === item.material_id);
          const stockRaw =
            await getMaterialAvailableStock(
              item.material_id,
              mat
            );
          const density = Number(mat?.density || mat?.default_density || 0);
          const matUnit = mat?.unit || 'gram';
          const requiredGram = Number(item.gram || 0);
          let stockGram = Number(stockRaw || 0);

          if (isPremix && matUnit === 'mililiter' && density > 0) {
            stockGram = Number(stockRaw || 0) * density;
          }

          return {
            ...item,
            material_name: mat?.name || item.material_name,
            material_id: item.material_id,
            stockAvailable: stockGram,
            stockAvailableRaw: stockRaw,
            stockUnit: matUnit,
            stockSufficient: stockGram >= requiredGram,
            requiredGram,
            requiredMl: Number(item.volumeMl || 0)
          };
        })
      );

      const orderKey = (item) => {
        const cat =
          matsById[item.material_id]?.material_category ||
          item.material_type ||
          '';
        return (
          PRODUCTION_ORDER[cat] ??
          PRODUCTION_ORDER[item.material_type] ??
          80
        );
      };

      stockChecks.sort((a, b) => {
        const pa = orderKey(a);
        const pb = orderKey(b);
        if (pa !== pb) return pa - pb;
        return String(a.material_name || '').localeCompare(
          String(b.material_name || '')
        );
      });

      setCalcItems(stockChecks);
      setStockCheck(stockChecks);
    },
    [recipes, materials, getMaterialAvailableStock]
  );

  useEffect(() => {
    if (form.recipe_id && form.target_volume) {
      calculateMaterials(form.recipe_id, form.target_volume);
    }
  }, [
    form.recipe_id,
    form.target_volume,
    calculateMaterials
  ]);

  /* ==========================================================
     OPEN ADD
  ========================================================== */
  const openAdd = () => {
    setEditing(null);
    setForm({
      recipe_id: '',
      target_volume: 1000,
      production_date: new Date().toISOString().slice(0, 10),
      operator: '',
      notes: ''
    });
    setCalcItems([]);
    setStockCheck([]);
    setModalOpen(true);
  };

  /* ==========================================================
     OPEN DETAIL
  ========================================================== */
  const openDetail = async (item) => {
    setEditing(item);

    const mats = await base44.entities.ProductionMaterial.filter({
      production_id: item.id
    });

    setProductionMaterials(mats);

    const ck = {};
    const gMap = {};
    let expectedTotal = 0;
    let storedTotal = 0;

    const target = Number(
      item.target_volume ||
      item.target_quantity ||
      0
    );

    const isFinished =
      item.production_type !== 'PREMIX';

    mats.forEach(m => {
      ck[m.material_id] =
        !!m.actual_gram &&
        Number(m.actual_gram) > 0;

      const mat = materials.find(
        x => x.id === m.material_id
      );

      const density =
        Number(
          mat?.density ||
          mat?.default_density
        ) ||
        (
          m.material_type === 'vegetable_glycerin'
            ? 1.261
            : m.material_type === 'propylene_glycol'
              ? 1.036
              : 1
        );

      const effectiveDensity =
        isOneToOnePremix(mat)
          ? 1
          : density;

      const recomputed =
        (
          Number(m.percentage || 0) /
          100
        ) *
        target *
        effectiveDensity;

      gMap[m.material_id] =
        m.required_gram != null
          ? Number(m.required_gram)
          : recomputed;

      if (isFinished) {
        expectedTotal += recomputed;
        storedTotal += Number(m.required_gram || 0);
      }
    });

    setChecked(ck);
    setGramasiMap(gMap);
    setGramasiTidakSinkron(
      isFinished &&
      mats.length > 0 &&
      Math.abs(
        expectedTotal -
        storedTotal
      ) > 1
    );

    setDetailOpen(true);
  };

  /* ==========================================================
     CREATE PRODUCTION ORDER
     Shared by normal and waiting-material flows.
  ========================================================== */
  const createProductionOrder = async ({
    recipe,
    status,
    shortageItems = []
  }) => {
    const prdNumber =
      await generateProductionNumber();

    const batchNumber =
      await generateBatchNumber(
        recipe?.recipe_type === 'PREMIX'
          ? 'GEN'
          : 'MFG'
      );

    const isPremix =
      recipe.recipe_type === 'PREMIX';

    const outputMaterial =
      isPremix
        ? materials.find(
            m => m.id === recipe.output_material_id
          )
        : null;

    const shortageNote =
      shortageItems.length > 0
        ? `Menunggu bahan: ${shortageItems
            .map(
              s =>
                `${s.material_name} kurang ${Math.max(
                  0,
                  Number(s.requiredGram || 0) -
                  Number(s.stockAvailable || 0)
                ).toFixed(2)}g`
            )
            .join(', ')}`
        : '';

    const production =
      await base44.entities.ProductionOrder.create({
        production_number: prdNumber,
        batch_number: batchNumber,
        production_date: form.production_date,
        recipe_id: recipe.id,
        recipe_code: recipe.code,
        recipe_version: recipe.version,
        recipe_type:
          recipe.recipe_type ||
          'FINISHED_PRODUCT',
        production_type:
          recipe.recipe_type ||
          'FINISHED_PRODUCT',
        calculation_basis:
          recipe.calculation_basis ||
          'W_W',
        product_id:
          recipe.product_id || '',
        product_name:
          isPremix
            ? outputMaterial?.name || recipe.output_material_name || 'Premix'
            : recipe.product_name || '',
        output_material_id:
          isPremix
            ? recipe.output_material_id || ''
            : '',
        output_material_name:
          outputMaterial?.name ||
          recipe.output_material_name ||
          '',
        brand_id:
          recipe.brand_id,
        brand_name:
          recipe.brand_name,
        target_volume:
          isPremix
            ? 0
            : Number(form.target_volume),
        target_quantity:
          isPremix
            ? Number(form.target_volume)
            : 0,
        target_unit:
          isPremix
            ? (
                recipe.calculation_basis === 'W_W'
                  ? 'gram'
                  : 'mililiter'
              )
            : 'mililiter',
        actual_volume: 0,
        operator: form.operator,
        approver: '',
        status,
        recipe_snapshot:
          JSON.stringify(recipe),
        notes:
          [form.notes, shortageNote]
            .filter(Boolean)
            .join('\n')
      });

    await base44.entities.ProductionMaterial.bulkCreate(
      calcItems.map(item => ({
        production_id: production.id,
        material_id: item.material_id,
        material_name: item.material_name,
        material_type: item.material_type,
        percentage: item.percentage,
        required_ml: item.volumeMl,
        required_gram: item.gram,
        actual_gram: 0,
        deviation_gram: 0,
        deviation_percent: 0,
        stock_available: item.stockAvailable,
        stock_sufficient: item.stockSufficient
      }))
    );

    await createAuditLog({
      module: 'Produksi',
      action:
        status === 'menunggu_bahan'
          ? 'Simpan Menunggu Bahan'
          : 'Tambah',
      entity_type: 'ProductionOrder',
      entity_id: production.id,
      reference_number: prdNumber,
      data_after: {
        status,
        shortage_count: shortageItems.length
      }
    });

    return {
      production,
      prdNumber,
      batchNumber
    };
  };

  /* ==========================================================
     SUBMIT PRODUCTION
  ========================================================== */
  const handleSubmit = async () => {
    if (
      !form.recipe_id ||
      !form.target_volume ||
      !form.operator
    ) {
      toast({
        variant: 'destructive',
        title: 'Resep, volume, dan operator wajib diisi'
      });
      return;
    }

    const recipe = recipes.find(
      r => r.id === form.recipe_id
    );

    if (
      recipe?.recipe_type === 'PREMIX'
    ) {
      const totalPct = stockCheck.reduce(
        (sum, item) =>
          sum +
          Number(item.percentage || 0),
        0
      );

      if (
        Math.abs(totalPct - 100) > 0.1
      ) {
        toast({
          variant: 'destructive',
          title: 'Komposisi Recipe tidak valid',
          description: 'Total bahan harus 100%.'
        });
        return;
      }
    }

    const insufficient = stockCheck.filter(
      s => !s.stockSufficient
    );

    setSubmitting(true);

    try {
      if (insufficient.length > 0) {
        const {
          prdNumber,
          batchNumber
        } = await createProductionOrder({
          recipe,
          status: 'menunggu_bahan',
          shortageItems: insufficient
        });

        toast({
          title: 'Produksi disimpan · Menunggu Bahan',
          description:
            `${prdNumber} · ${batchNumber} · ${insufficient.length} bahan belum cukup`
        });

        setModalOpen(false);
        await loadData();
        return;
      }

      const {
        prdNumber,
        batchNumber
      } = await createProductionOrder({
        recipe,
        status: 'siap_produksi'
      });

      toast({
        title: 'Produksi dibuat',
        description:
          `${prdNumber} · ${batchNumber}`
      });

      setModalOpen(false);
      await loadData();

    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Gagal menyimpan',
        description: e.message
      });
    } finally {
      setSubmitting(false);
    }
  };

  /* ==========================================================
     REFRESH PRODUCTION — MENUNGGU BAHAN
     Re-read current material stock and activate the order only
     when every required material is sufficient.
     No StockLedger movement here.
  ========================================================== */
  const handleActivateWaiting = async (item) => {
    if (
      item.status !== 'menunggu_bahan'
    ) {
      return;
    }

    setSubmitting(true);

    try {
      const mats =
        await base44.entities.ProductionMaterial.filter({
          production_id: item.id
        });

      const checks =
        await Promise.all(
          mats.map(async m => {
            const mat =
              materials.find(
                x => x.id === m.material_id
              );

            const stockRaw =
              await getMaterialAvailableStock(
                m.material_id,
                mat
              );

            const density =
              Number(
                mat?.density ||
                mat?.default_density ||
                0
              );

            const unit =
              String(
                mat?.unit || 'gram'
              ).toLowerCase();

            let availableGram =
              Number(stockRaw || 0);

            if (
              item.production_type === 'PREMIX' &&
              unit === 'mililiter' &&
              density > 0
            ) {
              availableGram =
                Number(stockRaw || 0) *
                density;
            }

            const requiredGram =
              Number(m.required_gram || 0);

            return {
              row: m,
              material:
                mat,
              availableGram,
              requiredGram,
              sufficient:
                availableGram >= requiredGram
            };
          })
        );

      const insufficient =
        checks.filter(
          row => !row.sufficient
        );

      for (const check of checks) {
        await base44.entities.ProductionMaterial.update(
          check.row.id,
          {
            stock_available:
              check.availableGram,
            stock_sufficient:
              check.sufficient
          }
        );
      }

      if (insufficient.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Bahan masih belum cukup',
          description:
            insufficient
              .map(
                row =>
                  `${row.row.material_name}: butuh ${row.requiredGram.toFixed(1)}g, tersedia ${row.availableGram.toFixed(1)}g`
              )
              .join(', ')
        });
        return;
      }

      await base44.entities.ProductionOrder.update(
        item.id,
        {
          status: 'siap_produksi'
        }
      );

      await createAuditLog({
        module: 'Produksi',
        action: 'Bahan Tersedia',
        entity_type: 'ProductionOrder',
        entity_id: item.id,
        reference_number:
          item.production_number,
        data_before: {
          status: 'menunggu_bahan'
        },
        data_after: {
          status: 'siap_produksi'
        }
      });

      toast({
        title: 'Bahan sudah tersedia',
        description:
          `${item.production_number} sekarang siap diproduksi`
      });

      await loadData();

    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Gagal mengecek stok bahan',
        description:
          e?.message || 'Terjadi kesalahan'
      });
    } finally {
      setSubmitting(false);
    }
  };

  /* ==========================================================
     POST PRODUCTION
  ========================================================== */
  const handlePost = async () => {
    if (!editing) return;

    if (
      ![
        'siap_produksi',
        'sedang_diproses'
      ].includes(editing.status)
    ) {
      toast({
        variant: 'destructive',
        title: 'Produksi sudah diposting',
        description: 'Transaksi tidak dapat diposting dua kali.'
      });
      return;
    }

    if (gramasiTidakSinkron) {
      toast({
        variant: 'destructive',
        title: 'Data gramasi tidak sinkron',
        description:
          'Data gramasi produksi tidak sinkron dengan hasil kalkulasi resep. Produksi belum dapat dilanjutkan.'
      });
      return;
    }

    const mats =
      await base44.entities.ProductionMaterial.filter({
        production_id: editing.id
      });

    const missing =
      mats.filter(
        m =>
          !checked[
            m.material_id
          ]
      );

    if (
      missing.length > 0
    ) {
      toast({
        variant: 'destructive',
        title: 'Penimbangan belum lengkap',
        description:
          `${missing.length} bahan belum dicentang`
      });
      return;
    }

    const isPremixProduction =
      editing.production_type === 'PREMIX';

    if (
      (isPremixProduction && !editing.output_material_id) ||
      (!isPremixProduction && !editing.product_id)
    ) {
      toast({
        variant: 'destructive',
        title: 'Produk output belum ditentukan',
        description: isPremixProduction
          ? 'Pilih bahan hasil premix sebelum posting. Stok bahan belum dikurangi.'
          : 'Pilih produk hasil produksi sebelum posting. Stok bahan belum dikurangi.'
      });
      return;
    }

    setSubmitting(true);

    try {
      const consumeType =
        isPremixProduction
          ? 'premix_consumption'
          : 'production_consumption';

      for (const m of mats) {
        const actual =
          Number(m.required_gram) || 0;

        const dev =
          actual -
          Number(m.required_gram || 0);

        const devPct =
          Number(m.required_gram || 0) > 0
            ? (
                dev /
                Number(m.required_gram)
              ) * 100
            : 0;

        await base44.entities.ProductionMaterial.update(
          m.id,
          {
            actual_gram: actual,
            deviation_gram: dev,
            deviation_percent: devPct
          }
        );

        const mat =
          materials.find(
            x => x.id === m.material_id
          );

        await consumeMaterialStock({
          productionMaterial: m,
          material: mat,
          quantity: actual,
          transactionType: consumeType,
          production: editing
        });
      }

      const totalActualGram =
        mats.reduce(
          (sum, m) =>
            sum +
            Number(m.required_gram || 0),
          0
        );

      if (isPremixProduction) {
        const outputMat =
          materials.find(
            m =>
              m.id ===
              editing.output_material_id
          );

        const outputQty =
          Number(editing.target_quantity) ||
          totalActualGram;

        const outputUnit =
          editing.target_unit ||
          'gram';

        const totalInputCost =
          mats.reduce(
            (sum, m) => {
              const mat =
                materials.find(
                  x =>
                    x.id ===
                    m.material_id
                );

              return (
                sum +
                (
                  Number(m.required_gram || 0) *
                  Number(mat?.last_purchase_price || 0)
                )
              );
            },
            0
          );

        const hppPerUnit =
          outputQty > 0
            ? totalInputCost /
              outputQty
            : 0;

        await recordStockMovement({
          item_type: 'material',
          item_id:
            editing.output_material_id,
          item_name:
            outputMat?.name ||
            editing.output_material_name ||
            '',
          item_code:
            outputMat?.code || '',
          batch_id: editing.id,
          batch_number:
            editing.batch_number,
          inventory_status: 'PREMIX',
          quantity_in: outputQty,
          unit: outputUnit,
          unit_cost:
            Number(hppPerUnit || 0),
          transaction_type:
            'premix_output',
          transaction_number:
            editing.production_number,
          reference_type: 'production',
          reference_id: editing.id,
          notes:
            `Hasil premix ${editing.batch_number}`
        });

        if (outputMat) {
          await base44.entities.Material.update(
            outputMat.id,
            {
              last_purchase_price:
                Number(
                  hppPerUnit.toFixed(4)
                )
            }
          );
        }

        await base44.entities.ProductionOrder.update(
          editing.id,
          {
            status: 'selesai_mixing',
            actual_output_quantity:
              outputQty,
            waste_quantity:
              Math.max(
                0,
                totalActualGram -
                outputQty
              )
          }
        );

        await createAuditLog({
          module: 'Produksi',
          action: 'Posting Premix',
          entity_type: 'ProductionOrder',
          entity_id: editing.id,
          reference_number:
            editing.production_number
        });

        toast({
          title: 'Produksi Premix berhasil diposting',
          description: 'Stok bahan dikurangi, stok premix ditambahkan'
        });

      } else {
        let actualVolume = 0;

        for (const m of mats) {
          const mat =
            materials.find(
              x => x.id === m.material_id
            );

          const d =
            isOneToOnePremix(mat)
              ? 1
              : (
                  Number(mat?.density) ||
                  (
                    m.material_type === 'vegetable_glycerin'
                      ? 1.261
                      : 1.036
                  )
                );

          if (d > 0) {
            actualVolume +=
              Number(m.required_gram || 0) /
              d;
          }
        }

        const totalInputCost =
          mats.reduce(
            (s, m) =>
              s +
              Number(m.required_gram || 0) *
              Number(
                materials.find(
                  x => x.id === m.material_id
                )?.last_purchase_price || 0
              ),
            0
          );

        const actualOutputMl =
          Number(actualVolume) || 0;

        const hppBulkPerMl =
          actualOutputMl > 0
            ? totalInputCost /
              actualOutputMl
            : 0;

        await recordStockMovement({
          item_type: 'product',
          item_id:
            editing.product_id ||
            editing.recipe_id,
          item_name:
            `Bulk ${editing.product_name || editing.recipe_code}`,
          item_code:
            editing.batch_number,
          batch_id: editing.id,
          batch_number:
            editing.batch_number,
          inventory_status: 'BULK',
          quantity_in:
            Number(actualVolume),
          unit: 'ml',
          unit_cost:
            Number(hppBulkPerMl || 0),
          transaction_type:
            'production_output',
          transaction_number:
            editing.production_number,
          reference_type: 'production',
          reference_id: editing.id,
          notes:
            `Hasil mixing ${editing.batch_number}`
        });

        await base44.entities.ProductionOrder.update(
          editing.id,
          {
            status: 'siap_bottling',
            actual_volume:
              Number(actualVolume)
          }
        );

        await createAuditLog({
          module: 'Produksi',
          action: 'Posting',
          entity_type: 'ProductionOrder',
          entity_id: editing.id,
          reference_number:
            editing.production_number
        });

        toast({
          title: 'Produksi berhasil diposting',
          description: 'Stok bahan dikurangi, bulk masuk'
        });
      }

      setDetailOpen(false);
      loadData();

    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Gagal posting',
        description: e.message
      });
    } finally {
      setSubmitting(false);
    }
  };

  /* ==========================================================
     PREMIX POST PREVIEW
  ========================================================== */
  const handlePostRequest = () => {
    if (
      !editing ||
      editing.production_type !== 'PREMIX'
    ) {
      return handlePost();
    }

    const rows =
      productionMaterials.map(m => {
        const mat =
          materials.find(
            x => x.id === m.material_id
          );

        const req =
          Number(m.required_gram || 0);

        const price =
          Number(
            mat?.last_purchase_price || 0
          );

        const unit =
          (mat?.unit || '').toLowerCase();

        const errors = [];

        if (
          unit &&
          unit !== 'gram' &&
          unit !== 'mililiter'
        ) {
          errors.push(
            `unit "${mat.unit}" bukan base unit (gram/mililiter) — kemungkinan harga masih per satuan beli`
          );
        }

        if (!(price > 0)) {
          errors.push(
            'harga per base unit belum diisi (0/null)'
          );
        }

        if (!(req > 0)) {
          errors.push(
            'required_gram <= 0'
          );
        }

        return {
          name: m.material_name,
          unit:
            mat?.unit || '-',
          required_gram: req,
          price_per_gram: price,
          cost: req * price,
          valid:
            errors.length === 0,
          errors
        };
      });

    const outputQty =
      Number(editing.actual_output_quantity) ||
      Number(editing.target_quantity) ||
      0;

    const allValid =
      rows.length > 0 &&
      rows.every(r => r.valid) &&
      outputQty > 0;

    const total =
      rows.reduce(
        (sum, row) =>
          sum +
          (
            row.valid
              ? row.cost
              : 0
          ),
        0
      );

    const hpp =
      allValid &&
      outputQty > 0
        ? total /
          outputQty
        : 0;

    setPremixPreview({
      rows,
      outputQty,
      total,
      hpp,
      valid: allValid
    });

    setPremixConfirmOpen(true);
  };

  /* ==========================================================
     VOID PRODUCTION / STOCK REVERSAL
     - Hanya untuk produksi yang sudah diposting.
     - Output harus masih utuh / belum dipakai downstream.
     - Output ditarik kembali.
     - Semua konsumsi bahan dikembalikan ke identity ledger asli.
     - Frozen unit_cost dari StockLedger asli dipakai untuk reversal.
     - Double VOID diblok dengan status dibatalkan.
  ========================================================== */
  const handleVoidProduction = async (item) => {
    if (
      ![
        'siap_bottling',
        'selesai_mixing'
      ].includes(item.status)
    ) {
      toast({
        variant: 'destructive',
        title: 'VOID tidak tersedia',
        description: 'Hanya produksi yang sudah diposting dan belum di-VOID yang dapat dibalik.'
      });
      return;
    }

    if (
      !confirm(
        `VOID produksi "${item.production_number}"?\n\n` +
        'Output produksi akan ditarik kembali dan seluruh bahan akan dikembalikan. ' +
        'VOID diblok jika output sudah digunakan proses berikutnya.'
      )
    ) {
      return;
    }

    setSubmitting(true);

    try {
      const referenceLedgers =
        await base44.entities.StockLedger.filter({
          reference_type: 'production',
          reference_id: item.id
        });

      const [numberLedgers, batchLedgers] = await Promise.all([
        item.production_number
          ? base44.entities.StockLedger.filter({ transaction_number: item.production_number })
          : Promise.resolve([]),
        item.batch_number
          ? base44.entities.StockLedger.filter({ batch_number: item.batch_number })
          : Promise.resolve([])
      ]);

      const ledgers = Array.from(new Map(
        [...referenceLedgers, ...numberLedgers, ...batchLedgers]
          .map(row => [row.id, row])
      ).values());

      const reversalExists =
        ledgers.some(
          row =>
            row.transaction_type === 'production_reversal'
        );

      if (reversalExists) {
        throw new Error(
          'Produksi ini sudah memiliki transaksi reversal / VOID.'
        );
      }

      const consumptionTypes = [
        'production_consumption',
        'premix_consumption'
      ];

      const outputTypes = [
        'production_output',
        'premix_output'
      ];

      const consumptionRows =
        ledgers.filter(
          row =>
            consumptionTypes.includes(
              row.transaction_type
            ) &&
            Number(row.quantity_out || 0) > 0
        );

      const outputRows =
        ledgers.filter(
          row =>
            outputTypes.includes(
              row.transaction_type
            ) &&
            Number(row.quantity_in || 0) > 0
        );

      /*
       * DOWNSTREAM GUARD
       *
       * Sebelum reversal, output produksi harus masih tersedia
       * pada StockBalance yang sama. Jika jumlahnya sudah berkurang,
       * berarti output telah dipakai / dipindah / dikoreksi.
       */
      for (const output of outputRows) {
        const balanceFilter = {
          item_id: output.item_id
        };

        if (output.batch_id) {
          balanceFilter.batch_id =
            output.batch_id;
        }

        if (output.warehouse_id) {
          balanceFilter.warehouse_id =
            output.warehouse_id;
        }

        if (output.inventory_status) {
          balanceFilter.inventory_status =
            output.inventory_status;
        }

        const outputBalances =
          await base44.entities.StockBalance.filter(
            balanceFilter
          );

        const matchingBalance =
          outputBalances.find(
            balance =>
              (balance.item_id || '') ===
                (output.item_id || '') &&
              (balance.batch_id || '') ===
                (output.batch_id || '') &&
              (balance.warehouse_id || '') ===
                (output.warehouse_id || '') &&
              (balance.inventory_status || '') ===
                (output.inventory_status || '')
          ) ||
          outputBalances[0] ||
          null;

        const available =
          Number(
            matchingBalance?.available_quantity ??
            matchingBalance?.quantity ??
            0
          );

        const required =
          Number(output.quantity_in || 0);

        if (
          !matchingBalance ||
          available < required
        ) {
          throw new Error(
            `VOID diblok. Output ${output.item_name || item.batch_number} ` +
            `sudah digunakan proses berikutnya atau stoknya berubah. ` +
            `Tersedia ${available}, dibutuhkan ${required}.`
          );
        }
      }

      const voidNumber =
        `VOID-${item.production_number}`;

      /*
       * 1. Tarik output produksi.
       */
      for (const output of outputRows) {
        await recordStockMovement({
          item_type:
            output.item_type,
          item_id:
            output.item_id,
          item_code:
            output.item_code || '',
          item_name:
            output.item_name || '',
          batch_id:
            output.batch_id || '',
          batch_number:
            output.batch_number || '',
          warehouse_id:
            output.warehouse_id || '',
          warehouse_name:
            output.warehouse_name || '',
          inventory_status:
            output.inventory_status || '',
          quantity_in: 0,
          quantity_out:
            Number(output.quantity_in || 0),
          unit:
            output.unit || '',
          unit_cost:
            Number(output.unit_cost || 0),
          transaction_type:
            'production_reversal',
          transaction_number:
            voidNumber,
          reference_type:
            'production',
          reference_id:
            item.id,
          notes:
            `VOID Production · tarik output ${item.production_number}`
        });
      }

      /*
       * 2. Kembalikan seluruh bahan ke batch/stage/gudang
       *    yang sama dengan transaksi konsumsi asli.
       */
      for (const row of consumptionRows) {
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
            Number(row.quantity_out || 0),
          quantity_out: 0,
          unit:
            row.unit || '',
          unit_cost:
            Number(row.unit_cost || 0),
          transaction_type:
            'production_reversal',
          transaction_number:
            voidNumber,
          reference_type:
            'production',
          reference_id:
            item.id,
          notes:
            `VOID Production · kembalikan bahan ${item.production_number}`
        });
      }

      await base44.entities.ProductionOrder.update(
        item.id,
        {
          status: 'dibatalkan'
        }
      );

      await createAuditLog({
        module: 'Produksi',
        action: 'VOID',
        entity_type: 'ProductionOrder',
        entity_id: item.id,
        reference_number:
          item.production_number,
        reason:
          'VOID Production / stock reversal',
        data_before: {
          status: item.status
        },
        data_after: {
          status: 'dibatalkan',
          reversal_number:
            voidNumber,
          output_reversal_count:
            outputRows.length,
          material_reversal_count:
            consumptionRows.length
        }
      });

      toast({
        title: 'VOID Production berhasil',
        description: outputRows.length > 0
          ? `${item.production_number} · output ditarik dan stok bahan dikembalikan`
          : consumptionRows.length > 0
            ? `${item.production_number} · stok bahan dari produksi parsial dikembalikan`
            : `${item.production_number} · dibatalkan tanpa reversal karena tidak pernah mencatat transaksi stok`
      });

      await loadData();

    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'VOID Production gagal',
        description:
          e?.message || 'Terjadi kesalahan'
      });
    } finally {
      setSubmitting(false);
    }
  };

  /* ==========================================================
     CANCEL
  ========================================================== */
  const handleCancel = async (item) => {
    if (
      !confirm(
        `Batalkan produksi "${item.production_number}"?`
      )
    ) {
      return;
    }

    try {
      await base44.entities.ProductionOrder.update(
        item.id,
        {
          status: 'dibatalkan'
        }
      );

      await createAuditLog({
        module: 'Produksi',
        action: 'Batal',
        entity_type: 'ProductionOrder',
        entity_id: item.id,
        reference_number:
          item.production_number
      });

      toast({
        title: 'Produksi dibatalkan'
      });

      loadData();

    } catch {
      toast({
        variant: 'destructive',
        title: 'Gagal'
      });
    }
  };

  /* ==========================================================
     PDF
  ========================================================== */
  const exportProductionPDF = async (row) => {
    if (!hasPermission(user, 'production', 'download')) {
      toast({
        variant: 'destructive',
        title: 'Akses ditolak',
        description: 'Anda tidak memiliki izin download laporan produksi.'
      });
      return;
    }

    try {
      const mats =
        await base44.entities.ProductionMaterial.filter({
          production_id: row.id
        });

      exportDocumentToPDF({
        title:
          row.production_type === 'PREMIX'
            ? 'Work Order Premix'
            : 'Work Order Produksi',
        docNumber:
          row.production_number,
        docDate:
          row.production_date,
        partyLabel:
          'No. Batch',
        party: {
          name:
            row.batch_number
        },
        infoLines: [
          {
            label: 'Produk',
            value:
              row.product_name ||
              row.output_material_name ||
              '-'
          },
          {
            label: 'Merk',
            value:
              row.brand_name ||
              '-'
          },
          {
            label: 'Target',
            value:
              row.production_type === 'PREMIX'
                ? `${row.target_quantity || 0} ${row.target_unit || 'gram'}`
                : `${row.target_volume || 0} ml`
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
          }
        ],
        itemColumns: [
          {
            key: 'no',
            header: '#',
            width: 24,
            align: 'right'
          },
          {
            key: 'material_name',
            header: 'Bahan'
          },
          {
            key: 'required_gram',
            header: 'Standar (g)',
            width: 85,
            align: 'right'
          },
          {
            key: 'actual_gram',
            header: 'Aktual (g)',
            width: 85,
            align: 'right'
          },
          {
            key: 'deviation_gram',
            header: 'Selisih',
            width: 75,
            align: 'right'
          }
        ],
        itemRows:
          mats.map(
            (m, i) => ({
              no:
                i + 1,
              material_name:
                m.material_name,
              required_gram:
                Number(m.required_gram || 0).toFixed(2),
              actual_gram:
                Number(m.actual_gram || 0).toFixed(2),
              deviation_gram:
                Number(m.deviation_gram || 0).toFixed(2)
            })
          ),
        totals: [
          {
            label: 'Total Standar (g)',
            value:
              mats.reduce(
                (sum, m) =>
                  sum +
                  Number(m.required_gram || 0),
                0
              ).toFixed(2)
          },
          {
            label: 'Total Aktual (g)',
            value:
              mats.reduce(
                (sum, m) =>
                  sum +
                  Number(m.actual_gram || 0),
                0
              ).toFixed(2),
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
          },
          {
            label: 'Disetujui,',
            name:
              row.approver || ''
          }
        ],
        fileName:
          `wo-${row.production_number}.pdf`
      });

    } catch {
      toast({
        variant: 'destructive',
        title: 'Gagal membuat PDF'
      });
    }
  };

  /* ==========================================================
     TABLE COLUMNS
  ========================================================== */
  const columns = [
    {
      key: 'production_number',
      header: 'No. Produksi',
      sortable: true,
      className: 'font-mono font-medium'
    },
    {
      key: 'batch_number',
      header: 'No. Batch',
      className: 'font-mono'
    },
    {
      key: 'product_name',
      header: 'Produk',
      render:
        row =>
          row.product_name ||
          row.output_material_name ||
          (row.production_type === 'PREMIX' || row.recipe_type === 'PREMIX' ? 'Premix' : '') ||
          '—'
    },
    {
      key: 'brand_name',
      header: 'Merk',
      render:
        row =>
          row.brand_name ||
          '—'
    },
    {
      key: 'target',
      header: 'Target',
      render:
        row =>
          row.production_type === 'PREMIX'
            ? `${row.target_quantity || 0} ${row.target_unit || 'gram'}`
            : `${row.target_volume || 0} ml`
    },
    {
      key: 'operator',
      header: 'Operator',
      render:
        row =>
          row.operator ||
          '—'
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
      width: '120px',
      render:
        row => (
          <div className="flex items-center gap-1">
            <PdfButton
              onExport={() =>
                exportProductionPDF(row)
              }
              perm="production"
              action="download"
              iconOnly
              label="Cetak Work Order"
            />

            {row.status ===
              'menunggu_bahan' && (
              <button
                type="button"
                onClick={() =>
                  handleActivateWaiting(row)
                }
                disabled={submitting}
                className="p-1.5 hover:bg-blue-50 rounded text-blue-600 disabled:opacity-40"
                title="Refresh stok bahan"
                aria-label="Refresh stok bahan"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    submitting ? 'animate-spin' : ''
                  }`}
                />
              </button>
            )}

            {row.status ===
              'siap_produksi' && (
              <button
                onClick={() =>
                  openDetail(row)
                }
                className="p-1.5 hover:bg-blue-50 rounded text-blue-600"
                title="Proses"
              >
                <Play className="w-3.5 h-3.5" />
              </button>
            )}

            {row.status ===
              'sedang_diproses' && (
              <button
                onClick={() =>
                  openDetail(row)
                }
                className="p-1.5 hover:bg-blue-50 rounded text-blue-600"
                title="Selesaikan"
              >
                <CheckCircle className="w-3.5 h-3.5" />
              </button>
            )}

            {row.status ===
              'siap_bottling' && (
              <span
                className="p-1.5 text-violet-500"
                title="Siap bottling"
              >
                <CheckCircle className="w-3.5 h-3.5" />
              </span>
            )}

            {[
              'siap_bottling',
              'selesai_mixing'
            ].includes(row.status) && (
              <button
                type="button"
                onClick={() =>
                  handleVoidProduction(row)
                }
                disabled={submitting}
                className="p-1.5 hover:bg-amber-50 rounded text-amber-600 disabled:opacity-40"
                title="VOID Production · reversal stok"
                aria-label="VOID Production"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}

            {![
              'dibatalkan',
              'siap_bottling',
              'selesai_mixing'
            ].includes(row.status) && (
              <button
                onClick={() =>
                  handleCancel(row)
                }
                className="p-1.5 hover:bg-red-50 rounded text-red-500"
                title="Batalkan"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )
    }
  ];

  /* ==========================================================
     VIEW DATA
  ========================================================== */
  const selectedRecipe =
    recipes.find(
      r => r.id === form.recipe_id
    );

  const isPremix =
    selectedRecipe?.recipe_type === 'PREMIX';

  const visibleRecipes =
    recipes.filter(
      r =>
        canSelectRecipeForProduction(
          user,
          r
        )
    );

  const formulaHidden =
    isRecipeFormulaHidden(
      user,
      selectedRecipe
    );

  const basis =
    selectedRecipe?.calculation_basis ||
    'W_W';

  const targetUnit =
    isPremix
      ? (
          basis === 'W_W'
            ? 'Gram'
            : 'ml'
        )
      : 'ml';

  const targetLabel =
    isPremix
      ? `Target Produksi (${targetUnit}) *`
      : 'Target Volume (ml) *';

  const totalFormulaPct =
    stockCheck.reduce(
      (sum, item) =>
        sum +
        Number(item.percentage || 0),
      0
    );

  const totalRequirement =
    stockCheck.reduce(
      (sum, item) =>
        sum +
        Number(item.gram || 0),
      0
    );

  const hasInsufficientStock =
    stockCheck.some(
      item => !item.stockSufficient
    );

  /* ==========================================================
     RENDER
  ========================================================== */
  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader
        title="Produksi"
        description="Buat batch produksi dari resep approved"
        actions={
          <Button
            onClick={openAdd}
            size="sm"
            className="gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Produksi Baru
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        emptyMessage="Belum ada produksi"
        searchKeys={[
          'production_number',
          'batch_number',
          'product_name',
          'output_material_name',
          'brand_name'
        ]}
        searchPlaceholder="Cari produksi..."
      />

      <FormModal
        open={modalOpen}
        onClose={() =>
          setModalOpen(false)
        }
        title="Produksi Baru"
        onSubmit={handleSubmit}
        submitting={submitting}
        submitLabel={
          hasInsufficientStock
            ? 'Simpan Menunggu Bahan'
            : 'Buat Produksi'
        }
        size="lg"
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-[12.5px] mb-1">
              Resep (Approved) *
            </Label>

            <SearchableSelect
              value={form.recipe_id}
              onValueChange={v =>
                setForm({
                  ...form,
                  recipe_id: v
                })
              }
              options={visibleRecipes.map(r => ({
                value: r.id,
                label: `${r.code || ''} · ${r.name || ''} (v${r.version || 1})`,
                keywords: `${r.code || ''} ${r.name || ''} ${r.brand_name || ''} ${r.product_name || ''}`,
              }))}
              placeholder="Cari kode / nama resep..."
              className="h-9"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              {targetLabel}
            </Label>

            <NumberInput
              value={
                form.target_volume
              }
              onChange={v =>
                setForm({
                  ...form,
                  target_volume: v
                })
              }
              allowDecimal
              min={0}
              maxDecimals={2}
              className="h-9 text-[13px]"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Tanggal Produksi
            </Label>

            <Input
              type="date"
              value={
                form.production_date
              }
              onChange={e =>
                setForm({
                  ...form,
                  production_date:
                    e.target.value
                })
              }
              className="h-9 text-[13px]"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Operator *
            </Label>

            <Input
              value={
                form.operator
              }
              onChange={e =>
                setForm({
                  ...form,
                  operator:
                    e.target.value
                })
              }
              className="h-9 text-[13px]"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Catatan
            </Label>

            <Input
              value={
                form.notes
              }
              onChange={e =>
                setForm({
                  ...form,
                  notes:
                    e.target.value
                })
              }
              className="h-9 text-[13px]"
            />
          </div>
        </div>

        {selectedRecipe &&
          stockCheck.length > 0 && (
          <div className="border-t pt-3 mt-2">

            <Label className="text-[12.5px] font-semibold mb-2 block">
              Ringkasan Produksi
            </Label>

            <div className="grid grid-cols-3 gap-2 text-[11.5px]">

              <div className="bg-muted/40 rounded px-2 py-1.5">
                Recipe Type:
                <b>
                  {' '}
                  {isPremix
                    ? 'PREMIX'
                    : 'FINISHED_PRODUCT'}
                </b>
              </div>

              <div className="bg-muted/40 rounded px-2 py-1.5">
                Calculation Basis:
                <b>
                  {' '}
                  {isPremix
                    ? basis
                    : '—'}
                </b>
              </div>

              <div className="bg-muted/40 rounded px-2 py-1.5">
                Target Produksi:
                <b>
                  {' '}
                  {formatNumber(
                    form.target_volume
                  )}{' '}
                  {targetUnit}
                </b>
              </div>

              <div className="bg-muted/40 rounded px-2 py-1.5">
                Satuan:
                <b>
                  {' '}
                  {isPremix
                    ? (
                        basis === 'W_W'
                          ? 'Gram'
                          : 'ml'
                      )
                    : 'ml'}
                </b>
              </div>

              {!formulaHidden && (
                <div className="bg-muted/40 rounded px-2 py-1.5">
                  Total Formula:
                  <b>
                    {' '}
                    {totalFormulaPct.toFixed(2)}%
                  </b>
                </div>
              )}

              <div className="bg-muted/40 rounded px-2 py-1.5">
                Total Kebutuhan:
                <b>
                  {' '}
                  {formatNumber(
                    totalRequirement,
                    2
                  )}{' '}
                  gram
                </b>
              </div>
            </div>
          </div>
        )}

        {stockCheck.length > 0 && (
          <div className="border-t pt-3 mt-2">

            <Label className="text-[12.5px] font-semibold mb-2 block">
              Pemeriksaan Stok Bahan
            </Label>

            {hasInsufficientStock && (
              <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-700">
                ⚠ Ada bahan yang belum cukup. Order tetap dapat disimpan sebagai
                <b> Menunggu Bahan</b>. Pada tahap ini stok belum dikurangi.
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="bg-muted/40 text-muted-foreground">
                    <th className="px-2 py-1 text-left">
                      Bahan
                    </th>

                    {!formulaHidden && (
                      <th className="px-2 py-1 text-right">
                        Persentase
                      </th>
                    )}

                    <th className="px-2 py-1 text-right">
                      Kebutuhan (ml)
                    </th>

                    <th className="px-2 py-1 text-right">
                      Kebutuhan (gram)
                    </th>

                    <th className="px-2 py-1 text-right">
                      Stok Tersedia
                      {isPremix
                        ? ' (gram)'
                        : ''}
                    </th>

                    <th className="px-2 py-1 text-center">
                      Status
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {stockCheck.map(
                    (item, i) => (
                      <tr
                        key={i}
                        className="border-b border-border/30"
                      >
                        <td className="px-2 py-1">
                          {item.material_name}
                        </td>

                        {!formulaHidden && (
                          <td className="px-2 py-1 text-right tabular-nums">
                            {Number(
                              item.percentage || 0
                            ).toFixed(2)}%
                          </td>
                        )}

                        <td className="px-2 py-1 text-right tabular-nums">
                          {Number(
                            item.volumeMl || 0
                          ).toFixed(2)}
                        </td>

                        <td className="px-2 py-1 text-right tabular-nums">
                          {Number(
                            item.gram || 0
                          ).toFixed(2)}
                        </td>

                        <td className="px-2 py-1 text-right tabular-nums">
                          {Number(
                            item.stockAvailable || 0
                          ).toFixed(2)}
                        </td>

                        <td className="px-2 py-1 text-center">
                          {item.stockSufficient
                            ? (
                              <span className="text-emerald-600 font-semibold">
                                ✓ Cukup
                              </span>
                            )
                            : (
                              <span className="text-red-600 font-semibold flex items-center justify-center gap-0.5">
                                <AlertTriangle className="w-3 h-3" />
                                Kurang
                              </span>
                            )
                          }
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </FormModal>

      <FormModal
        open={detailOpen}
        onClose={() =>
          setDetailOpen(false)
        }
        title={
          `Proses Penimbangan · ${editing?.production_number || ''}`
        }
        onSubmit={
          handlePostRequest
        }
        submitting={
          submitting
        }
        submitLabel="Posting Produksi"
        size="lg"
      >
        <div className="text-[12px] text-muted-foreground mb-3">
          Batch:
          <b>
            {' '}
            {editing?.batch_number}
          </b>
          {' '}· Target:
          <b>
            {' '}
            {editing?.production_type ===
            'PREMIX'
              ? `${editing?.target_quantity || 0} ${editing?.target_unit || 'gram'}`
              : `${editing?.target_volume || 0} ml`
            }
          </b>
        </div>

        <div className="text-[11.5px] text-muted-foreground mb-2">
          {
            productionMaterials.filter(
              m =>
                checked[
                  m.material_id
                ]
            ).length
          }
          /
          {productionMaterials.length}
          {' '}bahan sudah dimasukkan
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-muted/40 text-muted-foreground">
                <th className="px-2 py-1 text-center w-10">
                  ✓
                </th>
                <th className="px-2 py-1 text-left">
                  Nama Bahan
                </th>
                <th className="px-2 py-1 text-right">
                  Gramasi
                </th>
              </tr>
            </thead>

            <tbody>
              {productionMaterials.map(m => (
                <tr
                  key={m.id}
                  className={
                    `border-b border-border/30 ${
                      checked[m.material_id]
                        ? 'bg-emerald-50/60'
                        : ''
                    }`
                  }
                >
                  <td className="px-2 py-1.5 text-center">
                    <Checkbox
                      checked={
                        !!checked[
                          m.material_id
                        ]
                      }
                      onCheckedChange={v =>
                        setChecked(c => ({
                          ...c,
                          [m.material_id]:
                            v
                        }))
                      }
                    />
                  </td>

                  <td className="px-2 py-1.5">
                    {m.material_name}
                  </td>

                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                    {
                      (
                        gramasiMap[
                          m.material_id
                        ] ??
                        Number(
                          m.required_gram || 0
                        )
                      ).toFixed(2)
                    }
                    {' '}gram
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {gramasiTidakSinkron
          ? (
            <div className="bg-red-50 border border-red-300 rounded px-3 py-2 text-[11px] text-red-700 mt-2">
              ⚠ Data gramasi produksi tidak sinkron dengan hasil kalkulasi resep.
              Produksi belum dapat dilanjutkan.
              Batalkan produksi ini dan buat ulang.
            </div>
          )
          : (
            <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-[11px] text-amber-700 mt-2">
              ⚠ Posting akan mengurangi stok bahan dan{' '}
              {
                editing?.production_type ===
                'PREMIX'
                  ? 'menambah stok premix'
                  : 'membuat output bulk'
              }.
              {' '}Proses tidak dapat diulang.
            </div>
          )
        }
      </FormModal>

      <AlertDialog
        open={
          premixConfirmOpen
        }
        onOpenChange={
          setPremixConfirmOpen
        }
      >
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Konfirmasi HPP Premix
            </AlertDialogTitle>

            <AlertDialogDescription>
              Verifikasi harga ingredient sudah dalam satuan gram
              (base unit) sebelum posting.
              Batch:
              <b>
                {' '}
                {editing?.batch_number}
              </b>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="overflow-x-auto max-h-[45vh]">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-muted/40 text-muted-foreground">
                  <th className="px-2 py-1 text-left">
                    Bahan
                  </th>
                  <th className="px-2 py-1 text-left">
                    Unit
                  </th>
                  <th className="px-2 py-1 text-right">
                    Gram
                  </th>
                  <th className="px-2 py-1 text-right">
                    Harga/gram
                  </th>
                  <th className="px-2 py-1 text-right">
                    Total Cost
                  </th>
                </tr>
              </thead>

              <tbody>
                {(premixPreview?.rows || [])
                  .map((r, i) => (
                    <tr
                      key={i}
                      className="border-b border-border/30"
                    >
                      <td className="px-2 py-1">
                        {r.name}
                      </td>

                      <td className="px-2 py-1">
                        {r.unit}
                      </td>

                      <td className="px-2 py-1 text-right tabular-nums">
                        {formatNumber(
                          r.required_gram,
                          2
                        )}
                      </td>

                      <td className="px-2 py-1 text-right tabular-nums">
                        {formatCurrency(
                          r.price_per_gram
                        )}
                      </td>

                      <td className="px-2 py-1 text-right tabular-nums">
                        {formatCurrency(
                          r.cost
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>

              <tfoot>
                <tr className="bg-muted/30 font-semibold">
                  <td
                    className="px-2 py-1"
                    colSpan={4}
                  >
                    Total Input Cost
                  </td>

                  <td className="px-2 py-1 text-right tabular-nums">
                    {formatCurrency(
                      premixPreview?.total || 0
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <div className="bg-muted/40 rounded px-2 py-1.5">
              Output:
              <b>
                {' '}
                {formatNumber(
                  premixPreview?.outputQty || 0
                )}{' '}
                gram
              </b>
            </div>

            <div className="bg-primary/10 rounded px-2 py-1.5">
              HPP/gram:
              <b>
                {' '}
                {formatCurrency(
                  premixPreview?.hpp || 0
                )}
              </b>
            </div>
          </div>

          {premixPreview &&
          !premixPreview.valid
            ? (
              <div className="bg-red-50 border border-red-300 rounded px-3 py-2 text-[11px] text-red-700">
                ⚠ Validasi gagal — posting diblokir:
                <ul className="list-disc ml-4 mt-1">
                  {
                    premixPreview.rows
                      .filter(
                        r =>
                          !r.valid
                      )
                      .flatMap(
                        r =>
                          r.errors.map(
                            (e, i) => (
                              <li
                                key={
                                  r.name + i
                                }
                              >
                                {r.name}: {e}
                              </li>
                            )
                          )
                      )
                  }
                </ul>
              </div>
            )
            : (
              <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-[11px] text-amber-700">
                ⚠ Pastikan "Harga/gram" bukan harga per KG.
                Jika nilainya terlihat 1000× dari biasanya,
                periksa Master Bahan sebelum posting.
              </div>
            )
          }

          <AlertDialogFooter>
            <AlertDialogCancel>
              Batal
            </AlertDialogCancel>

            <AlertDialogAction
              disabled={
                !premixPreview?.valid ||
                submitting
              }
              className={
                !premixPreview?.valid
                  ? 'opacity-50 pointer-events-none'
                  : ''
              }
              onClick={() =>
                handlePost()
              }
            >
              Konfirmasi & Posting
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
