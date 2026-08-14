/**
 * Centralized permission catalog and helpers.
 * Permissions are stored per-user as:
 * { [menuKey]: { view, create, edit, delete, post, cancel, print, approve, download } }
 *
 * Admins bypass all checks; suspended users get no access.
 *
 * Master data is split per-entity
 * (master_customers, master_materials, ...)
 * so roles like SALES can access only Customer.
 *
 * A legacy `master` key is kept for backward compatibility
 * with users saved before the split.
 */

export const ACTIONS = [
  'view',
  'create',
  'edit',
  'delete'
];

export const MENU_CATALOG = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    group: 'utama',
    actions: ['view']
  },

  // =========================================================
  // DASHBOARD SECTION VISIBILITY
  // =========================================================

  {
    key: 'dashboard_operations',
    label: 'Dashboard · Operasional Produksi',
    group: 'utama',
    actions: ['view']
  },

  {
    key: 'dashboard_stock',
    label: 'Dashboard · Stok Operasional',
    group: 'utama',
    actions: ['view']
  },

  {
    key: 'dashboard_inventory_value',
    label: 'Dashboard · Nilai Persediaan',
    group: 'utama',
    actions: ['view']
  },

  {
    key: 'dashboard_sales',
    label: 'Dashboard · Penjualan',
    group: 'utama',
    actions: ['view']
  },

  {
    key: 'dashboard_receivables',
    label: 'Dashboard · Piutang',
    group: 'utama',
    actions: ['view']
  },

  {
    key: 'dashboard_activity',
    label: 'Dashboard · Aktivitas Terbaru',
    group: 'utama',
    actions: ['view']
  },

  // =========================================================
  // OPERASIONAL
  // =========================================================

  {
    key: 'recipes',
    label: 'Resep',
    group: 'operasional',
    actions: [
      'view',
      'create',
      'edit',
      'delete',
      'approve'
    ]
  },

  /**
   * SECURITY PATCH Ã¢â‚¬â€  Production Download Permission
   *
   * `view` dan `download` dipisahkan.
   *
   * User bisa:
   * view = true
   * download = false
   *
   * sehingga tetap dapat melihat Produksi
   * tetapi tidak dapat download Work Order / Laporan Produksi.
   */
  {
    key: 'production',
    label: 'Produksi',
    group: 'operasional',
    actions: [
      'view',
      'create',
      'edit',
      'post',
      'cancel',
      'download'
    ]
  },

  {
    key: 'premix',
    label: 'Produksi Premix',
    group: 'operasional',
    actions: [
      'view',
      'create',
      'edit',
      'post',
      'cancel'
    ]
  },

  {
    key: 'premix_batch',
    label: 'Batch Premix',
    group: 'operasional',
    actions: [
      'view',
      'adjust'
    ]
  },

  {
    key: 'bottling',
    label: 'Bottling',
    group: 'operasional',
    actions: [
      'view',
      'create',
      'edit',
      'post',
      'cancel'
    ]
  },

  {
    key: 'labeling',
    label: 'Labeling',
    group: 'operasional',
    actions: [
      'view',
      'create',
      'edit',
      'post',
      'cancel'
    ]
  },

  {
    key: 'excise',
    label: 'Proses Cukai',
    group: 'operasional',
    actions: [
      'view',
      'create',
      'edit',
      'post',
      'cancel'
    ]
  },

  {
    key: 'purchases',
    label: 'Pembelian',
    group: 'operasional',
    actions: [
      'view',
      'create',
      'edit',
      'post',
      'cancel',
      'print'
    ]
  },

  {
    key: 'sales',
    label: 'Penjualan',
    group: 'operasional',
    actions: [
      'view',
      'create',
      'edit',
      'delete',
      'post',
      'print'
    ]
  },

  {
    key: 'payments',
    label: 'Pembayaran Piutang',
    group: 'operasional',
    actions: [
      'view',
      'create',
      'edit'
    ]
  },

  {
    key: 'stock_card',
    label: 'Kartu Stok',
    group: 'operasional',
    actions: [
      'view',
      'opening_balance',
      'adjust'
    ]
  },

  {
    key: 'stock_card_detail',
    label: 'Kartu Stok Detail',
    group: 'operasional',
    actions: ['view']
  },

  // =========================================================
  // LAPORAN
  // =========================================================

  {
    key: 'report_sales',
    label: 'Laporan Penjualan',
    group: 'laporan',
    actions: ['view']
  },

  {
    key: 'report_receivables',
    label: 'Laporan Piutang',
    group: 'laporan',
    actions: ['view']
  },

  {
    key: 'traceability',
    label: 'Traceability Batch',
    group: 'laporan',
    actions: ['view']
  },

  {
    key: 'hpp',
    label: 'HPP Produk',
    group: 'laporan',
    actions: ['view']
  },

  {
    key: 'report_inventory',
    label: 'Laporan Inventaris',
    group: 'laporan',
    actions: ['view']
  },

  {
    key: 'report_profit_loss',
    label: 'Laporan Laba Rugi',
    group: 'laporan',
    actions: ['view']
  },

  {
    key: 'operational_cost',
    label: 'Operational Cost',
    group: 'laporan',
    actions: [
      'view',
      'create',
      'edit',
      'delete'
    ]
  },

  // =========================================================
  // MASTER DATA
  // =========================================================

  {
    key: 'master_brands',
    label: 'Master Merk',
    group: 'master',
    actions: [
      'view',
      'create',
      'edit',
      'delete'
    ]
  },

  {
    key: 'master_categories',
    label: 'Master Kategori',
    group: 'master',
    actions: [
      'view',
      'create',
      'edit',
      'delete'
    ]
  },

  {
    key: 'master_suppliers',
    label: 'Master Supplier',
    group: 'master',
    actions: [
      'view',
      'create',
      'edit',
      'delete'
    ]
  },

  {
    key: 'master_customers',
    label: 'Master Customer',
    group: 'master',
    actions: [
      'view',
      'create',
      'edit',
      'delete'
    ]
  },

  {
    key: 'master_materials',
    label: 'Master Bahan',
    group: 'master',
    actions: [
      'view',
      'create',
      'edit',
      'delete'
    ]
  },

  {
    key: 'master_products',
    label: 'Master Barang',
    group: 'master',
    actions: [
      'view',
      'create',
      'edit',
      'delete'
    ]
  },

  {
    key: 'master_warehouses',
    label: 'Master Gudang',
    group: 'master',
    actions: [
      'view',
      'create',
      'edit',
      'delete'
    ]
  },

  {
    key: 'master',
    label: 'Master Data (legacy)',
    group: 'master',
    actions: [
      'view',
      'create',
      'edit',
      'delete'
    ]
  },

  // =========================================================
  // SISTEM
  // =========================================================

  {
    key: 'report_pdf',
    label: 'Export PDF Laporan',
    group: 'sistem',
    actions: ['view']
  },

  {
    key: 'invoice_pdf',
    label: 'Export PDF Invoice',
    group: 'sistem',
    actions: ['view']
  },

  {
    key: 'users',
    label: 'Manajemen Pengguna',
    group: 'sistem',
    actions: [
      'view',
      'create',
      'edit',
      'delete'
    ]
  },

  {
    key: 'settings',
    label: 'Pengaturan',
    group: 'sistem',
    actions: ['view']
  },

  {
    key: 'recipe_visibility',
    label: 'Kelola Visibilitas Resep',
    group: 'sistem',
    actions: ['view']
  },

  {
    key: 'recipe_hidden_view',
    label: 'Lihat Resep Tersembunyi',
    group: 'sistem',
    actions: ['view']
  },

  {
    key: 'recipe_restricted_view',
    label: 'Lihat Resep Role-Restricted',
    group: 'sistem',
    actions: ['view']
  },

  {
    key: 'recipe_use_without_formula_view',
    label: 'Produksi Tanpa Lihat Formula',
    group: 'sistem',
    actions: ['view']
  },

  {
    key: 'database',
    label: 'Database Management',
    group: 'sistem',
    actions: [
      'view',
      'backup',
      'backup_download',
      'restore',
      'reset'
    ]
  },
];

