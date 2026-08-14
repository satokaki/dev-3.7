/**
 * Recipe Calculation Engine for E-Liquid
 *
 * Integrated PG/VG balancing model:
 *
 * - PREMIX ingredients count as PG 100% / VG 0% for finished-product balancing.
 * - Non-premix ingredients contribute via carrier (pg_content / vg_content).
 * - Nicotine can be injected automatically from selected nicotineMaterial +
 *   targetNicotine.
 * - Plain PG and VG are computed automatically as balancers.
 * - Total formula must equal 100%.
 * - Plain PG/VG must not be negative.
 *
 * Backward compatible:
 * - Manual ingredients are still supported.
 * - Legacy nicotineBaseStrength is still accepted.
 * - Existing return fields remain available.
 */


/**
 * @param {Object} params
 *
 * @param {Array} params.ingredients
 * Manual recipe ingredients.
 *
 * @param {number} params.targetVolume
 * Total finished volume in ml.
 *
 * @param {number} params.targetNicotine
 * Target nicotine in mg/ml.
 *
 * @param {number} params.targetPG
 * Target PG percentage.
 *
 * @param {number} params.targetVG
 * Target VG percentage.
 *
 * @param {Object|null} params.nicotineMaterial
 * Selected nicotine material from Master Bahan.
 *
 * Expected:
 * {
 *   id,
 *   name,
 *   nicotine_strength,
 *   nicotine_form,
 *   density,
 *   default_density,
 *   pg_content,
 *   vg_content
 * }
 *
 * @param {number} params.nicotineBaseStrength
 * Legacy fallback nicotine strength.
 *
 * @param {Object} params.pgMaterial
 * PG material for automatic PG balancer.
 *
 * @param {Object} params.vgMaterial
 * VG material for automatic VG balancer.
 */
