import React, { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Reusable number input that keeps a STRING state so users can clear the field,
 * type new values without a forced leading "0", and leave it empty while typing.
 *
 * - value can be: number | string | null | undefined  (normalized to "" when empty)
 * - onChange(value: string) — always returns the raw string ("" when empty)
 * - On submit the parent converts: form.x === "" ? null : Number(form.x)
 *
 * Validation on input (block invalid characters):
 * - allows digits, one decimal separator, optional leading minus when allowNegative
 * - no leading zeros like "01"/"005"
 * - enforces maxDecimals and max
 */
export default function NumberInput({
  value,
  onChange,
  allowNegative = false,
  allowDecimal = true,
  maxDecimals,
  max,
  min,
  className,
  ...rest
}) {
  // Normalize incoming value to a display string
  const display = useMemo(() => {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'number' && Number.isNaN(value)) return '';
    return String(value);
  }, [value]);

  const sanitize = (raw) => {
    if (raw === '' || raw === null || raw === undefined) return '';
    let s = String(raw).trim();
    // replace comma with dot for decimal
    s = s.replace(',', '.');
    // remove everything except digits, dot, minus
    s = s.replace(/[^\d.\-]/g, '');
    // only one minus at start
    if (allowNegative) {
      const minusCount = (s.match(/-/g) || []).length;
      if (s.indexOf('-') !== 0 && minusCount > 0) s = s.replace(/-/g, '');
      else if (s.indexOf('-') === 0) s = '-' + s.replace(/-/g, '');
    } else {
      s = s.replace(/-/g, '');
    }
    // only one dot
    const parts = s.split('.');
    if (parts.length > 2) s = parts[0] + '.' + parts.slice(1).join('');
    // remove leading zeros (keep "0" and "0.x")
    if (s.length > 1 && s[0] === '0' && s[1] !== '.') s = s.replace(/^0+/, '');
    if (s.startsWith('-0') && s.length > 2 && s[2] !== '.') s = s.replace(/^-0+/, '-') + (s[0] === '-' ? '' : '');
    // limit decimals
    if (maxDecimals !== undefined && s.includes('.')) {
      const [int, dec] = s.split('.');
      s = int + '.' + dec.slice(0, maxDecimals);
    }
    // enforce max
    if (max !== undefined && s !== '' && s !== '-') {
      const n = Number(s);
      if (!Number.isNaN(n) && n > max) s = String(max);
    }
    if (min !== undefined && s !== '' && s !== '-') {
      const n = Number(s);
      if (!Number.isNaN(n) && n < min) s = String(min);
    }
    return s;
  };

  const handleChange = (e) => {
    const next = sanitize(e.target.value);
    onChange?.(next);
  };

  // Hide native spinner for cleaner look consistent with project
  return (
    <Input
      type="text"
      inputMode="decimal"
      value={display}
      onChange={handleChange}
      className={cn('tabular-nums', className)}
      {...rest}
    />
  );
}