const MASTER_ENTITY_KEYS = [
  'master_brands',
  'master_categories',
  'master_suppliers',
  'master_customers',
  'master_materials',
  'master_products',
  'master_warehouses'
];

/**
 * ============================================================
 * OPERATOR DEFAULT
 * ============================================================
 */

const OPERATOR_DEFAULTS = {
  dashboard: {
    view: true
  },

  dashboard_operations: {
    view: true
  },

  dashboard_stock: {
    view: true
  },

  dashboard_inventory_value: {
    view: false
  },

  dashboard_sales: {
    view: false
  },

  dashboard_receivables: {
    view: false
  },

  dashboard_activity: {
    view: true
  },

  recipes: {
    view: true,
    create: true,
    edit: true,
    delete: false,
    approve: false
  },

  production: {
    view: true,
    create: true,
    edit: true,
    post: true,
    cancel: false,

    /**
     * SECURITY DEFAULT:
     * Operator tidak boleh download laporan produksi
     * kecuali Admin mengaktifkan permission ini.
     */
    download: false
  },

  premix: {
    view: true,
    create: true,
    edit: true,
    post: true,
    cancel: false
  },

  premix_batch: {
    view: true,
    adjust: false
  },

  bottling: {
    view: true,
    create: true,
    edit: true,
    post: true,
    cancel: false
  },

  labeling: {
    view: true,
    create: true,
    edit: true,
    post: true,
    cancel: false
  },

  excise: {
    view: true,
    create: true,
    edit: true,
    post: true,
    cancel: false
  },

  purchases: {
    view: true,
    create: true,
    edit: true,
    post: true,
    cancel: false,
    print: true
  },

  sales: {
    view: true,
    create: true,
    edit: true,
    delete: false,
    post: true,
    print: true
  },

  payments: {
    view: true,
    create: true,
    edit: true
  },

  stock_card: {
    view: true,
    opening_balance: false,
    adjust: false
  },

  stock_card_detail: {
    view: true
  },

  report_sales: {
    view: true
  },

  report_receivables: {
    view: true
  },

  traceability: {
    view: true
  },

  hpp: {
    view: true
  },

  master: {
    view: true,
    create: true,
    edit: true,
    delete: false
  },

  ...Object.fromEntries(
    MASTER_ENTITY_KEYS.map((key) => [
      key,
      {
        view: true,
        create: true,
        edit: true,
        delete: false
      }
    ])
  ),

  report_pdf: {
    view: true
  },

  invoice_pdf: {
    view: true
  },

  users: {
    view: false,
    create: false,
    edit: false,
    delete: false
  },

  settings: {
    view: false
  },
};


