import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import StatusBadge from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, TrendingUp } from 'lucide-react';
import PdfButton from '@/components/PdfButton';
import { exportReportToPDF } from '@/lib/pdfExport';
import { useAuth } from '@/lib/AuthContext';
import { formatCurrency as fmtMoney } from '@/lib/format';

export default function SalesReport() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ date_from: '', date_to: '', customer_id: '', payment_method: '', transaction_status: '', payment_status: '' });
  const [customers, setCustomers] = useState([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [items, custs] = await Promise.all([
        base44.entities.Sale.list('-created_date', 500),
        base44.entities.Customer.list(),
      ]);
      setData(items);
      setCustomers(custs);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = data.filter(s => {
    if (s.transaction_status === 'draft') return false;
    if (filters.date_from && s.transaction_date < filters.date_from) return false;
    if (filters.date_to && s.transaction_date > filters.date_to) return false;
    if (filters.customer_id && s.customer_id !== filters.customer_id) return false;
    if (filters.payment_method && s.payment_method !== filters.payment_method) return false;
    if (filters.transaction_status && s.transaction_status !== filters.transaction_status) return false;
    if (filters.payment_status && s.payment_status !== filters.payment_status) return false;
    return true;
  });

  const totalSales = filtered.reduce((s, r) => s + (r.total || 0), 0);
  const cashSales = filtered.filter(s => s.payment_method === 'cash').reduce((s, r) => s + (r.total || 0), 0);
  const transferSales = filtered.filter(s => s.payment_method === 'transfer').reduce((s, r) => s + (r.total || 0), 0);
  const tempoSales = filtered.filter(s => s.payment_method === 'tempo').reduce((s, r) => s + (r.total || 0), 0);
  const totalPiutang = filtered.reduce((s, r) => s + (r.remaining_receivable || 0), 0);
  const avgValue = filtered.length > 0 ? totalSales / filtered.length : 0;

  const exportCSV = () => {
    const headers = ['No. Invoice', 'Tanggal', 'Customer', 'Sales', 'Metode', 'Total', 'Pembayaran', 'Sisa Piutang', 'Jatuh Tempo', 'Status'];
    const rows = filtered.map(r => [r.invoice_number, r.transaction_date, r.customer_name, r.sales_person || '', r.payment_method, r.total, r.total_payment, r.remaining_receivable, r.due_date || '', r.payment_status]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `laporan-penjualan-${Date.now()}.csv`; a.click();
    toast({ title: 'Laporan diexport' });
  };

  const exportPDF = () => exportReportToPDF({
    title: 'Laporan Penjualan',
    subtitle: `${filtered.length} invoice · Total ${fmtMoney(totalSales)}`,
    meta: { company: 'LAB PRO', period: `${filters.date_from || 'Awal'} – ${filters.date_to || 'Akhir'}`, printedBy: user?.full_name },
    columns: [
      { key: 'invoice_number', header: 'No. Invoice' },
      { key: 'transaction_date', header: 'Tanggal' },
      { key: 'customer_name', header: 'Customer' },
      { key: 'sales_person', header: 'Sales' },
      { key: 'total', header: 'Total', align: 'right' },
      { key: 'total_payment', header: 'Pembayaran', align: 'right' },
      { key: 'remaining_receivable', header: 'Sisa Piutang', align: 'right' },
      { key: 'due_date', header: 'Jatuh Tempo' },
      { key: 'payment_status', header: 'Status' },
    ],
    rows: filtered.map(r => ({
      invoice_number: r.invoice_number, transaction_date: r.transaction_date,
      customer_name: r.customer_name, sales_person: r.sales_person || '-',
      total: fmtMoney(r.total), total_payment: fmtMoney(r.total_payment),
      remaining_receivable: fmtMoney(r.remaining_receivable), due_date: r.due_date || '-',
      payment_status: r.payment_status,
    })),
    fileName: `laporan-penjualan-${Date.now()}.pdf`,
  });

  const columns = [
    { key: 'invoice_number', header: 'No. Invoice', sortable: true, className: 'font-mono font-medium' },
    { key: 'transaction_date', header: 'Tanggal', sortable: true },
    { key: 'customer_name', header: 'Customer', sortable: true, className: 'font-medium' },
    { key: 'sales_person', header: 'Sales', render: (row) => row.sales_person || '—' },
    { key: 'total', header: 'Total', sortable: true, render: (row) => <span className="tabular-nums">{fmtMoney(row.total)}</span> },
    { key: 'total_payment', header: 'Pembayaran', render: (row) => <span className="tabular-nums">{fmtMoney(row.total_payment)}</span> },
    { key: 'remaining_receivable', header: 'Sisa Piutang', render: (row) => row.remaining_receivable > 0 ? <span className="text-red-600 tabular-nums">{fmtMoney(row.remaining_receivable)}</span> : <span className="text-emerald-600">Lunas</span> },
    { key: 'due_date', header: 'Jatuh Tempo', render: (row) => row.due_date || '—' },
    { key: 'payment_status', header: 'Status', render: (row) => <StatusBadge status={row.payment_status} /> },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Laporan Penjualan" description="Laporan penjualan dengan filter dan ringkasan"
        actions={<div className="flex items-center gap-2"><Button onClick={exportCSV} size="sm" variant="outline" className="gap-1.5"><Download className="w-4 h-4" /> Export CSV</Button><PdfButton onExport={exportPDF} /></div>} />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-white border border-border rounded-lg p-3"><div className="text-[11px] text-muted-foreground uppercase">Total Penjualan</div><div className="text-base font-bold mt-1 tabular-nums">{fmtMoney(totalSales)}</div></div>
        <div className="bg-white border border-border rounded-lg p-3"><div className="text-[11px] text-muted-foreground uppercase">Penjualan Cash</div><div className="text-base font-bold mt-1 tabular-nums text-emerald-600">{fmtMoney(cashSales)}</div></div>
        <div className="bg-white border border-border rounded-lg p-3"><div className="text-[11px] text-muted-foreground uppercase">Penjualan Transfer</div><div className="text-base font-bold mt-1 tabular-nums text-blue-600">{fmtMoney(transferSales)}</div></div>
        <div className="bg-white border border-border rounded-lg p-3"><div className="text-[11px] text-muted-foreground uppercase">Penjualan Tempo</div><div className="text-base font-bold mt-1 tabular-nums text-amber-600">{fmtMoney(tempoSales)}</div></div>
        <div className="bg-white border border-border rounded-lg p-3"><div className="text-[11px] text-muted-foreground uppercase">Total Piutang</div><div className="text-base font-bold mt-1 tabular-nums text-red-600">{fmtMoney(totalPiutang)}</div></div>
        <div className="bg-white border border-border rounded-lg p-3"><div className="text-[11px] text-muted-foreground uppercase">Jumlah Invoice</div><div className="text-base font-bold mt-1 tabular-nums">{filtered.length}</div></div>
        <div className="bg-white border border-border rounded-lg p-3"><div className="text-[11px] text-muted-foreground uppercase">Rata-rata Nilai</div><div className="text-base font-bold mt-1 tabular-nums">{fmtMoney(avgValue)}</div></div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-border rounded-lg p-3 mb-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div><Label className="text-[11px] mb-1">Dari Tanggal</Label><Input type="date" value={filters.date_from} onChange={e => setFilters({ ...filters, date_from: e.target.value })} className="h-8 text-[12px]" /></div>
        <div><Label className="text-[11px] mb-1">Sampai Tanggal</Label><Input type="date" value={filters.date_to} onChange={e => setFilters({ ...filters, date_to: e.target.value })} className="h-8 text-[12px]" /></div>
        <div>
          <Label className="text-[11px] mb-1">Customer</Label>
          <Select value={filters.customer_id} onValueChange={v => setFilters({ ...filters, customer_id: v })}>
            <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Semua" /></SelectTrigger>
            <SelectContent>{customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px] mb-1">Metode</Label>
          <Select value={filters.payment_method} onValueChange={v => setFilters({ ...filters, payment_method: v })}>
            <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Semua" /></SelectTrigger>
            <SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="transfer">Transfer</SelectItem><SelectItem value="tempo">Tempo</SelectItem></SelectContent>
          </Select>
        </div>
      </div>

      <DataTable columns={columns} data={filtered} loading={loading} emptyMessage="Belum ada data" searchKeys={['invoice_number', 'customer_name']} searchPlaceholder="Cari invoice..." />
    </div>
  );
}