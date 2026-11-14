import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import { Spinner } from './components/ui.jsx';
import BatchIssuePage from './pages/BatchIssuePage.jsx';
import BookDetailPage from './pages/BookDetailPage.jsx';
import BooksPage from './pages/BooksPage.jsx';
import ClassesPage from './pages/ClassesPage.jsx';
import HelpPage from './pages/HelpPage.jsx';
import LoansPage from './pages/LoansPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import StaffPage from './pages/StaffPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import ReaderDetailPage from './pages/ReaderDetailPage.jsx';
import ReadersPage from './pages/ReadersPage.jsx';

function RequireAuth({ managerOnly = false, children }) {
  const { staff, loading, isManager } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!staff) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (managerOnly && !isManager) {
    return <div className="content"><div className="alert alert--error">Недостатньо прав для цієї дії.</div></div>;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Navigate to="/books" replace />} />
        <Route path="/books" element={<BooksPage />} />
        <Route path="/books/:bookId" element={<BookDetailPage />} />
        <Route path="/readers" element={<ReadersPage />} />
        <Route path="/readers/:readerId" element={<ReaderDetailPage />} />
        <Route path="/loans" element={<LoansPage />} />
        <Route path="/loans/batch" element={<BatchIssuePage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/staff" element={<RequireAuth managerOnly><StaffPage /></RequireAuth>} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/classes" element={<RequireAuth managerOnly><ClassesPage /></RequireAuth>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