/**
 * ============================================================
 * MANAGER DEFAULT
 * ============================================================
 *
 * Manager adalah role operasional tingkat tinggi.
 * BUKAN Administrator Base44 dan tidak mendapat admin bypass.
 *
 * Default:
 * - memakai baseline Operator
 * - boleh Saldo Awal dan Koreksi Stok
 * - boleh membuka Settings & Manajemen Pengguna
 * - tidak boleh menghapus user secara default
 * - seluruh permission tetap bisa dicustom oleh Administrator
 */

const MANAGER_DEFAULTS = {
  ...OPERATOR_DEFAULTS,

  stock_card: {
    view: true,
    opening_balance: true,
    adjust: true
  },

  stock_card_detail: {
    view: true
  },

  users: {
    view: true,
    create: true,
    edit: true,
    delete: false
  },

  settings: {
    view: true
  }
};

/**
 * ============================================================
 * SALES DEFAULT
 * ============================================================
 */

const SALES_DEFAULTS = {
  dashboard: {
    view: true
  },

  dashboard_operations: {
    view: false
  },

  dashboard_stock: {
    view: true
  },

  dashboard_inventory_value: {
    view: false
  },

  dashboard_sales: {
    view: true
  },

  dashboard_receivables: {
    view: true
  },

  dashboard_activity: {
    view: true
  },

  sales: {
    view: true,
    create: true,
    edit: true,
    delete: false,
    post: true,
    print: true
  },

  payments: {
    view: true
  },

  stock_card: {
    view: true
  },

  master_customers: {
    view: true,
    create: true,
    edit: true,
    delete: false
  },

  master_products: {
    view: true,
    create: false,
    edit: false,
    delete: false
  },

  report_sales: {
    view: true
  },

  report_receivables: {
    view: true
  },

  report_pdf: {
    view: true
  },

  invoice_pdf: {
    view: true
  },

  hpp: {
    view: true
  },
};

