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
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { generateCategoryCode } from '@/lib/sequence';

const categoryTypes = [
  { value: 'bahan', label: 'Bahan' },
  { value: 'barang', label: 'Barang' },
  { value: 'kemasan', label: 'Kemasan' },
  { value: 'label', label: 'Label' },
  { value: 'cukai', label: 'Cukai' },
  { value: 'produk_jadi', label: 'Produk Jadi' },
];

const typeLabel = (v) => categoryTypes.find(t => t.value === v)?.label || v;

export default function Categories() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', category_type: 'bahan', is_active: true, notes: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const items = await base44.entities.Category.list('-created_date', 200);
      setData(items);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Gagal memuat data' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const openAdd = () => {
    setEditing(null);
    setForm({ code: '', name: '', category_type: 'bahan', is_active: true, notes: '' });
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({ code: item.code, name: item.name, category_type: item.category_type, is_active: item.is_active, notes: item.notes || '' });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name) {
      toast({ variant: 'destructive', title: 'Nama wajib diisi' });
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await base44.entities.Category.update(editing.id, form);
        toast({ title: 'Kategori diperbarui' });
      } else {
        const code = await generateCategoryCode();
        await base44.entities.Category.create({ ...form, code });
        toast({ title: 'Kategori ditambahkan' });
      }
      setModalOpen(false);
      loadData();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Gagal menyimpan', description: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (item) => {
    if (!confirm(`Nonaktifkan kategori "${item.name}"?`)) return;
    try {
      await base44.entities.Category.update(item.id, { is_active: false });
      toast({ title: 'Kategori dinonaktifkan' });
      loadData();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Gagal' });
    }
  };

  const columns = [
    { key: 'code', header: 'Kode', sortable: true, className: 'font-mono font-medium' },
    { key: 'name', header: 'Nama Kategori', sortable: true, className: 'font-medium' },
    { key: 'category_type', header: 'Jenis', sortable: true, render: (row) => <span className="text-[11px] px-2 py-0.5 bg-muted rounded">{typeLabel(row.category_type)}</span> },
    {
      key: 'is_active', header: 'Status',
      render: (row) => row.is_active
        ? <span className="text-[11px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded font-semibold">Aktif</span>
        : <span className="text-[11px] px-2 py-0.5 bg-slate-100 text-slate-400 rounded">Nonaktif</span>
    },
    { key: 'notes', header: 'Catatan', render: (row) => row.notes || '—' },
    {
      key: 'actions', header: '', width: '80px',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button onClick={() => openEdit(row)} className="p-1.5 hover:bg-muted rounded"><Pencil className="w-3.5 h-3.5" /></button>
          <button onClick={() => handleDelete(row)} className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      )
    },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Master Kategori" description="Kategori untuk bahan, barang, kemasan, label, cukai, produk jadi"
        actions={<Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Tambah Kategori</Button>} />
      <DataTable columns={columns} data={data} loading={loading} emptyMessage="Belum ada kategori" searchKeys={['code', 'name']} searchPlaceholder="Cari kategori..." />
      <FormModal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Kategori' : 'Tambah Kategori'} onSubmit={handleSubmit} submitting={submitting}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[12.5px] mb-1">Kode Kategori</Label>
            <Input value={editing ? form.code : ''} placeholder="Otomatis" className="h-9 text-[13px] font-mono bg-muted/40" disabled readOnly />
          </div>
          <div>
            <Label className="text-[12.5px] mb-1">Jenis Kategori *</Label>
            <Select value={form.category_type} onValueChange={v => setForm({ ...form, category_type: v })}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>{categoryTypes.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label className="text-[12.5px] mb-1">Nama Kategori *</Label>
          <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-[13px]" />
        </div>
        <div>
          <Label className="text-[12.5px] mb-1">Catatan</Label>
          <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="text-[13px]" />
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Switch checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} />
          <Label className="text-[12.5px]">Aktif</Label>
        </div>
      </FormModal>
    </div>
  );
}