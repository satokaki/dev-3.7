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
import { generateWarehouseCode } from '@/lib/sequence';

const warehouseTypes = [
  { value: 'gudang_bahan', label: 'Gudang Bahan' },
  { value: 'area_produksi', label: 'Area Produksi' },
  { value: 'area_bulk', label: 'Area Bulk' },
  { value: 'area_siap_labeling', label: 'Area Siap Labeling' },
  { value: 'area_belum_cukai', label: 'Area Belum Cukai' },
  { value: 'gudang_barang_jadi', label: 'Gudang Barang Jadi' },
  { value: 'gudang_retur', label: 'Gudang Retur' },
];
const wtLabel = (v) => warehouseTypes.find(t => t.value === v)?.label || v;

export default function Warehouses() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', warehouse_type: 'gudang_bahan', is_active: true, notes: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const items = await base44.entities.Warehouse.list('-created_date', 100);
      setData(items);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const openAdd = () => { setEditing(null); setForm({ code: '', name: '', warehouse_type: 'gudang_bahan', is_active: true, notes: '' }); setModalOpen(true); };
  const openEdit = (item) => { setEditing(item); setForm({ code: item.code, name: item.name, warehouse_type: item.warehouse_type, is_active: item.is_active, notes: item.notes || '' }); setModalOpen(true); };

  const handleSubmit = async () => {
    if (!form.name) { toast({ variant: 'destructive', title: 'Nama wajib diisi' }); return; }
    setSubmitting(true);
    try {
      if (editing) { await base44.entities.Warehouse.update(editing.id, form); toast({ title: 'Gudang diperbarui' }); }
      else { const code = await generateWarehouseCode(); await base44.entities.Warehouse.create({ ...form, code }); toast({ title: 'Gudang ditambahkan' }); }
      setModalOpen(false); loadData();
    } catch (e) { toast({ variant: 'destructive', title: 'Gagal menyimpan', description: e.message }); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (item) => {
    if (!confirm(`Nonaktifkan gudang "${item.name}"?`)) return;
    try { await base44.entities.Warehouse.update(item.id, { is_active: false }); toast({ title: 'Gudang dinonaktifkan' }); loadData(); }
    catch { toast({ variant: 'destructive', title: 'Gagal' }); }
  };

  const columns = [
    { key: 'code', header: 'Kode', sortable: true, className: 'font-mono font-medium' },
    { key: 'name', header: 'Nama Gudang', sortable: true, className: 'font-medium' },
    { key: 'warehouse_type', header: 'Jenis', render: (row) => <span className="text-[11px] px-2 py-0.5 bg-muted rounded">{wtLabel(row.warehouse_type)}</span> },
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
      <PageHeader title="Master Gudang" description="Gudang dan lokasi stok"
        actions={<Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Tambah Gudang</Button>} />
      <DataTable columns={columns} data={data} loading={loading} emptyMessage="Belum ada gudang" searchKeys={['code', 'name']} searchPlaceholder="Cari gudang..." />
      <FormModal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Gudang' : 'Tambah Gudang'} onSubmit={handleSubmit} submitting={submitting}>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-[12.5px] mb-1">Kode Gudang</Label><Input value={editing ? form.code : ''} placeholder="Otomatis" className="h-9 text-[13px] font-mono bg-muted/40" disabled readOnly /></div>
          <div>
            <Label className="text-[12.5px] mb-1">Jenis Gudang</Label>
            <Select value={form.warehouse_type} onValueChange={v => setForm({ ...form, warehouse_type: v })}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>{warehouseTypes.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div><Label className="text-[12.5px] mb-1">Nama Gudang *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-[13px]" /></div>
        <div><Label className="text-[12.5px] mb-1">Catatan</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="text-[13px]" /></div>
        <div className="flex items-center gap-2 pt-1"><Switch checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} /><Label className="text-[12.5px]">Aktif</Label></div>
      </FormModal>
    </div>
  );
}