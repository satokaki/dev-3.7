import React, { useEffect, useState, useCallback } from 'react';
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

import {
  Plus,
  Pencil,
  Copy,
  CheckCircle,
  Trash2,
  Calculator,
  X,
  Eye,
  EyeOff,
} from 'lucide-react';

import NumberInput from '@/components/NumberInput';

import { toNumber } from '@/lib/decimalInput';
import { calculateRecipe } from '@/lib/recipeCalculator';

import {
  createAuditLog,
} from '@/lib/stockUtils';

import {
  generateRecipeCode,
} from '@/lib/sequence';

import {
  validatePremixRecipe,
  buildPremixCompositionMap,
} from '@/lib/premix';

import RecipeIngredientPicker from '@/components/RecipeIngredientPicker';
import SearchableSelect from '@/components/SearchableSelect';

import { useAuth } from '@/lib/AuthContext';

import {
  canViewRecipe,
  canManageRecipeVisibility,
} from '@/lib/permissions';

import { ROLES } from '@/lib/roles';

import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';


const recipeTypes = [
  {
    value: 'FINISHED_PRODUCT',
    label: 'Produk Jadi',
  },
  {
    value: 'PREMIX',
    label: 'Premix',
  },
];


const calcBases = [
  {
    value: 'W_W',
    label: 'W/W (gram/total gram)',
  },
  {
    value: 'W_V',
    label: 'W/V (gram/total volume)',
  },
  {
    value: 'V_V',
    label: 'V/V (ml/total ml)',
  },
];


const nicotineForms = [
  {
    value: 'SALT',
    label: 'Salt Nicotine',
  },
  {
    value: 'FREEBASE',
    label: 'Freebase',
  },
];


const normalizeNicotineForm = (value) => {
  const v = String(value || '').trim().toUpperCase();
  return v === 'SALT' || v === 'FREEBASE' ? v : '';
};

const getMaterialNicotineForm = (material) => {
  const direct = normalizeNicotineForm(material?.nicotine_form);
  if (direct) return direct;

  const match = String(material?.notes || '').match(
    /\[\[NICOTINE_FORM:(SALT|FREEBASE)\]\]/i
  );
  return normalizeNicotineForm(match?.[1]);
};


const EMPTY_FORM = {
  code: '',
  name: '',

  brand_id: '',
  product_id: '',

  recipe_type: 'FINISHED_PRODUCT',

  output_material_id: '',
  calculation_basis: 'W_W',

  target_quantity: 1000,
  target_unit: 'gram',

  target_volume: 1000,

  /**
   * PATCH v3.4
   *
   * Nicotine sekarang dipilih secara khusus,
   * bukan dimasukkan manual di ingredients.
   */
  nicotine_form: '',
  nicotine_material_id: '',

  target_nicotine: 3,

  target_pg: 40,
  target_vg: 60,

  status: 'draft',
  notes: '',

  visibility_type: 'PUBLIC_INTERNAL',
  is_hidden: false,
  allow_production_without_formula_view: false,
  allowed_role_ids: [],

  ingredients: [],
};


