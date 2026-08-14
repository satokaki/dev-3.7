/**
 * LAB PRO — Sumber formatter global tunggal.
 *
 * Semua tampilan angka aplikasi (mata uang, quantity, desimal, persen, gram, ml,
 * unit) WAJIB melewati helper di file ini. Tidak boleh ada formatter lokal di
 * halaman (fmtMoney/formatRupiah/Intl.NumberFormat inline untuk display).
 *
 * Aturan:
 *  - Locale: id-ID (separator ribuan ".", desimal ",").
 *  - Mata uang: 2 desimal.
 *  - Quantity: integer → 0 desimal; desimal → maks 4 digit.
 *  - Persen: input 0–100 (TIDAK dikali 100), 2 desimal.
 *  - HPP per gram/ml: 2–4 desimal via formatCurrencyPrecise.
 *
 * Formatter HANYA untuk display. Kalkulasi internal wajib pakai number mentah.
 * Parsing input (string id-ID → number) lewat parseLocalizedNumber, BUKAN
 * Number("5.878,67") atau replace manual sebarangan.
 */

const LOCALE = 'id-ID';

/** Format mata uang IDR 2 desimal. formatCurrency(5878.674) → "Rp 5.878,67". */
export const formatCurrency = (v) =>
  'Rp ' + (Number(v) || 0).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Format mata uang IDR dengan presisi kustom (HPP per gram/ml). formatCurrencyPrecise(0.0512, 4) → "Rp 0,0512". */
export const formatCurrencyPrecise = (v, maximumFractionDigits = 4) =>
  'Rp ' + (Number(v) || 0).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits });

/** Format angka umum. formatNumber(10000) → "10.000"; formatNumber(5878.674, 3) → "5.878,674". */
export const formatNumber = (v, maximumFractionDigits = 2) =>
  (Number(v) || 0).toLocaleString(LOCALE, { maximumFractionDigits });

/** Alias formatNumber (nama eksplisit untuk konteks desimal). */
export const formatDecimal = (v, maximumFractionDigits = 2) => formatNumber(v, maximumFractionDigits);

/** Format quantity + satuan. Integer tanpa desimal, desimal maks 4 digit.
 *  formatQuantity(10000, "gram") → "10.000 gram"
 *  formatQuantity(10.5, "kg") → "10,5 kg"
 *  formatQuantity(158, "unit") → "158 unit" */
export const formatQuantity = (v, unit) => {
  const n = Number(v) || 0;
  const isInt = Number.isInteger(n);
  const num = n.toLocaleString(LOCALE, { maximumFractionDigits: isInt ? 0 : 4 });
  return unit ? `${num} ${unit}` : num;
};

/** Alias formatQuantity. */
export const formatUnitValue = (v, unit) => formatQuantity(v, unit);

/** Format persen (input 0–100, TIDAK dikali 100).
 *  formatPercent(8) → "8,00%"; formatPercent(0.5) → "0,50%". */
export const formatPercent = (v, maximumFractionDigits = 2) =>
  (Number(v) || 0).toLocaleString(LOCALE, { minimumFractionDigits: maximumFractionDigits, maximumFractionDigits }) + '%';

/** Parse string id-ID ("5.878,67" / "Rp 2.605.000,00") → number (5878.67).
 *  Untuk input parsing, BUKAN display. Aman untuk number mentah (return apa adanya). */
export const parseLocalizedNumber = (s) => {
  if (typeof s === 'number') return s;
  if (s === '' || s === null || s === undefined) return NaN;
  // Buang separator ribuan (.), ganti desimal (,) → (.), lalu strip sisa non-numeric.
  const cleaned = String(s).replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '');
  return Number(cleaned);
};