/**
 * HPP Product Calculator
 *
 * SOURCE OF TRUTH:
 * 1. Actual StockLedger untuk stage yang SUDAH diproses.
 * 2. Recipe + ProductComponentMapping sebagai standard/fallback.
 *
 * Prinsip breakdown:
 * Bulk tetap Bulk.
 * Botol tetap Botol.
 * Label tetap Label.
 * Box tetap Box.
 * Cukai tetap Cukai.
 *
 * Nilai cumulative output TIDAK pernah dimasukkan kembali
 * sebagai nilai salah satu komponen.
 */

import { calculateRecipe } from './recipeCalculator';

function ingredientCost(item, material) {
  const price = Number(material?.last_purchase_price) || 0;
  const isMl = material?.unit === 'mililiter';

  const qty = isMl
    ? Number(item.volumeMl) || 0
    : Number(item.gram) || 0;

  return {
    qty,
    unitLabel: isMl ? 'ml' : 'g',
    unitCost: price,
    cost: qty * price,
  };
}

const STAGE_PRIORITY = {
  excise_output: 4,
  labeling_output: 3,
  bottling_output: 2,
  production_output: 1,
  premix_output: 1,
};

function ledgerTime(row) {
  return new Date(
    row?.transaction_date ||
    row?.created_date ||
    0
  ).getTime();
}

function rowTotalCost(row) {
  return (
    (Number(row?.unit_cost) || 0) *
    (Number(row?.quantity_out) || 0)
  );
}

function latestOutput(rows, type, maxTime = Infinity) {
  return (rows || [])
    .filter(
      row =>
        row.transaction_type === type &&
        Number(row.quantity_in) > 0 &&
        ledgerTime(row) <= maxTime
    )
    .sort(
      (a, b) =>
        ledgerTime(b) - ledgerTime(a)
    )[0] || null;
}

function refsFor(stockLedger, output) {
  if (!output?.reference_id) return [];

  return (stockLedger || []).filter(
    row =>
      row.reference_id ===
      output.reference_id
  );
}

function actualRows(rows, outputQty) {
  return (rows || []).map(row => {
    const qtyOut =
      Number(row.quantity_out) || 0;

    const total =
      rowTotalCost(row);

    const perBottle =
      outputQty > 0
        ? total / outputQty
        : 0;

    return {
      materialId: row.item_id,
      materialName:
        row.item_name || 'Aktual',
      materialCode:
        row.item_code || '',
      qty:
        outputQty > 0
          ? qtyOut / outputQty
          : 0,
      unitLabel:
        row.unit || 'pcs',
      unitCost:
        Number(row.unit_cost) || 0,
      cost: perBottle,
    };
  });
}

/**
 * ACTUAL HPP BREAKDOWN
 *
 * Mencari output TERBARU dari product.
 * Setelah batch terbaru diketahui, komponen HPP
 * direkonstruksi dari setiap stage dalam batch tersebut.
 *
 * Contoh:
 *
 * production      Bulk 2054
 * bottling        + Bottle 1500
 * labeling        + Label 650
 * excise          + Excise + Box
 *
 * Tidak pernah:
 * labeling previous HPP 3554 → dianggap Bulk 3554.
 */
