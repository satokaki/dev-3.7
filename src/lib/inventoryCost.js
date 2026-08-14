/**
 * Inventory cost-resolution layer for reporting.
 *
 * LAB PRO v3.4
 *
 * PRIORITAS COST:
 * 1. Frozen StockLedger.unit_cost
 * 2. Material.last_purchase_price
 * 3. Standard stage costing dari computeProductHpp
 * 4. 0
 *
 * STAGE:
 * BULK                 = cost / ml
 * READY_FOR_LABELING   = bulk + bottle
 * UNEXCISED            = bulk + bottle + label
 * READY_FOR_SALE       = HPP final penuh
 *
 * PARENT / SOURCE RECIPE:
 * Produk turunan ukuran botol boleh mengambil formula/bulk cost
 * dari recipe produk sumber.
 *
 * Yang diwariskan HANYA recipe/bulk.
 * Mapping packaging tetap milik product yang sedang dihitung.
 */

import { base44 } from '@/api/base44Client';
import { computeProductHpp } from './hppCalculator';


/* =========================================================
 * PG / VG
 * ========================================================= */

export function resolvePgVgMaterials(materials = []) {
  return {
    pgMaterial:
      materials.find(
        m =>
          m.material_category ===
          'propylene_glycol'
      ) || null,

    vgMaterial:
      materials.find(
        m =>
          m.material_category ===
          'vegetable_glycerin'
      ) || null,
  };
}


/* =========================================================
 * RECIPE HELPERS
 * ========================================================= */

/**
 * Ambil recipe terbaru.
 *
 * Prioritas:
 * approved terbaru
 * lalu recipe versi terbaru.
 */
function pickLatestRecipe(recipes = []) {
  if (!recipes.length) return null;

  const byVersion = list =>
    [...list].sort(
      (a, b) =>
        (Number(b.version) || 0) -
        (Number(a.version) || 0)
    );

  const approved =
    byVersion(
      recipes.filter(
        r =>
          r.status === 'approved'
      )
    );

  return (
    approved[0] ||
    byVersion(recipes)[0] ||
    null
  );
}


/**
 * Product source compatibility resolver.
 *
 * LAB PRO pernah memakai beberapa konsep:
 * parent product / source product / bulk source.
 *
 * Resolver ini TIDAK mengubah data.
 * Hanya membaca field yang memang tersedia.
 */
function getRecipeSourceProductId(product) {
  if (!product) return '';

  return (
    product.recipe_source_product_id ||
    product.source_product_id ||
    product.parent_product_id ||
    product.bulk_source_product_id ||
    product.sourceProductId ||
    product.parentProductId ||
    ''
  );
}


/**
 * Cari recipe untuk product.
 *
 * PRIORITAS:
 *
 * 1. Recipe langsung product
 * 2. Recipe milik source/parent product
 *
 * Return:
 *
 * {
 *   recipe,
 *   ingredients,
 *   sourceRecipe,
 *   sourceIngredients
 * }
 */
function resolveRecipeContext({
  product,
  finishedRecipes,
  ingredients,
}) {
  if (!product) {
    return {
      recipe: null,
      ingredients: [],
      sourceRecipe: null,
      sourceIngredients: [],
    };
  }

  /*
   * DIRECT RECIPE
   */
  const directRecipe =
    pickLatestRecipe(
      finishedRecipes.filter(
        r =>
          r.product_id ===
          product.id
      )
    );

  if (directRecipe) {
    return {
      recipe:
        directRecipe,

      ingredients:
        ingredients.filter(
          i =>
            i.recipe_id ===
            directRecipe.id
        ),

      sourceRecipe:
        null,

      sourceIngredients:
        [],
    };
  }


  /*
   * SOURCE / PARENT RECIPE
   */
  const sourceProductId =
    getRecipeSourceProductId(
      product
    );

  if (!sourceProductId) {
    return {
      recipe: null,
      ingredients: [],
      sourceRecipe: null,
      sourceIngredients: [],
    };
  }

  const sourceRecipe =
    pickLatestRecipe(
      finishedRecipes.filter(
        r =>
          r.product_id ===
          sourceProductId
      )
    );

  if (!sourceRecipe) {
    return {
      recipe: null,
      ingredients: [],
      sourceRecipe: null,
      sourceIngredients: [],
    };
  }

  return {
    recipe:
      null,

    ingredients:
      [],

    sourceRecipe,

    sourceIngredients:
      ingredients.filter(
        i =>
          i.recipe_id ===
          sourceRecipe.id
      ),
  };
}


/* =========================================================
 * STAGE COST INDEX
 * ========================================================= */

/**
 * productId -> {
 *   BULK,
 *   READY_FOR_LABELING,
 *   UNEXCISED,
 *   READY_FOR_SALE
 * }
 *
 * Dipakai sebagai fallback untuk StockBalance / data lama
 * yang belum memiliki frozen unit_cost.
 */