/**
 * ============================================================
 * PRODUCTION HEAD DEFAULT
 * ============================================================
 */

const PRODUCTION_HEAD_DEFAULTS = {
  dashboard: {
    view: true
  },

  dashboard_operations: {
    view: true
  },

  dashboard_stock: {
    view: true
  },

  dashboard_inventory_value: {
    view: false
  },

  dashboard_sales: {
    view: false
  },

  dashboard_receivables: {
    view: false
  },

  dashboard_activity: {
    view: true
  },

  recipes: {
    view: true,
    create: false,
    edit: false,
    delete: false,
    approve: false
  },

  production: {
    view: true,
    create: true,
    edit: true,
    post: true,
    cancel: true,

    /**
     * Default OFF.
     *
     * Admin bisa memberikan download secara individual
     * dari Settings / Hak Akses.
     */
    download: false
  },

  premix: {
    view: true,
    create: true,
    edit: true,
    post: true,
    cancel: true
  },

  premix_batch: {
    view: true,
    adjust: false
  },

  bottling: {
    view: true,
    create: true,
    edit: true,
    post: true,
    cancel: true
  },

  labeling: {
    view: true,
    create: true,
    edit: true,
    post: true,
    cancel: true
  },

  excise: {
    view: true,
    create: true,
    edit: true,
    post: true,
    cancel: true
  },

  purchases: {
    view: true,
    create: true,
    edit: true,
    post: true,
    cancel: true,
    print: true
  },

  stock_card: {
    view: true
  },

  traceability: {
    view: true
  },

  hpp: {
    view: true
  },

  master_materials: {
    view: true,
    create: true,
    edit: true,
    delete: false
  },

  master_products: {
    view: true,
    create: true,
    edit: true,
    delete: false
  },

  master_suppliers: {
    view: true,
    create: true,
    edit: true,
    delete: false
  },

  master_brands: {
    view: true,
    create: false,
    edit: false,
    delete: false
  },

  master_categories: {
    view: true,
    create: false,
    edit: false,
    delete: false
  },

  master_warehouses: {
    view: true,
    create: false,
    edit: false,
    delete: false
  },

  report_pdf: {
    view: true
  },

  invoice_pdf: {
    view: true
  },
};

/**
 * ============================================================
 * BREWER DEFAULT
 * ============================================================
 */

const BREWER_DEFAULTS = {
  dashboard: {
    view: true
  },

  dashboard_operations: {
    view: true
  },

  dashboard_stock: {
    view: true
  },

  dashboard_inventory_value: {
    view: false
  },

  dashboard_sales: {
    view: false
  },

  dashboard_receivables: {
    view: false
  },

  dashboard_activity: {
    view: true
  },

  recipes: {
    view: true,
    create: false,
    edit: false,
    delete: false,
    approve: false
  },

  production: {
    view: true,
    create: true,
    edit: false,
    post: false,
    cancel: false,
    download: false
  },

  premix: {
    view: true,
    create: true,
    edit: false,
    post: false,
    cancel: false
  },

  stock_card: {
    view: true
  },

  traceability: {
    view: true
  },

  hpp: {
    view: true
  },
};

const ROLE_DEFAULTS = {
  manager: MANAGER_DEFAULTS,
  user: OPERATOR_DEFAULTS,
  sales: SALES_DEFAULTS,
  production_head: PRODUCTION_HEAD_DEFAULTS,
  brewer: BREWER_DEFAULTS,
};

/**
 * ============================================================
 * HAS PERMISSION
 * ============================================================
 */