export function calculateRecipe({
  ingredients,
  targetVolume,
  targetNicotine,
  targetPG,
  targetVG,

  nicotineMaterial = null,

  nicotineBaseStrength = 100,

  pgMaterial = null,
  vgMaterial = null,
}) {
  const targetPg =
    Number(targetPG) || 0;

  const targetVg =
    Number(targetVG) || 0;

  const volume =
    Number(targetVolume) || 0;

  const targetNic =
    Number(targetNicotine) || 0;


  /**
   * Normalize percentage because NumberInput can temporarily
   * contain an empty string while typing.
   */
  ingredients = (ingredients || []).map(
    (i) => ({
      ...i,
      percentage:
        Number(i.percentage) || 0,
    })
  );


  const isPremixIng = (ing) =>
    ing.is_premix ||
    ing.material_type === 'premix' ||
    ing.material_type === 'PREMIX';


  /**
   * Default carrier when PG/VG composition is not explicitly
   * stored on Master Bahan.
   */
  const defaultCarrier = (ing) => {
    const cat = ing.material_type;

    if (cat === 'propylene_glycol') {
      return {
        pg: 100,
        vg: 0,
      };
    }

    if (cat === 'vegetable_glycerin') {
      return {
        pg: 0,
        vg: 100,
      };
    }

    if (
      [
        'flavor',
        'sweetener',
        'cooling',
        'additive',
        'nicotine',
      ].includes(cat)
    ) {
      return {
        pg: 100,
        vg: 0,
      };
    }

    return {
      pg: 0,
      vg: 0,
    };
  };


  /**
   * Resolve carrier contribution.
   */
  const resolveCarrier = (ing) => {
    const fallback =
      defaultCarrier(ing);

    const pgRaw =
      Number(ing.pg_content);

    const vgRaw =
      Number(ing.vg_content);

    /**
     * Important:
     * allow an explicit 0.
     *
     * We only fallback if BOTH values are effectively unset / zero.
     */
    if (
      pgRaw > 0 ||
      vgRaw > 0
    ) {
      return {
        pg: pgRaw || 0,
        vg: vgRaw || 0,
      };
    }

    return fallback;
  };


  const items = [];

  let totalIngredientPg = 0;
  let totalIngredientVg = 0;

  let totalFlavorPercent = 0;

  let nicotineVolume = 0;

  const breakdown = {
    flavor: 0,
    nicotine: 0,
    sweetener: 0,
    premix: 0,
    otherVg: 0,
  };


  /**
   * ============================================================
   * 1. MANUAL INGREDIENTS
   * ============================================================
   *
   * Nicotine manual is still allowed for backward compatibility.
   *
   * Later Recipes.jsx should no longer require the user
   * to add nicotine manually.
   */
  ingredients.forEach((ing) => {
    const pct =
      Number(ing.percentage) || 0;

    const premix =
      isPremixIng(ing);

    let pgContrib = 0;
    let vgContrib = 0;


    if (premix) {
      /**
       * Current LAB PRO rule:
       * finished-product premix counts as PG 100%.
       */
      pgContrib = pct;
      vgContrib = 0;
    } else {
      const carrier =
        resolveCarrier(ing);

      pgContrib =
        (pct * carrier.pg) / 100;

      vgContrib =
        (pct * carrier.vg) / 100;
    }


    totalIngredientPg +=
      pgContrib;

    totalIngredientVg +=
      vgContrib;


    if (
      ing.material_type === 'flavor'
    ) {
      totalFlavorPercent += pct;
    }


    if (
      ing.material_type === 'nicotine'
    ) {
      breakdown.nicotine +=
        pgContrib;

      if (
        pct > 0 &&
        volume > 0
      ) {
        nicotineVolume +=
          (pct / 100) * volume;
      }
    } else if (
      ing.material_type === 'flavor'
    ) {
      breakdown.flavor +=
        pgContrib;
    } else if (
      ing.material_type === 'sweetener'
    ) {
      breakdown.sweetener +=
        pgContrib;
    } else if (premix) {
      breakdown.premix +=
        pgContrib;
    }


    if (vgContrib > 0) {
      breakdown.otherVg +=
        vgContrib;
    }


    const volumeMl =
      (pct / 100) * volume;


    const density =
      Number(ing.density) ||
      (
        premix
          ? 1.04
          : ing.material_type ===
              'vegetable_glycerin'
            ? 1.261
            : 1.036
      );


    items.push({
      ...ing,

      percentage:
        pct,

      pgContribution:
        pgContrib,

      vgContribution:
        vgContrib,

      volumeMl,

      gram:
        volumeMl * density,

      isAuto:
        false,
    });
  });


  /**
   * ============================================================
   * 2. AUTO NICOTINE
   * ============================================================
   *
   * Formula:
   *
   * target mg/ml
   * ---------------- × 100
   * base strength mg/ml
   *
   * Example:
   *
   * target = 30 mg/ml
   * base   = 500 mg/ml
   *
   * = 6%
   */
  let nicotinePercent = 0;


  if (
    targetNic > 0 &&
    nicotineMaterial
  ) {
    const strength =
      Number(
        nicotineMaterial.nicotine_strength
      ) ||
      Number(
        nicotineBaseStrength
      ) ||
      0;


    if (strength > 0) {
      nicotinePercent =
        (targetNic / strength) * 100;


      const nicotineIng = {
        material_id:
          nicotineMaterial.id || null,

        material_name:
          nicotineMaterial.name ||
          'Nicotine (Auto)',

        material_type:
          'nicotine',

        nicotine_form:
          nicotineMaterial.nicotine_form ||
          '',

        nicotine_strength:
          strength,

        density:
          Number(
            nicotineMaterial.density ??
            nicotineMaterial.default_density
          ) || 1.036,

        pg_content:
          Number(
            nicotineMaterial.pg_content
          ) || 0,

        vg_content:
          Number(
            nicotineMaterial.vg_content
          ) || 0,
      };


      const carrier =
        resolveCarrier(
          nicotineIng
        );


      const pgContrib =
        (
          nicotinePercent *
          carrier.pg
        ) / 100;


      const vgContrib =
        (
          nicotinePercent *
          carrier.vg
        ) / 100;


      totalIngredientPg +=
        pgContrib;

      totalIngredientVg +=
        vgContrib;


      breakdown.nicotine +=
        pgContrib;


      if (vgContrib > 0) {
        breakdown.otherVg +=
          vgContrib;
      }


      nicotineVolume =
        (nicotinePercent / 100) *
        volume;


      const nicotineDensity =
        Number(
          nicotineMaterial.density ??
          nicotineMaterial.default_density
        ) || 1.036;


      const nicotineVolumeMl =
        nicotineVolume;


      items.push({
        ...nicotineIng,

        percentage:
          nicotinePercent,

        pgContribution:
          pgContrib,

        vgContribution:
          vgContrib,

        volumeMl:
          nicotineVolumeMl,

        gram:
          nicotineVolumeMl *
          nicotineDensity,

        isAuto:
          true,

        autoType:
          'NICOTINE',
      });
    }
  }


  /**
   * ============================================================
   * 3. PLAIN PG / VG BALANCER
   * ============================================================
   */
  const plainPg =
    targetPg -
    totalIngredientPg;


  const plainVg =
    targetVg -
    totalIngredientVg;


  if (plainPg > 0.0001) {
    const mat =
      pgMaterial || {};


    const volumeMl =
      (plainPg / 100) *
      volume;


    const density =
      Number(mat.density) ||
      1.036;


    items.push({
      material_id:
        mat.id || null,

      material_name:
        mat.name || 'PG (Auto)',

      material_type:
        'propylene_glycol',

      isAuto:
        true,

      autoType:
        'PG',

      percentage:
        plainPg,

      pgContribution:
        plainPg,

      vgContribution:
        0,

      density,

      volumeMl,

      gram:
        volumeMl *
        density,
    });
  }


  if (plainVg > 0.0001) {
    const mat =
      vgMaterial || {};


    const volumeMl =
      (plainVg / 100) *
      volume;


    const density =
      Number(mat.density) ||
      1.261;


    items.push({
      material_id:
        mat.id || null,

      material_name:
        mat.name || 'VG (Auto)',

      material_type:
        'vegetable_glycerin',

      isAuto:
        true,

      autoType:
        'VG',

      percentage:
        plainVg,

      pgContribution:
        0,

      vgContribution:
        plainVg,

      density,

      volumeMl,

      gram:
        volumeMl *
        density,
    });
  }


  /**
   * ============================================================
   * 4. TOTALS
   * ============================================================
   */
  const totalPercent =
    items.reduce(
      (sum, i) =>
        sum +
        (Number(i.percentage) || 0),
      0
    );


  const totalVolume =
    items.reduce(
      (sum, i) =>
        sum +
        (Number(i.volumeMl) || 0),
      0
    );


  const totalGram =
    items.reduce(
      (sum, i) =>
        sum +
        (Number(i.gram) || 0),
      0
    );


  const totalPg =
    totalIngredientPg +
    Math.max(
      0,
      plainPg
    );


  const totalVg =
    totalIngredientVg +
    Math.max(
      0,
      plainVg
    );


  /**
   * ============================================================
   * 5. VALIDATION
   * ============================================================
   */
  const validation = {
    valid: true,
    errors: [],
    warnings: [],
  };


  if (
    Math.abs(
      targetPg +
      targetVg -
      100
    ) > 0.0001
  ) {
    validation.errors.push(
      `Target PG + VG = ${(
        targetPg +
        targetVg
      ).toFixed(
        2
      )}%, harus 100%`
    );

    validation.valid = false;
  }


  /**
   * Nicotine target requires nicotine material.
   */
  if (
    targetNic > 0 &&
    !nicotineMaterial
  ) {
    validation.errors.push(
      'Pilih nicotine base untuk target nicotine'
    );

    validation.valid = false;
  }


  if (
    targetNic > 0 &&
    nicotineMaterial &&
    !(
      Number(
        nicotineMaterial.nicotine_strength
      ) > 0
    )
  ) {
    validation.errors.push(
      'Nicotine strength pada Master Bahan belum tersedia'
    );

    validation.valid = false;
  }


  if (
    nicotinePercent >
    100 + 0.0001
  ) {
    validation.errors.push(
      `Kebutuhan nicotine ${nicotinePercent.toFixed(
        2
      )}% melebihi 100%. Gunakan nicotine base dengan strength lebih tinggi.`
    );

    validation.valid = false;
  }


  if (plainPg < -0.0001) {
    validation.errors.push(
      `Total bahan berbasis PG sebesar ${totalIngredientPg.toFixed(
        2
      )}%, melebihi Target PG ${targetPg.toFixed(
        2
      )}%. Kurangi bahan berbasis PG atau naikkan Target PG.`
    );

    validation.valid = false;
  }


  if (plainVg < -0.0001) {
    validation.errors.push(
      `Total bahan berbasis VG sebesar ${totalIngredientVg.toFixed(
        2
      )}%, melebihi Target VG ${targetVg.toFixed(
        2
      )}%. Kurangi bahan berbasis VG atau naikkan Target VG.`
    );

    validation.valid = false;
  }


  if (
    plainPg >= -0.0001 &&
    plainVg >= -0.0001 &&
    Math.abs(
      totalPercent -
      100
    ) > 0.0001
  ) {
    validation.errors.push(
      `Total formula ${totalPercent.toFixed(
        2
      )}%, harus 100%`
    );

    validation.valid = false;
  }


  /**
   * Warn if a legacy recipe still contains a manual nicotine ingredient
   * while automatic nicotine is also selected.
   *
   * This avoids silent double nicotine.
   */
  const manualNicotine =
    ingredients.find(
      (i) =>
        i.material_type ===
          'nicotine' &&
        !isPremixIng(i) &&
        Number(
          i.percentage
        ) > 0
    );


  if (
    manualNicotine &&
    nicotineMaterial &&
    targetNic > 0
  ) {
    validation.errors.push(
      'Nicotine terdeteksi dua kali: ingredient manual dan nicotine otomatis. Hapus nicotine manual dari Bahan Resep.'
    );

    validation.valid = false;
  }


  /**
   * ============================================================
   * RETURN
   * ============================================================
   */
  return {
    items,

    totalFlavor:
      totalFlavorPercent,

    totalIngredientPg,
    totalIngredientVg,

    plainPg,
    plainVg,

    totalPG:
      totalPg,

    totalVG:
      totalVg,

    totalVolume,
    totalGram,

    totalPercent,

    nicotineVolume,

    nicotinePercent,

    nicotineMaterialId:
      nicotineMaterial?.id ||
      null,

    pgNeeded:
      plainPg,

    vgNeeded:
      plainVg,

    breakdown,

    validation,
  };
}


/**
 * Check stock availability for production materials.
 */
export function checkStockAvailability(
  calculatedItems,
  stockBalances
) {
  return (
    calculatedItems || []
  ).map((item) => {
    const balance =
      stockBalances.find(
        (b) =>
          b.item_id ===
            item.material_id &&
          b.item_type ===
            'material'
      );


    const available =
      Number(
        balance?.available_quantity
      ) || 0;


    const required =
      Number(item.gram) ||
      Number(item.volumeMl) ||
      0;


    return {
      ...item,

      stockAvailable:
        available,

      stockSufficient:
        available >= required,
    };
  });
}