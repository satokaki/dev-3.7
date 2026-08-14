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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import NumberInput from '@/components/NumberInput';
import { Plus, Pencil, Trash2, Lock, Boxes } from 'lucide-react';
import { generateProductCode } from '@/lib/sequence';
import ProductMappingManager from '@/components/ProductMappingManager';
import { formatCurrency as fmtMoney } from '@/lib/format';

const productTypes = [
  { value: 'bahan_baku', label: 'Bahan Baku' },
  { value: 'kemasan', label: 'Kemasan' },
  { value: 'botol_kosong', label: 'Botol Kosong' },
  { value: 'label', label: 'Label' },
  { value: 'bulk_hasil_mixing', label: 'Bulk Hasil Mixing' },
  { value: 'barang_siap_bottling', label: 'Barang Siap Bottling' },
  { value: 'barang_siap_labeling', label: 'Barang Siap Labeling' },
  { value: 'barang_belum_cukai', label: 'Barang Belum Cukai' },
  { value: 'barang_siap_jual', label: 'Barang Siap Jual' },
  { value: 'barang_pendukung', label: 'Barang Pendukung' },
];
const ptLabel = (v) => productTypes.find(t => t.value === v)?.label || v;
// Tipe yang merupakan bahan penentu HPP — dikelola di Master Bahan, bukan Master Barang.
// Dikecualikan dari dropdown Tipe Barang agar operator tidak keliru mendaftarkan botol/kemasan di sini.
const PRODUCT_TYPE_EXCLUDED = ['bahan_baku', 'kemasan', 'botol_kosong', 'label'];
const productTypeOptions = productTypes.filter(t => !PRODUCT_TYPE_EXCLUDED.includes(t.value));

const units = [
  { value: 'kg', label: 'Kg' },
  { value: 'gram', label: 'Gram' },
  { value: 'pcs', label: 'Pcs' },
];