export function buildStageCostIndex({
  products = [],
  recipes = [],
  ingredients = [],
  materials = [],
  mappings = [],
  pgMaterial,
  vgMaterial,
}) {
  const index = {};

  const finishedRecipes =
    recipes.filter(
      r =>
        r.recipe_type ===
        'FINISHED_PRODUCT'
    );

  for (const product of products) {
    /*
     * Recipe direct atau parent/source.
     */
    const {
      recipe,
      ingredients: recipeIngredients,
      sourceRecipe,
      sourceIngredients,
    } = resolveRecipeContext({
      product,
      finishedRecipes,
      ingredients,
    });


    /*
     * IMPORTANT:
     *
     * Mapping SELALU product yang sedang dihitung.
     *
     * Jadi product 15 ml:
     *
     * bulk cost ← parent recipe
     * bottle    ← mapping 15 ml
     * label     ← mapping 15 ml
     * box       ← mapping 15 ml
     * excise    ← mapping 15 ml
     */
    const productMappings =
      mappings.filter(
        m =>
          m.product_id ===
          product.id
      );


    const hpp =
      computeProductHpp({
        product,

        recipe,

        ingredients:
          recipeIngredients,

        sourceRecipe,

        sourceIngredients,

        materials,

        mappings:
          productMappings,

        pgMaterial,
        vgMaterial,
      });


    if (!hpp) continue;


    const bulkPerBottle =
      Number(
        hpp.bulkPerBottle
      ) || 0;

    const bottleTotal =
      Number(
        hpp.bottleTotal
      ) || 0;

    const labelTotal =
      Number(
        hpp.labelTotal
      ) || 0;


    index[product.id] = {
      /*
       * BULK
       * unit = ml
       */
      BULK:
        Number(
          hpp.costPerMl
        ) || 0,


      /*
       * BOTTLING OUTPUT
       *
       * bulk + bottle
       */
      READY_FOR_LABELING:
        bulkPerBottle +
        bottleTotal,


      /*
       * LABELING OUTPUT
       *
       * bulk
       * + bottle
       * + label
       */
      UNEXCISED:
        bulkPerBottle +
        bottleTotal +
        labelTotal,


      /*
       * FINAL PRODUCT
       *
       * bulk
       * + bottle
       * + label
       * + excise
       * + box
       */
      READY_FOR_SALE:
        Number(
          hpp.hppPerBottle
        ) || 0,
    };
  }

  return index;
}


/* =========================================================
 * UNIT COST RESOLVER
 * ========================================================= */

/**
 * Resolve HPP/unit untuk StockLedger / StockBalance.
 *
 * PRIORITAS:
 *
 * 1. Frozen row.unit_cost
 * 2. Material HBT
 * 3. Stage cost fallback
 * 4. 0
 */
export function resolveBalanceUnitCost(
  row,
  {
    materialById,
    stageCostIndex,
  }
) {
  if (
    !row ||
    !row.item_id
  ) {
    return 0;
  }


  /*
   * =====================================
   * PRIORITAS 1 — FROZEN TRANSACTION COST
   * =====================================
   *
   * Jangan recost transaksi historis.
   */
  const frozenUnitCost =
    Number(
      row.unit_cost
    );

  if (
    Number.isFinite(
      frozenUnitCost
    ) &&
    frozenUnitCost > 0
  ) {
    return frozenUnitCost;
  }


  /*
   * =====================================
   * PRIORITAS 2 — MATERIAL HBT
   * =====================================
   */
  if (
    row.item_type ===
    'material'
  ) {
    return (
      Number(
        materialById?.[
          row.item_id
        ]?.last_purchase_price
      ) || 0
    );
  }


  /*
   * =====================================
   * PRIORITAS 3 — PRODUCT STAGE FALLBACK
   * =====================================
   */
  const status =
    row.inventory_status ||
    '';

  const stage =
    stageCostIndex?.[
      row.item_id
    ];

  if (
    stage &&
    stage[status] != null
  ) {
    return (
      Number(
        stage[status]
      ) || 0
    );
  }


  return 0;
}


/* =========================================================
 * LOAD CONTEXT
 * ========================================================= */

/**
 * Dipakai InventoryReport / StockCard.
 */
export async function loadInventoryCostContext() {
  const [
    products,
    materials,
    recipes,
    ingredients,
    mappings,
  ] = await Promise.all([
    base44.entities.Product.list(
      '-created_date',
      500
    ),

    base44.entities.Material.list(
      '-created_date',
      2000
    ),

    base44.entities.Recipe.list(
      '-created_date',
      500
    ),

    base44.entities.RecipeIngredient.list(
      '-created_date',
      3000
    ),

    base44.entities.ProductComponentMapping.list(
      '-created_date',
      3000
    ),
  ]);


  const {
    pgMaterial,
    vgMaterial,
  } =
    resolvePgVgMaterials(
      materials
    );


  const stageCostIndex =
    buildStageCostIndex({
      products,
      recipes,
      ingredients,
      materials,
      mappings,
      pgMaterial,
      vgMaterial,
    });


  const materialById =
    Object.fromEntries(
      materials.map(
        m => [
          m.id,
          m,
        ]
      )
    );


  return {
    products,
    materials,
    recipes,
    ingredients,
    mappings,

    pgMaterial,
    vgMaterial,

    stageCostIndex,
    materialById,
  };
}