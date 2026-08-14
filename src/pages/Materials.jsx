import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import FormModal from '@/components/FormModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import NumberInput from '@/components/NumberInput';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import {
  generateMaterialCode,
  generatePremixMaterialCode,
} from '@/lib/sequence';
import { createAuditLog } from '@/lib/stockUtils';
import { formatCurrency } from '@/lib/format';


const materialTypes = [
  { value: 'RAW_MATERIAL', label: 'Bahan Baku' },
  { value: 'PREMIX', label: 'Premix' },
  { value: 'PACKAGING', label: 'Box / Kemasan Luar' },
  { value: 'BOTTLE', label: 'Botol' },
  { value: 'LABEL', label: 'Label' },
  { value: 'EXCISE', label: 'Pita Cukai' },
  { value: 'CONSUMABLE', label: 'Consumable' },
];


const mtLabel = (v) =>
  materialTypes.find((t) => t.value === v)?.label || v;


const concentrationUnits = [
  { value: 'PERCENT_WW', label: '% w/w' },
  { value: 'PERCENT_WV', label: '% w/v' },
  { value: 'PERCENT_VV', label: '% v/v' },
];


const materialCategories = [
  { value: 'flavor', label: 'Flavor' },
  { value: 'propylene_glycol', label: 'Propylene Glycol' },
  { value: 'vegetable_glycerin', label: 'Vegetable Glycerin' },
  { value: 'nicotine', label: 'Nicotine' },
  { value: 'sweetener', label: 'Sweetener' },
  { value: 'cooling', label: 'Cooling' },
  { value: 'additive', label: 'Additive' },
  { value: 'lainnya', label: 'Lainnya' },
];


/**
 * PATCH v3.4
 *
 * Klasifikasi nicotine dipisahkan dari material_type.
 *
 * material_type:
 * RAW_MATERIAL
 *
 * material_category:
 * nicotine
 *
 * nicotine_form:
 * SALT / FREEBASE
 */
const nicotineForms = [
  { value: 'SALT', label: 'Salt Nicotine' },
  { value: 'FREEBASE', label: 'Freebase' },
];


/**
 * v3.4 persistence fallback
 *
 * Base44 projects lama dapat mengabaikan field baru `nicotine_form`
 * bila schema Material belum mengenalnya. Agar pilihan SALT/FREEBASE
 * tetap persist tanpa merusak field teknis lain, simpan mirror marker
 * di field `notes` yang sudah ada.
 *
 * Jika schema `nicotine_form` sudah tersedia, field asli tetap menjadi
 * source utama. Marker hanya fallback/backward compatibility.
 */
const NICOTINE_FORM_MARKER_RE = /\[\[NICOTINE_FORM:(SALT|FREEBASE)\]\]/gi;

const normalizeNicotineForm = (value) => {
  const v = String(value || '').trim().toUpperCase();
  return v === 'SALT' || v === 'FREEBASE' ? v : '';
};

const extractNicotineFormFromNotes = (notes) => {
  const match = String(notes || '').match(/\[\[NICOTINE_FORM:(SALT|FREEBASE)\]\]/i);
  return normalizeNicotineForm(match?.[1]);
};

