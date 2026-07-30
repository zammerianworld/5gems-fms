import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './components/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Trips from './pages/Trips'
import Expenses from './pages/Expenses'
import Billing from './pages/Billing'
import Users from './pages/Users'
import Settings from './pages/Settings'
import Reports from './pages/Reports'
import MidyearReport from './pages/MidyearReport'
import Summary from './pages/Summary'
import CheckVouchers from './pages/CheckVouchers'
import MyAccount from './pages/MyAccount'
import Logs from './pages/Logs'
import Activity from './pages/Activity'
import Cashflow from './pages/Cashflow'
import YearOverYear from './pages/YearOverYear'
import Backup from './pages/Backup'
import PaidInvoices from './pages/PaidInvoices'
import SubconTrips from './pages/SubconTrips'
import Loans from './pages/Loans'
import ORCR from './pages/ORCR'
import ExtraIncome from './pages/ExtraIncome'
import CashVouchers from './pages/CashVouchers'
import HistoricalData from './pages/HistoricalData'
import Trash from './pages/Trash'
import PrintLayouts from './pages/PrintLayouts'
import Payroll from './pages/Payroll'
import HowTo from './pages/HowTo'
import MyTrips from './pages/MyTrips'
import './index.css'

function ProtectedRoute({ children, adminOnly, superuserOnly, moduleKey, viewerAllowed }) {
  const { user, profile, loading, isSuperuser, isAdmin, isViewer, hasModule } = useAuth()
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)', color: 'var(--muted)', fontSize: 14 }}>
      Loading…
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  // Viewer accounts (e.g. a subcon's read-only login) are locked to their
  // own page and My Account — everything else redirects them back there.
  if (isViewer && !viewerAllowed) return <Navigate to="/my-trips" replace />
  if (superuserOnly && !isSuperuser) return <Navigate to="/dashboard" replace />
  if (adminOnly && !isAdmin) return <Navigate to="/dashboard" replace />
  if (moduleKey && !hasModule(moduleKey)) return <Navigate to="/dashboard" replace />
  return <Layout>{children}</Layout>
}

function AppRoutes() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={!user ? <Login /> : <Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/trips" element={<ProtectedRoute moduleKey="trips"><Trips /></ProtectedRoute>} />
      <Route path="/billing" element={<ProtectedRoute moduleKey="billing"><Billing /></ProtectedRoute>} />
      <Route path="/expenses" element={<ProtectedRoute moduleKey="expenses"><Expenses /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute adminOnly moduleKey="reports"><Reports /></ProtectedRoute>} />
      <Route path="/midyear-report" element={<ProtectedRoute adminOnly moduleKey="reports"><MidyearReport /></ProtectedRoute>} />
      <Route path="/summary" element={<ProtectedRoute adminOnly moduleKey="summary"><Summary /></ProtectedRoute>} />
      <Route path="/vouchers" element={<ProtectedRoute adminOnly moduleKey="vouchers"><CheckVouchers /></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute superuserOnly><Users /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute adminOnly moduleKey="settings"><Settings /></ProtectedRoute>} />
      <Route path="/my-account" element={<ProtectedRoute viewerAllowed><MyAccount /></ProtectedRoute>} />
      <Route path="/my-trips" element={<ProtectedRoute viewerAllowed><MyTrips /></ProtectedRoute>} />
      <Route path="/logs" element={<ProtectedRoute superuserOnly><Logs /></ProtectedRoute>} />
      <Route path="/activity" element={<ProtectedRoute><Activity /></ProtectedRoute>} />
      <Route path="/cashflow" element={<ProtectedRoute adminOnly moduleKey="cashflow"><Cashflow /></ProtectedRoute>} />
      <Route path="/year-over-year" element={<ProtectedRoute adminOnly moduleKey="yoy"><YearOverYear /></ProtectedRoute>} />
      <Route path="/backup" element={<ProtectedRoute adminOnly moduleKey="backup"><Backup /></ProtectedRoute>} />
      <Route path="/paid-invoices" element={<ProtectedRoute moduleKey="paid_invoices"><PaidInvoices /></ProtectedRoute>} />
      <Route path="/subcon-trips" element={<ProtectedRoute moduleKey="subcon"><SubconTrips /></ProtectedRoute>} />
      <Route path="/loans" element={<ProtectedRoute adminOnly moduleKey="loans"><Loans /></ProtectedRoute>} />
      <Route path="/orcr" element={<ProtectedRoute adminOnly moduleKey="orcr"><ORCR /></ProtectedRoute>} />
      <Route path="/extra-income" element={<ProtectedRoute adminOnly moduleKey="extra_income"><ExtraIncome /></ProtectedRoute>} />
      <Route path="/cash-vouchers" element={<ProtectedRoute adminOnly moduleKey="cash_vouchers"><CashVouchers /></ProtectedRoute>} />
      <Route path="/historical" element={<ProtectedRoute adminOnly moduleKey="historical"><HistoricalData /></ProtectedRoute>} />
      <Route path="/trash" element={<ProtectedRoute adminOnly moduleKey="trash"><Trash /></ProtectedRoute>} />
      <Route path="/print-layouts" element={<ProtectedRoute adminOnly><PrintLayouts /></ProtectedRoute>} />
      <Route path="/payroll" element={<ProtectedRoute adminOnly moduleKey="payroll"><Payroll /></ProtectedRoute>} />
      <Route path="/how-to" element={<ProtectedRoute moduleKey="how_to"><HowTo /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
