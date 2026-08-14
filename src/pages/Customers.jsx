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
import NumberInput from '@/components/NumberInput';
import { Plus, Pencil, Trash2, Lock } from 'lucide-react';
import { generateCustomerCode } from '@/lib/sequence';
import { formatCurrency as fmtMoney } from '@/lib/format';

export default function Customers() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', city: '', sales_person: '', credit_limit: '', default_payment_terms: '', is_active: true, notes: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const items = await base44.entities.Customer.list('-created_date', 200);
      setData(items);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const openAdd = () => { setEditing(null); setForm({ name: '', phone: '', email: '', address: '', city: '', sales_person: '', credit_limit: '', default_payment_terms: '', is_active: true, notes: '' }); setModalOpen(true); };
  const openEdit = (item) => {
    setEditing(item);
    setForm({ name: item.name, phone: item.phone || '', email: item.email || '', address: item.address || '', city: item.city || '', sales_person: item.sales_person || '', credit_limit: item.credit_limit ?? '', default_payment_terms: item.default_payment_terms ?? '', is_active: item.is_active, notes: item.notes || '' });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name) { toast({ variant: 'destructive', title: 'Nama wajib diisi' }); return; }
    setSubmitting(true);
    try {
      if (editing) {
        await base44.entities.Customer.update(editing.id, form);
        toast({ title: 'Customer diperbarui' });
      } else {
        const code = await generateCustomerCode();
        await base44.entities.Customer.create({ ...form, code });
        toast({ title: 'Customer ditambahkan', description: `Kode: ${code}` });
      }
      setModalOpen(false); loadData();
    } catch (e) { toast({ variant: 'destructive', title: 'Gagal menyimpan', description: e.message }); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (item) => {
    if (!confirm(`Nonaktifkan customer "${item.name}"?`)) return;
    try { await base44.entities.Customer.update(item.id, { is_active: false }); toast({ title: 'Customer dinonaktifkan' }); loadData(); }
    catch { toast({ variant: 'destructive', title: 'Gagal' }); }
  };

  const columns = [
    { key: 'code', header: 'Kode', sortable: true, className: 'font-mono font-medium', render: (row) => <span className="flex items-center gap-1">{row.code}<Lock className="w-3 h-3 text-muted-foreground/40" /></span> },
    { key: 'name', header: 'Nama Customer', sortable: true, className: 'font-medium' },
    { key: 'phone', header: 'Telepon', render: (row) => row.phone || '—' },
    { key: 'city', header: 'Kota', render: (row) => row.city || '—' },
    { key: 'sales_person', header: 'Sales', render: (row) => row.sales_person || '—' },
    { key: 'credit_limit', header: 'Limit Piutang', render: (row) => <span className="tabular-nums">{fmtMoney(row.credit_limit)}</span> },
    { key: 'default_payment_terms', header: 'Termin', render: (row) => row.default_payment_terms ? `${row.default_payment_terms} hari` : '—' },
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
      <PageHeader title="Master Customer" description="Kode customer auto-generate (CUS-YYYY-00001)"
        actions={<Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Tambah Customer</Button>} />
      <DataTable columns={columns} data={data} loading={loading} emptyMessage="Belum ada customer" searchKeys={['code', 'name', 'city', 'sales_person']} searchPlaceholder="Cari customer..." />
      <FormModal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Customer' : 'Tambah Customer'} onSubmit={handleSubmit} submitting={submitting}>
        <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-[11.5px] text-blue-700 mb-1">
          {!editing && 'Kode customer dibuat otomatis oleh sistem (CUS-YYYY-00001)'}
          {editing && `Kode: ${editing.code} (tidak dapat diubah)`}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label className="text-[12.5px] mb-1">Nama Customer *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Telepon</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Kota</Label><Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Sales</Label><Input value={form.sales_person} onChange={e => setForm({ ...form, sales_person: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Limit Piutang (Rp)</Label><NumberInput value={form.credit_limit} onChange={v => setForm({ ...form, credit_limit: v })} allowDecimal min={0} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Termin Default (hari)</Label><NumberInput value={form.default_payment_terms} onChange={v => setForm({ ...form, default_payment_terms: v })} allowDecimal={false} min={0} className="h-9 text-[13px]" /></div>
        </div>
        <div><Label className="text-[12.5px] mb-1">Alamat</Label><Textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} rows={2} className="text-[13px]" /></div>
        <div><Label className="text-[12.5px] mb-1">Catatan</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="text-[13px]" /></div>
        <div className="flex items-center gap-2 pt-1"><Switch checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} /><Label className="text-[12.5px]">Aktif</Label></div>
      </FormModal>
    </div>
  );
}