export default function Recipes() {
  const { toast } = useToast();
  const { user } = useAuth();

  const canManageVis =
    canManageRecipeVisibility(user);

  const isAdmin =
    user?.role === 'admin';


  const [data, setData] =
    useState([]);

  const [brands, setBrands] =
    useState([]);

  const [products, setProducts] =
    useState([]);

  const [materials, setMaterials] =
    useState([]);


  const [loading, setLoading] =
    useState(true);

  const [modalOpen, setModalOpen] =
    useState(false);

  const [editing, setEditing] =
    useState(null);

  const [submitting, setSubmitting] =
    useState(false);

  const [calcResult, setCalcResult] =
    useState(null);

  const [visFilter, setVisFilter] =
    useState('all');


  const [form, setForm] =
    useState({
      ...EMPTY_FORM,
    });


  /**
   * ============================================================
   * LOAD DATA
   * ============================================================
   */
  const loadData =
    useCallback(async () => {
      setLoading(true);

      try {
        const [
          items,
          brs,
          prods,
          mats,
        ] = await Promise.all([
          base44.entities.Recipe.list(
            '-created_date',
            200
          ),

          base44.entities.Brand.filter({
            is_active: true,
          }),

          base44.entities.Product.filter({
            is_active: true,
          }),

          base44.entities.Material.list(
            '-created_date',
            2000
          ),
        ]);


        setData(items);
        setBrands(brs);
        setProducts(prods);


        setMaterials(
          mats.filter((m) => {
            if (
              m.is_active === false
            ) {
              return false;
            }

            const category =
              String(
                m.material_category || ''
              ).toLowerCase();

            return ![
              'box',
              'label',
              'excise',
            ].includes(category);
          })
        );
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


  /**
   * ============================================================
   * NICOTINE MASTER
   * ============================================================
   */

  const nicotineMaterials =
    !form.nicotine_form
      ? []
      : materials.filter((m) => {
          const strength = Number(m.nicotine_strength) || 0;
          if (strength <= 0) return false;

          const rawNicotine =
            m.material_type === 'RAW_MATERIAL' &&
            m.material_category === 'nicotine';

          const premixNicotine =
            m.material_type === 'PREMIX' &&
            !!getMaterialNicotineForm(m);

          if (!rawNicotine && !premixNicotine) return false;

          return (
            getMaterialNicotineForm(m) ===
            normalizeNicotineForm(form.nicotine_form)
          );
        });


  const selectedNicotineMaterial =
    materials.find(
      (m) =>
        m.id ===
        form.nicotine_material_id
    ) || null;


  /**
   * Finished Product tidak lagi memilih nicotine
   * melalui Bahan Resep.
   *
   * PREMIX tetap boleh memakai nicotine sebagai
   * ingredient manual karena premix mempunyai
   * use-case berbeda.
   */
  const ingredientPickerMaterials =
    form.recipe_type ===
    'FINISHED_PRODUCT'
      ? materials.filter(
          (m) =>
            m.material_category !==
            'nicotine'
        )
      : materials;


  /**
   * ============================================================
   * LIVE CALCULATION
   * ============================================================
   */
  useEffect(() => {
    /**
     * Calculator ini khusus finished product.
     */
    if (
      form.recipe_type === 'PREMIX'
    ) {
      setCalcResult(null);
      return;
    }


    if (
      !form.target_volume
    ) {
      setCalcResult(null);
      return;
    }


    const pgMaterial =
      materials.find(
        (m) =>
          m.material_category ===
          'propylene_glycol'
      );


    const vgMaterial =
      materials.find(
        (m) =>
          m.material_category ===
          'vegetable_glycerin'
      );


    /**
     * Nicotine tidak dikirim melalui ingredients.
     *
     * Ini mencegah double nicotine:
     *
     * manual ingredient
     * +
     * automatic nicotine.
     */
    const manualIngredients =
      form.ingredients
        .filter(
          (i) =>
            i.material_type !==
            'nicotine'
        )
        .map((i) => {
          const master =
            materials.find(
              (m) =>
                m.id ===
                i.material_id
            );


          return {
            ...i,

            /**
             * Master Bahan adalah
             * source of truth.
             */
            density:
              Number(
                master?.density ??
                master?.default_density
              ) ||
              Number(
                i.density
              ) ||
              1.0,

            pg_content:
              master?.pg_content ??
              i.pg_content ??
              0,

            vg_content:
              master?.vg_content ??
              i.vg_content ??
              0,

            nicotine_strength:
              master?.nicotine_strength ??
              i.nicotine_strength ??
              0,
          };
        });


    const result =
      calculateRecipe({
        ingredients:
          manualIngredients,

        targetVolume:
          toNumber(
            form.target_volume
          ),

        targetNicotine:
          toNumber(
            form.target_nicotine
          ),

        targetPG:
          toNumber(
            form.target_pg
          ),

        targetVG:
          toNumber(
            form.target_vg
          ),

        /**
         * PATCH v3.4
         *
         * Nicotine base dipilih langsung
         * dari Master Bahan.
         */
        nicotineMaterial:
          selectedNicotineMaterial,

        pgMaterial,
        vgMaterial,
      });


    setCalcResult(result);
  }, [
    form.recipe_type,
    form.ingredients,

    form.target_volume,
    form.target_nicotine,

    form.target_pg,
    form.target_vg,

    form.nicotine_material_id,

    materials,
    selectedNicotineMaterial,
  ]);


  /**
   * ============================================================
   * PG / VG COMPLEMENT
   * ============================================================
   */
  const complement = (v) =>
    v === ''
      ? ''
      : String(
          parseFloat(
            (
              100 -
              Number(v)
            ).toFixed(4)
          )
        );


  const onTargetPg = (v) =>
    setForm((f) => ({
      ...f,

      target_pg: v,
      target_vg:
        complement(v),
    }));


  const onTargetVg = (v) =>
    setForm((f) => ({
      ...f,

      target_vg: v,
      target_pg:
        complement(v),
    }));


  /**
   * ============================================================
   * OPEN ADD
   * ============================================================
   */
  const openAdd = () => {
    setEditing(null);

    setForm({
      ...EMPTY_FORM,

      ingredients: [],
      allowed_role_ids: [],
    });

    setCalcResult(null);

    setModalOpen(true);
  };


  /**
   * ============================================================
   * OPEN EDIT
   * ============================================================
   *
   * Backward compatibility:
   *
   * Recipe lama menyimpan nicotine sebagai RecipeIngredient.
   *
   * Ketika dibuka:
   *
   * 1. ingredient nicotine lama dibaca
   * 2. material_id dipindahkan ke selector nicotine
   * 3. nicotine dihapus dari ingredient manual UI
   *
   * Saat save nanti nicotine dibuat ulang otomatis.
   */
  const openEdit =
    async (item) => {
      setEditing(item);


      const ingredients =
        await base44.entities.RecipeIngredient.filter({
          recipe_id: item.id,
        });


      const nicotineIngredient =
        ingredients.find(
          (i) =>
            i.material_type ===
            'nicotine'
        );


      const nicotineMaster =
        nicotineIngredient
          ? materials.find(
              (m) =>
                m.id ===
                nicotineIngredient.material_id
            )
          : null;


      const manualIngredients =
        item.recipe_type ===
        'PREMIX'
          ? ingredients
          : ingredients.filter(
              (i) =>
                i.material_type !==
                'nicotine'
            );


      setForm({
        code:
          item.code,

        name:
          item.name,

        brand_id:
          item.brand_id || '',

        product_id:
          item.product_id || '',

        recipe_type:
          item.recipe_type ||
          'FINISHED_PRODUCT',

        output_material_id:
          item.output_material_id || '',

        calculation_basis:
          item.calculation_basis ||
          'W_W',

        target_quantity:
          item.target_quantity ||
          1000,

        target_unit:
          item.target_unit ||
          'gram',

        target_volume:
          item.target_volume ||
          1000,


        /**
         * Nicotine selector direkonstruksi
         * dari RecipeIngredient lama.
         */
        nicotine_form:
          getMaterialNicotineForm(nicotineMaster),

        nicotine_material_id:
          nicotineMaster?.id ||
          '',


        target_nicotine:
          item.target_nicotine ??
          0,

        target_pg:
          item.target_pg ??
          40,

        target_vg:
          item.target_vg ??
          60,


        status:
          item.status,

        notes:
          item.notes || '',


        visibility_type:
          item.visibility_type ||
          'PUBLIC_INTERNAL',

        is_hidden:
          !!item.is_hidden,

        allow_production_without_formula_view:
          !!item.allow_production_without_formula_view,

        allowed_role_ids:
          item.allowed_role_ids ||
          [],


        ingredients:
          manualIngredients.map(
            (i) => ({
              id:
                i.id,

              material_id:
                i.material_id,

              material_name:
                i.material_name,

              material_type:
                i.material_type,

              is_premix:
                i.is_premix ||
                (
                  i.material_type ===
                  'premix'
                ),

              percentage:
                i.percentage,

              density:
                i.density,

              pg_content:
                i.pg_content,

              vg_content:
                i.vg_content,

              nicotine_strength:
                i.nicotine_strength,

              concentration_value:
                i.concentration_value,

              mix_order:
                i.mix_order,

              notes:
                i.notes,
            })
          ),
      });


      setModalOpen(true);
    };


  /**
   * ============================================================
   * INGREDIENTS
   * ============================================================
   */
  const addIngredient = () => {
    setForm((f) => ({
      ...f,

      ingredients: [
        ...f.ingredients,

        {
          material_id: '',
          material_name: '',

          material_type:
            'flavor',

          percentage: '',

          density: 0,

          pg_content: 0,
          vg_content: 0,

          nicotine_strength: 0,

          mix_order:
            f.ingredients.length +
            1,
        },
      ],
    }));
  };


  const updateIngredient =
    (
      idx,
      field,
      value
    ) => {
      setForm((f) => {
        const ings =
          [...f.ingredients];


        if (
          field ===
          'material_id'
        ) {
          const mat =
            materials.find(
              (m) =>
                m.id === value
            );


          const isPremix =
            mat?.material_type ===
            'PREMIX';


          ings[idx] = {
            ...ings[idx],

            material_id:
              value,

            material_name:
              mat?.name || '',

            material_type:
              isPremix
                ? 'premix'
                : (
                    mat?.material_category ||
                    'flavor'
                  ),

            is_premix:
              isPremix,

            density:
              mat?.density ||
              mat?.default_density ||
              0,

            pg_content:
              mat?.pg_content ||
              0,

            vg_content:
              mat?.vg_content ||
              0,

            nicotine_strength:
              mat?.nicotine_strength ||
              0,

            concentration_value:
              mat?.concentration_value ||
              0,
          };
        } else {
          const keepString =
            field ===
            'percentage';


          ings[idx] = {
            ...ings[idx],

            [field]:
              keepString
                ? value
                : (
                    [
                      'density',
                      'mix_order',
                    ].includes(field)
                      ? Number(value)
                      : value
                  ),
          };
        }


        return {
          ...f,
          ingredients: ings,
        };
      });
    };


  const removeIngredient =
    (idx) => {
      setForm((f) => ({
        ...f,

        ingredients:
          f.ingredients.filter(
            (_, i) =>
              i !== idx
          ),
      }));
    };


  /**
   * ============================================================
   * SAVE
   * ============================================================
   */
  const handleSubmit =
    async () => {
      if (!form.name) {
        toast({
          variant:
            'destructive',

          title:
            'Nama resep wajib diisi',
        });

        return;
      }


      if (
        form.recipe_type !==
          'PREMIX' &&
        !form.brand_id
      ) {
        toast({
          variant:
            'destructive',

          title:
            'Merk wajib diisi untuk resep produk jadi',
        });

        return;
      }


      /**
       * PREMIX tetap wajib memiliki
       * ingredient manual.
       */
      if (
        form.recipe_type ===
          'PREMIX' &&
        form.ingredients.length ===
          0
      ) {
        toast({
          variant:
            'destructive',

          title:
            'Resep premix harus memiliki minimal 1 bahan',
        });

        return;
      }


      /**
       * Finished product:
       *
       * nicotine wajib dipilih hanya
       * bila target nicotine > 0.
       */
      if (
        form.recipe_type !==
          'PREMIX' &&
        toNumber(
          form.target_nicotine
        ) > 0 &&
        !form.nicotine_form
      ) {
        toast({
          variant:
            'destructive',

          title:
            'Jenis nicotine wajib dipilih',
        });

        return;
      }


      if (
        form.recipe_type !==
          'PREMIX' &&
        toNumber(
          form.target_nicotine
        ) > 0 &&
        !form.nicotine_material_id
      ) {
        toast({
          variant:
            'destructive',

          title:
            'Nicotine base wajib dipilih',
        });

        return;
      }


      /**
       * PREMIX validation lama.
       */
      if (
        form.recipe_type ===
        'PREMIX'
      ) {
        const outputMaterial =
          materials.find(
            (m) =>
              m.id ===
              form.output_material_id
          );


        const premixRecipes =
          data.filter(
            (r) =>
              r.recipe_type ===
                'PREMIX' &&
              r.id !==
                editing?.id
          );


        const allIngs =
          premixRecipes.length
            ? await base44.entities.RecipeIngredient.filter({
                recipe_id: {
                  $in:
                    premixRecipes.map(
                      (r) =>
                        r.id
                    ),
                },
              })
            : [];


        const premixMap =
          buildPremixCompositionMap(
            premixRecipes,
            allIngs
          );


        premixMap[
          form.output_material_id
        ] = {
          recipe: {
            id: 'current',
          },

          components:
            form.ingredients,
        };


        const v =
          validatePremixRecipe({
            recipe: form,

            ingredients:
              form.ingredients,

            outputMaterial,

            materialsById:
              Object.fromEntries(
                materials.map(
                  (m) => [
                    m.id,
                    m,
                  ]
                )
              ),

            premixMap,
          });


        if (!v.valid) {
          toast({
            variant:
              'destructive',

            title:
              'Resep premix tidak valid',

            description:
              v.errors[0],
          });

          return;
        }
      } else {
        /**
         * Finished Product harus punya
         * kalkulasi valid.
         */
        if (!calcResult) {
          toast({
            variant:
              'destructive',

            title:
              'Kalkulasi resep belum tersedia',
          });

          return;
        }


        if (
          !calcResult.validation.valid
        ) {
          toast({
            variant:
              'destructive',

            title:
              'Resep tidak valid',

            description:
              calcResult.validation.errors[
                0
              ],
          });

          return;
        }
      }


      setSubmitting(true);


      try {
        const brand =
          brands.find(
            (b) =>
              b.id ===
              form.brand_id
          );


        const product =
          products.find(
            (p) =>
              p.id ===
              form.product_id
          );


        const totalFlavor =
          form.ingredients
            .filter(
              (i) =>
                i.material_type ===
                'flavor'
            )
            .reduce(
              (sum, i) =>
                sum +
                toNumber(
                  i.percentage
                ),
              0
            );


        let recipeCode =
          form.code;


        if (!editing) {
          recipeCode =
            await generateRecipeCode();
        }


        const outputMaterial =
          materials.find(
            (m) =>
              m.id ===
              form.output_material_id
          );


        /**
         * Recipe entity tetap memakai
         * field lama.
         *
         * Nicotine selection dipersist
         * melalui RecipeIngredient auto,
         * agar backend/schema lama dan
         * Production tetap kompatibel.
         */
        const payload = {
          code:
            recipeCode,

          name:
            form.name,

          brand_id:
            form.brand_id,

          brand_name:
            brand?.name || '',

          product_id:
            form.product_id,

          product_name:
            product?.name || '',

          recipe_type:
            form.recipe_type,

          output_material_id:
            form.output_material_id ||
            '',

          output_material_name:
            outputMaterial?.name ||
            '',

          calculation_basis:
            form.calculation_basis ||
            'W_W',

          target_quantity:
            toNumber(
              form.target_quantity
            ),

          target_unit:
            form.target_unit,

          version:
            editing?.version ||
            1,

          target_volume:
            toNumber(
              form.target_volume
            ),

          target_nicotine:
            toNumber(
              form.target_nicotine
            ),

          target_pg:
            toNumber(
              form.target_pg
            ),

          target_vg:
            toNumber(
              form.target_vg
            ),

          total_flavor:
            totalFlavor,

          status:
            form.status,

          notes:
            form.notes,

          visibility_type:
            form.visibility_type ||
            'PUBLIC_INTERNAL',

          is_hidden:
            !!form.is_hidden,

          allow_production_without_formula_view:
            !!form.allow_production_without_formula_view,

          allowed_role_ids:
            form.allowed_role_ids ||
            [],
        };


        let recipeId;


        if (editing) {
          await base44.entities.Recipe.update(
            editing.id,
            payload
          );

          recipeId =
            editing.id;
        } else {
          const created =
            await base44.entities.Recipe.create(
              payload
            );

          recipeId =
            created.id;
        }


        /**
         * Existing RecipeIngredients
         * di-rebuild.
         */
        if (editing) {
          const existing =
            await base44.entities.RecipeIngredient.filter({
              recipe_id:
                recipeId,
            });


          if (
            existing.length >
            0
          ) {
            await base44.entities.RecipeIngredient.deleteMany({
              id: {
                $in:
                  existing.map(
                    (e) =>
                      e.id
                  ),
              },
            });
          }
        }


        /**
         * ======================================================
         * BUILD INGREDIENTS TO SAVE
         * ======================================================
         *
         * Manual ingredients tetap sama.
         *
         * Nicotine AUTO diubah kembali
         * menjadi RecipeIngredient internal.
         *
         * Dengan cara ini:
         *
         * - user tidak input nicotine manual
         * - recipeCalculator auto
         * - Production tetap membaca nicotine
         * - HPP tetap membaca nicotine
         * - stock consumption tetap bekerja
         * - traceability tetap bekerja
         */
        const ingredientsToSave =
          form.ingredients.map(
            (i) => ({
              recipe_id:
                recipeId,

              material_id:
                i.material_id,

              material_name:
                i.material_name,

              material_type:
                i.material_type,

              is_premix:
                !!i.is_premix,

              concentration_value:
                Number(
                  i.concentration_value
                ) || 0,

              percentage:
                toNumber(
                  i.percentage
                ),

              density:
                Number(
                  i.density
                ),

              pg_content:
                Number(
                  i.pg_content
                ),

              vg_content:
                Number(
                  i.vg_content
                ),

              nicotine_strength:
                Number(
                  i.nicotine_strength
                ),

              mix_order:
                i.mix_order ||
                0,

              notes:
                i.notes || '',
            })
          );


        /**
         * FINISHED PRODUCT:
         * tambahkan nicotine hasil AUTO calculation.
         */
        if (
          form.recipe_type ===
            'FINISHED_PRODUCT' &&
          toNumber(
            form.target_nicotine
          ) > 0
        ) {
          const autoNicotine =
            calcResult?.items?.find(
              (i) =>
                i.autoType ===
                'NICOTINE'
            );


          if (!autoNicotine) {
            throw new Error(
              'Hasil kalkulasi nicotine otomatis tidak ditemukan.'
            );
          }


          ingredientsToSave.push({
            recipe_id:
              recipeId,

            material_id:
              autoNicotine.material_id,

            material_name:
              autoNicotine.material_name,

            /**
             * Tetap "nicotine"
             * agar Production/HPP lama
             * tetap mengenalinya.
             */
            material_type:
              'nicotine',

            is_premix:
              false,

            concentration_value:
              0,

            percentage:
              Number(
                autoNicotine.percentage
              ) || 0,

            density:
              Number(
                autoNicotine.density
              ) || 0,

            pg_content:
              Number(
                autoNicotine.pg_content
              ) || 0,

            vg_content:
              Number(
                autoNicotine.vg_content
              ) || 0,

            nicotine_strength:
              Number(
                autoNicotine.nicotine_strength
              ) || 0,

            /**
             * Nicotine ditaruh sebelum
             * PG/VG auto dalam urutan mixing.
             */
            mix_order:
              90,

            notes:
              `AUTO NICOTINE · ${normalizeNicotineForm(form.nicotine_form)}`,
          });
        }


        /**
         * Save RecipeIngredient.
         */
        if (
          ingredientsToSave.length >
          0
        ) {
          await base44.entities.RecipeIngredient.bulkCreate(
            ingredientsToSave
          );
        }


        await createAuditLog({
          module:
            'Resep',

          action:
            editing
              ? 'Edit'
              : 'Tambah',

          entity_type:
            'Recipe',

          entity_id:
            recipeId,

          reference_number:
            recipeCode,
        });


        if (
          editing &&
          canManageVis
        ) {
          const visChanged =
            (
              editing.visibility_type ||
              'PUBLIC_INTERNAL'
            ) !==
              (
                form.visibility_type ||
                'PUBLIC_INTERNAL'
              ) ||

            !!editing.is_hidden !==
              !!form.is_hidden ||

            JSON.stringify(
              editing.allowed_role_ids ||
              []
            ) !==
              JSON.stringify(
                form.allowed_role_ids ||
                []
              );


          if (visChanged) {
            await createAuditLog({
              module:
                'Resep',

              action:
                'RECIPE_VISIBILITY_CHANGED',

              entity_type:
                'Recipe',

              entity_id:
                recipeId,

              reference_number:
                recipeCode,

              notes:
                `${
                  editing.visibility_type ||
                  'PUBLIC_INTERNAL'
                } -> ${
                  form.visibility_type
                }; hidden ${
                  !!editing.is_hidden
                } -> ${
                  !!form.is_hidden
                }`,
            });
          }
        }


        toast({
          title:
            editing
              ? 'Resep diperbarui'
              : 'Resep dibuat',
        });


        setModalOpen(false);

        loadData();
      } catch (e) {
        toast({
          variant:
            'destructive',

          title:
            'Gagal menyimpan',

          description:
            e.message,
        });
      } finally {
        setSubmitting(false);
      }
    };


  /**
   * ============================================================
   * APPROVE
   * ============================================================
   */
  const handleApprove =
    async (item) => {
      if (
        !confirm(
          `Setujui resep "${item.name}"?`
        )
      ) {
        return;
      }


      try {
        await base44.entities.Recipe.update(
          item.id,
          {
            status:
              'approved',

            approval_date:
              new Date().toISOString(),

            approved_by:
              'Admin',
          }
        );


        await createAuditLog({
          module:
            'Resep',

          action:
            'Approve',

          entity_type:
            'Recipe',

          entity_id:
            item.id,

          reference_number:
            item.code,
        });


        toast({
          title:
            'Resep disetujui',
        });


        loadData();
      } catch {
        toast({
          variant:
            'destructive',

          title:
            'Gagal menyetujui',
        });
      }
    };


  /**
   * ============================================================
   * DUPLICATE
   * ============================================================
   */
  const handleDuplicate =
    async (item) => {
      try {
        const ingredients =
          await base44.entities.RecipeIngredient.filter({
            recipe_id:
              item.id,
          });


        const dupCode =
          await generateRecipeCode();


        const newRecipe =
          await base44.entities.Recipe.create({
            ...item,

            code:
              dupCode,

            name:
              `${item.name} (Copy)`,

            status:
              'draft',

            version:
              1,

            id:
              undefined,

            approved_by:
              '',

            approval_date:
              '',
          });


        if (
          ingredients.length >
          0
        ) {
          await base44.entities.RecipeIngredient.bulkCreate(
            ingredients.map(
              (i) => ({
                ...i,

                recipe_id:
                  newRecipe.id,

                id:
                  undefined,
              })
            )
          );
        }


        toast({
          title:
            'Resep diduplikasi',
        });


        loadData();
      } catch {
        toast({
          variant:
            'destructive',

          title:
            'Gagal menduplikasi',
        });
      }
    };


  /**
   * ============================================================
   * DELETE / ARCHIVE
   * ============================================================
   */
  const handleDelete =
    async (item) => {
      if (
        !confirm(
          `Hapus resep "${item.name}"?\n\nResep yang sudah pernah dipakai produksi akan diarsipkan (nonaktif) dan tidak bisa dipakai untuk produksi baru. Histori transaksi lama tetap aman.`
        )
      ) {
        return;
      }


      try {
        const draftProductions =
          await base44.entities.ProductionOrder.filter({
            recipe_id:
              item.id,

            status: {
              $in: [
                'draft',
                'menunggu_bahan',
                'siap_produksi',
                'sedang_diproses',
              ],
            },
          });


        if (
          draftProductions.length >
          0
        ) {
          toast({
            variant:
              'destructive',

            title:
              'Resep tidak dapat dihapus',

            description:
              `Resep sedang digunakan pada ${draftProductions.length} transaksi produksi Draft/Aktif. Selesaikan atau batalkan transaksi tersebut terlebih dahulu.`,
          });

          return;
        }


        await base44.entities.Recipe.update(
          item.id,
          {
            status:
              'inactive',
          }
        );


        await createAuditLog({
          module:
            'Resep',

          action:
            'Hapus/Arsip',

          entity_type:
            'Recipe',

          entity_id:
            item.id,

          reference_number:
            item.code,
        });


        toast({
          title:
            'Resep berhasil diarsipkan',

          description:
            'Tidak lagi tersedia untuk produksi baru.',
        });


        loadData();
      } catch (e) {
        toast({
          variant:
            'destructive',

          title:
            'Gagal menghapus',

          description:
            e.message,
        });
      }
    };


  /**
   * ============================================================
   * VISIBILITY
   * ============================================================
   */
  const toggleHide =
    async (row) => {
      if (
        !confirm(
          row.is_hidden
            ? `Tampilkan resep "${row.name}"?`
            : `Sembunyikan resep "${row.name}" dari Brewer?`
        )
      ) {
        return;
      }


      try {
        await base44.entities.Recipe.update(
          row.id,
          {
            is_hidden:
              !row.is_hidden,
          }
        );


        await createAuditLog({
          module:
            'Resep',

          action:
            row.is_hidden
              ? 'RECIPE_UNHIDDEN'
              : 'RECIPE_HIDDEN',

          entity_type:
            'Recipe',

          entity_id:
            row.id,

          reference_number:
            row.code,

          notes:
            `is_hidden: ${!!row.is_hidden} -> ${!row.is_hidden}`,
        });


        toast({
          title:
            row.is_hidden
              ? 'Resep ditampilkan'
              : 'Resep disembunyikan dari Brewer',
        });


        loadData();
      } catch {
        toast({
          variant:
            'destructive',

          title:
            'Gagal mengubah visibilitas',
        });
      }
    };


  /**
   * ============================================================
   * TABLE
   * ============================================================
   */
  const columns = [
    {
      key: 'code',
      header: 'Kode',
      sortable: true,
      className:
        'font-mono font-medium',
    },

    {
      key: 'name',
      header: 'Nama Resep',
      sortable: true,
      className:
        'font-medium',
    },

    {
      key:
        'recipe_type',

      header:
        'Tipe',

      render:
        (row) =>
          row.recipe_type ===
          'PREMIX' ? (
            <span className="text-[11px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded font-semibold">
              Premix
            </span>
          ) : (
            <span className="text-[11px] px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-semibold">
              Produk Jadi
            </span>
          ),
    },

    {
      key:
        'brand_name',

      header:
        'Merk',

      render:
        (row) =>
          row.brand_name ||
          '—',
    },

    {
      key:
        'target_volume',

      header:
        'Target',

      render:
        (row) =>
          `${row.target_volume || 0} ml`,
    },

    {
      key:
        'target_nicotine',

      header:
        'Nic',

      render:
        (row) =>
          `${row.target_nicotine || 0} mg`,
    },

    {
      key:
        'version',

      header:
        'Versi',

      render:
        (row) =>
          `v${row.version || 1}`,
    },

    {
      key:
        'visibility',

      header:
        'Visibilitas',

      render:
        (row) => {
          if (
            row.is_hidden
          ) {
            return (
              <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">
                Brewer Tersembunyi
              </span>
            );
          }


          const vt =
            row.visibility_type ||
            'PUBLIC_INTERNAL';


          if (
            vt ===
            'ADMIN_ONLY'
          ) {
            return (
              <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-medium">
                Hanya Admin
              </span>
            );
          }


          if (
            vt ===
            'ROLE_RESTRICTED'
          ) {
            return (
              <span className="text-[10px] px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded font-medium">
                Role Tertentu
              </span>
            );
          }


          return (
            <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-medium">
              Semua User
            </span>
          );
        },
    },

    {
      key:
        'status',

      header:
        'Status',

      render:
        (row) => (
          <StatusBadge
            status={
              row.status
            }
          />
        ),
    },

    {
      key:
        'actions',

      header:
        '',

      width:
        '120px',

      render:
        (row) => (
          <div className="flex items-center gap-1">
            <button
              onClick={() =>
                openEdit(
                  row
                )
              }
              className="p-1.5 hover:bg-muted rounded"
              title="Edit"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>


            {isAdmin && (
              <button
                onClick={() =>
                  toggleHide(
                    row
                  )
                }
                className="p-1.5 hover:bg-amber-50 rounded text-amber-600"
                title={
                  row.is_hidden
                    ? 'Tampilkan'
                    : 'Sembunyikan dari Brewer'
                }
              >
                {row.is_hidden
                  ? (
                    <Eye className="w-3.5 h-3.5" />
                  )
                  : (
                    <EyeOff className="w-3.5 h-3.5" />
                  )}
              </button>
            )}


            {row.status ===
            'approved' ? (
              <span
                className="p-1.5 text-emerald-500"
                title="Disetujui"
              >
                <CheckCircle className="w-3.5 h-3.5" />
              </span>
            ) : (
              <button
                onClick={() =>
                  handleApprove(
                    row
                  )
                }
                className="p-1.5 hover:bg-emerald-50 rounded text-emerald-600"
                title="Setujui"
              >
                <CheckCircle className="w-3.5 h-3.5" />
              </button>
            )}


            <button
              onClick={() =>
                handleDuplicate(
                  row
                )
              }
              className="p-1.5 hover:bg-muted rounded"
              title="Duplikasi"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>


            {isAdmin && (
              <button
                onClick={() =>
                  handleDelete(
                    row
                  )
                }
                className="p-1.5 hover:bg-red-50 rounded text-red-500"
                title="Hapus/Arsipkan"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ),
    },
  ];


  const mcLabel = {
    flavor:
      'Flavor',

    propylene_glycol:
      'PG',

    vegetable_glycerin:
      'VG',

    nicotine:
      'Nicotine',

    sweetener:
      'Sweetener',

    cooling:
      'Cooling',

    additive:
      'Additive',

    premix:
      'Premix',

    lainnya:
      'Lainnya',
  };


  const tpPg =
    toNumber(
      form.target_pg
    );


  const tpVg =
    toNumber(
      form.target_vg
    );


  const visibleData =
    (
      isAdmin
        ? data
        : data.filter(
            (r) =>
              canViewRecipe(
                user,
                r
              )
          )
    ).filter((r) => {
      if (
        visFilter ===
        'all'
      ) {
        return true;
      }

      if (
        visFilter ===
        'public'
      ) {
        return (
          (
            r.visibility_type ||
            'PUBLIC_INTERNAL'
          ) ===
            'PUBLIC_INTERNAL' &&
          !r.is_hidden
        );
      }

      if (
        visFilter ===
        'admin_only'
      ) {
        return (
          r.visibility_type ===
          'ADMIN_ONLY'
        );
      }

      if (
        visFilter ===
        'restricted'
      ) {
        return (
          r.visibility_type ===
          'ROLE_RESTRICTED'
        );
      }

      if (
        visFilter ===
        'hidden'
      ) {
        return !!r.is_hidden;
      }

      return true;
    });


  /**
   * ============================================================
   * UI
   * ============================================================
   */
  return (
    <div className="p-5 max-w-[1400px] mx-auto">

      <PageHeader
        title="Master Resep"
        description="Formulasi resep e-liquid dengan kalkulasi otomatis"
        actions={
          <Button
            onClick={
              openAdd
            }
            size="sm"
            className="gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Tambah Resep
          </Button>
        }
      />


      <div className="flex items-center gap-2 mb-3">
        <Label className="text-[12.5px]">
          Filter Visibilitas:
        </Label>

        <Select
          value={
            visFilter
          }
          onValueChange={
            setVisFilter
          }
        >
          <SelectTrigger className="h-8 text-[12.5px] w-48">
            <SelectValue />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value="all">
              Semua Visibilitas
            </SelectItem>

            <SelectItem value="public">
              Semua User
            </SelectItem>

            <SelectItem value="admin_only">
              Hanya Admin
            </SelectItem>

            <SelectItem value="restricted">
              Role Tertentu
            </SelectItem>

            <SelectItem value="hidden">
              Disembunyikan dari Brewer
            </SelectItem>
          </SelectContent>
        </Select>
      </div>


      <DataTable
        columns={
          columns
        }
        data={
          visibleData
        }
        loading={
          loading
        }
        emptyMessage="Belum ada resep"
        searchKeys={[
          'code',
          'name',
          'brand_name',
        ]}
        searchPlaceholder="Cari resep..."
      />


      <FormModal
        open={
          modalOpen
        }
        onClose={() =>
          setModalOpen(
            false
          )
        }
        title={
          editing
            ? 'Edit Resep'
            : 'Tambah Resep'
        }
        onSubmit={
          handleSubmit
        }
        submitting={
          submitting
        }
        submitLabel="Simpan Resep"
        size="xl"
      >

        <div className="grid grid-cols-3 gap-3">

          <div className="col-span-2">
            <Label className="text-[12.5px] mb-1">
              Nama Resep *
            </Label>

            <Input
              value={
                form.name
              }
              onChange={(e) =>
                setForm({
                  ...form,
                  name:
                    e.target.value,
                })
              }
              className="h-9 text-[13px]"
            />
          </div>


          <div>
            <Label className="text-[12.5px] mb-1">
              Kode
            </Label>

            <Input
              value={
                editing
                  ? form.code
                  : ''
              }
              placeholder="Otomatis"
              className="h-9 text-[13px] font-mono bg-muted/40"
              disabled
              readOnly
            />
          </div>


          {form.recipe_type !==
            'PREMIX' && (
            <div>
              <Label className="text-[12.5px] mb-1">
                Merk *
              </Label>

              <Select
                value={
                  form.brand_id
                }
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    brand_id:
                      v,
                  })
                }
              >
                <SelectTrigger className="h-9 text-[13px]">
                  <SelectValue placeholder="Pilih merk" />
                </SelectTrigger>

                <SelectContent>
                  {brands.map(
                    (b) => (
                      <SelectItem
                        key={
                          b.id
                        }
                        value={
                          b.id
                        }
                      >
                        {b.name}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
          )}


          <div>
            <Label className="text-[12.5px] mb-1">
              Produk Terkait
            </Label>

            <SearchableSelect
              value={
                form.product_id
              }
              onValueChange={(v) =>
                setForm({
                  ...form,
                  product_id:
                    v,
                })
              }
              options={
                products.map(
                  (p) => ({
                    value:
                      p.id,

                    label:
                      `${p.name}${
                        p.brand_name
                          ? ` · ${p.brand_name}`
                          : ''
                      }${
                        p.bottle_size
                          ? ` (${p.bottle_size}ml)`
                          : ''
                      }`,

                    keywords:
                      `${p.code || ''} ${p.name || ''} ${p.brand_name || ''} ${p.bottle_size || ''}`,
                  })
                )
              }
              placeholder="Cari produk..."
              className="h-9 text-[13px]"
            />
          </div>


          <div>
            <Label className="text-[12.5px] mb-1">
              Tipe Resep
            </Label>

            <Select
              value={
                form.recipe_type
              }
              onValueChange={(v) =>
                setForm(
                  (f) => ({
                    ...f,

                    recipe_type:
                      v,

                    /**
                     * Jika berpindah ke premix,
                     * reset selector nicotine.
                     */
                    nicotine_form:
                      v ===
                      'PREMIX'
                        ? ''
                        : f.nicotine_form,

                    nicotine_material_id:
                      v ===
                      'PREMIX'
                        ? ''
                        : f.nicotine_material_id,
                  })
                )
              }
            >
              <SelectTrigger className="h-9 text-[13px]">
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                {recipeTypes.map(
                  (t) => (
                    <SelectItem
                      key={
                        t.value
                      }
                      value={
                        t.value
                      }
                    >
                      {t.label}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>


          {form.recipe_type ===
          'PREMIX' ? (
            <>
              <div>
                <Label className="text-[12.5px] mb-1">
                  Output Material *
                </Label>

                <Select
                  value={
                    form.output_material_id
                  }
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      output_material_id:
                        v,
                    })
                  }
                >
                  <SelectTrigger className="h-9 text-[13px]">
                    <SelectValue placeholder="Pilih bahan premix output" />
                  </SelectTrigger>

                  <SelectContent>
                    {materials
                      .filter(
                        (m) =>
                          m.material_type ===
                          'PREMIX'
                      )
                      .map(
                        (m) => (
                          <SelectItem
                            key={
                              m.id
                            }
                            value={
                              m.id
                            }
                          >
                            {m.name}
                          </SelectItem>
                        )
                      )}
                  </SelectContent>
                </Select>
              </div>


              <div>
                <Label className="text-[12.5px] mb-1">
                  Basis Perhitungan
                </Label>

                <Select
                  value={
                    form.calculation_basis
                  }
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      calculation_basis:
                        v,
                    })
                  }
                >
                  <SelectTrigger className="h-9 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    {calcBases.map(
                      (b) => (
                        <SelectItem
                          key={
                            b.value
                          }
                          value={
                            b.value
                          }
                        >
                          {b.label}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>


              <div>
                <Label className="text-[12.5px] mb-1">
                  Target Quantity
                </Label>

                <NumberInput
                  value={
                    form.target_quantity
                  }
                  onChange={(v) =>
                    setForm({
                      ...form,
                      target_quantity:
                        v,
                    })
                  }
                  maxDecimals={
                    3
                  }
                  className="h-9 text-[13px]"
                />
              </div>


              <div>
                <Label className="text-[12.5px] mb-1">
                  Satuan Target
                </Label>

                <Select
                  value={
                    form.target_unit
                  }
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      target_unit:
                        v,
                    })
                  }
                >
                  <SelectTrigger className="h-9 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="gram">
                      Gram
                    </SelectItem>

                    <SelectItem value="mililiter">
                      Mililiter
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <>

              <div>
                <Label className="text-[12.5px] mb-1">
                  Target Volume (ml)
                </Label>

                <NumberInput
                  value={
                    form.target_volume
                  }
                  onChange={(v) =>
                    setForm({
                      ...form,
                      target_volume:
                        v,
                    })
                  }
                  maxDecimals={
                    2
                  }
                  className="h-9 text-[13px]"
                />
              </div>


              {/* ============================
                  NICOTINE AUTO
                  ============================ */}

              <div>
                <Label className="text-[12.5px] mb-1">
                  Jenis Nicotine
                </Label>

                <Select
                  value={
                    form.nicotine_form
                  }
                  onValueChange={(v) =>
                    setForm(
                      (f) => ({
                        ...f,

                        nicotine_form:
                          normalizeNicotineForm(v),

                        /**
                         * Ganti Salt/Freebase:
                         * nicotine material harus
                         * dipilih ulang.
                         */
                        nicotine_material_id:
                          '',
                      })
                    )
                  }
                >
                  <SelectTrigger className="h-9 text-[13px]">
                    <SelectValue placeholder="Pilih Salt / Freebase" />
                  </SelectTrigger>

                  <SelectContent>
                    {nicotineForms.map(
                      (n) => (
                        <SelectItem
                          key={
                            n.value
                          }
                          value={
                            n.value
                          }
                        >
                          {n.label}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>


              <div>
                <Label className="text-[12.5px] mb-1">
                  Nicotine Base
                </Label>

                <SearchableSelect
                  value={
                    form.nicotine_material_id
                  }
                  onValueChange={(v) =>
                    setForm({
                      ...form,

                      nicotine_material_id:
                        v,
                    })
                  }
                  options={
                    nicotineMaterials.map(
                      (m) => ({
                        value:
                          m.id,

                        label:
                          `${m.name} · ${Number(
                            m.nicotine_strength
                          )} mg/ml`,

                        keywords:
                          `${m.code || ''} ${m.name || ''} ${m.nicotine_form || ''} ${m.nicotine_strength || ''}`,
                      })
                    )
                  }
                  placeholder={
                    form.nicotine_form
                      ? 'Cari nicotine base...'
                      : 'Pilih jenis nicotine dulu'
                  }
                  className="h-9 text-[13px]"
                />

                {selectedNicotineMaterial && (
                  <div className="mt-1 text-[10.5px] text-muted-foreground">
                    Strength{' '}
                    <span className="font-semibold">
                      {Number(
                        selectedNicotineMaterial.nicotine_strength
                      )} mg/ml
                    </span>

                    {' · '}

                    Density{' '}
                    <span className="font-semibold">
                      {Number(
                        selectedNicotineMaterial.density ??
                        selectedNicotineMaterial.default_density ??
                        0
                      ) || '—'} g/ml
                    </span>
                  </div>
                )}
              </div>


              <div>
                <Label className="text-[12.5px] mb-1">
                  Target Nicotine (mg/ml)
                </Label>

                <NumberInput
                  value={
                    form.target_nicotine
                  }
                  onChange={(v) =>
                    setForm({
                      ...form,
                      target_nicotine:
                        v,
                    })
                  }
                  maxDecimals={
                    2
                  }
                  min={
                    0
                  }
                  className="h-9 text-[13px]"
                />

                {calcResult &&
                  Number(
                    calcResult.nicotinePercent
                  ) > 0 && (
                  <div className="mt-1 text-[10.5px] text-emerald-700">
                    AUTO:{' '}
                    <span className="font-semibold tabular-nums">
                      {Number(
                        calcResult.nicotinePercent
                      ).toFixed(4)}%
                    </span>{' '}
                    nicotine base
                  </div>
                )}
              </div>


              <div>
                <Label className="text-[12.5px] mb-1">
                  Target PG (%)
                </Label>

                <NumberInput
                  value={
                    form.target_pg
                  }
                  onChange={
                    onTargetPg
                  }
                  max={
                    100
                  }
                  maxDecimals={
                    2
                  }
                  className="h-9 text-[13px]"
                />
              </div>


              <div>
                <Label className="text-[12.5px] mb-1">
                  Target VG (%)
                </Label>

                <NumberInput
                  value={
                    form.target_vg
                  }
                  onChange={
                    onTargetVg
                  }
                  max={
                    100
                  }
                  maxDecimals={
                    2
                  }
                  className="h-9 text-[13px]"
                />
              </div>
            </>
          )}

        </div>


        {/* ======================================================
            INGREDIENTS
            ====================================================== */}

        <div className="border-t pt-3 mt-3">
          <div className="flex items-center justify-between mb-2">

            <Label className="text-[12.5px] font-semibold flex items-center gap-1">
              <Calculator className="w-3.5 h-3.5" />
              Bahan Resep
            </Label>


            <Button
              type="button"
              onClick={
                addIngredient
              }
              size="sm"
              variant="outline"
              className="h-7 text-[12px] gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Tambah Bahan
            </Button>

          </div>


          {form.recipe_type ===
            'FINISHED_PRODUCT' && (
            <div className="text-[10.5px] text-muted-foreground mb-2">
              Nicotine, PG dan VG tidak perlu ditambahkan manual.
              Nicotine dihitung dari target mg/ml dan nicotine base;
              PG/VG dihitung otomatis sebagai balancer.
            </div>
          )}


          <div className="space-y-1.5 max-h-48 overflow-y-auto">

            {form.ingredients.length ===
              0 && (
              <div className="text-center py-4 text-[12px] text-muted-foreground border border-dashed rounded">
                Belum ada bahan manual.
                Klik "Tambah Bahan" untuk flavor, sweetener,
                cooling, additive atau premix.
              </div>
            )}


            {form.ingredients.map(
              (ing, idx) => (
                <div
                  key={
                    idx
                  }
                  className="grid grid-cols-[1fr_80px_80px_30px] gap-1.5 items-center"
                >

                  <RecipeIngredientPicker
                    materials={
                      ingredientPickerMaterials
                    }
                    value={
                      ing.material_id
                    }
                    onChange={(v) =>
                      updateIngredient(
                        idx,
                        'material_id',
                        v
                      )
                    }
                    excludeIds={
                      form.ingredients
                        .filter(
                          (_, i) =>
                            i !== idx
                        )
                        .map(
                          (i) =>
                            i.material_id
                        )
                        .filter(
                          Boolean
                        )
                    }
                  />


                  <NumberInput
                    placeholder="%"
                    value={
                      ing.percentage
                    }
                    onChange={(v) =>
                      updateIngredient(
                        idx,
                        'percentage',
                        v
                      )
                    }
                    max={
                      100
                    }
                    maxDecimals={
                      4
                    }
                    className="h-8 text-[12px]"
                  />


                  <span className="text-[10px] text-muted-foreground px-1">
                    {mcLabel[
                      ing.material_type
                    ] ||
                      ing.material_type}
                  </span>


                  <button
                    type="button"
                    onClick={() =>
                      removeIngredient(
                        idx
                      )
                    }
                    className="p-1 hover:bg-red-50 rounded text-red-500"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>

                </div>
              )
            )}

          </div>
        </div>


        {/* ======================================================
            PREMIX PREVIEW
            ====================================================== */}

        {form.recipe_type ===
          'PREMIX' && (
          <div className="border-t pt-3 mt-3">

            <div className="flex items-center justify-between mb-2">

              <Label className="text-[12.5px] font-semibold">
                Preview Premix
              </Label>


              <span
                className={`text-[11px] px-2 py-0.5 rounded font-semibold ${
                  Math.abs(
                    form.ingredients.reduce(
                      (s, i) =>
                        s +
                        toNumber(
                          i.percentage,
                          0
                        ),
                      0
                    ) -
                    100
                  ) <
                  0.0001
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-red-100 text-red-600'
                }`}
              >
                Total{' '}
                {form.ingredients
                  .reduce(
                    (s, i) =>
                      s +
                      toNumber(
                        i.percentage,
                        0
                      ),
                    0
                  )
                  .toFixed(
                    2
                  )}
                %
              </span>

            </div>


            <div className="text-[11.5px] text-muted-foreground">
              Basis:{' '}
              {calcBases.find(
                (b) =>
                  b.value ===
                  form.calculation_basis
              )?.label}

              {' · '}

              Output:{' '}
              {materials.find(
                (m) =>
                  m.id ===
                  form.output_material_id
              )?.name || '—'}
            </div>

          </div>
        )}


        {/* ======================================================
            CALCULATION PREVIEW
            ====================================================== */}

        {form.recipe_type !==
          'PREMIX' &&
          calcResult && (
          <div className="border-t pt-3 mt-3">

            <div className="flex items-center justify-between mb-2">

              <Label className="text-[12.5px] font-semibold">
                Hasil Kalkulasi
              </Label>


              <span
                className={`text-[11px] px-2 py-0.5 rounded font-semibold ${
                  calcResult.validation.valid
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-red-100 text-red-600'
                }`}
              >
                {calcResult.validation.valid
                  ? 'Valid'
                  : 'Tidak Valid'}
              </span>

            </div>


            {calcResult.validation.errors.length >
              0 && (
              <div className="bg-red-50 border border-red-200 rounded px-2 py-1.5 mb-2 text-[11px] text-red-700 space-y-0.5">
                {calcResult.validation.errors.map(
                  (err, i) => (
                    <div
                      key={
                        i
                      }
                    >
                      ⚠ {err}
                    </div>
                  )
                )}
              </div>
            )}


            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11.5px] mb-2">

              <div>
                Target PG
              </div>

              <div className="text-right tabular-nums">
                {tpPg.toFixed(
                  2
                )}
                %
              </div>


              <div>
                Target VG
              </div>

              <div className="text-right tabular-nums">
                {tpVg.toFixed(
                  2
                )}
                %
              </div>


              <div className="text-muted-foreground pl-2">
                PG dari Flavor
              </div>

              <div className="text-right tabular-nums text-muted-foreground">
                {calcResult.breakdown.flavor.toFixed(
                  2
                )}
                %
              </div>


              <div className="text-muted-foreground pl-2">
                PG dari Nicotine
              </div>

              <div className="text-right tabular-nums text-muted-foreground">
                {calcResult.breakdown.nicotine.toFixed(
                  2
                )}
                %
              </div>


              <div className="text-muted-foreground pl-2">
                PG dari Sweetener
              </div>

              <div className="text-right tabular-nums text-muted-foreground">
                {calcResult.breakdown.sweetener.toFixed(
                  2
                )}
                %
              </div>


              <div className="text-muted-foreground pl-2">
                PG dari Premix lain
              </div>

              <div className="text-right tabular-nums text-muted-foreground">
                {calcResult.breakdown.premix.toFixed(
                  2
                )}
                %
              </div>


              <div className="text-muted-foreground pl-2">
                VG dari bahan lain
              </div>

              <div className="text-right tabular-nums text-muted-foreground">
                {calcResult.breakdown.otherVg.toFixed(
                  2
                )}
                %
              </div>


              <div className="font-medium pl-2">
                PG murni tambahan
              </div>

              <div className="text-right tabular-nums font-medium">
                {calcResult.plainPg.toFixed(
                  2
                )}
                %
              </div>


              <div className="font-medium pl-2">
                VG murni tambahan
              </div>

              <div className="text-right tabular-nums font-medium">
                {calcResult.plainVg.toFixed(
                  2
                )}
                %
              </div>


              <div className="font-semibold border-t pt-0.5">
                Total PG akhir
              </div>

              <div className="text-right tabular-nums font-semibold border-t pt-0.5">
                {calcResult.totalPG.toFixed(
                  2
                )}
                %
              </div>


              <div className="font-semibold">
                Total VG akhir
              </div>

              <div className="text-right tabular-nums font-semibold">
                {calcResult.totalVG.toFixed(
                  2
                )}
                %
              </div>


              <div className="font-semibold">
                Total Formula
              </div>

              <div className="text-right tabular-nums font-semibold">
                {calcResult.totalPercent.toFixed(
                  2
                )}
                %
              </div>

            </div>


            <div className="overflow-x-auto">

              <table className="w-full text-[11.5px]">

                <thead>
                  <tr className="bg-muted/40 text-muted-foreground">

                    <th className="px-2 py-1 text-left">
                      Bahan
                    </th>

                    <th className="px-2 py-1 text-right">
                      Persentase
                    </th>

                    <th className="px-2 py-1 text-right">
                      Volume (ml)
                    </th>

                    <th className="px-2 py-1 text-right">
                      Berat (gram)
                    </th>

                  </tr>
                </thead>


                <tbody>

                  {calcResult.items.map(
                    (item, i) => (
                      <tr
                        key={
                          `${item.material_id || item.material_type}-${i}`
                        }
                        className={`border-b border-border/30 ${
                          item.isAuto
                            ? 'bg-blue-50/40'
                            : ''
                        }`}
                      >

                        <td className="px-2 py-1">

                          {item.material_name ||
                            mcLabel[
                              item.material_type
                            ] ||
                            item.material_type}


                          {item.isAuto && (
                            <span className="ml-1 text-[9px] px-1 py-0.5 bg-blue-100 text-blue-700 rounded">
                              Auto
                            </span>
                          )}

                        </td>


                        <td className="px-2 py-1 text-right tabular-nums">
                          {Number(
                            item.percentage
                          ).toFixed(
                            2
                          )}
                          %
                        </td>


                        <td className="px-2 py-1 text-right tabular-nums">
                          {Number(
                            item.volumeMl
                          ).toFixed(
                            2
                          )}
                        </td>


                        <td className="px-2 py-1 text-right tabular-nums">
                          {Number(
                            item.gram
                          ).toFixed(
                            2
                          )}
                        </td>

                      </tr>
                    )
                  )}

                </tbody>


                <tfoot>
                  <tr className="font-semibold border-t">

                    <td className="px-2 py-1">
                      Total
                    </td>

                    <td className="px-2 py-1 text-right tabular-nums">
                      {calcResult.totalPercent.toFixed(
                        2
                      )}
                      %
                    </td>

                    <td className="px-2 py-1 text-right tabular-nums">
                      {calcResult.totalVolume.toFixed(
                        2
                      )}
                    </td>

                    <td className="px-2 py-1 text-right tabular-nums">
                      {calcResult.totalGram.toFixed(
                        2
                      )}
                    </td>

                  </tr>
                </tfoot>

              </table>

            </div>

          </div>
        )}


        {/* ======================================================
            VISIBILITY
            ====================================================== */}

        {canManageVis && (
          <div className="border-t pt-3 mt-3">

            <Label className="text-[12.5px] font-semibold mb-2 block">
              Visibilitas Resep
            </Label>


            <div className="grid grid-cols-2 gap-3">

              <div>
                <Label className="text-[12.5px] mb-1">
                  Tipe Visibilitas
                </Label>

                <Select
                  value={
                    form.visibility_type
                  }
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      visibility_type:
                        v,
                    })
                  }
                >
                  <SelectTrigger className="h-9 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="PUBLIC_INTERNAL">
                      Semua User Berizin
                    </SelectItem>

                    <SelectItem value="ADMIN_ONLY">
                      Hanya Admin
                    </SelectItem>

                    <SelectItem value="ROLE_RESTRICTED">
                      Role Tertentu
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>


              <div className="flex flex-col gap-2 justify-center">

                <label className="flex items-center gap-2 text-[12.5px] cursor-pointer">
                  <Switch
                    checked={
                      !!form.is_hidden
                    }
                    onCheckedChange={(v) =>
                      setForm({
                        ...form,
                        is_hidden:
                          v,
                      })
                    }
                  />

                  Sembunyikan resep ini dari Brewer
                </label>


                <label className="flex items-center gap-2 text-[12.5px] cursor-pointer">
                  <Switch
                    checked={
                      !!form.allow_production_without_formula_view
                    }
                    onCheckedChange={(v) =>
                      setForm({
                        ...form,

                        allow_production_without_formula_view:
                          v,
                      })
                    }
                  />

                  Izinkan produksi tanpa melihat formula
                </label>

              </div>

            </div>


            {form.visibility_type ===
              'ROLE_RESTRICTED' && (
              <div className="mt-2">

                <Label className="text-[12.5px] mb-1">
                  Role yang boleh melihat
                </Label>


                <div className="flex flex-wrap gap-3">

                  {ROLES
                    .filter(
                      (r) =>
                        r.value !==
                        'admin'
                    )
                    .map(
                      (r) => (
                        <label
                          key={
                            r.value
                          }
                          className="flex items-center gap-1.5 text-[12px] cursor-pointer"
                        >
                          <Checkbox
                            checked={
                              !!(
                                form.allowed_role_ids ||
                                []
                              ).includes(
                                r.value
                              )
                            }
                            onCheckedChange={(v) =>
                              setForm(
                                (f) => ({
                                  ...f,

                                  allowed_role_ids:
                                    v
                                      ? [
                                          ...(
                                            f.allowed_role_ids ||
                                            []
                                          ),
                                          r.value,
                                        ]
                                      : (
                                          f.allowed_role_ids ||
                                          []
                                        ).filter(
                                          (x) =>
                                            x !==
                                            r.value
                                        ),
                                })
                              )
                            }
                          />

                          {r.label}
                        </label>
                      )
                    )}

                </div>

              </div>
            )}


            {form.is_hidden && (
              <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                ⚠ Resep tersembunyi tak tampil di daftar/search Brewer.
                Untuk formula yang benar-benar rahasia (termasuk dari API),
                gunakan <b>Hanya Admin</b> (di-enforce backend).
              </div>
            )}

          </div>
        )}


        <div>
          <Label className="text-[12.5px] mb-1">
            Catatan
          </Label>

          <Textarea
            value={
              form.notes
            }
            onChange={(e) =>
              setForm({
                ...form,
                notes:
                  e.target.value,
              })
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