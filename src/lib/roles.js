export const ROLES = [
  { value: 'admin', label: 'Administrator' },
  { value: 'manager', label: 'Manager' },
  { value: 'user', label: 'Operator' },
  { value: 'sales', label: 'Sales' },
  { value: 'production_head', label: 'Kepala Produksi' },
  { value: 'brewer', label: 'Brewer' },
];

export const roleLabel = (r) =>
  ROLES.find((x) => x.value === r)?.label || (r || '—');