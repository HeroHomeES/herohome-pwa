import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import './index.css'
import { AuthProvider, useAuth } from './context/AuthContext'
import MainLayout from './layouts/MainLayout'
import LoginPage from './pages/LoginPage'

const HomePage = lazy(() => import('./pages/HomePage'))
const PropertyPage = lazy(() => import('./pages/PropertyPage'))
const CalendarPage = lazy(() => import('./pages/CalendarPage'))
const OffersPage = lazy(() => import('./pages/OffersPage'))

const spinner = (
  <div className="min-h-screen flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-[#2E5EA1] border-t-transparent rounded-full animate-spin" />
  </div>
)

function ProtectedLayout() {
  const { session, loading } = useAuth()
  if (loading) return spinner
  if (!session) return <Navigate to="/login" replace />
  return <MainLayout />
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedLayout />,
    children: [
      { index: true, element: <Suspense fallback={null}><HomePage /></Suspense> },
      { path: '/property', element: <Suspense fallback={null}><PropertyPage /></Suspense> },
      { path: '/calendar', element: <Suspense fallback={null}><CalendarPage /></Suspense> },
      { path: '/offers', element: <Suspense fallback={null}><OffersPage /></Suspense> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
)
