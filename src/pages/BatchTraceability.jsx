import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import StatusBadge from '@/components/StatusBadge';
import { Search, Layers, Factory, Package, Tag, Stamp, ShoppingCart } from 'lucide-react';
import { formatCurrency as fmtMoney } from '@/lib/format';

export default function BatchTraceability() {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [productions, setProductions] = useState([]);
  const [bottlings, setBottlings] = useState([]);
  const [labelings, setLabelings] = useState([]);
  const [excises, setExcises] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, blgs, lbls, excs, sls] = await Promise.all([
        base44.entities.ProductionOrder.list('-created_date', 200),
        base44.entities.BottlingOrder.list('-created_date', 200),
        base44.entities.LabelingOrder.list('-created_date', 200),
        base44.entities.ExciseOrder.list('-created_date', 200),
        base44.entities.Sale.list('-created_date', 200),
      ]);
      setProductions(prods);
      setBottlings(blgs);
      setLabelings(lbls);
      setExcises(excs);
      setSales(sls);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredProductions = productions.filter(p =>
    !search || p.batch_number?.toLowerCase().includes(search.toLowerCase()) || p.production_number?.toLowerCase().includes(search.toLowerCase()) || p.product_name?.toLowerCase().includes(search.toLowerCase())
  );

  const batchTimeline = selectedBatch ? [
    { icon: Factory, label: 'Produksi', date: selectedBatch.production_date, number: selectedBatch.production_number, details: [`Batch: ${selectedBatch.batch_number}`, `Produk: ${selectedBatch.product_name || '—'}`, `Merk: ${selectedBatch.brand_name || '—'}`, `Target: ${selectedBatch.target_volume} ml`, `Operator: ${selectedBatch.operator || '—'}`], status: selectedBatch.status },
    ...(bottlings.filter(b => b.batch_number === selectedBatch.batch_number).map(b => ({ icon: Package, label: 'Bottling', date: b.bottling_date, number: b.bottling_number, details: [`Bulk: ${b.total_bulk_processed} ml`, `Output: ${b.total_output} ml`, `Waste: ${b.waste} ml`, `Operator: ${b.operator || '—'}`], status: b.status }))),
    ...(labelings.filter(l => l.batch_number === selectedBatch.batch_number).map(l => ({ icon: Tag, label: 'Labeling', date: l.labeling_date, number: l.labeling_number, details: [`Jumlah: ${l.quantity}`, `Label: ${l.label_type || '—'}`, `Operator: ${l.operator || '—'}`], status: l.status }))),
    ...(excises.filter(e => e.batch_number === selectedBatch.batch_number).map(e => ({ icon: Stamp, label: 'Proses Cukai', date: e.excise_date, number: e.excise_number, details: [`Jumlah: ${e.quantity}`, `Ref: ${e.excise_reference_number || '—'}`, `Operator: ${e.operator || '—'}`], status: e.status }))),
    ...(sales.filter(s => s.invoice_number?.includes(selectedBatch.batch_number)).map(s => ({ icon: ShoppingCart, label: 'Penjualan', date: s.transaction_date, number: s.invoice_number, details: [`Customer: ${s.customer_name}`, `Total: ${fmtMoney(s.total)}`, `Metode: ${s.payment_method}`], status: s.transaction_status }))),
  ] : [];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Traceability Batch" description="Telusuri produk dari produksi hingga penjualan" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Batch List */}
        <div className="lg:col-span-1">
          <div className="bg-white border border-border rounded-lg p-3">
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari batch..." className="h-8 text-[12px] pl-8" />
            </div>
            <div className="space-y-1.5 max-h-[calc(100vh-260px)] overflow-y-auto">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 bg-muted/50 rounded animate-pulse" />)
              ) : filteredProductions.length === 0 ? (
                <div className="text-center py-8 text-[12px] text-muted-foreground">Tidak ada batch</div>
              ) : filteredProductions.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedBatch(p)}
                  className={`w-full text-left p-2.5 rounded-lg border transition-colors ${selectedBatch?.id === p.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30'}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] font-mono font-semibold">{p.batch_number}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="text-[11px] text-muted-foreground">{p.product_name || '—'} · {p.production_date}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-border rounded-lg p-4">
            {!selectedBatch ? (
              <div className="text-center py-16 text-muted-foreground">
                <Layers className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <div className="text-[13px]">Pilih batch untuk melihat traceability</div>
              </div>
            ) : (
              <>
                <div className="mb-4 pb-3 border-b border-border">
                  <h2 className="text-[15px] font-bold">{selectedBatch.batch_number}</h2>
                  <p className="text-[12px] text-muted-foreground mt-0.5">{selectedBatch.product_name} · {selectedBatch.brand_name}</p>
                </div>
                <div className="space-y-0">
                  {batchTimeline.map((step, idx) => {
                    const Icon = step.icon;
                    return (
                      <div key={idx} className="flex gap-3 pb-4">
                        <div className="flex flex-col items-center">
                          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <Icon className="w-4 h-4 text-primary" />
                          </div>
                          {idx < batchTimeline.length - 1 && <div className="w-0.5 flex-1 bg-border mt-1" />}
                        </div>
                        <div className="flex-1 min-w-0 pb-2">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[13px] font-semibold">{step.label}</span>
                            <span className="text-[10.5px] text-muted-foreground">{step.date}</span>
                            <StatusBadge status={step.status} />
                          </div>
                          <div className="text-[11.5px] font-mono text-muted-foreground mb-1.5">{step.number}</div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11.5px]">
                            {step.details.map((d, i) => <div key={i} className="text-muted-foreground">{d}</div>)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}