export function hasPermission(
  user,
  menu,
  action = 'view'
) {
  if (!user) {
    return false;
  }

  /**
   * ADMIN FAIL-SAFE
   *
   * Admin selalu full access.
   */
  if (user.role === 'admin') {
    return true;
  }

  /**
   * Suspended user tidak memiliki akses.
   */
  if (user.status === 'suspended') {
    return false;
  }

  const matrix =
    user.permissions &&
    typeof user.permissions === 'object' &&
    !Array.isArray(user.permissions) &&
    Object.keys(user.permissions).length > 0
      ? user.permissions
      : getDefaultPermissions(
          user.role || 'user'
        );

  let menuPermission =
    matrix[menu];

  /**
   * Backward compatibility:
   *
   * Legacy `master` permission dapat men-cover
   * master_* untuk user lama.
   */
  if (
    !menuPermission &&
    menu.startsWith('master_') &&
    matrix.master
  ) {
    menuPermission =
      matrix.master;
  }

  return !!(
    menuPermission &&
    menuPermission[action]
  );
}

/**
 * ============================================================
 * DEFAULT PERMISSIONS
 * ============================================================
 *
 * Membuat fresh matrix berdasarkan MENU_CATALOG.
 *
 * Keuntungan:
 * ketika action baru seperti `download` ditambahkan,
 * semua role otomatis mengenalnya.
 *
 * Untuk non-admin:
 * permission yang tidak disebut dalam preset
 * tetap false.
 */

export function getDefaultPermissions(role) {
  const base = {};

  for (const menu of MENU_CATALOG) {
    base[menu.key] = {};

    for (const action of menu.actions) {
      base[menu.key][action] =
        role === 'admin';
    }
  }

  if (role === 'admin') {
    return base;
  }

  const defaults =
    ROLE_DEFAULTS[role] ||
    OPERATOR_DEFAULTS;

  for (const key of Object.keys(defaults)) {
    base[key] = {
      ...base[key],
      ...defaults[key],
    };
  }

  return base;
}

/**
 * ============================================================
 * NORMALIZE PERMISSIONS
 * ============================================================
 *
 * Semua menu/action pada MENU_CATALOG
 * selalu tersedia di hasil akhir.
 *
 * SECURITY:
 * permission baru yang belum dimiliki user lama
 * otomatis menjadi FALSE.
 *
 * Contoh:
 *
 * user lama:
 *
 * production: {
 *   view: true,
 *   create: true
 * }
 *
 * setelah normalize:
 *
 * production: {
 *   view: true,
 *   create: true,
 *   edit: false,
 *   post: false,
 *   cancel: false,
 *   download: false
 * }
 */

export function normalizePermissions(perm) {
  const out = {};

  for (const menu of MENU_CATALOG) {
    const row =
      perm?.[menu.key] ||
      {};

    out[menu.key] = {};

    for (const action of menu.actions) {
      out[menu.key][action] =
        !!row[action];
    }
  }

  return out;
}

/**
 * ============================================================
 * ROUTE ACCESS
 * ============================================================
 */

export const ROUTE_ACCESS = [
  {
    route: '/',
    perm: 'dashboard'
  },

  {
    route: '/recipes',
    perm: 'recipes'
  },

  {
    route: '/production',
    perm: 'production'
  },

  {
    route: '/bottling',
    perm: 'bottling'
  },

  {
    route: '/labeling',
    perm: 'labeling'
  },

  {
    route: '/excise',
    perm: 'excise'
  },

  {
    route: '/purchases',
    perm: 'purchases'
  },

  {
    route: '/sales',
    perm: 'sales'
  },

  {
    route: '/payments',
    perm: 'payments'
  },

  {
    route: '/stock-card',
    perm: 'stock_card'
  },

  {
    route: '/stock-card-dedicated',
    perm: 'stock_card_detail'
  },

  {
    route: '/reports/sales',
    perm: 'report_sales'
  },

  {
    route: '/reports/receivables',
    perm: 'report_receivables'
  },

  {
    route: '/traceability',
    perm: 'traceability'
  },

  {
    route: '/hpp',
    perm: 'hpp'
  },

  {
    route: '/reports/inventory',
    perm: 'report_inventory'
  },

  {
    route: '/reports/profit-loss',
    perm: 'report_profit_loss'
  },

  {
    route: '/operational-cost',
    perm: 'operational_cost'
  },

  {
    route: '/master/brands',
    perm: 'master_brands'
  },

  {
    route: '/master/categories',
    perm: 'master_categories'
  },

  {
    route: '/master/suppliers',
    perm: 'master_suppliers'
  },

  {
    route: '/master/customers',
    perm: 'master_customers'
  },

  {
    route: '/master/materials',
    perm: 'master_materials'
  },

  {
    route: '/master/products',
    perm: 'master_products'
  },

  {
    route: '/master/warehouses',
    perm: 'master_warehouses'
  },

  {
    route: '/users',
    perm: 'users'
  },

  {
    route: '/database',
    perm: 'database'
  },

  {
    route: '/settings',
    perm: 'settings'
  },
];

