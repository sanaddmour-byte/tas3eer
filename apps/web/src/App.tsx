import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Shell } from './components/Shell';
import { Loading } from './components/ui';
import { AcceptInvitePage, LoginPage, SetupPage } from './pages/Auth';
import { Overview } from './pages/Overview';
import { QuotationList } from './pages/QuotationList';
import { QuotationBuilder } from './pages/QuotationBuilder';
import { QuotationDetail } from './pages/QuotationDetail';
import { MixLibrary, MixDetail } from './pages/Mixes';
import { PriceBook } from './pages/PriceBook';
import { PriceUpdates, PriceBatchDetail } from './pages/PriceUpdates';
import { PlantCosts } from './pages/PlantCosts';
import { Approvals } from './pages/Approvals';
import { ClientsProjects } from './pages/Clients';
import { UsersPage, AuditPage, SettingsPage } from './pages/Admin';

export function App() {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!me) {
    return (
      <Routes>
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" state={{ from: loc.pathname + loc.search }} replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Overview />} />
        <Route path="quotations" element={<QuotationList />} />
        <Route path="quotations/new" element={<QuotationBuilder />} />
        <Route path="quotations/:id" element={<QuotationDetail />} />
        <Route path="quotations/:id/edit" element={<QuotationBuilder />} />
        <Route path="mixes" element={<MixLibrary />} />
        <Route path="mixes/:id" element={<MixDetail />} />
        <Route path="price-book" element={<PriceBook />} />
        <Route path="price-book/updates" element={<PriceUpdates />} />
        <Route path="price-book/updates/:id" element={<PriceBatchDetail />} />
        <Route path="plant-costs" element={<PlantCosts />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="clients" element={<ClientsProjects />} />
        <Route path="admin/users" element={<UsersPage />} />
        <Route path="admin/audit" element={<AuditPage />} />
        <Route path="admin/settings" element={<SettingsPage />} />
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<div className="page"><h1>404</h1></div>} />
      </Route>
    </Routes>
  );
}