export function getActualHppFromLedger(
  stockLedger,
  productId,
  mappings = [],
  bottleSize = 0
) {
  if (
    !Array.isArray(stockLedger) ||
    !productId
  ) {
    return null;
  }

  /*
   * Cari actual output terbaru product.
   *
   * Timestamp menang.
   * Stage priority hanya tie breaker.
   */
  const productOutputs = stockLedger
    .filter(
      row =>
        row?.item_id === productId &&
        String(
          row?.transaction_type || ''
        ).endsWith('_output') &&
        Number(row?.quantity_in) > 0 &&
        Number(row?.unit_cost) > 0
    )
    .sort((a, b) => {
      const timeDiff =
        ledgerTime(b) -
        ledgerTime(a);

      if (timeDiff) {
        return timeDiff;
      }

      return (
        (STAGE_PRIORITY[
          b.transaction_type
        ] || 0) -
        (STAGE_PRIORITY[
          a.transaction_type
        ] || 0)
      );
    });

  if (!productOutputs.length) {
    return null;
  }

  const latest =
    productOutputs[0];

  const latestTime =
    ledgerTime(latest);

  const batchNumber =
    latest.batch_number || '';

  /*
   * Setelah batch terbaru diketahui,
   * cari SEMUA stage dalam batch tersebut.
   *
   * Ini penting untuk maklon:
   *
   * Bottling masih item IZZI
   * Labeling output sudah item YMMY
   *
   * tetapi batch tetap sama.
   */
  const batchEntries =
    batchNumber
      ? stockLedger.filter(
          row =>
            row.batch_number ===
            batchNumber
        )
      : stockLedger.filter(
          row =>
            row.reference_id ===
            latest.reference_id
        );

  const stage =
    STAGE_PRIORITY[
      latest.transaction_type
    ] || 0;

  /*
   * ==========================================
   * PRODUCTION / BULK
   * ==========================================
   */

  const productionOutput =
    latestOutput(
      batchEntries,
      'production_output',
      latestTime
    );

  let bulkPerBottle = 0;

  /*
   * Jika Bottling sudah ada,
   * Bulk paling akurat dihitung dari
   * bottling_consumption transaksi Bottling.
   */
  const bottlingOutput =
    stage >= 2
      ? latestOutput(
          batchEntries,
          'bottling_output',
          latestTime
        )
      : null;

  let bottlePerBottle = 0;
  let bottleRows = [];

  if (bottlingOutput) {
    const refs =
      refsFor(
        stockLedger,
        bottlingOutput
      );

    const outputQty =
      Number(
        bottlingOutput.quantity_in
      ) || 1;

    const bulkConsumption =
      refs.filter(
        row =>
          row.transaction_type ===
            'bottling_consumption' &&
          row.item_type === 'product'
      );

    const bulkTotal =
      bulkConsumption.reduce(
        (sum, row) =>
          sum +
          rowTotalCost(row),
        0
      );

    if (
      outputQty > 0 &&
      bulkTotal > 0
    ) {
      bulkPerBottle =
        bulkTotal / outputQty;
    }

    const bottleConsumptions =
      refs.filter(
        row =>
          row.transaction_type ===
          'bottling_bottle_consumption'
      );

    const bottleTotal =
      bottleConsumptions.reduce(
        (sum, row) =>
          sum +
          rowTotalCost(row),
        0
      );

    bottlePerBottle =
      outputQty > 0
        ? bottleTotal / outputQty
        : 0;

    bottleRows =
      actualRows(
        bottleConsumptions,
        outputQty
      );
  }

  /*
   * Belum Bottling:
   * production_output.unit_cost adalah cost/ml.
   * Convert ke cost per bottle.
   */
  if (
    bulkPerBottle <= 0 &&
    productionOutput
  ) {
    const costPerMl =
      Number(
        productionOutput.unit_cost
      ) || 0;

    bulkPerBottle =
      bottleSize > 0
        ? costPerMl *
          Number(bottleSize)
        : costPerMl;
  }

  /*
   * ==========================================
   * LABELING
   * ==========================================
   */

  let labelPerBottle = 0;
  let labelRows = [];

  const labelingOutput =
    stage >= 3
      ? latestOutput(
          batchEntries,
          'labeling_output',
          latestTime
        )
      : null;

  if (labelingOutput) {
    const refs =
      refsFor(
        stockLedger,
        labelingOutput
      );

    const outputQty =
      Number(
        labelingOutput.quantity_in
      ) || 1;

    const consumptions =
      refs.filter(
        row =>
          row.transaction_type ===
          'label_consumption'
      );

    const total =
      consumptions.reduce(
        (sum, row) =>
          sum +
          rowTotalCost(row),
        0
      );

    labelPerBottle =
      outputQty > 0
        ? total / outputQty
        : 0;

    labelRows =
      actualRows(
        consumptions,
        outputQty
      );
  }

  /*
   * ==========================================
   * CUKAI + BOX
   * ==========================================
   */

  let excisePerBottle = 0;
  let boxPerBottle = 0;

  let exciseRows = [];
  let boxRows = [];

  const exciseOutput =
    stage >= 4
      ? latestOutput(
          batchEntries,
          'excise_output',
          latestTime
        )
      : null;

  if (exciseOutput) {
    const refs =
      refsFor(
        stockLedger,
        exciseOutput
      );

    const outputQty =
      Number(
        exciseOutput.quantity_in
      ) || 1;

    const materialConsumptions =
      refs.filter(
        row =>
          row.transaction_type ===
            'excise_consumption' &&
          row.item_type === 'material'
      );

    /*
     * Gunakan mapping final product untuk
     * membedakan Box vs Pita Cukai.
     */
    const activeMappings =
      (mappings || []).filter(
        mapping =>
          mapping.is_active !== false
      );

    const boxIds =
      new Set(
        activeMappings
          .filter(
            mapping =>
              mapping.component_type ===
              'box'
          )
          .map(
            mapping =>
              mapping.material_id
          )
          .filter(Boolean)
      );

    const exciseIds =
      new Set(
        activeMappings
          .filter(
            mapping =>
              mapping.component_type ===
              'excise'
          )
          .map(
            mapping =>
              mapping.material_id
          )
          .filter(Boolean)
      );

    const boxConsumptions = [];
    const exciseConsumptions = [];

    for (
      const row of
      materialConsumptions
    ) {
      if (
        boxIds.has(row.item_id)
      ) {
        boxConsumptions.push(row);
      } else if (
        exciseIds.has(row.item_id)
      ) {
        exciseConsumptions.push(row);
      } else {
        /*
         * Fallback:
         * material excise yang tidak dapat
         * dikenali mapping tetap masuk
         * kelompok Cukai agar cost tidak hilang.
         */
        exciseConsumptions.push(row);
      }
    }

    const boxTotal =
      boxConsumptions.reduce(
        (sum, row) =>
          sum +
          rowTotalCost(row),
        0
      );

    const exciseTotal =
      exciseConsumptions.reduce(
        (sum, row) =>
          sum +
          rowTotalCost(row),
        0
      );

    boxPerBottle =
      outputQty > 0
        ? boxTotal / outputQty
        : 0;

    excisePerBottle =
      outputQty > 0
        ? exciseTotal / outputQty
        : 0;

    boxRows =
      actualRows(
        boxConsumptions,
        outputQty
      );

    exciseRows =
      actualRows(
        exciseConsumptions,
        outputQty
      );
  }

  /*
   * ==========================================
   * FINAL ACTUAL TOTAL
   * ==========================================
   *
   * output.unit_cost tetap SOURCE OF TRUTH.
   */

  let actualHppPerBottle =
    Number(latest.unit_cost) || 0;

  /*
   * production_output.unit_cost adalah per ml.
   */
  if (
    latest.transaction_type ===
    'production_output'
  ) {
    actualHppPerBottle =
      bottleSize > 0
        ? actualHppPerBottle *
          Number(bottleSize)
        : actualHppPerBottle;
  }

  return {
    actualHppPerBottle,

    bulkPerBottle,
    bottlePerBottle,
    labelPerBottle,
    boxPerBottle,
    excisePerBottle,

    bottleRows,
    labelRows,
    boxRows,
    exciseRows,

    transactionType:
      latest.transaction_type,

    stage:
      latest.inventory_status ||
      '',

    stagePriority:
      stage,

    batchNumber,

    referenceId:
      latest.reference_id || '',

    outputQty:
      Number(latest.quantity_in) ||
      1,
  };
}