const stripNicotineFormMarker = (notes) =>
  String(notes || '')
    .replace(NICOTINE_FORM_MARKER_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const buildNotesWithNicotineFormMarker = (notes, nicotineForm, isNicotine) => {
  const cleanNotes = stripNicotineFormMarker(notes);
  if (!isNicotine) return cleanNotes;

  const normalized = normalizeNicotineForm(nicotineForm);
  if (!normalized) return cleanNotes;

  return cleanNotes
    ? `${cleanNotes}\n[[NICOTINE_FORM:${normalized}]]`
    : `[[NICOTINE_FORM:${normalized}]]`;
};


const units = [
  { value: 'gram', label: 'Gram' },
  { value: 'mililiter', label: 'Mililiter' },
  { value: 'unit', label: 'Unit' },
  { value: 'pcs', label: 'Pcs' },
];


// Tipe yang masuk resep → perlu field teknis.
const RECIPE_TYPES = [
  'RAW_MATERIAL',
  'PREMIX',
];


// Mapping tipe material ke Master Kategori.
const CATEGORY_TYPE_BY_MATERIAL_TYPE = {
  RAW_MATERIAL: 'bahan',
  PREMIX: 'bahan',
  PACKAGING: 'kemasan',
  BOTTLE: 'kemasan',
  LABEL: 'label',
  STICKER: 'label',
  CONSUMABLE: 'barang',
  EXCISE: 'cukai',
  FINISHED_GOOD: 'produk_jadi',
};


const catTypeLabel = (materialType) => {
  const t =
    CATEGORY_TYPE_BY_MATERIAL_TYPE[
      materialType
    ] || 'bahan';

  return (
    {
      bahan: 'bahan',
      kemasan: 'kemasan',
      label: 'label',
      barang: 'barang',
      cukai: 'cukai',
      produk_jadi: 'produk jadi',
    }[t] || t
  );
};


const EMPTY = {
  code: '',
  name: '',

  material_type: 'RAW_MATERIAL',
  category_id: '',
  material_category: 'flavor',

  /**
   * PATCH v3.4
   * Hanya digunakan jika material_category === nicotine.
   */
  nicotine_form: '',

  supplier_id: '',
  unit: 'gram',

  density: '',
  pg_content: '',
  vg_content: '',
  nicotine_strength: '',

  min_stock: '',
  last_purchase_price: '',

  is_active: true,
  is_internally_produced: false,

  concentration_value: '',
  concentration_unit: 'PERCENT_WW',

  carrier_material_id: '',
  default_density: '',

  notes: '',
};


export default function Materials() {
  const { toast } = useToast();

  const [data, setData] = useState([]);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);

  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState(EMPTY);

  const [catError, setCatError] = useState(false);


  const loadData = useCallback(async () => {
    setLoading(true);

    try {
      const [items, sups] =
        await Promise.all([
          base44.entities.Material.list(
            '-created_date',
            2000
          ),

          base44.entities.Supplier.filter({
            is_active: true,
          }),
        ]);

      setData(items);
      setSuppliers(sups);
    } catch {
      toast({
        variant: 'destructive',
        title: 'Gagal memuat data',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);


  const refreshCategories = useCallback(
    async (
      currentCategoryId,
      materialType
    ) => {
      try {
        setCatError(false);

        const catType =
          CATEGORY_TYPE_BY_MATERIAL_TYPE[
            materialType
          ] || 'bahan';

        let cats =
          await base44.entities.Category.filter({
            category_type: catType,
            is_active: true,
          });

        if (
          currentCategoryId &&
          !cats.some(
            (c) =>
              c.id === currentCategoryId
          )
        ) {
          try {
            const cur =
              await base44.entities.Category.get(
                currentCategoryId
              );

            if (
              cur &&
              cur.category_type === catType
            ) {
              cats = [
                cur,
                ...cats,
              ];
            }
          } catch {
            // Kategori sudah dihapus / tidak tersedia.
          }
        }

        setCategories(cats);
      } catch {
        setCatError(true);
      }
    },
    []
  );


  useEffect(() => {
    loadData();
  }, [loadData]);


  const openAdd = () => {
    setEditing(null);

    setForm({
      ...EMPTY,
    });

    refreshCategories(
      null,
      'RAW_MATERIAL'
    );

    setModalOpen(true);
  };


  const openEdit = (item) => {
    setEditing(item);

    /**
     * PATCH v3.4
     *
     * Data lama mungkin pernah mempunyai:
     *
     * RAW_MATERIAL
     * material_category = premix
     *
     * Kondisi tersebut tidak valid.
     */
    const normalizedMaterialCategory =
      item.material_category === 'premix'
        ? (
            Number(item.nicotine_strength) > 0
              ? 'nicotine'
              : 'flavor'
          )
        : item.material_category || 'flavor';


    setForm({
      code:
        item.code,

      name:
        item.name,

      material_type:
        item.material_type ||
        'RAW_MATERIAL',

      category_id:
        item.category_id || '',

      material_category:
        normalizedMaterialCategory,

      /**
       * PATCH v3.4
       *
       * nicotine_form berlaku untuk nicotine base
       * RAW_MATERIAL maupun PREMIX.
       */
      nicotine_form:
        (
          normalizedMaterialCategory === 'nicotine' ||
          item.material_type === 'PREMIX'
        )
          ? (
              normalizeNicotineForm(item.nicotine_form) ||
              extractNicotineFormFromNotes(item.notes)
            )
          : '',

      supplier_id:
        item.supplier_id || '',

      unit:
        item.unit || 'gram',

      density:
        item.density ?? '',

      pg_content:
        item.pg_content ?? '',

      vg_content:
        item.vg_content ?? '',

      nicotine_strength:
        item.nicotine_strength ?? '',

      min_stock:
        item.min_stock ?? '',

      last_purchase_price:
        item.last_purchase_price ??
        '',

      is_active:
        item.is_active,

      is_internally_produced:
        item.is_internally_produced ??
        false,

      concentration_value:
        item.concentration_value ?? '',

      concentration_unit:
        item.concentration_unit ||
        'PERCENT_WW',

      carrier_material_id:
        item.carrier_material_id || '',

      default_density:
        item.default_density ?? '',

      notes:
        stripNicotineFormMarker(item.notes),
    });


    refreshCategories(
      item.category_id,
      item.material_type
    );

    setModalOpen(true);
  };


  const isRecipeType =
    RECIPE_TYPES.includes(
      form.material_type
    );


  const isPremix =
    form.material_type === 'PREMIX';


  const isRawNicotine =
    form.material_type === 'RAW_MATERIAL' &&
    form.material_category === 'nicotine';

  const isNicotineBase =
    isRawNicotine ||
    (isPremix && !!normalizeNicotineForm(form.nicotine_form));


  /**
   * PATCH v3.4
   *
   * Mengatur pergantian tipe material.
   *
   * PREMIX → RAW_MATERIAL:
   * - material_category premix dibersihkan
   * - metadata khusus premix dibersihkan
   * - internally produced false
   */
  const handleMaterialTypeChange =
    (newType) => {
      setForm((current) => {
        const leavingPremix =
          current.material_type ===
            'PREMIX' &&
          newType !== 'PREMIX';

        const becomingRawMaterial =
          newType ===
          'RAW_MATERIAL';

        let nextMaterialCategory =
          current.material_category;


        if (
          becomingRawMaterial &&
          nextMaterialCategory ===
            'premix'
        ) {
          nextMaterialCategory =
            'flavor';
        }


        return {
          ...current,

          material_type:
            newType,

          category_id:
            '',

          material_category:
            nextMaterialCategory,

          /**
           * nicotine_form hanya valid
           * untuk RAW_MATERIAL nicotine.
           */
          nicotine_form:
            (
              (
                newType === 'RAW_MATERIAL' &&
                nextMaterialCategory === 'nicotine'
              ) ||
              newType === 'PREMIX'
            )
              ? normalizeNicotineForm(current.nicotine_form)
              : '',

          is_internally_produced:
            newType === 'PREMIX',

          concentration_value:
            leavingPremix
              ? ''
              : current.concentration_value,

          carrier_material_id:
            leavingPremix
              ? ''
              : current.carrier_material_id,

          default_density:
            leavingPremix
              ? ''
              : current.default_density,
        };
      });


      refreshCategories(
        null,
        newType
      );
    };


  /**
   * PATCH v3.4
   *
   * Jenis Bahan berubah.
   *
   * Jika keluar dari nicotine,
   * nicotine_form dibersihkan agar
   * metadata SALT/FREEBASE tidak
   * menempel ke flavor / PG / VG dll.
   */
  const handleMaterialCategoryChange =
    (newCategory) => {
      setForm((current) => ({
        ...current,

        material_category:
          newCategory,

        nicotine_form:
          newCategory === 'nicotine'
            ? normalizeNicotineForm(current.nicotine_form)
            : '',

        nicotine_strength:
          newCategory === 'nicotine'
            ? current.nicotine_strength
            : current.nicotine_strength,
      }));
    };


  const handleSubmit = async () => {
    if (!form.name) {
      toast({
        variant: 'destructive',
        title: 'Nama wajib diisi',
      });

      return;
    }


    /**
     * PATCH v3.4
     *
     * Nicotine RAW_MATERIAL wajib
     * memiliki klasifikasi SALT/FREEBASE.
     */
    if (
      isRawNicotine &&
      !form.nicotine_form
    ) {
      toast({
        variant: 'destructive',
        title:
          'Jenis nicotine wajib dipilih',
        description:
          'Pilih Salt Nicotine atau Freebase.',
      });

      return;
    }


    /**
     * Nicotine strength juga wajib
     * lebih dari 0 agar Recipe Calculator
     * dapat menghitung target nicotine.
     */
    if (
      isNicotineBase &&
      !(
        Number(
          form.nicotine_strength
        ) > 0
      )
    ) {
      toast({
        variant: 'destructive',
        title:
          'Kekuatan nicotine wajib diisi',
        description:
          'Isi nicotine strength dalam mg/ml, misalnya 100, 250, 500 atau 1000.',
      });

      return;
    }


    setSubmitting(true);


    try {
      const cat =
        categories.find(
          (c) =>
            c.id ===
            form.category_id
        );


      const sup =
        suppliers.find(
          (s) =>
            s.id ===
            form.supplier_id
        );


      const carrier =
        data.find(
          (m) =>
            m.id ===
            form.carrier_material_id
        );


      /**
       * Guard data lama:
       *
       * RAW_MATERIAL tidak boleh
       * mempunyai technical category
       * "premix".
       */
      let normalizedMaterialCategory =
        form.material_category;


      if (
        form.material_type ===
          'RAW_MATERIAL' &&
        normalizedMaterialCategory ===
          'premix'
      ) {
        normalizedMaterialCategory =
          'flavor';
      }


      const normalizedIsNicotineBase =
        (
          form.material_type === 'RAW_MATERIAL' &&
          normalizedMaterialCategory === 'nicotine'
        ) ||
        (
          form.material_type === 'PREMIX' &&
          !!normalizeNicotineForm(form.nicotine_form)
        );


      const payload = {
        ...form,


        is_internally_produced:
          isPremix,


        material_category:
          isRecipeType
            ? normalizedMaterialCategory
            : undefined,


        /**
         * PATCH v3.4
         *
         * SALT / FREEBASE hanya disimpan
         * untuk RAW_MATERIAL nicotine.
         */
        nicotine_form:
          normalizedIsNicotineBase
            ? normalizeNicotineForm(form.nicotine_form)
            : '',


        concentration_value:
          isPremix
            ? Number(
                form.concentration_value
              )
            : undefined,


        concentration_unit:
          form.concentration_unit,


        carrier_material_id:
          isPremix
            ? form.carrier_material_id
            : '',


        carrier_material_name:
          isPremix
            ? carrier?.name || ''
            : '',


        default_density:
          isPremix
            ? Number(
                form.default_density
              )
            : undefined,


        density:
          isRecipeType
            ? Number(
                form.density
              )
            : undefined,


        pg_content:
          isRecipeType
            ? Number(
                form.pg_content
              )
            : undefined,


        vg_content:
          isRecipeType
            ? Number(
                form.vg_content
              )
            : undefined,


        nicotine_strength:
          isRecipeType
            ? Number(
                form.nicotine_strength
              )
            : undefined,


        min_stock:
          Number(
            form.min_stock
          ),


        last_purchase_price:
          Number(
            form.last_purchase_price
          ) || 0,


        supplier_id:
          isRecipeType
            ? form.supplier_id
            : '',


        supplier_name:
          isRecipeType
            ? sup?.name || ''
            : '',


        category_name:
          cat?.name || '',

        /**
         * Mirror fallback agar SALT/FREEBASE tetap persist
         * pada project Base44 yang schema Material-nya belum
         * menyimpan field baru `nicotine_form`.
         */
        notes:
          buildNotesWithNicotineFormMarker(
            form.notes,
            form.nicotine_form,
            normalizedIsNicotineBase
          ),
      };


      if (editing) {
        await base44.entities.Material.update(
          editing.id,
          payload
        );


        await createAuditLog({
          module: 'Bahan',
          action: 'Edit',
          entity_type: 'Material',
          entity_id: editing.id,

          reference_number:
            editing.code,

          data_before:
            editing,

          data_after:
            payload,
        });


        toast({
          title:
            'Bahan diperbarui',
        });
      } else {
        const code =
          isPremix
            ? await generatePremixMaterialCode(
                (form.name || 'XX')
                  .substring(0, 4)
                  .toUpperCase(),

                Number(
                  form.concentration_value
                ) || 0
              )
            : await generateMaterialCode();


        const created =
          await base44.entities.Material.create({
            ...payload,
            code,
          });


        await createAuditLog({
          module: 'Bahan',
          action: 'Tambah',
          entity_type: 'Material',
          entity_id: created.id,
          reference_number: code,
        });


        toast({
          title:
            'Bahan ditambahkan',
        });
      }


      setModalOpen(false);

      loadData();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Gagal menyimpan',
        description: e.message,
      });
    } finally {
      setSubmitting(false);
    }
  };


  const handleDelete = async (item) => {
    if (
      !confirm(
        `Nonaktifkan bahan "${item.name}"?`
      )
    ) {
      return;
    }


    try {
      await base44.entities.Material.update(
        item.id,
        {
          is_active: false,
        }
      );


      await createAuditLog({
        module: 'Bahan',
        action: 'Nonaktif',
        entity_type: 'Material',
        entity_id: item.id,

        reference_number:
          item.code,

        reason:
          'Nonaktifkan bahan',
      });


      toast({
        title:
          'Bahan dinonaktifkan',
      });


      loadData();
    } catch {
      toast({
        variant: 'destructive',
        title: 'Gagal',
      });
    }
  };


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
      header: 'Nama Bahan',
      sortable: true,
      className:
        'font-medium',
    },


    {
      key: 'category_name',
      header: 'Kategori',

      render: (row) =>
        row.category_name || '—',
    },


    {
      key: 'material_type',
      header: 'Tipe',

      render: (row) =>
        row.material_type ===
        'PREMIX' ? (
          <span className="text-[11px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded font-semibold">
            Premix
          </span>
        ) : (
          <span className="text-[11px] px-2 py-0.5 bg-slate-100 text-slate-500 rounded">
            {mtLabel(
              row.material_type
            )}
          </span>
        ),
    },


    {
      key: 'unit',
      header: 'Satuan',
    },


    {
      key: 'last_purchase_price',
      header: 'HBT',

      render: (row) => {
        const v =
          Number(
            row.last_purchase_price
          );

        return (
          <span className="tabular-nums">
            {v &&
            !Number.isNaN(v)
              ? formatCurrency(
                  row.last_purchase_price
                )
              : '—'}
          </span>
        );
      },
    },


    {
      key: 'min_stock',
      header: 'Stok Min',

      render: (row) => (
        <span className="tabular-nums">
          {row.min_stock}
        </span>
      ),
    },


    {
      key: 'is_active',
      header: 'Status',

      render: (row) =>
        row.is_active ? (
          <span className="text-[11px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded font-semibold">
            Aktif
          </span>
        ) : (
          <span className="text-[11px] px-2 py-0.5 bg-slate-100 text-slate-400 rounded">
            Nonaktif
          </span>
        ),
    },


    {
      key: 'actions',
      header: '',
      width: '80px',

      render: (row) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() =>
              openEdit(row)
            }
            className="p-1.5 hover:bg-muted rounded"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>


          <button
            onClick={() =>
              handleDelete(row)
            }
            className="p-1.5 hover:bg-red-50 rounded text-red-500"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ),
    },
  ];


  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader
        title="Master Bahan"
        description="Semua bahan penentu HPP: essence, nicotine, PG/VG, premix, botol, label, stiker, pita cukai. Produk jadi simpan di Master Barang."
        actions={
          <Button
            onClick={openAdd}
            size="sm"
            className="gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Tambah Bahan
          </Button>
        }
      />


      <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
        <span className="font-semibold">
          Aturan:
        </span>{' '}
        daftarkan di sini semua bahan yang ikut menghitung HPP produksi
        (essence, nicotine, PG, VG, premix, botol, label, stiker,
        pita cukai). Master Barang khusus untuk{' '}
        <span className="font-semibold">
          produk jadi
        </span>{' '}
        (barang siap jual / hasil akhir).
      </div>


      <div className="mb-3 flex items-center gap-2">
        <Label className="text-[12.5px] text-muted-foreground shrink-0">
          Filter Kategori
        </Label>


        <Select
          value={filterCategory}
          onValueChange={
            setFilterCategory
          }
        >
          <SelectTrigger className="h-8 w-[220px] text-[12.5px]">
            <SelectValue placeholder="Semua Kategori" />
          </SelectTrigger>


          <SelectContent>
            <SelectItem value="__all">
              Semua Kategori
            </SelectItem>


            {[
              ...new Set(
                data
                  .map(
                    (d) =>
                      d.category_name
                  )
                  .filter(Boolean)
              ),
            ]
              .sort((a, b) =>
                a.localeCompare(b)
              )
              .map((c) => (
                <SelectItem
                  key={c}
                  value={c}
                >
                  {c}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>


        {filterCategory &&
          filterCategory !==
            '__all' && (
            <button
              onClick={() =>
                setFilterCategory('')
              }
              className="text-[11px] text-primary hover:underline"
            >
              Reset
            </button>
          )}
      </div>


      <DataTable
        columns={columns}
        data={
          filterCategory &&
          filterCategory !==
            '__all'
            ? data.filter(
                (d) =>
                  d.category_name ===
                  filterCategory
              )
            : data
        }
        loading={loading}
        emptyMessage="Belum ada bahan"
        searchKeys={[
          'code',
          'name',
        ]}
        searchPlaceholder="Cari bahan..."
      />


      <FormModal
        open={modalOpen}
        onClose={() =>
          setModalOpen(false)
        }
        title={
          editing
            ? 'Edit Bahan'
            : 'Tambah Bahan'
        }
        onSubmit={handleSubmit}
        submitting={submitting}
        size="lg"
      >
        <div className="grid grid-cols-2 gap-3">
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


          <div>
            <Label className="text-[12.5px] mb-1">
              Nama Barang *
            </Label>

            <Input
              value={form.name}
              onChange={(e) =>
                setForm({
                  ...form,
                  name:
                    e.target.value,
                })
              }
              placeholder="mis. Botol 60ml White Flat"
              className="h-9 text-[13px]"
            />
          </div>


          <div>
            <Label className="text-[12.5px] mb-1">
              Tipe
            </Label>

            <Select
              value={
                form.material_type
              }
              onValueChange={
                handleMaterialTypeChange
              }
            >
              <SelectTrigger className="h-9 text-[13px]">
                <SelectValue />
              </SelectTrigger>


              <SelectContent>
                {materialTypes.map(
                  (t) => (
                    <SelectItem
                      key={t.value}
                      value={t.value}
                    >
                      {t.label}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>


          <div>
            <Label className="text-[12.5px] mb-1">
              Kategori
            </Label>

            {catError ? (
              <div className="flex items-center gap-2 h-9">
                <span className="text-[12px] text-destructive">
                  Gagal memuat kategori.
                </span>


                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    refreshCategories(
                      editing?.category_id,
                      form.material_type
                    )
                  }
                >
                  Coba Lagi
                </Button>
              </div>
            ) : categories.length ===
              0 ? (
              <p className="text-[12px] text-muted-foreground italic">
                Belum ada kategori{' '}
                {catTypeLabel(
                  form.material_type
                )}
                . Tambahkan di Master
                Kategori (Jenis:{' '}
                {catTypeLabel(
                  form.material_type
                )}
                ).
              </p>
            ) : (
              <Select
                value={
                  form.category_id
                }
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    category_id: v,
                  })
                }
              >
                <SelectTrigger className="h-9 text-[13px]">
                  <SelectValue
                    placeholder={`Pilih kategori ${catTypeLabel(
                      form.material_type
                    )}`}
                  />
                </SelectTrigger>


                <SelectContent>
                  {categories.map(
                    (c) => (
                      <SelectItem
                        key={c.id}
                        value={c.id}
                      >
                        {c.is_active ===
                        false
                          ? `${c.name} (Nonaktif)`
                          : c.name}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            )}
          </div>


          <div>
            <Label className="text-[12.5px] mb-1">
              Satuan
            </Label>

            <Select
              value={form.unit}
              onValueChange={(v) =>
                setForm({
                  ...form,
                  unit: v,
                })
              }
            >
              <SelectTrigger className="h-9 text-[13px]">
                <SelectValue />
              </SelectTrigger>


              <SelectContent>
                {units.map((u) => (
                  <SelectItem
                    key={u.value}
                    value={u.value}
                  >
                    {u.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>


          <div>
            <Label className="text-[12.5px] mb-1">
              Stok Minimum
            </Label>

            <NumberInput
              value={
                form.min_stock
              }
              onChange={(v) =>
                setForm({
                  ...form,
                  min_stock: v,
                })
              }
              allowDecimal
              min={0}
              className="h-9 text-[13px]"
            />
          </div>
        </div>


        <div className="border-t border-border pt-3 mt-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[12.5px] mb-1">
                Harga Beli Terakhir
                (HBT)
              </Label>

              <NumberInput
                value={
                  form.last_purchase_price
                }
                onChange={(v) =>
                  setForm({
                    ...form,
                    last_purchase_price:
                      v,
                  })
                }
                allowDecimal
                min={0}
                className="h-9 text-[13px]"
              />
            </div>
          </div>


          <div className="text-[11px] text-muted-foreground mt-1">
            Harga per satuan dasar (
            {form.unit || 'unit'}).
            Dipakai sebagai dasar HPP
            untuk semua tipe bahan.
          </div>
        </div>


        {isRecipeType && (
          <div className="border-t border-border pt-3 mt-1 space-y-3">
            <div className="text-[12px] font-semibold text-muted-foreground">
              Properti Bahan Resep
            </div>


            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[12.5px] mb-1">
                  Jenis Bahan
                </Label>

                <Select
                  value={
                    form.material_category
                  }
                  onValueChange={
                    handleMaterialCategoryChange
                  }
                >
                  <SelectTrigger className="h-9 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>


                  <SelectContent>
                    {materialCategories.map(
                      (t) => (
                        <SelectItem
                          key={t.value}
                          value={t.value}
                        >
                          {t.label}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>


              <div>
                <Label className="text-[12.5px] mb-1">
                  Supplier Utama
                </Label>

                <Select
                  value={
                    form.supplier_id
                  }
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      supplier_id:
                        v,
                    })
                  }
                >
                  <SelectTrigger className="h-9 text-[13px]">
                    <SelectValue placeholder="Pilih supplier" />
                  </SelectTrigger>


                  <SelectContent>
                    {suppliers.map(
                      (s) => (
                        <SelectItem
                          key={s.id}
                          value={s.id}
                        >
                          {s.name}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>


              {isRawNicotine && (
                <div>
                  <Label className="text-[12.5px] mb-1">
                    Jenis Nicotine *
                  </Label>

                  <Select
                    value={
                      form.nicotine_form
                    }
                    onValueChange={(v) =>
                      setForm({
                        ...form,
                        nicotine_form:
                          normalizeNicotineForm(v),
                      })
                    }
                  >
                    <SelectTrigger className="h-9 text-[13px]">
                      <SelectValue placeholder="Pilih Salt / Freebase" />
                    </SelectTrigger>


                    <SelectContent>
                      {nicotineForms.map(
                        (n) => (
                          <SelectItem
                            key={n.value}
                            value={n.value}
                          >
                            {n.label}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}


              <div>
                <Label className="text-[12.5px] mb-1">
                  Density (g/ml)
                </Label>

                <NumberInput
                  value={
                    form.density
                  }
                  onChange={(v) =>
                    setForm({
                      ...form,
                      density: v,
                    })
                  }
                  allowDecimal
                  maxDecimals={3}
                  min={0}
                  step="0.001"
                  className="h-9 text-[13px]"
                />
              </div>


              <div>
                <Label className="text-[12.5px] mb-1">
                  Kandungan PG (%)
                </Label>

                <NumberInput
                  value={
                    form.pg_content
                  }
                  onChange={(v) =>
                    setForm({
                      ...form,
                      pg_content: v,
                    })
                  }
                  allowDecimal
                  maxDecimals={2}
                  min={0}
                  max={100}
                  className="h-9 text-[13px]"
                />
              </div>


              <div>
                <Label className="text-[12.5px] mb-1">
                  Kandungan VG (%)
                </Label>

                <NumberInput
                  value={
                    form.vg_content
                  }
                  onChange={(v) =>
                    setForm({
                      ...form,
                      vg_content: v,
                    })
                  }
                  allowDecimal
                  maxDecimals={2}
                  min={0}
                  max={100}
                  className="h-9 text-[13px]"
                />
              </div>


              <div>
                <Label className="text-[12.5px] mb-1">
                  Kekuatan Nicotine
                  (mg/ml)
                </Label>

                <NumberInput
                  value={
                    form.nicotine_strength
                  }
                  onChange={(v) =>
                    setForm({
                      ...form,
                      nicotine_strength:
                        v,
                    })
                  }
                  allowDecimal
                  maxDecimals={2}
                  min={0}
                  className="h-9 text-[13px]"
                />
              </div>
            </div>


            {isRawNicotine && (
              <div className="text-[11px] text-muted-foreground">
                Jenis Nicotine dan
                Kekuatan Nicotine akan
                digunakan oleh Recipe
                Calculator untuk memilih
                nicotine base dan
                menghitung persentase
                nicotine otomatis.
              </div>
            )}
          </div>
        )}


        {isPremix && (
          <div className="border rounded-md p-3 bg-amber-50/40 space-y-2 mt-1">
            <div className="text-[12px] font-semibold text-amber-700">
              Properti Premix
            </div>


            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-[12.5px] mb-1">
                  Jenis Nicotine (opsional)
                </Label>
                <Select
                  value={form.nicotine_form}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      nicotine_form: normalizeNicotineForm(v),
                    })
                  }
                >
                  <SelectTrigger className="h-9 text-[13px]">
                    <SelectValue placeholder="Bukan nicotine base" />
                  </SelectTrigger>
                  <SelectContent>
                    {nicotineForms.map((n) => (
                      <SelectItem key={n.value} value={n.value}>
                        {n.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-[12.5px] mb-1">
                  Konsentrasi
                </Label>

                <NumberInput
                  value={
                    form.concentration_value
                  }
                  onChange={(v) =>
                    setForm({
                      ...form,
                      concentration_value:
                        v,
                    })
                  }
                  allowDecimal
                  maxDecimals={2}
                  min={0}
                  className="h-9 text-[13px]"
                />
              </div>


              <div>
                <Label className="text-[12.5px] mb-1">
                  Satuan Konsentrasi
                </Label>

                <Select
                  value={
                    form.concentration_unit
                  }
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      concentration_unit:
                        v,
                    })
                  }
                >
                  <SelectTrigger className="h-9 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>


                  <SelectContent>
                    {concentrationUnits.map(
                      (u) => (
                        <SelectItem
                          key={u.value}
                          value={u.value}
                        >
                          {u.label}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>


              <div>
                <Label className="text-[12.5px] mb-1">
                  Density Default
                  (g/ml)
                </Label>

                <NumberInput
                  value={
                    form.default_density
                  }
                  onChange={(v) =>
                    setForm({
                      ...form,
                      default_density:
                        v,
                    })
                  }
                  allowDecimal
                  maxDecimals={3}
                  min={0}
                  step="0.001"
                  className="h-9 text-[13px]"
                />
              </div>


              <div className="col-span-3">
                <Label className="text-[12.5px] mb-1">
                  Carrier
                </Label>

                <Select
                  value={
                    form.carrier_material_id
                  }
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      carrier_material_id:
                        v,
                    })
                  }
                >
                  <SelectTrigger className="h-9 text-[13px]">
                    <SelectValue placeholder="Pilih carrier (mis. PG)" />
                  </SelectTrigger>


                  <SelectContent>
                    {data
                      .filter(
                        (m) =>
                          (
                            m.material_category ===
                              'propylene_glycol' ||
                            m.material_category ===
                              'vegetable_glycerin'
                          ) &&
                          m.id !==
                            editing?.id
                      )
                      .map((m) => (
                        <SelectItem
                          key={m.id}
                          value={m.id}
                        >
                          {m.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>


            {form.nicotine_form && (
              <div className="text-[11px] text-amber-700/80">
                Premix ini akan tersedia sebagai Nicotine Base. Isi Kekuatan Nicotine
                (mg/ml), density, dan carrier PG/VG dengan benar.
              </div>
            )}
            <div className="text-[11px] text-amber-700/80">
              Bahan premix otomatis
              ditandai "Diproduksi
              Internal". Kode dibuat
              otomatis format
              PMX-NAMA-KONS-NOMOR.
            </div>
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
            rows={2}
            className="text-[13px]"
          />
        </div>


        <div className="flex items-center gap-2 pt-1">
          <Switch
            checked={
              form.is_active
            }
            onCheckedChange={(v) =>
              setForm({
                ...form,
                is_active: v,
              })
            }
          />

          <Label className="text-[12.5px]">
            Aktif
          </Label>
        </div>
      </FormModal>
    </div>
  );
}