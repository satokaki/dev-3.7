// Reusable decimal normalization for numeric form fields.
// NumberInput keeps a raw string while the user types; call toNumber() /
// normalizeDecimalInput() only at submit or validation time.
//
// Behavior:
//   "" / null / undefined        -> null  (field kosong, bukan 0)
//   "0,5" / "0.5"                -> 0.5   (koma -> titik)
//   "010"                        -> 10    (leading zero dibuang oleh NumberInput,
//                                         tapi helper tetap aman)
//   "abc" / "-" / "."             -> null
export function normalizeDecimalInput(value) {
  if (value === null || value === undefined || value === '') return null;
  let s = String(value).trim().replace(',', '.');
  s = s.replace(/[^\d.\-]/g, '');
  if (s === '' || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

// Convenience: returns fallback (default 0) when the field is empty/invalid,
// so numeric payloads stay consistent for the DB.
export function toNumber(value, fallback = 0) {
  const n = normalizeDecimalInput(value);
  return n === null ? fallback : n;
}