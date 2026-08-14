/**
 * Premix / Intermediate Material engine.
 *
 * Layer di atas recipeCalculator — tidak mengubah engine lama.
 *
 * Bertanggung jawab atas:
 *  - perhitungan komponen premix berdasarkan basis (W_W / W_V / V_V)
 *  - resolusi komposisi premix secara rekursif
 *  - deteksi circular dependency antar premix
 *  - validasi resep premix
 *  - pemilihan batch FEFO
 *
 * RULE PENTING:
 *  - W_W = targetQuantity adalah GRAM
 *  - Gram menjadi source of truth
 *  - Density TIDAK BOLEH mengubah gramasi W_W
 *  - Density hanya dipakai untuk menghitung nilai volume informasional
 *  - Material PREMIX pada W_W menggunakan aturan 1 gram = 1 ml
 */

import { base44 } from '@/api/base44Client';


/* ==========================================================
   CONSTANT
========================================================== */

export const CALC_BASIS = {
  W_W: 'W_W', // gram terhadap total gram
  W_V: 'W_V', // gram terhadap total volume
  V_V: 'V_V', // ml terhadap total ml
};


export const MATERIAL_TYPE = {
  RAW_MATERIAL: 'RAW_MATERIAL',
  PREMIX: 'PREMIX',
  PACKAGING: 'PACKAGING',
  LABEL: 'LABEL',
  CONSUMABLE: 'CONSUMABLE',
  FINISHED_GOOD: 'FINISHED_GOOD',
};


export const BATCH_STATUS = {
  DRAFT: 'DRAFT',
  IN_PROCESS: 'IN_PROCESS',
  AVAILABLE: 'AVAILABLE',
  DEPLETED: 'DEPLETED',
  QUARANTINE: 'QUARANTINE',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
};


/* ==========================================================
   HELPER
========================================================== */

const densityOf = (material) => {
  const density = Number(
    material?.default_density ??
    material?.density ??
    1
  );

  return density > 0 ? density : 1;
};


const numberOf = (value, fallback = 0) => {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
};


/* ==========================================================
   PREMIX QUANTITY CALCULATOR
========================================================== */

/**
 * Hitung kebutuhan komponen premix.
 *
 * @param {Array} ingredients
 * [{ material_id, percentage, density }]
 *
 * @param {number} targetQuantity
 *
 * W_W:
 * targetQuantity = GRAM
 *
 * W_V:
 * targetQuantity = ML
 *
 * V_V:
 * targetQuantity = ML
 *
 * @param {string} basis
 * W_W | W_V | V_V
 *
 * @returns {Array}
 * [{
 *   material_id,
 *   percentage,
 *   gram,
 *   ml,
 *   density
 * }]
 */
export function calculatePremixQuantities({
  ingredients,
  targetQuantity,
  basis = CALC_BASIS.W_W,
  materialsById = {},
}) {

  const target = numberOf(targetQuantity);

  return (ingredients || []).map((ingredient) => {

    const material =
      materialsById?.[ingredient.material_id] || null;

    const percentage =
      numberOf(ingredient.percentage);

    const density =
      numberOf(
        ingredient.density,
        densityOf(material)
      ) || 1;

    let gram = 0;
    let ml = 0;


    /* ======================================================
       W/W
       ======================================================
       Target adalah GRAM.

       Contoh:
       Target = 1000 gram
       WS23 = 25%
       PG   = 75%

       WS23 = 250 gram
       PG   = 750 gram

       Density TIDAK BOLEH mengubah gram tersebut.
    ====================================================== */

    if (basis === CALC_BASIS.W_W) {

      gram =
        (percentage / 100) * target;

      /*
       * Untuk material PREMIX:
       *
       * Business rule:
       * 1 gram = 1 ml
       *
       * Penting:
       * nilai ml hanya informasi.
       * Production tetap harus menggunakan gram.
       */

      if (
        material?.material_type ===
        MATERIAL_TYPE.PREMIX
      ) {

        ml = gram;

      } else {

        /*
         * Raw material masih boleh mempunyai
         * equivalent volume berdasarkan density.
         *
         * Tetapi nilai GRAM tidak berubah.
         */

        ml =
          density > 0
            ? gram / density
            : 0;
      }
    }


    /* ======================================================
       V/V
       ======================================================
       Target adalah ML.

       Component ML ditentukan oleh persentase.
       Gram baru dihitung melalui density.
    ====================================================== */

    else if (basis === CALC_BASIS.V_V) {

      ml =
        (percentage / 100) * target;

      gram =
        ml * density;
    }


    /* ======================================================
       W/V
       ======================================================
       Target adalah ML.

       percentage menyatakan:
       gram per 100 ml final volume.
    ====================================================== */

    else if (basis === CALC_BASIS.W_V) {

      gram =
        (percentage / 100) * target;

      ml =
        density > 0
          ? gram / density
          : 0;
    }


    /* ======================================================
       UNKNOWN BASIS
    ====================================================== */

    else {

      throw new Error(
        `Calculation basis tidak dikenal: ${basis}`
      );
    }


    return {
      ...ingredient,

      percentage,

      gram,

      /*
       * Alias agar layer lama tetap compatible.
       */

      ml,

      density,
    };
  });
}


