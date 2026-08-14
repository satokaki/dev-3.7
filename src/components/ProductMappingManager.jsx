import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import FormModal from '@/components/FormModal';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import NumberInput from '@/components/NumberInput';
import SearchableSelect from '@/components/SearchableSelect';
import { Plus, Trash2, Star } from 'lucide-react';
import { getAllStockBalances } from '@/lib/stockUtils';

const COMPONENTS = [
  { type: 'bottle', label: 'Botol', materialTypes: ['BOTTLE'], perUnit: false },
  { type: 'box', label: 'Box', materialTypes: ['PACKAGING'], perUnit: true },
  { type: 'label', label: 'Label', materialTypes: ['LABEL', 'STICKER'], perUnit: true },
  { type: 'excise', label: 'Cukai', materialTypes: ['EXCISE'], perUnit: true },
];

export default function ProductMappingManager({ product, onClose }) {
  const { toast } = useToast();
  const [mappings, setMappings] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [stocks, setStocks] = useState({});
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState({
    bottle: { material_id: '', quantity_per_unit: '1' },
    box: { material_id: '', quantity_per_unit: '1' },
    label: { material_id: '', quantity_per_unit: '1' },
    excise: { material_id: '', quantity_per_unit: '1' },
  });

  const loadData = useCallback(async () => {
    if (!product) return;
    setLoading(true);
    try {
      const [maps, mats, balances] = await Promise.all([
        base44.entities.ProductComponentMapping.filter({ product_id: product.id }),
        base44.entities.Material.filter({ is_active: true }),
        getAllStockBalances('material'),
      ]);
      setMappings(maps);
      setMaterials(mats);
      const sm = {};
      balances.forEach(b => { sm[b.item_id] = (sm[b.item_id] || 0) + (b.available_quantity || 0); });
      setStocks(sm);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat mapping' }); }
    finally { setLoading(false); }
  }, [product, toast]);

  useEffect(() => { if (product) loadData(); }, [product, loadData]);

  if (!product) return null;

  const byType = (t) => mappings.filter(m => m.component_type === t && m.is_active !== false);

  const candidates = (comp) => {
    const mappedIds = new Set(byType(comp.type).map(m => m.material_id));
    return materials.filter(m => comp.materialTypes.includes(m.material_type) && !mappedIds.has(m.id));
  };

  const handleAdd = async (comp) => {
    const add = adding[comp.type];
    if (!add.material_id) { toast({ variant: 'destructive', title: 'Pilih item dulu' }); return; }
    try {
      const mat = materials.find(m => m.id === add.material_id);
      await base44.entities.ProductComponentMapping.create({
        product_id: product.id, product_name: product.name,
        component_type: comp.type,
        material_id: mat.id, material_code: mat.code || '', material_name: mat.name,
        quantity_per_unit: Number(add.quantity_per_unit) || 1,
        is_default: byType(comp.type).length === 0,
        is_active: true,
      });
      toast({ title: `${comp.label} ditambahkan ke mapping` });
      setAdding(a => ({ ...a, [comp.type]: { material_id: '', quantity_per_unit: '1' } }));
      loadData();
    } catch (e) { toast({ variant: 'destructive', title: 'Gagal menambah', description: e.message }); }
  };

  const handleRemove = async (m) => {
    if (!confirm(`Hapus "${m.material_name}" dari mapping?`)) return;
    try { await base44.entities.ProductComponentMapping.delete(m.id); toast({ title: 'Mapping dihapus' }); loadData(); }
    catch { toast({ variant: 'destructive', title: 'Gagal menghapus' }); }
  };

  const handleSetDefault = async (comp, m) => {
    try {
      await Promise.all(byType(comp.type).map(x => base44.entities.ProductComponentMapping.update(x.id, { is_default: x.id === m.id })));
      loadData();
    } catch { toast({ variant: 'destructive', title: 'Gagal mengubah default' }); }
  };

  const Section = ({ comp }) => {
    const list = byType(comp.type);
    const opts = candidates(comp).map(m => ({
      value: m.id,
      label: `${m.code || ''} · ${m.name} · Stok: ${stocks[m.id] || 0} ${m.unit || 'pcs'}`,
      keywords: `${m.code || ''} ${m.name} ${m.specification || ''} ${m.category_name || ''}`,
    }));
    const add = adding[comp.type];
    return (
      <div className="space-y-2">
        {list.length === 0 && <p className="text-[12px] text-muted-foreground italic">Belum ada {comp.label.toLowerCase()} kompatibel.</p>}
        {list.map(m => (
          <div key={m.id} className="flex items-center justify-between border border-border rounded-lg px-3 py-2 bg-muted/10">
            <div className="flex items-center gap-2 min-w-0">
              <button type="button" onClick={() => handleSetDefault(comp, m)} title={m.is_default ? 'Default' : 'Jadikan default'}>
                <Star className={`w-4 h-4 ${m.is_default ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40'}`} />
              </button>
              <div className="min-w-0">
                <div className="text-[13px] font-medium truncate">{m.material_name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {comp.perUnit && `${m.quantity_per_unit || 1} per unit · `}Stok: {stocks[m.material_id] || 0} pcs
                </div>
              </div>
            </div>
            <button type="button" onClick={() => handleRemove(m)} className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        <div className="border-t border-dashed pt-2">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label className="text-[11.5px] mb-1">Tambah {comp.label}</Label>
              <SearchableSelect
                value={add.material_id}
                onValueChange={v => setAdding(a => ({ ...a, [comp.type]: { ...a[comp.type], material_id: v } }))}
                options={opts}
                placeholder={opts.length ? `Cari ${comp.label.toLowerCase()}...` : `Tidak ada ${comp.label.toLowerCase()} tersedia`}
                className="h-9"
              />
            </div>
            {comp.perUnit && (
              <div className="w-24">
                <Label className="text-[11.5px] mb-1">Per Unit</Label>
                <NumberInput value={add.quantity_per_unit} onChange={v => setAdding(a => ({ ...a, [comp.type]: { ...a[comp.type], quantity_per_unit: v } }))} allowDecimal min={0} className="h-9 text-[13px]" />
              </div>
            )}
            <Button type="button" size="sm" onClick={() => handleAdd(comp)} className="h-9 gap-1"><Plus className="w-3.5 h-3.5" /> Tambah</Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <FormModal
      open={!!product}
      onClose={onClose}
      title={`Mapping Komponen — ${product.name}`}
      onSubmit={(e) => { e?.preventDefault?.(); onClose(); }}
      submitting={false}
      submitLabel="Selesai"
      size="lg"
    >
      {loading ? (
        <div className="py-8 text-center text-[12px] text-muted-foreground">Memuat...</div>
      ) : (
        <Tabs defaultValue="bottle">
          <TabsList className="w-full">
            <TabsTrigger value="bottle" className="flex-1">Botol</TabsTrigger>
            <TabsTrigger value="box" className="flex-1">Box</TabsTrigger>
            <TabsTrigger value="label" className="flex-1">Label</TabsTrigger>
            <TabsTrigger value="excise" className="flex-1">Cukai</TabsTrigger>
          </TabsList>
          <TabsContent value="bottle" className="pt-3"><Section comp={COMPONENTS[0]} /></TabsContent>
          <TabsContent value="box" className="pt-3"><Section comp={COMPONENTS[1]} /></TabsContent>
          <TabsContent value="label" className="pt-3"><Section comp={COMPONENTS[2]} /></TabsContent>
          <TabsContent value="excise" className="pt-3"><Section comp={COMPONENTS[3]} /></TabsContent>
        </Tabs>
      )}
      <div className="text-[11px] text-muted-foreground bg-muted/30 rounded px-2 py-1.5 mt-2">
        Bintang = pilihan default saat operator tidak memilih manual. Stok ditampilkan untuk referensi.
      </div>
    </FormModal>
  );
}