export function computeProductHpp({
  product,
  recipe,
  ingredients,
  materials,
  mappings,
  pgMaterial,
  vgMaterial,
  stockLedger,

  /*
   * v3.4 PATCH
   *
   * Optional parent/source recipe.
   *
   * Existing caller tetap kompatibel.
   */
  sourceRecipe = null,
  sourceIngredients = null,
}) {
  if (!product) {
    return null;
  }

  /*
   * ============================================================
   * RECIPE SOURCE
   * ============================================================
   *
   * PRIORITAS:
   *
   * 1. Recipe langsung product
   * 2. Parent/source recipe
   *
   * Packaging TIDAK diwariskan.
   * Packaging tetap menggunakan mapping product yang sedang dihitung.
   */
  const effectiveRecipe =
    recipe ||
    sourceRecipe ||
    null;

  const effectiveIngredients =
    recipe
      ? (ingredients || [])
      : (
          sourceIngredients ||
          ingredients ||
          []
        );

  const bottleSize =
    Number(
      product.bottle_size
    ) || 0;

  const volume =
    Number(
      effectiveRecipe?.target_volume
    ) ||
    bottleSize ||
    0;

  const result = {
    product,

    recipe:
      effectiveRecipe,

    volume,
    bottleSize,

    bulkRows: [],
    bulkTotal: 0,
    costPerMl: 0,
    bulkPerBottle: 0,

    bottleRows: [],
    bottleTotal: 0,

    boxRows: [],
    boxTotal: 0,

    labelRows: [],
    labelTotal: 0,

    exciseRows: [],
    exciseTotal: 0,

    hppPerBottle: 0,

    salePrice:
      Number(
        product.sale_price
      ) || 0,

    margin: 0,
    marginPct: 0,

    hasRecipe:
      !!effectiveRecipe,

    validation:
      null,

    useActual:
      false,

    actualHpp:
      null,

    /*
     * Berguna untuk UI/debug:
     *
     * direct = recipe langsung
     * parent = recipe parent/source
     * none   = tidak ada recipe
     */
    recipeSource:
      recipe
        ? 'direct'
        : (
            sourceRecipe
              ? 'parent'
              : 'none'
          ),
  };

  const matById = id =>
    (materials || []).find(
      material =>
        material.id === id
    );

  /*
   * ==========================================
   * STANDARD BULK / RECIPE
   * ==========================================
   */

  if (effectiveRecipe) {
    /*
     * ==========================================================
     * NICOTINE COMPATIBILITY PATCH
     * ==========================================================
     *
     * Recipes.jsx menyimpan nicotine AUTO kembali sebagai
     * RecipeIngredient internal.
     *
     * recipeCalculator baru mengharapkan:
     *
     * nicotineMaterial
     *
     * bukan nicotine sebagai manual ingredient.
     *
     * Maka:
     *
     * 1. Cari RecipeIngredient nicotine
     * 2. Ambil Material master-nya
     * 3. Hapus nicotine dari manual ingredients
     * 4. Kirim sebagai nicotineMaterial
     *
     * Hasil:
     *
     * - tidak double nicotine
     * - HPP mengenali nicotine base
     * - warning "Pilih nicotine base" hilang
     * - Production lama tetap kompatibel
     * - traceability tetap kompatibel
     */

    const nicotineIngredient =
      effectiveIngredients.find(
        item =>
          item.material_type ===
          'nicotine'
      ) || null;

    const nicotineMaterial =
      nicotineIngredient
        ? matById(
            nicotineIngredient.material_id
          )
        : null;

    const manualIngredients =
      effectiveIngredients
        .filter(
          item =>
            item.material_type !==
            'nicotine'
        )
        .map(item => ({
          ...item,

          percentage:
            Number(
              item.percentage
            ) || 0,
        }));

    const calc =
      calculateRecipe({
        ingredients:
          manualIngredients,

        targetVolume:
          volume,

        targetNicotine:
          effectiveRecipe.target_nicotine,

        targetPG:
          effectiveRecipe.target_pg,

        targetVG:
          effectiveRecipe.target_vg,

        nicotineMaterial,

        pgMaterial,
        vgMaterial,
      });

    result.validation =
      calc.validation;

    result.bulkRows =
      calc.items.map(
        item => {
          const mat =
            matById(
              item.material_id
            );

          return {
            ...ingredientCost(
              item,
              mat
            ),

            materialId:
              item.material_id,

            materialName:
              item.material_name ||
              mat?.name ||
              (
                item.isAuto
                  ? 'Auto'
                  : '—'
              ),

            materialCode:
              mat?.code || '',

            materialType:
              item.material_type,

            isPremix:
              !!item.is_premix,

            isAuto:
              !!item.isAuto,

            percentage:
              item.percentage,
          };
        }
      );

    result.bulkTotal =
      result.bulkRows.reduce(
        (sum, row) =>
          sum + row.cost,
        0
      );

    result.costPerMl =
      volume > 0
        ? result.bulkTotal /
          volume
        : 0;

    /*
     * Parent recipe boleh 15.000 ml,
     * product turunannya boleh 15 / 30 / 60 ml.
     *
     * Yang diwariskan adalah COST / ML.
     *
     * Maka:
     *
     * bulk per bottle =
     * cost/ml × bottle size product turunan
     */
    result.bulkPerBottle =
      bottleSize > 0
        ? result.costPerMl *
          bottleSize
        : 0;
  }

  /*
   * ==========================================
   * STANDARD MAPPING
   * ==========================================
   *
   * Mapping SELALU milik product yang sedang dihitung.
   *
   * Parent recipe hanya menjadi sumber BULK.
   *
   * Jadi:
   *
   * IZZI Mango recipe
   *       ↓
   * cost/ml
   *       ↓
   * IZZI Mango 15 ml
   *       +
   * botol 15 ml
   * label 15 ml
   * box 15 ml
   * cukai 15 ml
   *
   * Mapping parent TIDAK ikut diwariskan.
   */

  const activeMappings =
    (mappings || []).filter(
      mapping =>
        mapping.is_active !== false
    );

  const buildComp = type =>
    activeMappings
      .filter(
        mapping =>
          mapping.component_type ===
          type
      )
      .map(mapping => {
        const mat =
          matById(
            mapping.material_id
          );

        const price =
          Number(
            mat?.last_purchase_price
          ) || 0;

        const qty =
          Number(
            mapping.quantity_per_unit
          ) || 1;

        return {
          materialId:
            mapping.material_id,

          materialName:
            mapping.material_name ||
            mat?.name ||
            '—',

          materialCode:
            mapping.material_code ||
            mat?.code ||
            '',

          qty,

          unitLabel:
            'pcs',

          unitCost:
            price,

          cost:
            qty * price,
        };
      });

  result.bottleRows =
    buildComp('bottle');

  result.boxRows =
    buildComp('box');

  result.labelRows =
    buildComp('label');

  result.exciseRows =
    buildComp('excise');

  result.bottleTotal =
    result.bottleRows.reduce(
      (sum, row) =>
        sum + row.cost,
      0
    );

  result.boxTotal =
    result.boxRows.reduce(
      (sum, row) =>
        sum + row.cost,
      0
    );

  result.labelTotal =
    result.labelRows.reduce(
      (sum, row) =>
        sum + row.cost,
      0
    );

  result.exciseTotal =
    result.exciseRows.reduce(
      (sum, row) =>
        sum + row.cost,
      0
    );

  /*
   * ==========================================
   * ACTUAL
   * ==========================================
   */

  const actual =
    getActualHppFromLedger(
      stockLedger,
      product.id,
      mappings,
      bottleSize
    );

  if (actual) {
    result.useActual = true;

    result.actualHpp =
      actual;

    /*
     * TOTAL selalu source of truth
     * dari latest output.unit_cost.
     */
    result.hppPerBottle =
      actual.actualHppPerBottle;

    /*
     * BULK SELALU BULK.
     *
     * Jangan diganti dengan
     * previous cumulative stage.
     */
    if (
      actual.bulkPerBottle > 0
    ) {
      result.bulkPerBottle =
        actual.bulkPerBottle;
    }

    /*
     * BOTTLING SUDAH TERJADI
     */
    if (
      actual.stagePriority >= 2
    ) {
      result.bottleTotal =
        actual.bottlePerBottle;

      if (
        actual.bottleRows.length
      ) {
        result.bottleRows =
          actual.bottleRows;
      }
    }

    /*
     * LABELING SUDAH TERJADI
     */
    if (
      actual.stagePriority >= 3
    ) {
      result.labelTotal =
        actual.labelPerBottle;

      if (
        actual.labelRows.length
      ) {
        result.labelRows =
          actual.labelRows;
      }
    }

    /*
     * CUKAI SUDAH TERJADI
     */
    if (
      actual.stagePriority >= 4
    ) {
      result.boxTotal =
        actual.boxPerBottle;

      result.exciseTotal =
        actual.excisePerBottle;

      if (
        actual.boxRows.length
      ) {
        result.boxRows =
          actual.boxRows;
      }

      if (
        actual.exciseRows.length
      ) {
        result.exciseRows =
          actual.exciseRows;
      }
    }
  } else {
    /*
     * BELUM ADA ACTUAL TRANSACTION.
     *
     * Standard HPP:
     *
     * BULK
     * + BOTOL
     * + BOX
     * + LABEL
     * + CUKAI
     */
    result.hppPerBottle =
      result.bulkPerBottle +
      result.bottleTotal +
      result.boxTotal +
      result.labelTotal +
      result.exciseTotal;
  }

  /*
   * ==========================================
   * MARGIN
   * ==========================================
   */

  result.margin =
    result.salePrice -
    result.hppPerBottle;

  result.marginPct =
    result.salePrice > 0
      ? (
          result.margin /
          result.salePrice
        ) * 100
      : 0;

  return result;
}