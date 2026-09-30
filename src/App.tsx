import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { FullScreenMessage } from "@/components/layout/FullScreenMessage";
import { ActionsProvider } from "@/features/actions/ActionsProvider";
import { useAuth } from "@/features/auth/AuthProvider";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { VaultProvider } from "@/features/vault/VaultProvider";

// Secondary pages load on demand to keep the first download small
const AssetsPage = lazy(() => import("@/features/assets/AssetsPage").then((m) => ({ default: m.AssetsPage })));
const ActivityPage = lazy(() => import("@/features/activity/ActivityPage").then((m) => ({ default: m.ActivityPage })));
const GoalsPage = lazy(() => import("@/features/goals/GoalsPage").then((m) => ({ default: m.GoalsPage })));
const ProfilePage = lazy(() => import("@/features/profile/ProfilePage").then((m) => ({ default: m.ProfilePage })));
const authPages = () => import("@/features/auth/AuthPages");
const SignInPage = lazy(() => authPages().then((m) => ({ default: m.SignInPage })));
const RegisterPage = lazy(() => authPages().then((m) => ({ default: m.RegisterPage })));
const ForgotPasswordPage = lazy(() => authPages().then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => authPages().then((m) => ({ default: m.ResetPasswordPage })));

function RequireAuth() {
  const { status, recovering } = useAuth();
  const location = useLocation();
  if (status === "loading") return <FullScreenMessage loading title="Loading…" />;
  if (status === "signedOut") return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (recovering) return <Navigate to="/reset-password" replace />;
  return (
    <VaultProvider>
      <ActionsProvider>
        <Outlet />
      </ActionsProvider>
    </VaultProvider>
  );
}

function PublicOnly() {
  const { status } = useAuth();
  if (status === "loading") return <FullScreenMessage loading title="Loading…" />;
  if (status === "signedIn") return <Navigate to="/" replace />;
  return (
    <Suspense fallback={<FullScreenMessage loading title="Loading…" />}>
      <Outlet />
    </Suspense>
  );
}

function PageFallback() {
  return <div className="h-40" aria-busy="true" />;
}

export function App() {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="login" element={<SignInPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
      </Route>
      <Route
        path="reset-password"
        element={
          <Suspense fallback={<FullScreenMessage loading title="Loading…" />}>
            <ResetPasswordPage />
          </Suspense>
        }
      />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route
            path="assets"
            element={
              <Suspense fallback={<PageFallback />}>
                <AssetsPage />
              </Suspense>
            }
          />
          <Route
            path="activity"
            element={
              <Suspense fallback={<PageFallback />}>
                <ActivityPage />
              </Suspense>
            }
          />
          <Route
            path="goals"
            element={
              <Suspense fallback={<PageFallback />}>
                <GoalsPage />
              </Suspense>
            }
          />
          <Route
            path="profile"
            element={
              <Suspense fallback={<PageFallback />}>
                <ProfilePage />
              </Suspense>
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