/**
 * First route the user may view.
 */
export function getFirstAccessibleRoute(user) {
  return (
    ROUTE_ACCESS.find(
      route =>
        hasPermission(
          user,
          route.perm,
          'view'
        )
    )?.route ||
    null
  );
}

/**
 * Whether user may access route.
 *
 * Unknown routes pass because public/auth pages
 * may not exist in ROUTE_ACCESS.
 */
export function canAccessRoute(
  user,
  path
) {
  if (
    user?.role ===
    'admin'
  ) {
    return true;
  }

  const entry =
    ROUTE_ACCESS.find(
      route =>
        route.route === path
    );

  if (!entry) {
    return true;
  }

  return hasPermission(
    user,
    entry.perm,
    'view'
  );
}

/**
 * ============================================================
 * RECIPE VISIBILITY HELPERS
 * ============================================================
 */

export function canManageRecipeVisibility(user) {
  return hasPermission(
    user,
    'recipe_visibility',
    'view'
  );
}

export function canViewHiddenRecipe(user) {
  return hasPermission(
    user,
    'recipe_hidden_view',
    'view'
  );
}

export function canUseRecipeWithoutFormulaView(user) {
  return hasPermission(
    user,
    'recipe_use_without_formula_view',
    'view'
  );
}

/**
 * Whether the given user may VIEW a recipe.
 */
export function canViewRecipe(
  user,
  recipe
) {
  if (
    !user ||
    !recipe
  ) {
    return false;
  }

  if (
    user.role ===
    'admin'
  ) {
    return true;
  }

  if (
    !hasPermission(
      user,
      'recipes',
      'view'
    )
  ) {
    return false;
  }

  const visibilityType =
    recipe.visibility_type ||
    'PUBLIC_INTERNAL';

  if (
    visibilityType ===
    'ADMIN_ONLY'
  ) {
    return canViewHiddenRecipe(
      user
    );
  }

  if (
    recipe.is_hidden &&
    !canViewHiddenRecipe(
      user
    )
  ) {
    return false;
  }

  if (
    visibilityType ===
    'ROLE_RESTRICTED'
  ) {
    if (
      hasPermission(
        user,
        'recipe_restricted_view',
        'view'
      )
    ) {
      return true;
    }

    const allowed =
      recipe.allowed_role_ids ||
      [];

    return (
      Array.isArray(
        allowed
      ) &&
      allowed.includes(
        user.role
      )
    );
  }

  return true;
}

/**
 * Whether the user may SELECT a recipe
 * in Production.
 */
export function canSelectRecipeForProduction(
  user,
  recipe
) {
  if (
    !user ||
    !recipe
  ) {
    return false;
  }

  if (
    user.role ===
    'admin'
  ) {
    return true;
  }

  if (
    canViewRecipe(
      user,
      recipe
    )
  ) {
    return true;
  }

  return !!(
    recipe.allow_production_without_formula_view &&
    canUseRecipeWithoutFormulaView(
      user
    )
  );
}

/**
 * Whether formula percentages must be hidden.
 */
export function isRecipeFormulaHidden(
  user,
  recipe
) {
  if (
    !user ||
    !recipe
  ) {
    return false;
  }

  if (
    user.role ===
    'admin'
  ) {
    return false;
  }

  if (
    canViewHiddenRecipe(
      user
    )
  ) {
    return false;
  }

  return (
    recipe.is_hidden === true ||
    recipe.visibility_type ===
      'ADMIN_ONLY'
  );
}