/* ==========================================================
   BUILD PREMIX COMPOSITION MAP
========================================================== */

/**
 * Bangun:
 *
 * outputMaterialId
 *     ↓
 * {
 *   recipe,
 *   components
 * }
 *
 * Ingredients sebaiknya preload sekali supaya tidak
 * melakukan query database berulang.
 */
export function buildPremixCompositionMap(
  premixRecipes,
  allIngredients
) {

  const map = {};

  for (const recipe of premixRecipes || []) {

    if (!recipe.output_material_id) {
      continue;
    }

    const components =
      (allIngredients || []).filter(
        (ingredient) =>
          ingredient.recipe_id === recipe.id
      );

    map[recipe.output_material_id] = {
      recipe,
      components,
    };
  }

  return map;
}


/* ==========================================================
   CIRCULAR DEPENDENCY
========================================================== */

/**
 * Contoh circular dependency:
 *
 * Premix A
 *   ↓
 * Premix B
 *   ↓
 * Premix A
 *
 * Harus ditolak.
 */
export function detectCircularDependency(
  outputMaterialId,
  premixMap,
  path = new Set()
) {

  if (!outputMaterialId) {
    return false;
  }

  if (path.has(outputMaterialId)) {
    return true;
  }

  path.add(outputMaterialId);

  const node =
    premixMap?.[outputMaterialId];


  if (node?.components?.length) {

    for (const component of node.components) {

      const circular =
        detectCircularDependency(
          component.material_id,
          premixMap,
          path
        );

      if (circular) {
        path.delete(outputMaterialId);
        return true;
      }
    }
  }

  path.delete(outputMaterialId);

  return false;
}


/* ==========================================================
   RESOLVE PREMIX COMPOSITION
========================================================== */

/**
 * Pecah premix menjadi bahan atom.
 *
 * Contoh:
 *
 * Sucralose 10%
 * ├─ Sucralose Powder 10%
 * └─ PG 90%
 *
 * Jika digunakan 20 gram:
 *
 * Powder = 2 gram
 * PG     = 18 gram
 *
 * CATATAN:
 * Recursive composition menggunakan W/W.
 *
 * Ini sengaja dipertahankan karena premix manufacturing
 * menggunakan gram sebagai source of truth.
 */
export function resolveCompositionContribution({
  materialId,
  quantityGram,
  premixMap,
  materialsById,
  path = new Set(),
}) {

  const contributions = [];

  const quantity =
    numberOf(quantityGram);


  /* ======================================================
     CIRCULAR CHECK
  ====================================================== */

  if (path.has(materialId)) {

    return {
      contributions,
      circular: true,
    };
  }


  path.add(materialId);


  const node =
    premixMap?.[materialId];


  /* ======================================================
     ATOMIC MATERIAL
  ====================================================== */

  if (
    !node ||
    !node.components ||
    node.components.length === 0
  ) {

    const material =
      materialsById?.[materialId];

    contributions.push({

      material_id: materialId,

      name:
        material?.name || '',

      grams:
        quantity,

      is_premix:
        material?.material_type ===
        MATERIAL_TYPE.PREMIX,

      depth:
        path.size - 1,
    });


    path.delete(materialId);


    return {
      contributions,
      circular: false,
    };
  }


  /* ======================================================
     PREMIX
  ====================================================== */

  const totalPercentage =
    node.components.reduce(
      (sum, component) =>
        sum +
        numberOf(component.percentage),
      0
    );


  /*
   * Defensive fallback.
   * Recipe validation normalnya sudah memastikan total 100%.
   */

  const divisor =
    totalPercentage > 0
      ? totalPercentage
      : 100;


  let circular = false;


  for (const component of node.components) {

    const percentage =
      numberOf(component.percentage);


    /*
     * SOURCE OF TRUTH:
     *
     * quantityGram × percentage
     *
     * Tidak ada density conversion di sini.
     */

    const componentGram =
      (percentage / divisor) *
      quantity;


    const sub =
      resolveCompositionContribution({

        materialId:
          component.material_id,

        quantityGram:
          componentGram,

        premixMap,

        materialsById,

        path,
      });


    if (sub.circular) {
      circular = true;
    }


    contributions.push(
      ...sub.contributions
    );
  }


  path.delete(materialId);


  return {
    contributions,
    circular,
  };
}


