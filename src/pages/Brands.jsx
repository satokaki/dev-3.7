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
import { Switch } from '@/components/ui/switch';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { generateBrandCode } from '@/lib/sequence';

export default function Brands() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', logo_url: '', is_active: true, notes: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const items = await base44.entities.Brand.list('-created_date', 100);
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
    setForm({ code: '', name: '', logo_url: '', is_active: true, notes: '' });
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({ code: item.code, name: item.name, logo_url: item.logo_url || '', is_active: item.is_active, notes: item.notes || '' });
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
        await base44.entities.Brand.update(editing.id, form);
        toast({ title: 'Merk berhasil diperbarui' });
      } else {
        const code = await generateBrandCode();
        await base44.entities.Brand.create({ ...form, code });
        toast({ title: 'Merk berhasil ditambahkan' });
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
    if (!confirm(`Nonaktifkan merk "${item.name}"?`)) return;
    try {
      await base44.entities.Brand.update(item.id, { is_active: false });
      toast({ title: 'Merk dinonaktifkan' });
      loadData();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Gagal menonaktifkan' });
    }
  };

  const columns = [
    { key: 'code', header: 'Kode', sortable: true, className: 'font-mono font-medium' },
    { key: 'name', header: 'Nama Merk', sortable: true, className: 'font-medium' },
    {
      key: 'logo_url', header: 'Logo',
      render: (row) => row.logo_url
        ? <img src={row.logo_url} alt="" className="w-8 h-8 rounded object-cover" />
        : <div className="w-8 h-8 rounded bg-muted flex items-center justify-center text-[10px] text-muted-foreground">—</div>
    },
    {
      key: 'is_active', header: 'Status',
      render: (row) => row.is_active
        ? <StatusBadge status="approved" />
        : <span className="text-[11px] text-muted-foreground px-2 py-0.5 bg-slate-100 rounded">Nonaktif</span>
    },
    { key: 'notes', header: 'Catatan', render: (row) => row.notes || '—' },
    {
      key: 'actions', header: '', width: '80px',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="p-1.5 hover:bg-muted rounded">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); handleDelete(row); }} className="p-1.5 hover:bg-red-50 rounded text-red-500">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )
    },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader
        title="Master Merk"
        description="Kelola merk e-liquid"
        actions={
          <Button onClick={openAdd} size="sm" className="gap-1.5">
            <Plus className="w-4 h-4" /> Tambah Merk
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        emptyMessage="Belum ada merk"
        searchKeys={['code', 'name', 'notes']}
        searchPlaceholder="Cari merk..."
      />
      <FormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Merk' : 'Tambah Merk'}
        onSubmit={handleSubmit}
        submitting={submitting}
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[12.5px] mb-1">Kode Merk</Label>
            <Input value={editing ? form.code : ''} placeholder="Otomatis" className="h-9 text-[13px] font-mono bg-muted/40" disabled readOnly />
          </div>
          <div>
            <Label className="text-[12.5px] mb-1">Nama Merk *</Label>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-[13px]" />
          </div>
        </div>
        <div>
          <Label className="text-[12.5px] mb-1">Logo URL</Label>
          <Input value={form.logo_url} onChange={e => setForm({ ...form, logo_url: e.target.value })} className="h-9 text-[13px]" placeholder="https://..." />
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