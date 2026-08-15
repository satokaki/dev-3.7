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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Ban, Eye, Pencil, Plus, X } from 'lucide-react';
import { generateInvoiceNumber } from '@/lib/sequence';
import {
  recordStockMovement,
  getAllStockBalances,
  createAuditLog,
} from '@/lib/stockUtils';
import { getInventoryDisplayName } from '@/lib/inventoryDisplay';
import NumberInput from '@/components/NumberInput';
import PdfButton from '@/components/PdfButton';
import { exportDocumentToPDF } from '@/lib/pdfExport';
import { formatCurrency as fmtMoney } from '@/lib/format';

const emptyForm = () => ({
  customer_id: '',
  transaction_date: new Date().toISOString().slice(0, 10),
  payment_method: 'cash',
  payment_terms: 0,
  warehouse_id: '',
  sales_person: '',
  notes: '',
  items: [],
});

const ledgerTime = row =>
  new Date(row?.transaction_date || row?.created_date || 0).getTime();

const same = (a, b) => String(a || '') === String(b || '');

export default function Sales() {
  const { toast } = useToast();

  const [data, setData] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [allStock, setAllStock] = useState([]);
  const [siapJualStock, setSiapJualStock] = useState([]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [formMode, setFormMode] = useState('add');
  const [editingSale, setEditingSale] = useState(null);
  const [originalItems, setOriginalItems] = useState([]);
  const [form, setForm] = useState(emptyForm());

  const [viewOpen, setViewOpen] = useState(false);
  const [viewSale, setViewSale] = useState(null);
  const [viewItems, setViewItems] = useState([]);
  const [viewLoading, setViewLoading] = useState(false);

  const hppSnapshotCache = new Map();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sales, custs, balances, prods, whs] = await Promise.all([
        base44.entities.Sale.list('-created_date', 100),
        base44.entities.Customer.filter({ is_active: true }),
        getAllStockBalances('product'),
        base44.entities.Product.filter({ is_active: true }),
        base44.entities.Warehouse.filter({ is_active: true }),
      ]);

      setData(sales || []);
      setCustomers(custs || []);
      setProducts(prods || []);
      setWarehouses(whs || []);
      setAllStock(balances || []);
      setSiapJualStock(
        (balances || []).filter(
          b =>
            b.inventory_status === 'READY_FOR_SALE' &&
            Number(b.available_quantity ?? b.quantity) > 0
        )
      );
    } catch {
      toast({
        variant: 'destructive',
        title: 'Gagal memuat data',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const subtotal = form.items.reduce(
    (sum, item) =>
      sum +
      Number(item.quantity || 0) * Number(item.price || 0) -
      Number(item.discount || 0),
    0
  );

  const totalDiscount = form.items.reduce(
    (sum, item) => sum + Number(item.discount || 0),
    0
  );

  const getStockByItem = item =>
    allStock.find(
      stock =>
        stock.inventory_status === 'READY_FOR_SALE' &&
        stock.item_id === item.product_id &&
        (stock.batch_number || '') === (item.batch_number || '')
    );

  const getOldQty = item => {
    if (formMode !== 'edit') return 0;
    return originalItems
      .filter(
        old =>
          old.product_id === item.product_id &&
          (old.batch_number || '') === (item.batch_number || '')
      )
      .reduce((sum, old) => sum + Number(old.quantity || 0), 0);
  };

  const effectiveAvailable = item => {
    const stock =
      siapJualStock.find(s => s.id === item.stock_id) ||
      getStockByItem(item);
    return Number(stock?.available_quantity ?? stock?.quantity ?? 0) + getOldQty(item);
  };

  const stockOptionsFor = item =>
    allStock.filter(
      stock =>
        stock.inventory_status === 'READY_FOR_SALE' &&
        (
          Number(stock.available_quantity ?? stock.quantity ?? 0) > 0 ||
          stock.id === item.stock_id
        )
    );

  const openAdd = () => {
    const customer = customers[0] || null;
    setFormMode('add');
    setEditingSale(null);
    setOriginalItems([]);
    setForm({
      ...emptyForm(),
      customer_id: customer?.id || '',
      payment_terms: customer?.default_payment_terms || 0,
      sales_person: customer?.sales_person || '',
    });
    setModalOpen(true);
  };

  const openView = async sale => {
    setViewSale(sale);
    setViewItems([]);
    setViewLoading(true);
    setViewOpen(true);
    try {
      const items = await base44.entities.SaleItem.filter({ sale_id: sale.id });
      setViewItems(items || []);
    } catch {
      toast({
        variant: 'destructive',
        title: 'Gagal memuat detail penjualan',
      });
    } finally {
      setViewLoading(false);
    }
  };

  const openEdit = async sale => {
    if (sale.transaction_status === 'void') {
      toast({
        variant: 'destructive',
        title: 'Transaksi VOID tidak dapat diedit',
      });
      return;
    }

    if (
      sale.payment_method === 'tempo' &&
      Number(sale.total_payment || 0) > 0
    ) {
      toast({
        variant: 'destructive',
        title: 'Transaksi sudah memiliki pembayaran',
        description:
          'Edit diblokir agar tidak merusak histori pembayaran/piutang.',
      });
      return;
    }

    setSubmitting(true);
    try {
      const items = await base44.entities.SaleItem.filter({
        sale_id: sale.id,
      });

      const prepared = (items || []).map(item => {
        const stock = getStockByItem(item);
        return {
          ...item,
          stock_id: stock?.id || '',
          quantity: Number(item.quantity) || 0,
          price: Number(item.price) || 0,
          discount: Number(item.discount) || 0,
          unit: item.unit || 'unit',
        };
      });

      setFormMode('edit');
      setEditingSale(sale);
      setOriginalItems(items || []);
      setForm({
        customer_id: sale.customer_id || '',
        transaction_date:
          sale.transaction_date || new Date().toISOString().slice(0, 10),
        payment_method: sale.payment_method || 'cash',
        payment_terms: Number(sale.payment_terms) || 0,
        warehouse_id: sale.warehouse_id || '',
        sales_person: sale.sales_person || '',
        notes: sale.notes || '',
        items: prepared,
      });
      setModalOpen(true);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal membuka edit',
        description: error?.message || '',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const addItem = () =>
    setForm(current => ({
      ...current,
      items: [
        ...current.items,
        {
          stock_id: '',
          product_id: '',
          product_name: '',
          batch_number: '',
          quantity: 1,
          unit: 'unit',
          price: 0,
          discount: 0,
        },
      ],
    }));

  const updateItem = (index, field, value) =>
    setForm(current => {
      const items = [...current.items];

      if (field === 'stock_id') {
        const stock = allStock.find(s => s.id === value);
        const product = products.find(p => p.id === stock?.item_id);

        items[index] = {
          ...items[index],
          stock_id: value,
          product_id: stock?.item_id || '',
          product_name: product?.name || stock?.item_name || '',
          batch_number: stock?.batch_number || '',
          quantity: items[index].quantity || 1,
          price: product?.sale_price || 0,
        };
      } else {
        items[index] = {
          ...items[index],
          [field]: value,
        };
      }

      return { ...current, items };
    });

  const removeItem = index =>
    setForm(current => ({
      ...current,
      items: current.items.filter((_, i) => i !== index),
    }));

  const validateForm = () => {
    if (!form.customer_id || form.items.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Customer dan item wajib diisi',
      });
      return false;
    }

    for (const item of form.items) {
      if (!item.product_id || Number(item.quantity) <= 0) {
        toast({
          variant: 'destructive',
          title: 'Produk dan jumlah wajib valid',
        });
        return false;
      }

      const available = effectiveAvailable(item);
      if (Number(item.quantity) > available) {
        toast({
          variant: 'destructive',
          title: `Stok ${item.product_name} tidak mencukupi`,
          description: `Tersedia setelah memperhitungkan transaksi lama: ${available}`,
        });
        return false;
      }
    }

    return true;
  };

  const buildSalePayload = customer => {
    const dueDate =
      form.payment_method === 'tempo'
        ? new Date(
            new Date(form.transaction_date).getTime() +
              Number(form.payment_terms || 0) * 86400000
          )
            .toISOString()
            .slice(0, 10)
        : '';

    const total = subtotal;
    const remaining = form.payment_method === 'tempo' ? total : 0;

    return {
      transaction_date: form.transaction_date,
      customer_id: form.customer_id,
      customer_name: customer?.name || '',
      sales_person: form.sales_person,
      warehouse_id: form.warehouse_id,
      warehouse_name:
        warehouses.find(w => w.id === form.warehouse_id)?.name || '',
      payment_method: form.payment_method,
      payment_terms: Number(form.payment_terms || 0),
      due_date: dueDate,
      subtotal,
      discount: totalDiscount,
      tax: 0,
      total,
      total_payment: total - remaining,
      remaining_receivable: remaining,
      transaction_status: 'posted',
      payment_status:
        form.payment_method === 'tempo' ? 'belum_dibayar' : 'lunas',
      notes: form.notes,
    };
  };

  /*
   * ============================================================
   * FINAL HPP RESOLVER
   * ============================================================
   *
   * Cukai:
   *   excise_output -> READY_FOR_SALE
   *
   * Non-cukai / sample:
   *   labeling_output -> READY_FOR_SALE
   *
   * Legacy fallback:
   *   latest inbound READY_FOR_SALE with frozen unit_cost.
   */
  const resolveFinalHpp = async (item, stockOverride = null) => {
    const stock =
      stockOverride ||
      allStock.find(s => s.id === item.stock_id) ||
      getStockByItem(item);

    const productId = item.product_id || stock?.item_id || '';
    const batchNumber = item.batch_number || stock?.batch_number || '';
    const batchId = stock?.batch_id || '';
    const warehouseId = stock?.warehouse_id || '';
    const cacheKey = `${productId}|${batchId}|${batchNumber}|${warehouseId}`;

    if (hppSnapshotCache.has(cacheKey)) {
      return hppSnapshotCache.get(cacheKey);
    }

    const filter = {
      item_id: productId,
      inventory_status: 'READY_FOR_SALE',
    };

    if (batchId) filter.batch_id = batchId;
    else if (batchNumber) filter.batch_number = batchNumber;
    if (warehouseId) filter.warehouse_id = warehouseId;

    let rows = await base44.entities.StockLedger.filter(filter);

    if ((!rows || rows.length === 0) && warehouseId) {
      const fallbackFilter = {
        item_id: productId,
        inventory_status: 'READY_FOR_SALE',
      };
      if (batchId) fallbackFilter.batch_id = batchId;
      else if (batchNumber) fallbackFilter.batch_number = batchNumber;

      rows = await base44.entities.StockLedger.filter(fallbackFilter);
    }

    const inboundRows = (rows || [])
      .filter(
        row =>
          Number(row.quantity_in) > 0 &&
          Number(row.unit_cost) > 0
      )
      .sort((a, b) => ledgerTime(b) - ledgerTime(a));

    const finalRow =
      inboundRows.find(row => row.transaction_type === 'excise_output') ||
      inboundRows.find(row => row.transaction_type === 'labeling_output') ||
      inboundRows[0];

    const hpp = Number(finalRow?.unit_cost) || 0;

    if (!(hpp > 0)) {
      throw new Error(
        `HPP READY_FOR_SALE tidak ditemukan untuk ${item.product_name || 'produk'}${batchNumber ? ` · ${batchNumber}` : ''}.`
      );
    }

    hppSnapshotCache.set(cacheKey, hpp);
    return hpp;
  };

  const buildSaleItems = saleId =>
    form.items.map(item => ({
      sale_id: saleId,
      product_id: item.product_id,
      product_name: item.product_name,
      batch_number: item.batch_number,
      quantity: Number(item.quantity),
      unit: item.unit || 'unit',
      price: Number(item.price),
      discount: Number(item.discount || 0),
      subtotal:
        Number(item.quantity) * Number(item.price) -
        Number(item.discount || 0),
    }));

  /*
   * ============================================================
   * SALE PREFLIGHT
   * ============================================================
   *
   * ZERO WRITE:
   * No Sale, SaleItem, StockLedger or StockBalance is changed here.
   */
  const preflightSale = async () => {
    const freshBalances = await getAllStockBalances('product');
    const prepared = [];
    const requiredByStockId = new Map();

    for (const item of form.items) {
      const stock = (freshBalances || []).find(
        balance => balance.id === item.stock_id
      );

      if (!stock) {
        throw new Error(
          `StockBalance tidak ditemukan untuk ${item.product_name}. Refresh halaman dan pilih batch kembali.`
        );
      }

      if (stock.inventory_status !== 'READY_FOR_SALE') {
        throw new Error(
          `${item.product_name} bukan stok READY_FOR_SALE.`
        );
      }

      if (stock.item_id !== item.product_id) {
        throw new Error(
          `Identity stok berubah untuk ${item.product_name}. Refresh dan pilih ulang stok.`
        );
      }

      if (!same(stock.batch_number, item.batch_number)) {
        throw new Error(
          `Batch stok berubah untuk ${item.product_name}. Refresh dan pilih ulang stok.`
        );
      }

      const qty = Number(item.quantity) || 0;
      const totalRequired =
        (requiredByStockId.get(stock.id) || 0) + qty;

      requiredByStockId.set(stock.id, totalRequired);

      const available = Number(
        stock.available_quantity ?? stock.quantity ?? 0
      );

      if (totalRequired > available) {
        throw new Error(
          `Stok ${item.product_name} tidak mencukupi. Tersedia ${available}, dibutuhkan ${totalRequired}.`
        );
      }

      const hpp = await resolveFinalHpp(item, stock);

      prepared.push({
        item,
        stock,
        hpp,
      });
    }

    return prepared;
  };

  const getSaleLedger = async saleId =>
    base44.entities.StockLedger.filter({
      reference_id: saleId,
      reference_type: 'sale',
    });

  const rollbackPostedSaleMovements = async (
    sale,
    invoiceNumber,
    reason = 'AUTO REVERSAL failed posting'
  ) => {
    const ledgerRows = await getSaleLedger(sale.id);

    const originalRows = (ledgerRows || []).filter(
      row =>
        row.transaction_type === 'sales' &&
        Number(row.quantity_out) > 0
    );

    const reversalRows = (ledgerRows || []).filter(
      row =>
        row.transaction_type === 'sales_reversal' &&
        Number(row.quantity_in) > 0
    );

    for (const row of originalRows) {
      const alreadyReversed = reversalRows
        .filter(
          rev =>
            same(rev.item_id, row.item_id) &&
            same(rev.batch_id, row.batch_id) &&
            same(rev.batch_number, row.batch_number) &&
            same(rev.warehouse_id, row.warehouse_id)
        )
        .reduce(
          (sum, rev) => sum + (Number(rev.quantity_in) || 0),
          0
        );

      const outstanding = Math.max(
        0,
        (Number(row.quantity_out) || 0) - alreadyReversed
      );

      if (outstanding <= 0) continue;

      await recordStockMovement({
        item_type: row.item_type || 'product',
        item_id: row.item_id,
        item_code: row.item_code || '',
        item_name: row.item_name,
        batch_id: row.batch_id || '',
        batch_number: row.batch_number || '',
        warehouse_id: row.warehouse_id || '',
        warehouse_name: row.warehouse_name || '',
        inventory_status:
          row.inventory_status || 'READY_FOR_SALE',
        quantity_in: outstanding,
        unit: row.unit || 'unit',
        unit_cost: Number(row.unit_cost) || 0,
        transaction_type: 'sales_reversal',
        transaction_number: `${invoiceNumber}-AUTO-REV`,
        reference_type: 'sale',
        reference_id: sale.id,
        notes: `${reason} ${invoiceNumber}`,
      });
    }
  };

  const createSale = async () => {
    const preparedItems = await preflightSale();

    const customer = customers.find(
      c => c.id === form.customer_id
    );

    const invoiceNumber = await generateInvoiceNumber();
    let sale = null;

    try {
      sale = await base44.entities.Sale.create({
        invoice_number: invoiceNumber,
        ...buildSalePayload(customer),
      });

      await base44.entities.SaleItem.bulkCreate(
        buildSaleItems(sale.id)
      );

      for (const prepared of preparedItems) {
        const { item, stock, hpp } = prepared;
        const product = products.find(
          p => p.id === item.product_id
        );

        await recordStockMovement({
          item_type: 'product',
          item_id: item.product_id,
          item_name: item.product_name,
          item_code: product?.code || '',
          batch_id: stock.batch_id || '',
          batch_number:
            stock.batch_number || item.batch_number || '',
          warehouse_id: stock.warehouse_id || '',
          warehouse_name: stock.warehouse_name || '',
          inventory_status: 'READY_FOR_SALE',
          quantity_out: Number(item.quantity),
          unit: item.unit || 'unit',
          unit_cost: hpp,
          transaction_type: 'sales',
          transaction_number: invoiceNumber,
          reference_type: 'sale',
          reference_id: sale.id,
          notes: `Penjualan ${invoiceNumber}`,
        });
      }

      await createAuditLog({
        module: 'Penjualan',
        action: 'Posting',
        entity_type: 'Sale',
        entity_id: sale.id,
        reference_number: invoiceNumber,
      });

      return invoiceNumber;
    } catch (error) {
      if (sale?.id) {
        try {
          await rollbackPostedSaleMovements(
            sale,
            invoiceNumber
          );

          await base44.entities.Sale.update(
            sale.id,
            {
              transaction_status: 'void',
              remaining_receivable: 0,
              payment_status: 'void',
              notes: [
                form.notes,
                `AUTO VOID ${new Date().toISOString()}`,
                `Posting gagal: ${error?.message || 'unknown error'}`,
              ]
                .filter(Boolean)
                .join('\n'),
            }
          );
        } catch (rollbackError) {
          console.error(
            'SALE AUTO ROLLBACK FAILED',
            rollbackError
          );

          throw new Error(
            `${error?.message || 'Posting gagal'}. ` +
            `Rollback otomatis juga gagal. Audit invoice ${invoiceNumber} sebelum retry.`
          );
        }
      }

      throw error;
    }
  };

  /*
   * Existing edit flow kept, but uses safe VOID-like rollback
   * of original stock before replacing detail.
   */
  const updateSale = async () => {
    if (!editingSale) return;

    const customer = customers.find(
      c => c.id === form.customer_id
    );

    const preparedItems = await preflightSale();

    await rollbackPostedSaleMovements(
      editingSale,
      editingSale.invoice_number,
      'Reversal edit'
    );

    await base44.entities.Sale.update(
      editingSale.id,
      buildSalePayload(customer)
    );

    const oldRows = await base44.entities.SaleItem.filter({
      sale_id: editingSale.id,
    });

    for (const row of oldRows || []) {
      await base44.entities.SaleItem.delete(row.id);
    }

    await base44.entities.SaleItem.bulkCreate(
      buildSaleItems(editingSale.id)
    );

    for (const prepared of preparedItems) {
      const { item, stock, hpp } = prepared;
      const product = products.find(
        p => p.id === item.product_id
      );

      await recordStockMovement({
        item_type: 'product',
        item_id: item.product_id,
        item_name: item.product_name,
        item_code: product?.code || '',
        batch_id: stock.batch_id || '',
        batch_number:
          stock.batch_number || item.batch_number || '',
        warehouse_id: stock.warehouse_id || '',
        warehouse_name: stock.warehouse_name || '',
        inventory_status: 'READY_FOR_SALE',
        quantity_out: Number(item.quantity),
        unit: item.unit || 'unit',
        unit_cost: hpp,
        transaction_type: 'sales',
        transaction_number: editingSale.invoice_number,
        reference_type: 'sale',
        reference_id: editingSale.id,
        notes: `Repost edit ${editingSale.invoice_number}`,
      });
    }

    await createAuditLog({
      module: 'Penjualan',
      action: 'Edit',
      entity_type: 'Sale',
      entity_id: editingSale.id,
      reference_number: editingSale.invoice_number,
    });

    return editingSale.invoice_number;
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!validateForm()) return;

    setSubmitting(true);
    try {
      const invoiceNumber =
        formMode === 'edit'
          ? await updateSale()
          : await createSale();

      toast({
        title:
          formMode === 'edit'
            ? 'Penjualan berhasil diperbarui'
            : 'Penjualan berhasil diposting',
        description: invoiceNumber,
      });

      setModalOpen(false);
      setEditingSale(null);
      setOriginalItems([]);
      await loadData();
    } catch (error) {
      toast({
        variant: 'destructive',
        title:
          formMode === 'edit'
            ? 'Gagal mengedit penjualan'
            : 'Gagal menyimpan',
        description: error?.message || '',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const voidSale = async sale => {
    if (sale.transaction_status === 'void') {
      toast({
        variant: 'destructive',
        title: 'Invoice sudah VOID',
      });
      return;
    }

    if (
      sale.payment_method === 'tempo' &&
      Number(sale.total_payment || 0) > 0
    ) {
      toast({
        variant: 'destructive',
        title: 'Void diblokir',
        description:
          'Invoice tempo sudah memiliki pembayaran. Batalkan/alokasikan balik pembayaran terlebih dahulu.',
      });
      return;
    }

    const confirmed = window.confirm(
      `VOID invoice ${sale.invoice_number}?\n\n` +
      `Hanya stock movement yang benar-benar pernah terposting yang akan dikembalikan.`
    );

    if (!confirmed) return;
    if (submitting) return;

    setSubmitting(true);

    try {
      await rollbackPostedSaleMovements(
        sale,
        sale.invoice_number,
        'VOID penjualan'
      );

      await base44.entities.Sale.update(
        sale.id,
        {
          transaction_status: 'void',
          remaining_receivable: 0,
          payment_status: 'void',
          notes: [
            sale.notes,
            `VOID ${new Date().toISOString()}`,
          ]
            .filter(Boolean)
            .join('\n'),
        }
      );

      await createAuditLog({
        module: 'Penjualan',
        action: 'Void',
        entity_type: 'Sale',
        entity_id: sale.id,
        reference_number: sale.invoice_number,
      });

      toast({
        title: 'Invoice berhasil di-VOID',
        description: sale.invoice_number,
      });

      await loadData();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal VOID invoice',
        description: error?.message || '',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const exportInvoicePDF = async row => {
    try {
      const items = await base44.entities.SaleItem.filter({
        sale_id: row.id,
      });

      const customer = customers.find(
        c => c.id === row.customer_id
      );

      exportDocumentToPDF({
        title:
          row.transaction_status === 'void'
            ? 'Invoice — VOID'
            : 'Invoice',
        docNumber: row.invoice_number,
        docDate: row.transaction_date,
        partyLabel: 'Kepada Yth.',
        party: {
          name: row.customer_name,
          address: [customer?.city || ''].filter(Boolean),
          phone: customer?.phone || '',
        },
        infoLines: [
          { label: 'Sales', value: row.sales_person || '-' },
          { label: 'Metode', value: row.payment_method },
          { label: 'Jatuh Tempo', value: row.due_date || '-' },
          { label: 'Status', value: row.transaction_status },
        ],
        itemColumns: [
          { key: 'no', header: '#', width: 22, align: 'right' },
          { key: 'product_name', header: 'Produk' },
          { key: 'batch_number', header: 'Batch', width: 80 },
          { key: 'quantity', header: 'Qty', width: 45, align: 'right' },
          { key: 'unit', header: 'Sat', width: 38 },
          { key: 'price', header: 'Harga', width: 80, align: 'right' },
          { key: 'subtotal', header: 'Subtotal', width: 90, align: 'right' },
        ],
        itemRows: items.map((item, index) => ({
          no: index + 1,
          product_name: item.product_name,
          batch_number: item.batch_number || '-',
          quantity: item.quantity,
          unit: item.unit || '',
          price: fmtMoney(item.price),
          subtotal: fmtMoney(item.subtotal),
        })),
        totals: [
          { label: 'Subtotal', value: fmtMoney(row.subtotal) },
          ...(row.discount
            ? [{ label: 'Diskon', value: fmtMoney(row.discount) }]
            : []),
          { label: 'Total', value: fmtMoney(row.total), bold: true },
          { label: 'Dibayar', value: fmtMoney(row.total_payment) },
          ...(row.remaining_receivable > 0
            ? [{
                label: 'Sisa Piutang',
                value: fmtMoney(row.remaining_receivable),
                bold: true,
              }]
            : []),
        ],
        notes: row.notes,
        signatures: [{
          label: 'Hormat kami,',
          name: row.sales_person || '',
        }],
        fileName: `invoice-${row.invoice_number}.pdf`,
      });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Gagal membuat PDF invoice',
      });
    }
  };

  const columns = [
    {
      key: 'invoice_number',
      header: 'No. Invoice',
      sortable: true,
      className: 'font-mono font-medium',
    },
    {
      key: 'transaction_date',
      header: 'Tanggal',
      sortable: true,
    },
    {
      key: 'customer_name',
      header: 'Customer',
      sortable: true,
      className: 'font-medium',
    },
    {
      key: 'payment_method',
      header: 'Metode',
      render: row => (
        <span className="text-[11px] px-2 py-0.5 bg-muted rounded uppercase">
          {row.payment_method}
        </span>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      render: row => (
        <span className="tabular-nums">
          {fmtMoney(row.total)}
        </span>
      ),
    },
    {
      key: 'remaining_receivable',
      header: 'Sisa Piutang',
      render: row =>
        row.remaining_receivable > 0 ? (
          <span className="text-red-600 tabular-nums">
            {fmtMoney(row.remaining_receivable)}
          </span>
        ) : (
          <span className="text-emerald-600">Lunas</span>
        ),
    },
    {
      key: 'transaction_status',
      header: 'Status',
      render: row => (
        <StatusBadge status={row.transaction_status} />
      ),
    },
    {
      key: 'payment_status',
      header: 'Pembayaran',
      render: row => (
        <StatusBadge status={row.payment_status} />
      ),
    },
    {
      key: 'actions',
      header: 'Aksi',
      width: '150px',
      render: row => (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => openView(row)}
            title="View"
            className="p-1.5 rounded hover:bg-muted text-blue-600"
          >
            <Eye className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => openEdit(row)}
            disabled={
              row.transaction_status === 'void' ||
              submitting
            }
            title="Edit"
            className="p-1.5 rounded hover:bg-muted text-amber-600 disabled:opacity-30"
          >
            <Pencil className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => voidSale(row)}
            disabled={
              row.transaction_status === 'void' ||
              submitting
            }
            title="Void"
            className="p-1.5 rounded hover:bg-red-50 text-red-600 disabled:opacity-30"
          >
            <Ban className="w-4 h-4" />
          </button>

          <PdfButton
            onExport={() => exportInvoicePDF(row)}
            perm="invoice_pdf"
            iconOnly
            label="Cetak Invoice"
          />
        </div>
      ),
    },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader
        title="Penjualan"
        description="Penjualan barang siap jual"
        actions={
          <Button
            onClick={openAdd}
            size="sm"
            className="gap-1.5"
            disabled={submitting}
          >
            <Plus className="w-4 h-4" />
            Penjualan Baru
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        emptyMessage="Belum ada penjualan"
        searchKeys={[
          'invoice_number',
          'customer_name',
        ]}
        searchPlaceholder="Cari penjualan..."
      />

      <FormModal
        open={modalOpen}
        onClose={() => {
          if (!submitting) setModalOpen(false);
        }}
        title={
          formMode === 'edit'
            ? `Edit Penjualan · ${editingSale?.invoice_number || ''}`
            : 'Penjualan Baru'
        }
        onSubmit={handleSubmit}
        submitting={submitting}
        submitLabel={
          formMode === 'edit'
            ? 'Simpan Perubahan'
            : 'Posting Penjualan'
        }
        size="xl"
      >
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-[12.5px] mb-1">Customer *</Label>
            <Select
              value={form.customer_id}
              onValueChange={value => {
                const customer = customers.find(c => c.id === value);
                setForm(current => ({
                  ...current,
                  customer_id: value,
                  sales_person: customer?.sales_person || '',
                  payment_terms: customer?.default_payment_terms || 0,
                }));
              }}
            >
              <SelectTrigger className="h-9 text-[13px]">
                <SelectValue placeholder="Pilih customer" />
              </SelectTrigger>
              <SelectContent>
                {customers.map(customer => (
                  <SelectItem
                    key={customer.id}
                    value={customer.id}
                  >
                    {customer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">Tanggal</Label>
            <Input
              type="date"
              value={form.transaction_date}
              onChange={event =>
                setForm(current => ({
                  ...current,
                  transaction_date: event.target.value,
                }))
              }
              className="h-9 text-[13px]"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">
              Metode Pembayaran
            </Label>
            <Select
              value={form.payment_method}
              onValueChange={value =>
                setForm(current => ({
                  ...current,
                  payment_method: value,
                }))
              }
            >
              <SelectTrigger className="h-9 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="transfer">Transfer</SelectItem>
                <SelectItem value="tempo">Tempo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">Sales</Label>
            <Input
              value={form.sales_person}
              onChange={event =>
                setForm(current => ({
                  ...current,
                  sales_person: event.target.value,
                }))
              }
              className="h-9 text-[13px]"
            />
          </div>

          <div>
            <Label className="text-[12.5px] mb-1">Gudang</Label>
            <Select
              value={form.warehouse_id}
              onValueChange={value =>
                setForm(current => ({
                  ...current,
                  warehouse_id: value,
                }))
              }
            >
              <SelectTrigger className="h-9 text-[13px]">
                <SelectValue placeholder="Pilih gudang" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map(warehouse => (
                  <SelectItem
                    key={warehouse.id}
                    value={warehouse.id}
                  >
                    {warehouse.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {form.payment_method === 'tempo' && (
            <div>
              <Label className="text-[12.5px] mb-1">Termin (hari)</Label>
              <NumberInput
                value={form.payment_terms}
                onChange={value =>
                  setForm(current => ({
                    ...current,
                    payment_terms: value,
                  }))
                }
                allowDecimal={false}
                min={0}
                className="h-9 text-[13px]"
              />
            </div>
          )}
        </div>

        <div className="border-t pt-3">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-[12.5px] font-semibold">
              Detail Penjualan
            </Label>
            <Button
              type="button"
              onClick={addItem}
              size="sm"
              variant="outline"
              className="h-7 text-[12px] gap-1"
              disabled={submitting}
            >
              <Plus className="w-3.5 h-3.5" />
              Tambah Item
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="bg-muted/40 text-muted-foreground">
                  <th className="px-2 py-1 text-left">Produk</th>
                  <th className="px-2 py-1 text-right w-20">Jumlah</th>
                  <th className="px-2 py-1 text-right w-28">Harga</th>
                  <th className="px-2 py-1 text-right w-24">Diskon</th>
                  <th className="px-2 py-1 text-right w-28">Subtotal</th>
                  <th className="w-8" />
                </tr>
              </thead>

              <tbody>
                {form.items.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="text-center py-3 text-muted-foreground"
                    >
                      Belum ada item
                    </td>
                  </tr>
                )}

                {form.items.map((item, index) => (
                  <tr
                    key={index}
                    className="border-b border-border/30"
                  >
                    <td className="px-2 py-1">
                      <Select
                        value={item.stock_id}
                        onValueChange={value =>
                          updateItem(index, 'stock_id', value)
                        }
                        disabled={submitting}
                      >
                        <SelectTrigger className="h-7 text-[11.5px]">
                          <SelectValue placeholder="Pilih produk" />
                        </SelectTrigger>
                        <SelectContent>
                          {stockOptionsFor(item).map(stock => {
                            const product = products.find(
                              p => p.id === stock.item_id
                            );

                            return (
                              <SelectItem
                                key={stock.id}
                                value={stock.id}
                              >
                                {getInventoryDisplayName(
                                  product?.name || stock.item_name,
                                  'READY_FOR_SALE'
                                )}{' '}
                                (
                                {Number(
                                  stock.available_quantity ??
                                    stock.quantity
                                )}
                                )
                                {stock.batch_number
                                  ? ` · ${stock.batch_number}`
                                  : ''}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </td>

                    <td className="px-2 py-1">
                      <NumberInput
                        value={item.quantity}
                        onChange={value =>
                          updateItem(index, 'quantity', value)
                        }
                        allowDecimal={false}
                        min={0}
                        className="h-7 text-[11.5px] text-right"
                        disabled={submitting}
                      />
                    </td>

                    <td className="px-2 py-1">
                      <NumberInput
                        value={item.price}
                        onChange={value =>
                          updateItem(index, 'price', value)
                        }
                        allowDecimal
                        min={0}
                        className="h-7 text-[11.5px] text-right"
                        disabled={submitting}
                      />
                    </td>

                    <td className="px-2 py-1">
                      <NumberInput
                        value={item.discount}
                        onChange={value =>
                          updateItem(index, 'discount', value)
                        }
                        allowDecimal
                        min={0}
                        className="h-7 text-[11.5px] text-right"
                        disabled={submitting}
                      />
                    </td>

                    <td className="px-2 py-1 text-right tabular-nums">
                      {fmtMoney(
                        Number(item.quantity) *
                          Number(item.price) -
                          Number(item.discount || 0)
                      )}
                    </td>

                    <td className="px-1 py-1">
                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        className="p-0.5 hover:bg-red-50 rounded text-red-500 disabled:opacity-30"
                        disabled={submitting}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-4 mt-2 text-[12px]">
            <span>
              Subtotal: <b>{fmtMoney(subtotal)}</b>
            </span>
            <span>
              Diskon: <b>{fmtMoney(totalDiscount)}</b>
            </span>
            <span className="text-primary">
              Total: <b>{fmtMoney(subtotal)}</b>
            </span>
          </div>
        </div>

        <div>
          <Label className="text-[12.5px] mb-1">Catatan</Label>
          <Textarea
            value={form.notes}
            onChange={event =>
              setForm(current => ({
                ...current,
                notes: event.target.value,
              }))
            }
            rows={2}
            className="text-[13px]"
            disabled={submitting}
          />
        </div>
      </FormModal>

      {viewOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-background rounded-lg border border-border shadow-xl w-full max-w-3xl max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div>
                <div className="font-semibold text-[14px]">
                  Detail Penjualan
                </div>
                <div className="text-[11px] text-muted-foreground font-mono">
                  {viewSale?.invoice_number}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setViewOpen(false)}
                className="p-1 rounded hover:bg-muted"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {viewLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Memuat...
              </div>
            ) : (
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
                  <div>
                    <div className="text-muted-foreground">Customer</div>
                    <div className="font-medium">
                      {viewSale?.customer_name || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Tanggal</div>
                    <div className="font-medium">
                      {viewSale?.transaction_date || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Sales</div>
                    <div className="font-medium">
                      {viewSale?.sales_person || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Gudang</div>
                    <div className="font-medium">
                      {viewSale?.warehouse_name || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Metode</div>
                    <div className="font-medium uppercase">
                      {viewSale?.payment_method || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Status</div>
                    <StatusBadge status={viewSale?.transaction_status} />
                  </div>
                  <div>
                    <div className="text-muted-foreground">Pembayaran</div>
                    <StatusBadge status={viewSale?.payment_status} />
                  </div>
                  <div>
                    <div className="text-muted-foreground">Jatuh Tempo</div>
                    <div className="font-medium">
                      {viewSale?.due_date || '—'}
                    </div>
                  </div>
                </div>

                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-[12px]">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2">Produk</th>
                        <th className="text-left px-3 py-2">Batch</th>
                        <th className="text-right px-3 py-2">Qty</th>
                        <th className="text-right px-3 py-2">Harga</th>
                        <th className="text-right px-3 py-2">Diskon</th>
                        <th className="text-right px-3 py-2">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewItems.map(item => (
                        <tr key={item.id} className="border-t">
                          <td className="px-3 py-2 font-medium">
                            {item.product_name}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px]">
                            {item.batch_number || '—'}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {item.quantity}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {fmtMoney(item.price)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {fmtMoney(item.discount)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium">
                            {fmtMoney(item.subtotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end">
                  <div className="w-64 space-y-1 text-[12px]">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <b>{fmtMoney(viewSale?.subtotal)}</b>
                    </div>
                    <div className="flex justify-between">
                      <span>Diskon</span>
                      <b>{fmtMoney(viewSale?.discount)}</b>
                    </div>
                    <div className="flex justify-between border-t pt-1 text-[14px]">
                      <span>Total</span>
                      <b>{fmtMoney(viewSale?.total)}</b>
                    </div>
                    {Number(viewSale?.remaining_receivable) > 0 && (
                      <div className="flex justify-between text-red-600">
                        <span>Sisa Piutang</span>
                        <b>
                          {fmtMoney(viewSale?.remaining_receivable)}
                        </b>
                      </div>
                    )}
                  </div>
                </div>

                {viewSale?.notes && (
                  <div className="text-[12px]">
                    <div className="text-muted-foreground mb-1">
                      Catatan
                    </div>
                    <div className="border rounded p-2 whitespace-pre-wrap">
                      {viewSale.notes}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