/* ==========================================================
   PREMIX CONTRIBUTION TO FINISHED PRODUCT
========================================================== */

/**
 * Menghitung kontribusi carrier.
 *
 * Contoh:
 *
 * Sucralose 10%
 *
 * 2 gram Sucralose
 * 18 gram PG
 *
 * Maka ketika 20 gram premix dipakai:
 *
 * PG contribution = 18 gram
 * Active = 2 gram
 */
export function premixContributionForFinishedRecipe({
  materialId,
  quantityGram,
  premixMap,
  materialsById,
}) {

  const {
    contributions,
    circular,
  } = resolveCompositionContribution({

    materialId,

    quantityGram,

    premixMap,

    materialsById,
  });


  let pgGram = 0;
  let vgGram = 0;

  const active = [];


  for (const contribution of contributions) {

    const material =
      materialsById?.[
        contribution.material_id
      ];


    const pgPercentage =
      numberOf(
        material?.pg_content,
        material?.material_category ===
        'propylene_glycol'
          ? 100
          : 0
      );


    const vgPercentage =
      numberOf(
        material?.vg_content,
        material?.material_category ===
        'vegetable_glycerin'
          ? 100
          : 0
      );


    pgGram +=
      contribution.grams *
      (pgPercentage / 100);


    vgGram +=
      contribution.grams *
      (vgPercentage / 100);


    active.push({

      material_id:
        contribution.material_id,

      name:
        contribution.name,

      grams:
        contribution.grams,

      is_premix:
        contribution.is_premix,
    });
  }


  return {

    pgGram,

    vgGram,

    /*
     * Nama lama dipertahankan untuk compatibility.
     */

    activeGram:
      active,

    circular,
  };
}


/* ==========================================================
   VALIDATE PREMIX RECIPE
========================================================== */

export function validatePremixRecipe({
  recipe,
  ingredients = [],
  outputMaterial,
  materialsById,
  premixMap,
}) {

  const errors = [];


  /* ======================================================
     NON PREMIX
  ====================================================== */

  if (
    !recipe?.recipe_type ||
    recipe.recipe_type !== 'PREMIX'
  ) {

    return {
      valid: true,
      errors,
    };
  }


  /* ======================================================
     OUTPUT MATERIAL
  ====================================================== */

  if (!recipe.output_material_id) {

    errors.push(
      'Resep PREMIX wajib memiliki Output Material'
    );

  } else {

    if (!outputMaterial) {

      errors.push(
        'Output material tidak ditemukan'
      );

    } else if (
      outputMaterial.material_type !==
      MATERIAL_TYPE.PREMIX
    ) {

      errors.push(
        'Output material wajib bertipe PREMIX'
      );
    }


    /* ====================================================
       SELF REFERENCE
    ==================================================== */

    if (
      ingredients.some(
        (ingredient) =>
          ingredient.material_id ===
          recipe.output_material_id
      )
    ) {

      errors.push(
        'Output material tidak boleh menjadi komponen resepnya sendiri'
      );
    }


    /* ====================================================
       CIRCULAR DEPENDENCY
    ==================================================== */

    if (
      premixMap &&
      detectCircularDependency(
        recipe.output_material_id,
        premixMap,
        new Set()
      )
    ) {

      errors.push(
        'Circular dependency terdeteksi pada formula premix'
      );
    }
  }


  /* ======================================================
     TOTAL COMPOSITION
  ====================================================== */

  const total =
    ingredients.reduce(
      (sum, ingredient) =>
        sum +
        numberOf(ingredient.percentage),
      0
    );


  if (
    Math.abs(total - 100) > 0.1
  ) {

    errors.push(
      `Total komposisi ${total.toFixed(2)}%, harus 100%`
    );
  }


  return {

    valid:
      errors.length === 0,

    errors,
  };
}


/* ==========================================================
   AVAILABLE PREMIX BATCHES
========================================================== */

