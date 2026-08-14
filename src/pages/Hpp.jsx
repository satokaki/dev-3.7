import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import SearchableSelect from '@/components/SearchableSelect';
import { Label } from '@/components/ui/label';
import {
  AlertTriangle,
  Box,
  Calculator,
  FlaskConical,
  Package,
  Stamp,
  Tag,
  TrendingUp,
} from 'lucide-react';
import { computeProductHpp } from '@/lib/hppCalculator';
import {
  formatCurrency as fmtMoney,
  formatQuantity as fmtQty,
} from '@/lib/format';

const FINISHED_TYPES = [
  'barang_siap_jual',
  'barang_belum_cukai',
  'barang_siap_labeling',
  'barang_siap_bottling',
];

function pickProductRecipe(recipes, productId) {
  return (
    (recipes || [])
      .filter(r => r.product_id === productId)
      .sort((a, b) => {
        const approvedDiff =
          (b.status === 'approved' ? 1 : 0) -
          (a.status === 'approved' ? 1 : 0);

        return (
          approvedDiff ||
          (Number(b.version) || 0) -
            (Number(a.version) || 0)
        );
      })[0] || null
  );
}

function findMaklonSourceProductId(stockLedger, resultProductId) {
  const output = (stockLedger || [])
    .filter(
      row =>
        row.item_id === resultProductId &&
        row.transaction_type === 'labeling_output'
    )
    .sort(
      (a, b) =>
        new Date(
          b.transaction_date ||
            b.created_date ||
            0
        ) -
        new Date(
          a.transaction_date ||
            a.created_date ||
            0
        )
    )[0];

  if (!output?.reference_id) return null;

  const input = (stockLedger || []).find(
    row =>
      row.reference_id === output.reference_id &&
      row.transaction_type === 'labeling_consumption' &&
      row.item_type === 'product'
  );

  return input?.item_id || null;
}

