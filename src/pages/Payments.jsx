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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { generatePaymentNumber } from '@/lib/sequence';
import { createAuditLog } from '@/lib/stockUtils';
import NumberInput from '@/components/NumberInput';
import PdfButton from '@/components/PdfButton';
import { exportDocumentToPDF } from '@/lib/pdfExport';
import { formatCurrency as fmtMoney } from '@/lib/format';

export default function Payments() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [unpaidSales, setUnpaidSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [allocations, setAllocations] = useState([]);
  const [remaining, setRemaining] = useState(0);
  const [form, setForm] = useState({ customer_id: '', payment_date: new Date().toISOString().slice(0, 10), total_payment: 0, payment_method: 'cash', cash_account: '', reference_number: '', notes: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [items, custs] = await Promise.all([
        base44.entities.CustomerPayment.list('-created_date', 100),
        base44.entities.Customer.filter({ is_active: true }),
      ]);
      setData(items);
      setCustomers(custs);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadUnpaidSales = async (customerId) => {
    if (!customerId) { setUnpaidSales([]); return; }
    try {
      const sales = await base44.entities.Sale.filter({ customer_id: customerId, transaction_status: 'posted' });
      const unpaid = sales.filter(s => s.remaining_receivable > 0);
      setUnpaidSales(unpaid);
      setAllocations(unpaid.map(s => ({ sale_id: s.id, invoice_number: s.invoice_number, invoice_balance_before: s.remaining_receivable, allocated_amount: 0, invoice_balance_after: s.remaining_receivable })));
    } catch { setUnpaidSales([]); }
  };

  const totalAllocated = allocations.reduce((sum, a) => sum + Number(a.allocated_amount || 0), 0);
  const remainingAmount = Number(form.total_payment) - totalAllocated;

  const updateAllocation = (idx, value) => {
    setAllocations(prev => {
      const next = [...prev];
      const n = value === '' || value === null ? 0 : Number(value);
      const val = Math.min(n, next[idx].invoice_balance_before);
      next[idx] = { ...next[idx], allocated_amount: value === '' ? '' : String(val), invoice_balance_after: next[idx].invoice_balance_before - val };
      return next;
    });
  };

  const autoAllocate = () => {
    let remaining = Number(form.total_payment);
    setAllocations(prev => prev.map(a => {
      if (remaining <= 0) return { ...a, allocated_amount: 0, invoice_balance_after: a.invoice_balance_before };
      const alloc = Math.min(remaining, a.invoice_balance_before);
      remaining -= alloc;
      return { ...a, allocated_amount: alloc, invoice_balance_after: a.invoice_balance_before - alloc };
    }));
  };

  const openAdd = () => {
    setForm({ customer_id: '', payment_date: new Date().toISOString().slice(0, 10), total_payment: 0, payment_method: 'cash', cash_account: '', reference_number: '', notes: '' });
    setUnpaidSales([]);
    setAllocations([]);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.customer_id || Number(form.total_payment) <= 0) { toast({ variant: 'destructive', title: 'Customer dan nominal pembayaran wajib diisi' }); return; }
    if (totalAllocated > Number(form.total_payment)) { toast({ variant: 'destructive', title: 'Total alokasi melebihi pembayaran' }); return; }
    setSubmitting(true);
    try {
      const customer = customers.find(c => c.id === form.customer_id);
      const payNumber = await generatePaymentNumber();
      const payment = await base44.entities.CustomerPayment.create({
        payment_number: payNumber,
        payment_date: form.payment_date,
        customer_id: form.customer_id, customer_name: customer?.name || '',
        total_payment: Number(form.total_payment),
        payment_method: form.payment_method,
        cash_account: form.cash_account,
        reference_number: form.reference_number,
        notes: form.notes,
      });
      // Create allocations and update sale balances
      for (const alloc of allocations) {
        if (Number(alloc.allocated_amount) <= 0) continue;
        await base44.entities.PaymentAllocation.create({
          payment_id: payment.id, sale_id: alloc.sale_id, invoice_number: alloc.invoice_number,
          allocated_amount: Number(alloc.allocated_amount),
          invoice_balance_before: alloc.invoice_balance_before,
          invoice_balance_after: alloc.invoice_balance_after,
        });
        const sale = unpaidSales.find(s => s.id === alloc.sale_id);
        if (sale) {
          const newTotalPayment = (sale.total_payment || 0) + Number(alloc.allocated_amount);
          const newRemaining = sale.total - newTotalPayment;
          const newStatus = newRemaining <= 0 ? 'lunas' : 'sebagian_dibayar';
          await base44.entities.Sale.update(sale.id, {
            total_payment: newTotalPayment,
            remaining_receivable: newRemaining,
            payment_status: newStatus,
          });
        }
      }
      await createAuditLog({ module: 'Pembayaran', action: 'Catat', entity_type: 'CustomerPayment', entity_id: payment.id, reference_number: payNumber });
      toast({ title: 'Pembayaran berhasil dicatat', description: payNumber });
      setModalOpen(false); loadData();
    } catch (e) { toast({ variant: 'destructive', title: 'Gagal menyimpan', description: e.message }); }
    finally { setSubmitting(false); }
  };

  const exportPaymentPDF = async (row) => {
    try {
      const allocs = await base44.entities.PaymentAllocation.filter({ payment_id: row.id });
      exportDocumentToPDF({
        title: 'Kuitansi Pembayaran',
        docNumber: row.payment_number, docDate: row.payment_date,
        partyLabel: 'Diterima dari', party: { name: row.customer_name },
        infoLines: [
          { label: 'Metode', value: row.payment_method },
          { label: 'Kas/Rekening', value: row.cash_account || '-' },
          { label: 'No. Referensi', value: row.reference_number || '-' },
        ],
        itemColumns: [
          { key: 'no', header: '#', width: 24, align: 'right' },
          { key: 'invoice_number', header: 'Invoice' },
          { key: 'allocated_amount', header: 'Alokasi', width: 120, align: 'right' },
          { key: 'invoice_balance_after', header: 'Sisa Invoice', width: 120, align: 'right' },
        ],
        itemRows: allocs.map((a, i) => ({ no: i + 1, invoice_number: a.invoice_number, allocated_amount: fmtMoney(a.allocated_amount), invoice_balance_after: fmtMoney(a.invoice_balance_after) })),
        totals: [{ label: 'Total Pembayaran', value: fmtMoney(row.total_payment), bold: true }],
        notes: row.notes,
        fileName: `kuitansi-${row.payment_number}.pdf`,
      });
    } catch { toast({ variant: 'destructive', title: 'Gagal membuat PDF' }); }
  };

  const columns = [
    { key: 'payment_number', header: 'No. Pembayaran', sortable: true, className: 'font-mono font-medium' },
    { key: 'payment_date', header: 'Tanggal', sortable: true },
    { key: 'customer_name', header: 'Customer', sortable: true, className: 'font-medium' },
    { key: 'total_payment', header: 'Total', render: (row) => <span className="tabular-nums">{fmtMoney(row.total_payment)}</span> },
    { key: 'payment_method', header: 'Metode', render: (row) => <span className="text-[11px] px-2 py-0.5 bg-muted rounded uppercase">{row.payment_method}</span> },
    { key: 'cash_account', header: 'Kas/Rekening', render: (row) => row.cash_account || '—' },
    { key: 'reference_number', header: 'Ref.', render: (row) => row.reference_number || '—' },
    { key: 'actions', header: '', width: '56px', render: (row) => <PdfButton onExport={() => exportPaymentPDF(row)} perm="payments" iconOnly label="Cetak Kuitansi" /> },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Pembayaran Piutang" description="Catat pembayaran customer dan alokasi invoice"
        actions={<Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Pembayaran Baru</Button>} />
      <DataTable columns={columns} data={data} loading={loading} emptyMessage="Belum ada pembayaran" searchKeys={['payment_number', 'customer_name']} searchPlaceholder="Cari pembayaran..." />

      <FormModal open={modalOpen} onClose={() => setModalOpen(false)} title="Pembayaran Piutang Baru" onSubmit={handleSubmit} submitting={submitting} submitLabel="Catat Pembayaran" size="lg">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[12.5px] mb-1">Customer *</Label>
            <Select value={form.customer_id} onValueChange={v => { setForm({ ...form, customer_id: v }); loadUnpaidSales(v); }}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pilih customer" /></SelectTrigger>
              <SelectContent>{customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-[12.5px] mb-1">Tanggal</Label><Input type="date" value={form.payment_date} onChange={e => setForm({ ...form, payment_date: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Total Pembayaran *</Label><NumberInput value={form.total_payment} onChange={v => setForm({ ...form, total_payment: v })} allowDecimal min={0} className="h-9 text-[13px]" /></div>
          <div>
            <Label className="text-[12.5px] mb-1">Metode</Label>
            <Select value={form.payment_method} onValueChange={v => setForm({ ...form, payment_method: v })}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="transfer">Transfer</SelectItem></SelectContent>
            </Select>
          </div>
          <div><Label className="text-[12.5px] mb-1">Kas/Rekening</Label><Input value={form.cash_account} onChange={e => setForm({ ...form, cash_account: e.target.value })} className="h-9 text-[13px]" /></div>
          <div><Label className="text-[12.5px] mb-1">Nomor Referensi</Label><Input value={form.reference_number} onChange={e => setForm({ ...form, reference_number: e.target.value })} className="h-9 text-[13px]" /></div>
        </div>

        {unpaidSales.length > 0 && (
          <div className="border-t pt-3">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-[12.5px] font-semibold">Alokasi ke Invoice</Label>
              <Button type="button" onClick={autoAllocate} size="sm" variant="outline" className="h-7 text-[12px]">Auto Alokasi (Invoice Terlama)</Button>
            </div>
            <div className="overflow-x-auto max-h-52 overflow-y-auto">
              <table className="w-full text-[11.5px]">
                <thead><tr className="bg-muted/40 text-muted-foreground sticky top-0">
                  <th className="px-2 py-1 text-left">Invoice</th>
                  <th className="px-2 py-1 text-right">Saldo Invoice</th>
                  <th className="px-2 py-1 text-right">Alokasi</th>
                  <th className="px-2 py-1 text-right">Sisa</th>
                </tr></thead>
                <tbody>
                  {allocations.map((a, idx) => (
                    <tr key={idx} className="border-b border-border/30">
                      <td className="px-2 py-1 font-mono">{a.invoice_number}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(a.invoice_balance_before)}</td>
                      <td className="px-2 py-1"><NumberInput value={a.allocated_amount} onChange={v => updateAllocation(idx, v)} allowDecimal min={0} className="h-7 text-[11.5px] text-right" max={a.invoice_balance_before} /></td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(a.invoice_balance_after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between mt-2 text-[12px]">
              <span>Total Alokasi: <b>{fmtMoney(totalAllocated)}</b></span>
              <span className={remainingAmount < 0 ? 'text-red-600' : 'text-emerald-600'}>Sisa Pembayaran: <b>{fmtMoney(remainingAmount)}</b></span>
            </div>
          </div>
        )}
        {form.customer_id && unpaidSales.length === 0 && (
          <div className="text-center py-4 text-[12px] text-muted-foreground border border-dashed rounded">Tidak ada invoice belum lunas untuk customer ini</div>
        )}
        <div><Label className="text-[12.5px] mb-1">Catatan</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="text-[13px]" /></div>
      </FormModal>
    </div>
  );
}