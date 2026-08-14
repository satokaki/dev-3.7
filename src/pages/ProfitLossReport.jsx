import React, {
  useEffect,
  useState,
  useMemo,
  useCallback
} from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Receipt,
  Percent,
  Download,
  Eye,
  X,
  CircleDollarSign
} from 'lucide-react';
import PdfButton from '@/components/PdfButton';
import { exportReportToPDF } from '@/lib/pdfExport';
import {
  formatCurrency as fmtMoney
} from '@/lib/format';

const fmtPct = v =>
  `${(Number(v) || 0).toFixed(1)}%`;

function MiniKpi({
  icon: Icon,
  label,
  value,
  color
}) {
  return (
    <div className="bg-white border border-border rounded-lg p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground uppercase">
          {label}
        </div>

        <div className="text-base font-bold mt-1 tabular-nums truncate">
          {value}
        </div>
      </div>

      <div
        className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${color}`}
      >
        <Icon className="w-4 h-4" />
      </div>
    </div>
  );
}

export default function ProfitLossReport() {
  const { toast } = useToast();

  const [sales, setSales] = useState([]);
  const [saleItems, setSaleItems] =
    useState([]);
  const [salesLedgers, setSalesLedgers] =
    useState([]);
  const [
    operationalCosts,
    setOperationalCosts
  ] = useState([]);

  const [loading, setLoading] = useState(true);

  const [filters, setFilters] = useState({
    date_from: '',
    date_to: ''
  });

  const [detailRow, setDetailRow] =
    useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);

    try {
      const [s, si, sl, oc] =
        await Promise.all([
          base44.entities.Sale.list(
            '-created_date',
            1000
          ),

          base44.entities.SaleItem.list(
            '-created_date',
            3000
          ),

          base44.entities.StockLedger.filter(
            {
              transaction_type: 'sales'
            },
            '-created_date',
            5000
          ),

          base44.entities.OperationalCost
            .list(
              '-cost_date',
              5000
            )
            .catch(() => [])
        ]);

      setSales(s || []);
      setSaleItems(si || []);
      setSalesLedgers(sl || []);
      setOperationalCosts(oc || []);
    } catch (error) {
      console.error(
        'ProfitLoss load error:',
        error
      );

      toast({
        variant: 'destructive',
        title:
          'Gagal memuat data laporan'
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /*
   * HPP tetap menggunakan frozen cost
   * StockLedger sales existing.
   *
   * OperationalCost hanya menjadi layer
   * tambahan setelah laba kotor.
   */
  const ledgerBySale = useMemo(() => {
    const byReference = {};
    const byInvoice = {};

    salesLedgers.forEach(row => {
      const ref =
        row.reference_id || '';
      const trx =
        row.transaction_number || '';

      if (ref) {
        if (!byReference[ref]) {
          byReference[ref] = [];
        }

        byReference[ref].push(row);
      }

      if (trx) {
        if (!byInvoice[trx]) {
          byInvoice[trx] = [];
        }

        byInvoice[trx].push(row);
      }
    });

    return {
      byReference,
      byInvoice
    };
  }, [salesLedgers]);

  const rows = useMemo(() => {
    const itemsBySale = {};

    saleItems.forEach(item => {
      if (!itemsBySale[item.sale_id]) {
        itemsBySale[item.sale_id] = [];
      }

      itemsBySale[item.sale_id].push(
        item
      );
    });

    return sales
      .filter(
        s =>
          ![
            'draft',
            'cancelled',
            'void'
          ].includes(
            s.transaction_status
          )
      )
      .filter(s => {
        if (
          filters.date_from &&
          s.transaction_date <
            filters.date_from
        ) {
          return false;
        }

        if (
          filters.date_to &&
          s.transaction_date >
            filters.date_to
        ) {
          return false;
        }

        return true;
      })
      .map(s => {
        const items =
          itemsBySale[s.id] || [];

        const qty = items.reduce(
          (sum, item) =>
            sum +
            (Number(item.quantity) || 0),
          0
        );

        const ledgerRows =
          ledgerBySale.byReference[s.id]
            ?.length
            ? ledgerBySale.byReference[
                s.id
              ]
            : (
                ledgerBySale.byInvoice[
                  s.invoice_number
                ] || []
              );

        const hpp = Math.max(
          0,
          ledgerRows.reduce(
            (sum, row) => {
              const unitCost =
                Number(row.unit_cost) ||
                0;

              const qtyOut =
                Number(
                  row.quantity_out
                ) || 0;

              const qtyIn =
                Number(
                  row.quantity_in
                ) || 0;

              return (
                sum +
                (qtyOut - qtyIn) *
                  unitCost
              );
            },
            0
          )
        );

        const detailItems =
          items.map(item => {
            const itemLedgers =
              ledgerRows.filter(
                row =>
                  row.item_id ===
                  item.product_id
              );

            const itemHpp =
              Math.max(
                0,
                itemLedgers.reduce(
                  (sum, row) => {
                    const unitCost =
                      Number(
                        row.unit_cost
                      ) || 0;

                    const qtyOut =
                      Number(
                        row.quantity_out
                      ) || 0;

                    const qtyIn =
                      Number(
                        row.quantity_in
                      ) || 0;

                    return (
                      sum +
                      (qtyOut -
                        qtyIn) *
                        unitCost
                    );
                  },
                  0
                )
              );

            const itemQty =
              Number(
                item.quantity
              ) || 0;

            const unitPrice =
              Number(
                item.unit_price
              ) || 0;

            const itemRevenue =
              Number(
                item.subtotal
              ) ||
              itemQty * unitPrice;

            const hppUnit =
              itemQty > 0
                ? itemHpp /
                  itemQty
                : 0;

            const itemLaba =
              itemRevenue -
              itemHpp;

            const itemMargin =
              itemRevenue > 0
                ? (
                    itemLaba /
                    itemRevenue
                  ) * 100
                : null;

            return {
              product_name:
                item.product_name ||
                item.item_name ||
                '-',
              qty: itemQty,
              unit_price:
                unitPrice,
              revenue:
                itemRevenue,
              hpp_unit:
                hppUnit,
              hpp:
                itemHpp,
              laba:
                itemLaba,
              margin:
                itemMargin
            };
          });

        const revenue =
          Number(s.total) || 0;

        const laba =
          revenue - hpp;

        const margin =
          revenue > 0
            ? (laba / revenue) *
              100
            : 0;

        return {
          invoice_number:
            s.invoice_number,
          transaction_date:
            s.transaction_date,
          customer_name:
            s.customer_name,
          qty,
          revenue,
          hpp,
          laba,
          margin,
          payment_status:
            s.payment_status,
          detailItems
        };
      });
  }, [
    sales,
    saleItems,
    ledgerBySale,
    filters
  ]);

  /*
   * Operational Cost memakai filter periode
   * yang sama dengan penjualan.
   *
   * Hanya record non-VOID yang dihitung.
   * Legacy status POSTED juga tetap dianggap aktif.
   */
  const filteredOperationalCosts =
    useMemo(() => {
      return operationalCosts
        .filter(row => {
          const status =
            String(
              row.status || ''
            ).toUpperCase();

          return status !== 'VOID';
        })
        .filter(row => {
          const date =
            row.cost_date || '';

          if (
            filters.date_from &&
            date < filters.date_from
          ) {
            return false;
          }

          if (
            filters.date_to &&
            date > filters.date_to
          ) {
            return false;
          }

          return true;
        });
    }, [
      operationalCosts,
      filters
    ]);

  const operationalSummary =
    useMemo(() => {
      const cost =
        filteredOperationalCosts
          .filter(
            row =>
              row.cost_type ===
              'COST'
          )
          .reduce(
            (sum, row) =>
              sum +
              (Number(
                row.amount
              ) || 0),
            0
          );

      const loss =
        filteredOperationalCosts
          .filter(
            row =>
              row.cost_type ===
              'LOSS'
          )
          .reduce(
            (sum, row) =>
              sum +
              (Number(
                row.amount
              ) || 0),
            0
          );

      return {
        cost,
        loss,
        total: cost + loss,
        count:
          filteredOperationalCosts.length
      };
    }, [
      filteredOperationalCosts
    ]);

  const summary = useMemo(() => {
    const revenue =
      rows.reduce(
        (sum, row) =>
          sum + row.revenue,
        0
      );

    const hpp =
      rows.reduce(
        (sum, row) =>
          sum + row.hpp,
        0
      );

    const laba =
      revenue - hpp;

    const margin =
      revenue > 0
        ? (laba / revenue) *
          100
        : 0;

    const labaNet =
      laba -
      operationalSummary.cost -
      operationalSummary.loss;

    const marginNet =
      revenue > 0
        ? (labaNet / revenue) *
          100
        : 0;

    return {
      revenue,
      hpp,
      laba,
      margin,
      operationalCost:
        operationalSummary.cost,
      operationalLoss:
        operationalSummary.loss,
      operationalTotal:
        operationalSummary.total,
      labaNet,
      marginNet,
      count:
        rows.length
    };
  }, [
    rows,
    operationalSummary
  ]);

  const exportCSV = () => {
    const headers = [
      'No. Invoice',
      'Tanggal',
      'Customer',
      'Qty',
      'Pendapatan',
      'HPP',
      'Laba Kotor',
      'Margin Kotor %',
      'Status'
    ];

    const invoiceRows =
      rows.map(row => [
        row.invoice_number,
        row.transaction_date,
        row.customer_name,
        row.qty,
        row.revenue,
        row.hpp,
        row.laba,
        row.margin.toFixed(1),
        row.payment_status
      ]);

    const csvRows = [
      [
        'RINGKASAN LABA RUGI'
      ],
      [
        'Pendapatan',
        summary.revenue
      ],
      [
        'HPP',
        summary.hpp
      ],
      [
        'Laba Kotor',
        summary.laba
      ],
      [
        'Biaya Operasional',
        summary.operationalCost
      ],
      [
        'Loss / Kerugian',
        summary.operationalLoss
      ],
      [
        'Laba Net',
        summary.labaNet
      ],
      [
        'Margin Net %',
        summary.marginNet.toFixed(
          1
        )
      ],
      [],
      headers,
      ...invoiceRows
    ];

    const csv =
      csvRows
        .map(row =>
          row
            .map(
              value =>
                `"${value ?? ''}"`
            )
            .join(',')
        )
        .join('\n');

    const blob =
      new Blob(
        [csv],
        {
          type: 'text/csv'
        }
      );

    const url =
      URL.createObjectURL(blob);

    const a =
      document.createElement('a');

    a.href = url;

    a.download =
      `laporan-laba-rugi-${Date.now()}.csv`;

    a.click();

    URL.revokeObjectURL(url);

    toast({
      title:
        'Laporan laba rugi diexport'
    });
  };

  const exportPDF = () =>
    exportReportToPDF({
      title:
        'Laporan Laba Rugi',

      subtitle:
        `Pendapatan ${fmtMoney(
          summary.revenue
        )} · ` +
        `HPP ${fmtMoney(
          summary.hpp
        )} · ` +
        `Laba Kotor ${fmtMoney(
          summary.laba
        )} · ` +
        `Cost ${fmtMoney(
          summary.operationalCost
        )} · ` +
        `Loss ${fmtMoney(
          summary.operationalLoss
        )} · ` +
        `Laba Net ${fmtMoney(
          summary.labaNet
        )}`,

      meta: {
        period:
          `${filters.date_from || 'Awal'} – ` +
          `${filters.date_to || 'Akhir'}`
      },

      columns: [
        {
          key:
            'invoice_number',
          header:
            'No. Invoice'
        },
        {
          key:
            'transaction_date',
          header:
            'Tanggal'
        },
        {
          key:
            'customer_name',
          header:
            'Customer'
        },
        {
          key:
            'qty',
          header:
            'Qty',
          align:
            'right'
        },
        {
          key:
            'revenue',
          header:
            'Pendapatan',
          align:
            'right'
        },
        {
          key:
            'hpp',
          header:
            'HPP',
          align:
            'right'
        },
        {
          key:
            'laba',
          header:
            'Laba Kotor',
          align:
            'right'
        },
        {
          key:
            'margin',
          header:
            'Margin',
          align:
            'right'
        }
      ],

      rows:
        rows.map(row => ({
          invoice_number:
            row.invoice_number ||
            '-',
          transaction_date:
            row.transaction_date ||
            '-',
          customer_name:
            row.customer_name ||
            '-',
          qty:
            row.qty,
          revenue:
            fmtMoney(
              row.revenue
            ),
          hpp:
            fmtMoney(
              row.hpp
            ),
          laba:
            fmtMoney(
              row.laba
            ),
          margin:
            fmtPct(
              row.margin
            )
        })),

      fileName:
        `laporan-laba-rugi-${Date.now()}.pdf`
    });

  const columns = [
    {
      key:
        'invoice_number',
      header:
        'No. Invoice',
      sortable:
        true,
      className:
        'font-mono font-medium'
    },
    {
      key:
        'transaction_date',
      header:
        'Tanggal',
      sortable:
        true
    },
    {
      key:
        'customer_name',
      header:
        'Customer',
      sortable:
        true,
      className:
        'font-medium'
    },
    {
      key:
        'qty',
      header:
        'Qty',
      sortable:
        true,
      render: row => (
        <span className="tabular-nums">
          {row.qty}
        </span>
      )
    },
    {
      key:
        'revenue',
      header:
        'Pendapatan',
      sortable:
        true,
      render: row => (
        <span className="tabular-nums">
          {fmtMoney(
            row.revenue
          )}
        </span>
      )
    },
    {
      key:
        'hpp',
      header:
        'HPP',
      render: row => (
        <span className="tabular-nums">
          {fmtMoney(row.hpp)}
        </span>
      )
    },
    {
      key:
        'laba',
      header:
        'Laba Kotor',
      sortable:
        true,
      render: row => (
        <span
          className={`tabular-nums font-medium ${
            row.laba >= 0
              ? 'text-emerald-600'
              : 'text-red-600'
          }`}
        >
          {fmtMoney(row.laba)}
        </span>
      )
    },
    {
      key:
        'margin',
      header:
        'Margin',
      render: row => (
        <span className="tabular-nums">
          {fmtPct(
            row.margin
          )}
        </span>
      )
    },
    {
      key:
        'payment_status',
      header:
        'Status',
      render: row =>
        row.payment_status ||
        '—'
    },
    {
      key:
        'detail',
      header:
        'Detail',
      render: row => (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 gap-1 text-[11px]"
          onClick={() =>
            setDetailRow(row)
          }
        >
          <Eye className="w-3.5 h-3.5" />
          Detail
        </Button>
      )
    }
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader
        title="Laporan Laba Rugi"
        description="Pendapatan − HPP − Cost & Loss = Laba Net"
        actions={
          <div className="flex items-center gap-2">
            <Button
              onClick={exportCSV}
              size="sm"
              variant="outline"
              className="gap-1.5"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </Button>

            <PdfButton
              onExport={
                exportPDF
              }
            />
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mb-4">
        <MiniKpi
          icon={Receipt}
          label="Pendapatan"
          value={fmtMoney(
            summary.revenue
          )}
          color="bg-emerald-50 text-emerald-600"
        />

        <MiniKpi
          icon={Wallet}
          label="Total HPP"
          value={fmtMoney(
            summary.hpp
          )}
          color="bg-amber-50 text-amber-600"
        />

        <MiniKpi
          icon={TrendingUp}
          label="Laba Kotor"
          value={fmtMoney(
            summary.laba
          )}
          color={
            summary.laba >= 0
              ? 'bg-teal-50 text-teal-600'
              : 'bg-red-50 text-red-600'
          }
        />

        <MiniKpi
          icon={Wallet}
          label="Biaya Operasional"
          value={fmtMoney(
            summary.operationalCost
          )}
          color="bg-indigo-50 text-indigo-600"
        />

        <MiniKpi
          icon={TrendingDown}
          label="Loss"
          value={fmtMoney(
            summary.operationalLoss
          )}
          color="bg-rose-50 text-rose-600"
        />

        <MiniKpi
          icon={CircleDollarSign}
          label={
            summary.labaNet >= 0
              ? 'Laba Net'
              : 'Rugi Net'
          }
          value={fmtMoney(
            summary.labaNet
          )}
          color={
            summary.labaNet >= 0
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-red-50 text-red-700'
          }
        />

        <MiniKpi
          icon={Percent}
          label="Margin Net"
          value={fmtPct(
            summary.marginNet
          )}
          color="bg-slate-100 text-slate-700"
        />
      </div>

      <div className="bg-white border border-border rounded-lg p-3 mb-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div>
          <Label className="text-[11px] mb-1">
            Dari Tanggal
          </Label>

          <Input
            type="date"
            value={
              filters.date_from
            }
            onChange={event =>
              setFilters(
                current => ({
                  ...current,
                  date_from:
                    event.target
                      .value
                })
              )
            }
            className="h-8 text-[12px]"
          />
        </div>

        <div>
          <Label className="text-[11px] mb-1">
            Sampai Tanggal
          </Label>

          <Input
            type="date"
            value={
              filters.date_to
            }
            onChange={event =>
              setFilters(
                current => ({
                  ...current,
                  date_to:
                    event.target
                      .value
                })
              )
            }
            className="h-8 text-[12px]"
          />
        </div>

        <div className="flex items-end">
          <div className="text-[12px] text-muted-foreground">
            {summary.count} invoice
          </div>
        </div>

        <div className="flex items-end">
          <div className="text-[12px] text-muted-foreground">
            {
              operationalSummary.count
            } Cost/Loss
          </div>
        </div>
      </div>

      <div className="bg-slate-900 text-white rounded-lg p-4 mb-4">
        <div className="grid sm:grid-cols-5 gap-3 text-sm">
          <div>
            <p className="text-slate-400 text-xs">
              Laba Kotor
            </p>
            <p className="font-bold mt-1">
              {fmtMoney(
                summary.laba
              )}
            </p>
          </div>

          <div>
            <p className="text-slate-400 text-xs">
              Biaya
            </p>
            <p className="font-bold mt-1 text-indigo-300">
              -{' '}
              {fmtMoney(
                summary.operationalCost
              )}
            </p>
          </div>

          <div>
            <p className="text-slate-400 text-xs">
              Loss
            </p>
            <p className="font-bold mt-1 text-rose-300">
              -{' '}
              {fmtMoney(
                summary.operationalLoss
              )}
            </p>
          </div>

          <div>
            <p className="text-slate-400 text-xs">
              Total Pengurang
            </p>
            <p className="font-bold mt-1">
              {fmtMoney(
                summary.operationalTotal
              )}
            </p>
          </div>

          <div>
            <p className="text-slate-400 text-xs">
              {summary.labaNet >= 0
                ? 'LABA NET'
                : 'RUGI NET'}
            </p>

            <p
              className={`text-xl font-bold mt-1 ${
                summary.labaNet >= 0
                  ? 'text-emerald-300'
                  : 'text-red-300'
              }`}
            >
              {fmtMoney(
                summary.labaNet
              )}
            </p>
          </div>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        emptyMessage="Belum ada data penjualan"
        searchKeys={[
          'invoice_number',
          'customer_name'
        ]}
        searchPlaceholder="Cari invoice / customer..."
      />

      {detailRow && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onMouseDown={event => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setDetailRow(null);
            }
          }}
        >
          <div className="bg-white rounded-lg shadow-xl border w-full max-w-6xl max-h-[85vh] overflow-hidden">
            <div className="px-5 py-4 border-b flex items-start justify-between gap-4">
              <div>
                <h2 className="font-bold text-base">
                  Breakdown Laba Rugi per Item
                </h2>

                <div className="text-xs text-muted-foreground mt-1">
                  {
                    detailRow.invoice_number
                  }{' '}
                  ·{' '}
                  {
                    detailRow.customer_name ||
                    '-'
                  }{' '}
                  ·{' '}
                  {
                    detailRow.transaction_date ||
                    '-'
                  }
                </div>
              </div>

              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={() =>
                  setDetailRow(null)
                }
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="overflow-auto max-h-[60vh]">
              <table className="w-full text-xs">
                <thead className="bg-muted/60 sticky top-0">
                  <tr className="border-b">
                    <th className="text-left px-4 py-2.5">
                      Produk
                    </th>
                    <th className="text-right px-3 py-2.5">
                      Qty
                    </th>
                    <th className="text-right px-3 py-2.5">
                      Harga/Unit
                    </th>
                    <th className="text-right px-3 py-2.5">
                      Pendapatan
                    </th>
                    <th className="text-right px-3 py-2.5">
                      HPP/Unit
                    </th>
                    <th className="text-right px-3 py-2.5">
                      Total HPP
                    </th>
                    <th className="text-right px-3 py-2.5">
                      Laba Kotor
                    </th>
                    <th className="text-right px-4 py-2.5">
                      Margin
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {(
                    detailRow.detailItems ||
                    []
                  ).map(
                    (
                      item,
                      index
                    ) => (
                      <tr
                        key={`${item.product_name}-${index}`}
                        className="border-b last:border-0"
                      >
                        <td className="px-4 py-3 font-medium">
                          {
                            item.product_name
                          }
                        </td>

                        <td className="px-3 py-3 text-right tabular-nums">
                          {item.qty}
                        </td>

                        <td className="px-3 py-3 text-right tabular-nums">
                          {fmtMoney(
                            item.unit_price
                          )}
                        </td>

                        <td className="px-3 py-3 text-right tabular-nums">
                          {fmtMoney(
                            item.revenue
                          )}
                        </td>

                        <td className="px-3 py-3 text-right tabular-nums">
                          {fmtMoney(
                            item.hpp_unit
                          )}
                        </td>

                        <td className="px-3 py-3 text-right tabular-nums font-medium">
                          {fmtMoney(
                            item.hpp
                          )}
                        </td>

                        <td
                          className={`px-3 py-3 text-right tabular-nums font-medium ${
                            item.laba >= 0
                              ? 'text-emerald-600'
                              : 'text-red-600'
                          }`}
                        >
                          {fmtMoney(
                            item.laba
                          )}
                        </td>

                        <td className="px-4 py-3 text-right tabular-nums">
                          {item.margin ===
                          null
                            ? '—'
                            : fmtPct(
                                item.margin
                              )}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>

                <tfoot className="bg-muted/40 font-bold border-t">
                  <tr>
                    <td className="px-4 py-3">
                      TOTAL INVOICE
                    </td>

                    <td className="px-3 py-3 text-right tabular-nums">
                      {
                        detailRow.qty
                      }
                    </td>

                    <td />

                    <td className="px-3 py-3 text-right tabular-nums">
                      {fmtMoney(
                        detailRow.revenue
                      )}
                    </td>

                    <td />

                    <td className="px-3 py-3 text-right tabular-nums">
                      {fmtMoney(
                        detailRow.hpp
                      )}
                    </td>

                    <td
                      className={`px-3 py-3 text-right tabular-nums ${
                        detailRow.laba >=
                        0
                          ? 'text-emerald-600'
                          : 'text-red-600'
                      }`}
                    >
                      {fmtMoney(
                        detailRow.laba
                      )}
                    </td>

                    <td className="px-4 py-3 text-right tabular-nums">
                      {fmtPct(
                        detailRow.margin
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="px-5 py-3 border-t bg-muted/20 text-[11px] text-muted-foreground">
              HPP detail tetap menggunakan frozen unit_cost dari StockLedger transaksi sales. Cost & Loss tidak dialokasikan ke masing-masing invoice; pengurang diterapkan pada ringkasan periode untuk menghasilkan Laba Net.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}