function StageCard({
  icon: Icon,
  title,
  subtitle,
  rows = [],
  subtotal = 0,
  perBottleNote,
  color,
}) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border bg-muted/40">
        <Icon className={`w-4 h-4 ${color}`} />

        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold leading-tight">
            {title}
          </div>

          {subtitle && (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {subtitle}
            </div>
          )}
        </div>

        <div className="text-right">
          <div className="text-[11px] text-muted-foreground">
            Subtotal
          </div>

          <div className="text-[13px] font-semibold tabular-nums">
            {fmtMoney(subtotal)}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="px-3.5 py-3 text-[12px] text-muted-foreground italic">
          Belum ada komponen terpetakan.
        </div>
      ) : (
        <table className="w-full text-[12.5px]">
          <thead className="text-[11px] text-muted-foreground bg-muted/20">
            <tr>
              <th className="text-left font-medium px-3.5 py-1.5">
                Komponen
              </th>
              <th className="text-right font-medium px-2 py-1.5">
                Qty
              </th>
              <th className="text-right font-medium px-2 py-1.5">
                Harga Satuan
              </th>
              <th className="text-right font-medium px-3.5 py-1.5">
                Subtotal
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row, index) => (
              <tr
                key={`${row.materialId || row.materialCode || index}-${index}`}
                className="border-t border-border/60"
              >
                <td className="px-3.5 py-1.5">
                  <div className="font-medium leading-tight">
                    {row.materialName}
                  </div>

                  <div className="text-[10.5px] text-muted-foreground font-mono">
                    {row.materialCode || '—'}
                    {row.isAuto ? ' · auto' : ''}
                  </div>
                </td>

                <td className="text-right px-2 py-1.5 tabular-nums">
                  {fmtQty(row.qty, row.unitLabel)}
                </td>

                <td className="text-right px-2 py-1.5 tabular-nums text-muted-foreground">
                  {fmtMoney(row.unitCost)}
                </td>

                <td className="text-right px-3.5 py-1.5 tabular-nums font-medium">
                  {fmtMoney(row.cost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {perBottleNote && (
        <div className="px-3.5 py-1.5 border-t border-border/60 bg-muted/20 text-[11.5px] text-muted-foreground">
          {perBottleNote}
        </div>
      )}
    </div>
  );
}

export default function Hpp() {
  const { toast } = useToast();

  const [products, setProducts] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [recipes, setRecipes] = useState([]);

  const [ingredients, setIngredients] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [stockLedger, setStockLedger] = useState([]);

  const [recipe, setRecipe] = useState(null);
  const [recipeSourceProductId, setRecipeSourceProductId] =
    useState('');

  const [productId, setProductId] = useState('');
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);

    try {
      const [
        productRows,
        materialRows,
        recipeRows,
      ] = await Promise.all([
        base44.entities.Product.list(
          '-created_date',
          500
        ),
        base44.entities.Material.list(
          '-created_date',
          500
        ),
        base44.entities.Recipe.list(
          '-created_date',
          500
        ),
      ]);

      setProducts(productRows || []);
      setMaterials(materialRows || []);

      setRecipes(
        (recipeRows || []).filter(
          row =>
            row.recipe_type ===
            'FINISHED_PRODUCT'
        )
      );
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal memuat data HPP',
        description: error?.message || '',
      });
    } finally {
      setLoadingMeta(false);
    }
  }, [toast]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  const product = useMemo(
    () =>
      products.find(
        item => item.id === productId
      ) || null,
    [products, productId]
  );

  useEffect(() => {
    if (!product) {
      setRecipe(null);
      setRecipeSourceProductId('');
      setIngredients([]);
      setMappings([]);
      setStockLedger([]);
      return;
    }

    let alive = true;

    (async () => {
      setLoadingDetail(true);

      try {
        const [maps, ledger] =
          await Promise.all([
            base44.entities.ProductComponentMapping.filter({
              product_id: product.id,
            }),
            base44.entities.StockLedger.list(
              '-created_date',
              1000
            ),
          ]);

        if (!alive) return;

        let selectedRecipe =
          pickProductRecipe(
            recipes,
            product.id
          );

        let sourceProductId =
          product.id;

        if (!selectedRecipe) {
          const maklonSourceId =
            findMaklonSourceProductId(
              ledger,
              product.id
            );

          if (maklonSourceId) {
            const sourceRecipe =
              pickProductRecipe(
                recipes,
                maklonSourceId
              );

            if (sourceRecipe) {
              selectedRecipe =
                sourceRecipe;

              sourceProductId =
                maklonSourceId;
            }
          }
        }

        const recipeIngredients =
          selectedRecipe
            ? await base44.entities.RecipeIngredient.filter({
                recipe_id:
                  selectedRecipe.id,
              })
            : [];

        if (!alive) return;

        setMappings(maps || []);
        setStockLedger(ledger || []);
        setRecipe(selectedRecipe);
        setRecipeSourceProductId(
          sourceProductId
        );
        setIngredients(
          recipeIngredients || []
        );
      } catch (error) {
        if (!alive) return;

        setRecipe(null);
        setRecipeSourceProductId('');
        setIngredients([]);
        setMappings([]);
        setStockLedger([]);

        toast({
          variant: 'destructive',
          title:
            'Gagal memuat detail HPP',
          description:
            error?.message || '',
        });
      } finally {
        if (alive) {
          setLoadingDetail(false);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [product, recipes, toast]);

  const pgMaterial = useMemo(
    () =>
      materials.find(
        material =>
          material.material_category ===
          'propylene_glycol'
      ),
    [materials]
  );

  const vgMaterial = useMemo(
    () =>
      materials.find(
        material =>
          material.material_category ===
          'vegetable_glycerin'
      ),
    [materials]
  );

  const hpp = useMemo(
    () =>
      computeProductHpp({
        product,
        recipe,
        ingredients,
        materials,
        mappings,
        pgMaterial,
        vgMaterial,
        stockLedger,
      }),
    [
      product,
      recipe,
      ingredients,
      materials,
      mappings,
      pgMaterial,
      vgMaterial,
      stockLedger,
    ]
  );

  const recipeSourceProduct = useMemo(
    () =>
      products.find(
        item =>
          item.id ===
          recipeSourceProductId
      ) || null,
    [products, recipeSourceProductId]
  );

  const isMaklonRecipe =
    !!product &&
    !!recipe &&
    !!recipeSourceProductId &&
    recipeSourceProductId !== product.id;

  const productOptions = useMemo(() => {
    const finished = products.filter(
      item =>
        FINISHED_TYPES.includes(
          item.product_type
        )
    );

    const source =
      finished.length
        ? finished
        : products;

    return source.map(item => ({
      value: item.id,
      label:
        `${item.name}` +
        `${
          item.brand_name
            ? ` · ${item.brand_name}`
            : ''
        }` +
        `${
          item.bottle_size
            ? ` (${item.bottle_size}ml)`
            : ''
        }`,
      keywords:
        `${item.code || ''} ${item.name || ''} ${item.brand_name || ''}`,
    }));
  }, [products]);

  const finalHpp = useMemo(() => {
    if (
      !product?.id ||
      !stockLedger?.length
    ) {
      return 0;
    }

    const finalRows =
      stockLedger
        .filter(
          row =>
            row.item_id === product.id &&
            row.inventory_status ===
              'READY_FOR_SALE' &&
            Number(row.unit_cost) > 0
        )
        .sort(
          (a, b) =>
            new Date(
              b.transaction_date ||
                b.created_date ||
                0
            ) -
            new Date(
              a.transaction_date ||
                a.created_date ||
                0
            )
        );

    return (
      Number(
        finalRows[0]?.unit_cost
      ) || 0
    );
  }, [product, stockLedger]);

  const sourceLabel =
    hpp?.useActual
      ? `Aktual · ${
          hpp.actualHpp
            ?.transactionType ||
          'StockLedger'
        }`
      : isMaklonRecipe
        ? `Standar · Recipe ${
            recipeSourceProduct
              ?.name ||
            'produk sumber'
          } + Mapping ${
            product?.name ||
            'produk hasil'
          }`
        : 'Standar / Mapping';

  return (
    <div className="p-5 max-w-[1100px] mx-auto">
      <PageHeader
        title="HPP Produk"
        description="HPP aktual dari transaksi jika tersedia. Produk maklon dapat memakai recipe produk sumber dan mapping produk hasil."
      />

      <div className="rounded-lg border border-border bg-card p-4 mb-4">
        <Label className="text-[12.5px] mb-1.5">
          Pilih Produk
        </Label>

        {loadingMeta ? (
          <div className="h-9 bg-muted/40 rounded animate-pulse" />
        ) : (
          <SearchableSelect
            value={productId}
            onValueChange={setProductId}
            options={productOptions}
            placeholder="Cari produk..."
            className="h-9"
          />
        )}
      </div>

      {!product &&
        !loadingMeta && (
          <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground text-[13px]">
            Pilih produk untuk melihat rincian HPP.
          </div>
        )}

      {product &&
        loadingDetail && (
          <div className="rounded-lg border border-border bg-card p-6 mb-4">
            <div className="h-5 w-40 bg-muted rounded animate-pulse mb-3" />
            <div className="h-4 w-72 bg-muted rounded animate-pulse" />
          </div>
        )}

      {product &&
        hpp &&
        !loadingDetail && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-[11px] text-muted-foreground">
                  Ukuran Botol
                </div>

                <div className="text-[16px] font-semibold tabular-nums mt-0.5">
                  {hpp.bottleSize || '—'}
                  {hpp.bottleSize
                    ? ' ml'
                    : ''}
                </div>

                <div className="mt-2 pt-2 border-t border-border/60">
                  <div className="text-[10.5px] text-muted-foreground">
                    HPP Final
                  </div>

                  <div className="text-[14px] font-semibold tabular-nums text-emerald-600">
                    {finalHpp > 0
                      ? fmtMoney(finalHpp)
                      : '—'}
                  </div>

                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    READY_FOR_SALE
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-[11px] text-muted-foreground">
                  HPP / Botol

                  {hpp.useActual && (
                    <span className="ml-1 font-semibold text-emerald-600">
                      · Aktual
                    </span>
                  )}
                </div>

                <div className="text-[16px] font-semibold tabular-nums mt-0.5 text-primary">
                  {fmtMoney(
                    hpp.hppPerBottle
                  )}
                </div>

                <div className="text-[10.5px] text-muted-foreground mt-0.5">
                  {sourceLabel}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-[11px] text-muted-foreground">
                  Harga Jual
                </div>

                <div className="text-[16px] font-semibold tabular-nums mt-0.5">
                  {fmtMoney(
                    hpp.salePrice
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-[11px] text-muted-foreground">
                  Margin / Botol
                </div>

                <div
                  className={`text-[16px] font-semibold tabular-nums mt-0.5 ${
                    hpp.margin >= 0
                      ? 'text-emerald-600'
                      : 'text-destructive'
                  }`}
                >
                  {fmtMoney(
                    hpp.margin
                  )}

                  {hpp.salePrice > 0 && (
                    <span className="text-[11px] font-normal text-muted-foreground ml-1">
                      (
                      {hpp.marginPct.toFixed(
                        1
                      )}
                      %)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {isMaklonRecipe && (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2.5 mb-4 text-[12px] text-blue-700">
                Produk hasil{' '}
                <strong>
                  {product.name}
                </strong>{' '}
                menggunakan Recipe dari produk sumber{' '}
                <strong>
                  {recipeSourceProduct?.name ||
                    'produk sumber'}
                </strong>
                . Mapping botol, box, label, dan cukai tetap menggunakan produk hasil.
              </div>
            )}

            {!hpp.hasRecipe &&
              !hpp.useActual && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 mb-4 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />

                  <div className="text-[12px] text-amber-700">
                    Tidak ditemukan Recipe langsung maupun Recipe produk sumber.
                    Mapping produk tetap dihitung. Jika sudah ada output transaksi dengan unit_cost,
                    HPP aktual tetap dapat dibaca dari StockLedger.
                  </div>
                </div>
              )}

            {hpp.hasRecipe &&
              hpp.validation &&
              !hpp.validation.valid && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 mb-4 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />

                  <div className="text-[12px] text-amber-700">
                    Resep memiliki validasi yang belum lolos:{' '}
                    {hpp.validation.errors.join(
                      '; '
                    )}
                  </div>
                </div>
              )}

            <div className="mb-3">
              <StageCard
                icon={FlaskConical}
                color="text-blue-600"
                title="1. Bahan Bulk (Mixing)"
                subtitle={
                  recipe
                    ? `${
                        isMaklonRecipe
                          ? 'Recipe sumber'
                          : 'Recipe'
                      } ${recipe.code || ''} v${recipe.version || 1} · target ${hpp.volume} ml`
                    : 'Tidak ada Recipe'
                }
                rows={hpp.bulkRows}
                subtotal={hpp.bulkTotal}
                perBottleNote={`Per botol: ${fmtMoney(
                  hpp.bulkPerBottle
                )}`}
              />
            </div>

            <div className="mb-3">
              <StageCard
                icon={Package}
                color="text-violet-600"
                title="2. Botol (Bottling)"
                subtitle={
                  hpp.useActual &&
                  hpp.actualHpp?.transactionType ===
                    'bottling_output'
                    ? 'Cost aktual dari transaksi Bottling'
                    : 'Komponen botol dari mapping produk hasil'
                }
                rows={hpp.bottleRows}
                subtotal={hpp.bottleTotal}
                perBottleNote={`Per botol: ${fmtMoney(
                  hpp.bottleTotal
                )}`}
              />
            </div>

            <div className="mb-3">
              <StageCard
                icon={Box}
                color="text-orange-600"
                title="3. Box (Kemasan Luar)"
                subtitle="Komponen box/kemasan dari mapping produk hasil"
                rows={hpp.boxRows}
                subtotal={hpp.boxTotal}
                perBottleNote={`Per botol: ${fmtMoney(
                  hpp.boxTotal
                )}`}
              />
            </div>

            <div className="mb-3">
              <StageCard
                icon={Tag}
                color="text-pink-600"
                title="4. Label / Stiker (Labeling)"
                subtitle={
                  hpp.useActual &&
                  hpp.actualHpp?.transactionType ===
                    'labeling_output'
                    ? 'Cost aktual dari transaksi Labeling'
                    : 'Komponen label dari mapping produk hasil'
                }
                rows={hpp.labelRows}
                subtotal={hpp.labelTotal}
                perBottleNote={`Per botol: ${fmtMoney(
                  hpp.labelTotal
                )}`}
              />
            </div>

            <div className="mb-3">
              <StageCard
                icon={Stamp}
                color="text-amber-600"
                title="5. Pita Cukai (Cukai)"
                subtitle={
                  hpp.useActual &&
                  hpp.actualHpp?.transactionType ===
                    'excise_output'
                    ? 'Cost aktual dari transaksi Cukai'
                    : 'Komponen pita cukai dari mapping produk hasil'
                }
                rows={hpp.exciseRows}
                subtotal={hpp.exciseTotal}
                perBottleNote={`Per botol: ${fmtMoney(
                  hpp.exciseTotal
                )}`}
              />
            </div>

            <div className="rounded-lg border-2 border-primary bg-primary/5 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Calculator className="w-4 h-4 text-primary" />

                <div className="text-[13px] font-semibold">
                  Akumulasi HPP per Botol
                </div>
              </div>

              <div className="space-y-1.5 text-[12.5px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Bulk / Tahap Sebelumnya
                  </span>

                  <span className="tabular-nums">
                    {fmtMoney(
                      hpp.bulkPerBottle
                    )}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Botol
                  </span>

                  <span className="tabular-nums">
                    {fmtMoney(
                      hpp.bottleTotal
                    )}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Box
                  </span>

                  <span className="tabular-nums">
                    {fmtMoney(
                      hpp.boxTotal
                    )}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Label / Stiker
                  </span>

                  <span className="tabular-nums">
                    {fmtMoney(
                      hpp.labelTotal
                    )}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Pita Cukai / Kemasan
                  </span>

                  <span className="tabular-nums">
                    {fmtMoney(
                      hpp.exciseTotal
                    )}
                  </span>
                </div>

                <div className="border-t border-primary/20 pt-1.5 flex justify-between items-center">
                  <span className="font-semibold">
                    Total HPP / Botol
                  </span>

                  <span className="text-[16px] font-bold tabular-nums text-primary">
                    {fmtMoney(
                      hpp.hppPerBottle
                    )}
                  </span>
                </div>

                {hpp.salePrice > 0 && (
                  <div className="flex justify-between items-center pt-1">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <TrendingUp className="w-3.5 h-3.5" />
                      Margin
                    </span>

                    <span
                      className={`tabular-nums font-semibold ${
                        hpp.margin >= 0
                          ? 'text-emerald-600'
                          : 'text-destructive'
                      }`}
                    >
                      {fmtMoney(
                        hpp.margin
                      )}{' '}
                      (
                      {hpp.marginPct.toFixed(
                        1
                      )}
                      %)
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 text-[11px] text-muted-foreground">
              {hpp.useActual ? (
                <>
                  HPP{' '}
                  <span className="font-medium text-emerald-600">
                    aktual
                  </span>{' '}
                  menggunakan snapshot{' '}
                  <span className="font-medium">
                    StockLedger output.unit_cost
                  </span>
                  {hpp.actualHpp?.batchNumber
                    ? ` · batch ${hpp.actualHpp.batchNumber}`
                    : ''}
                  . Recipe digunakan untuk rincian bahan, sedangkan mapping tetap berasal dari produk hasil.
                </>
              ) : isMaklonRecipe ? (
                <>
                  HPP standar menggunakan Recipe{' '}
                  <span className="font-medium">
                    {recipeSourceProduct?.name}
                  </span>{' '}
                  sebagai sumber formula dan ProductComponentMapping{' '}
                  <span className="font-medium">
                    {product.name}
                  </span>{' '}
                  sebagai sumber kemasan final.
                </>
              ) : (
                <>
                  HPP standar dihitung dari Recipe jika tersedia,
                  harga beli terakhir bahan, dan ProductComponentMapping produk.
                </>
              )}
            </div>
          </>
        )}
    </div>
  );
}