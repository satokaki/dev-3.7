// Production.jsx PATCH — Brewer weighing must show ALL ingredients
// NON-DATA-AFFECTING for stock/ledger. It may repair missing ProductionMaterial
// work-instruction rows for an existing unposted order.
//
// Replace the existing openDetail with this version.

const openDetail = async (item) => {
  setEditing(item);

  let mats = await base44.entities.ProductionMaterial.filter({
    production_id: item.id
  });

  // Regression guard:
  // Some orders can contain only generated PG/VG rows while recipe ingredients
  // (essence, sweetener, nicotine, etc.) are missing from ProductionMaterial.
  // Recalculate the work instruction from the approved recipe and add ONLY
  // missing rows. Percentages remain internal; weighing UI still renders only
  // material_name + required_gram.
  if (
    ['siap_produksi', 'sedang_diproses', 'menunggu_bahan'].includes(item.status) &&
    item.recipe_id
  ) {
    const recipe = recipes.find(r => r.id === item.recipe_id);

    if (recipe) {
      const ingredients = await base44.entities.RecipeIngredient.filter({
        recipe_id: item.recipe_id
      });

      const matsById = Object.fromEntries(materials.map(m => [m.id, m]));
      const target = Number(item.target_volume || item.target_quantity || 0);
      let expectedItems = [];

      if (recipe.recipe_type === 'PREMIX') {
        const calc = calculatePremixQuantities({
          ingredients,
          targetQuantity: target,
          basis: recipe.calculation_basis || 'W_W',
          materialsById: matsById
        });

        expectedItems = calc.map(c => ({
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
          targetVolume: target,
          targetNicotine: recipe.target_nicotine,
          targetPG: recipe.target_pg,
          targetVG: recipe.target_vg,
          nicotineBaseStrength:
            ingredients.find(i => i.material_type === 'nicotine')?.nicotine_strength || 100,
          pgMaterial,
          vgMaterial
        });

        expectedItems = (result.items || []).map(calcItem => {
          const mat = matsById[calcItem.material_id];
          return isOneToOnePremix(mat)
            ? { ...calcItem, gram: Number(calcItem.volumeMl || 0) }
            : calcItem;
        });
      }

      const existingIds = new Set(mats.map(m => m.material_id));
      const missingItems = expectedItems.filter(
        expected => expected.material_id && !existingIds.has(expected.material_id)
      );

      if (missingItems.length > 0) {
        await base44.entities.ProductionMaterial.bulkCreate(
          missingItems.map(expected => ({
            production_id: item.id,
            material_id: expected.material_id,
            material_name:
              matsById[expected.material_id]?.name ||
              expected.material_name ||
              '',
            material_type: expected.material_type || '',
            percentage: Number(expected.percentage || 0),
            required_ml: Number(expected.volumeMl || 0),
            required_gram: Number(expected.gram || 0),
            actual_gram: 0,
            deviation_gram: 0,
            deviation_percent: 0,
            stock_available: 0,
            stock_sufficient: true
          }))
        );

        mats = await base44.entities.ProductionMaterial.filter({
          production_id: item.id
        });
      }
    }
  }

  setProductionMaterials(mats);

  const ck = {};
  const gMap = {};
  let expectedTotal = 0;
  let storedTotal = 0;

  const target = Number(item.target_volume || item.target_quantity || 0);
  const isFinished = item.production_type !== 'PREMIX';

  mats.forEach(m => {
    ck[m.material_id] = !!m.actual_gram && Number(m.actual_gram) > 0;

    const mat = materials.find(x => x.id === m.material_id);
    const density =
      Number(mat?.density || mat?.default_density) ||
      (
        m.material_type === 'vegetable_glycerin'
          ? 1.261
          : m.material_type === 'propylene_glycol'
            ? 1.036
            : 1
      );

    const effectiveDensity = isOneToOnePremix(mat) ? 1 : density;
    const recomputed =
      (Number(m.percentage || 0) / 100) * target * effectiveDensity;

    gMap[m.material_id] =
      m.required_gram != null ? Number(m.required_gram) : recomputed;

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
    Math.abs(expectedTotal - storedTotal) > 1
  );

  setDetailOpen(true);
};

// IMPORTANT UI RULE:
// Keep the weighing table as:
// productionMaterials.map(... material_name ... required_gram/gramasiMap ...)
// Do NOT filter rows using formulaHidden.
// formulaHidden may hide percentage/formula columns only.