/**
 * Ambil batch AVAILABLE.
 *
 * FEFO:
 * expiry paling dekat digunakan terlebih dahulu.
 */
export async function getAvailablePremixBatches(
  materialId
) {

  const today =
    new Date()
      .toISOString()
      .slice(0, 10);


  const batches =
    await base44.entities.PremixBatch.filter({

      material_id:
        materialId,

      status:
        BATCH_STATUS.AVAILABLE,
    });


  return (batches || [])

    .filter(
      (batch) =>
        !batch.expiry_date ||
        batch.expiry_date >= today
    )

    .filter(
      (batch) =>
        numberOf(
          batch.quantity_remaining
        ) > 0
    )

    .sort((a, b) => {

      const expiryA =
        a.expiry_date ||
        '9999-12-31';

      const expiryB =
        b.expiry_date ||
        '9999-12-31';

      return expiryA.localeCompare(
        expiryB
      );
    });
}


/* ==========================================================
   FEFO PICKER
========================================================== */

/**
 * Pilih batch untuk memenuhi quantity.
 *
 * @returns
 *
 * {
 *   allocations: [{
 *     batch_id,
 *     batch_code,
 *     quantity,
 *     expiry_date
 *   }],
 *
 *   fulfilled,
 *   remaining
 * }
 */
export function pickBatchFEFO(
  batches,
  neededQty
) {

  const allocations = [];

  let remaining =
    numberOf(neededQty);


  for (const batch of batches || []) {

    if (remaining <= 0) {
      break;
    }


    const available =
      numberOf(
        batch.quantity_remaining
      );


    if (available <= 0) {
      continue;
    }


    const take =
      Math.min(
        available,
        remaining
      );


    allocations.push({

      batch_id:
        batch.id,

      batch_code:
        batch.batch_code,

      quantity:
        take,

      expiry_date:
        batch.expiry_date,
    });


    remaining -= take;
  }


  return {

    allocations,

    fulfilled:
      remaining <= 0.0001,

    remaining:
      Math.max(
        0,
        remaining
      ),
  };
}


/* ==========================================================
   BATCH USABILITY
========================================================== */

export function isBatchUsable(batch) {

  if (!batch) {
    return false;
  }


  if (
    batch.status !==
    BATCH_STATUS.AVAILABLE
  ) {

    return false;
  }


  if (batch.expiry_date) {

    const today =
      new Date()
        .toISOString()
        .slice(0, 10);


    if (
      batch.expiry_date <
      today
    ) {

      return false;
    }
  }


  if (
    numberOf(
      batch.quantity_remaining
    ) <= 0
  ) {

    return false;
  }


  return true;
}


/* ==========================================================
   BATCH BY PRODUCTION
========================================================== */

/**
 * Ambil batch premix yang berhubungan dengan
 * Production Order.
 *
 * NAMA FUNCTION DIPERTAHANKAN
 * karena kemungkinan sudah digunakan modul lain.
 */
export async function getBatchesUsedByProduction(
  productionId
) {

  return base44.entities.PremixBatch.filter({

    production_id:
      productionId,
  });
}


/* ==========================================================
   TRACEABILITY
========================================================== */

/**
 * Cari produk jadi yang menggunakan material
 * dari PremixBatch tertentu.
 *
 * NOTE:
 * Implementasi ini masih traceability berbasis:
 *
 * batch
 *   ↓
 * material
 *   ↓
 * recipe ingredient
 *   ↓
 * finished production
 *
 * Belum merupakan exact batch allocation tracking.
 */
export async function getProductsUsingPremixBatch(
  premixBatchId
) {

  const batch =
    await base44.entities.PremixBatch
      .get(premixBatchId)
      .catch(() => null);


  if (!batch) {
    return [];
  }


  const ingredients =
    await base44.entities.RecipeIngredient.filter({

      material_id:
        batch.material_id,

      is_premix:
        true,
    });


  const recipeIds =
    [
      ...new Set(
        (ingredients || [])
          .map(
            (ingredient) =>
              ingredient.recipe_id
          )
          .filter(Boolean)
      ),
    ];


  if (
    recipeIds.length === 0
  ) {

    return [];
  }


  const productions = [];


  for (const recipeId of recipeIds) {

    const result =
      await base44.entities.ProductionOrder.filter({

        recipe_id:
          recipeId,

        production_type:
          'FINISHED_PRODUCT',
      });


    productions.push(
      ...(result || [])
    );
  }


  return productions;
}