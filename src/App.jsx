import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import Recipes from '@/pages/Recipes';
import Production from '@/pages/Production';
import Bottling from '@/pages/Bottling';
import Labeling from '@/pages/Labeling';
import Excise from '@/pages/Excise';
import Sales from '@/pages/Sales';
import Purchases from '@/pages/Purchases';
import Payments from '@/pages/Payments';
import StockCard from '@/pages/StockCard';
import StockCardDedicated from '@/pages/StockCardDedicated';
import SalesReport from '@/pages/SalesReport';
import ReceivablesReport from '@/pages/ReceivablesReport';
import InventoryReport from '@/pages/InventoryReport';
import ProfitLossReport from '@/pages/ProfitLossReport';
import BatchTraceability from '@/pages/BatchTraceability';
import Hpp from '@/pages/Hpp';
import Settings from '@/pages/Settings';
import DatabaseManagement from '@/pages/DatabaseManagement';
import Brands from '@/pages/Brands';
import Categories from '@/pages/Categories';
import Suppliers from '@/pages/Suppliers';
import Customers from '@/pages/Customers';
import Materials from '@/pages/Materials';
import Products from '@/pages/Products';
import Warehouses from '@/pages/Warehouses';
import Assistant from '@/pages/Assistant';
import OperationalCost from '@/pages/OperationalCost';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import NoAccess from '@/pages/NoAccess';
import LandingRedirect from '@/components/LandingRedirect';
import PermissionGuard from '@/components/PermissionGuard';

const AuthenticatedApp = () => {
  const {
    isLoadingAuth,
    isLoadingPublicSettings,
    authError,
    navigateToLogin
  } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route element={<PermissionGuard />}>
          <Route path="/" element={<LandingRedirect />} />

          {/* Operasional */}
          <Route path="/recipes" element={<Recipes />} />
          <Route path="/production" element={<Production />} />
          <Route path="/bottling" element={<Bottling />} />
          <Route path="/labeling" element={<Labeling />} />
          <Route path="/excise" element={<Excise />} />
          <Route path="/sales" element={<Sales />} />
          <Route path="/purchases" element={<Purchases />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/stock-card" element={<StockCard />} />
          <Route path="/stock-card-dedicated" element={<StockCardDedicated />} />

          {/* Biaya Operasional */}
          <Route
            path="/operationalCost"
            element={<OperationalCost />}
          />

          {/* Laporan */}
          <Route path="/reports/sales" element={<SalesReport />} />
          <Route
            path="/reports/receivables"
            element={<ReceivablesReport />}
          />
          <Route
            path="/reports/inventory"
            element={<InventoryReport />}
          />
          <Route
            path="/reports/profit-loss"
            element={<ProfitLossReport />}
          />
          <Route
            path="/traceability"
            element={<BatchTraceability />}
          />
          <Route path="/hpp" element={<Hpp />} />

          {/* Sistem */}
          <Route path="/settings" element={<Settings />} />
          <Route path="/database" element={<DatabaseManagement />} />
          <Route path="/assistant" element={<Assistant />} />

          {/* Master Data */}
          <Route path="/master/brands" element={<Brands />} />
          <Route path="/master/categories" element={<Categories />} />
          <Route path="/master/suppliers" element={<Suppliers />} />
          <Route path="/master/customers" element={<Customers />} />
          <Route path="/master/materials" element={<Materials />} />
          <Route path="/master/products" element={<Products />} />
          <Route path="/master/warehouses" element={<Warehouses />} />
        </Route>
      </Route>

      {/* Public routes */}
      <Route path="/no-access" element={<NoAccess />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* 404 */}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>

        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App