export default function Products() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [brands, setBrands] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [mappingProduct, setMappingProduct] = useState(null);
  const [form, setForm] = useState({ name: '', sku: '', barcode: '', brand_id: '', category_id: '', product_type: 'barang_siap_jual', bottle_size: '', unit: 'unit', sale_price: '', min_stock: '', excise_required: true, is_active: true, notes: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [items, brs, cats] = await Promise.all([
        base44.entities.Product.list('-created_date', 200),
        base44.entities.Brand.filter({ is_active: true }),
        base44.entities.Category.filter({ is_active: true }),
      ]);
      setData(items);
      setBrands(brs);
      setCategories(cats);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const openAdd = () => { setEditing(null); setForm({ name: '', sku: '', barcode: '', brand_id: '', category_id: '', product_type: 'barang_siap_jual', bottle_size: '', unit: 'unit', sale_price: '', min_stock: '', excise_required: true, is_active: true, notes: '' }); setModalOpen(true); };
  const openEdit = (item) => {
    setEditing(item);
    setForm({ name: item.name, sku: item.sku || '', barcode: item.barcode || '', brand_id: item.brand_id || '', category_id: item.category_id || '', product_type: item.product_type, bottle_size: item.bottle_size ?? '', unit: item.unit || 'unit', sale_price: item.sale_price ?? '', min_stock: item.min_stock ?? '', excise_required: item.excise_required !== false, is_active: item.is_active, notes: item.notes || '' });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name) { toast({ variant: 'destructive', title: 'Nama wajib diisi' }); return; }
    setSubmitting(true);
    try {
      const brand = brands.find(b => b.id === form.brand_id);
      const cat = categories.find(c => c.id === form.category_id);
      const payload = {
        ...form,
        bottle_size: Number(form.bottle_size),
        sale_price: Number(form.sale_price),
        min_stock: Number(form.min_stock),
        excise_required: form.excise_required !== false,
        brand_name: brand?.name || '',
        category_name: cat?.name || '',
      };
      if (editing) {
        await base44.entities.Product.update(editing.id, payload);
        toast({ title: 'Barang diperbarui' });
      } else {
        const code = await generateProductCode(cat?.code || 'XX');
        await base44.entities.Product.create({ ...payload, code });
        toast({ title: 'Barang ditambahkan', description: `Kode: ${code}` });
      }
      setModalOpen(false); loadData();
    } catch (e) { toast({ variant: 'destructive', title: 'Gagal menyimpan', description: e.message }); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (item) => {
    if (!confirm(`Nonaktifkan barang "${item.name}"?`)) return;
    try { await base44.entities.Product.update(item.id, { is_active: false }); toast({ title: 'Barang dinonaktifkan' }); loadData(); }
    catch { toast({ variant: 'destructive', title: 'Gagal' }); }
  };

  const columns = [
    { key: 'code', header: 'Kode', sortable: true, className: 'font-mono font-medium', render: (row) => <span className="flex items-center gap-1">{row.code}<Lock className="w-3 h-3 text-muted-foreground/40" /></span> },
    { key: 'name', header: 'Nama Barang', sortable: true, className: 'font-medium' },
    { key: 'brand_name', header: 'Merk', render: (row) => row.brand_name || '—' },
    { key: 'product_type', header: 'Tipe', render: (row) => <span className="text-[11px] px-2 py-0.5 bg-muted rounded">{ptLabel(row.product_type)}</span> },
    { key: 'bottle_size', header: 'Ukuran', render: (row) => row.bottle_size ? `${row.bottle_size} ml` : '—' },
    { key: 'sale_price', header: 'Harga Jual', render: (row) => <span className="tabular-nums">{fmtMoney(row.sale_price)}</span> },
    {
      key: 'is_active', header: 'Status',
      render: (row) => row.is_active
        ? <span className="text-[11px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded font-semibold">Aktif</span>
        : <span className="text-[11px] px-2 py-0.5 bg-slate-100 text-slate-400 rounded">Nonaktif</span>
    },
    {
      key: 'actions', header: '', width: '110px',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button onClick={() => setMappingProduct(row)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600" title="Mapping Komponen"><Boxes className="w-3.5 h-3.5" /></button>
          <button onClick={() => openEdit(row)} className="p-1.5 hover:bg-muted rounded"><Pencil className="w-3.5 h-3.5" /></button>
          <button onClick={() => handleDelete(row)} className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      )
    },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Master Barang" description="Khusus produk jadi (barang siap jual / hasil akhir). Bahan penentu HPP simpan di Master Bahan."
        actions={<Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Tambah Barang</Button>} />
      <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] text-blue-700">
        <span className="font-semibold">Aturan:</span> Master Barang hanya untuk <span className="font-semibold">produk jadi</span> yang dijual. Bahan penentu HPP (essence, nicotine, PG/VG, premix, botol, label, stiker, pita cukai) simpan di Master Bahan.
      </div>
      <DataTable columns={columns} data={data} loading={loading} emptyMessage="Belum ada barang" searchKeys={['code', 'name', 'brand_name', 'sku']} searchPlaceholder="Cari barang..." />
      <FormModal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Barang' : 'Tambah Barang'} onSubmit={handleSubmit} submitting={submitting} size="lg">
        <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-[11.5px] text-blue-700 mb-1">
          {!editing && 'Kode barang dibuat otomatis berdasarkan kategori (BRG-KAT-00001)'}
          {editing && `Kode: ${editing.code} (tidak dapat diubah)`}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label className="text-[12.5px] mb-1">Nama Barang *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-[13px]" /></div>
          <div>
            <Label className="text-[12.5px] mb-1">Merk</Label>
            <Select value={form.brand_id} onValueChange={v => setForm({ ...form, brand_id: v })}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih merk" /></SelectTrigger>
              <SelectContent>{brands.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[12.5px] mb-1">Kategori</Label>
            <Select value={form.category_id} onValueChange={v => setForm({ ...form, category_id: v })}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
              <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-[12.5px] mb-1">Tipe Barang</Label>
            <Select value={form.product_type} onValueChange={v => setForm({ ...form, product_type: v })}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>{productTypeOptions.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-[12.5px] mb-1">SKU</Label><Input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Barcode</Label><Input value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Ukuran Botol (ml)</Label><NumberInput value={form.bottle_size} onChange={v => setForm({ ...form, bottle_size: v })} allowDecimal maxDecimals={1} min={0} className="h-9 text-[13px]" /></div>
          <div>
            <Label className="text-[12.5px] mb-1">Satuan</Label>
            <Select value={units.some(u => u.value === form.unit) ? form.unit : 'pcs'} onValueChange={v => setForm({ ...form, unit: v })}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>{units.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-[12.5px] mb-1">Harga Jual (Rp)</Label><NumberInput value={form.sale_price} onChange={v => setForm({ ...form, sale_price: v })} allowDecimal min={0} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Stok Minimum</Label><NumberInput value={form.min_stock} onChange={v => setForm({ ...form, min_stock: v })} allowDecimal min={0} className="h-9 text-[13px]" /></div>
        </div>

        <div className="border-t border-border pt-3 mt-1">
          <Label className="text-[12.5px] font-semibold mb-2 block">Status Cukai</Label>
          <div className="flex items-center gap-3">
            <Switch
              checked={form.excise_required !== false}
              onCheckedChange={v => setForm(f => ({ ...f, excise_required: v }))}
            />
            <div>
              <div className="text-[12.5px] font-medium">
                {form.excise_required !== false ? 'Wajib Cukai' : 'Non Cukai / Sample'}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Produk lama tanpa setting otomatis dianggap Wajib Cukai.
              </div>
            </div>
          </div>
        </div>

        <div><Label className="text-[12.5px] mb-1">Catatan</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="text-[13px]" /></div>
        <div className="flex items-center gap-2 pt-1"><Switch checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} /><Label className="text-[12.5px]">Aktif</Label></div>
      </FormModal>
      <ProductMappingManager product={mappingProduct} onClose={() => setMappingProduct(null)} />
    </div>
  );
}