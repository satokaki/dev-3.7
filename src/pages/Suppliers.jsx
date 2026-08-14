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
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { generateSupplierCode } from '@/lib/sequence';

export default function Suppliers() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', contact_person: '', phone: '', email: '', address: '', city: '', is_active: true, notes: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const items = await base44.entities.Supplier.list('-created_date', 200);
      setData(items);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const openAdd = () => { setEditing(null); setForm({ code: '', name: '', contact_person: '', phone: '', email: '', address: '', city: '', is_active: true, notes: '' }); setModalOpen(true); };
  const openEdit = (item) => { setEditing(item); setForm({ code: item.code, name: item.name, contact_person: item.contact_person || '', phone: item.phone || '', email: item.email || '', address: item.address || '', city: item.city || '', is_active: item.is_active, notes: item.notes || '' }); setModalOpen(true); };

  const handleSubmit = async () => {
    if (!form.name) { toast({ variant: 'destructive', title: 'Nama wajib diisi' }); return; }
    setSubmitting(true);
    try {
      if (editing) { await base44.entities.Supplier.update(editing.id, form); toast({ title: 'Supplier diperbarui' }); }
      else { const code = await generateSupplierCode(); await base44.entities.Supplier.create({ ...form, code }); toast({ title: 'Supplier ditambahkan' }); }
      setModalOpen(false); loadData();
    } catch (e) { toast({ variant: 'destructive', title: 'Gagal menyimpan', description: e.message }); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (item) => {
    if (!confirm(`Nonaktifkan supplier "${item.name}"?`)) return;
    try { await base44.entities.Supplier.update(item.id, { is_active: false }); toast({ title: 'Supplier dinonaktifkan' }); loadData(); }
    catch { toast({ variant: 'destructive', title: 'Gagal' }); }
  };

  const columns = [
    { key: 'code', header: 'Kode', sortable: true, className: 'font-mono font-medium' },
    { key: 'name', header: 'Nama Supplier', sortable: true, className: 'font-medium' },
    { key: 'contact_person', header: 'Kontak', render: (row) => row.contact_person || '—' },
    { key: 'phone', header: 'Telepon', render: (row) => row.phone || '—' },
    { key: 'city', header: 'Kota', render: (row) => row.city || '—' },
    {
      key: 'is_active', header: 'Status',
      render: (row) => row.is_active
        ? <span className="text-[11px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded font-semibold">Aktif</span>
        : <span className="text-[11px] px-2 py-0.5 bg-slate-100 text-slate-400 rounded">Nonaktif</span>
    },
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
      <PageHeader title="Master Supplier" description="Kelola data supplier bahan"
        actions={<Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Tambah Supplier</Button>} />
      <DataTable columns={columns} data={data} loading={loading} emptyMessage="Belum ada supplier" searchKeys={['code', 'name', 'contact_person', 'city']} searchPlaceholder="Cari supplier..." />
      <FormModal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Supplier' : 'Tambah Supplier'} onSubmit={handleSubmit} submitting={submitting}>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-[12.5px] mb-1">Kode Supplier</Label><Input value={editing ? form.code : ''} placeholder="Otomatis" className="h-9 text-[13px] font-mono bg-muted/40" disabled readOnly /></div>
          <div><Label className="text-[12.5px] mb-1">Nama Supplier *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Kontak Person</Label><Input value={form.contact_person} onChange={e => setForm({ ...form, contact_person: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Telepon</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Kota</Label><Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} className="h-9 text-[13px]" /></div>
        </div>
        <div><Label className="text-[12.5px] mb-1">Alamat</Label><Textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} rows={2} className="text-[13px]" /></div>
        <div><Label className="text-[12.5px] mb-1">Catatan</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="text-[13px]" /></div>
        <div className="flex items-center gap-2 pt-1"><Switch checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} /><Label className="text-[12.5px]">Aktif</Label></div>
      </FormModal>
    </div>
  );
}