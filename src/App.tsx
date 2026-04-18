import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import Wallets from "./pages/Wallets";
import SendMoney from "./pages/SendMoney";
import Transactions from "./pages/Transactions";
import Exchange from "./pages/Exchange";
import BankAccounts from "./pages/BankAccounts";
import Kyc from "./pages/Kyc";
import Settings from "./pages/Settings";
import Admin from "./pages/Admin";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={user ? "/dashboard" : "/login"} replace />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/wallets" element={<Wallets />} />
              <Route path="/send" element={<SendMoney />} />
              <Route path="/exchange" element={<Exchange />} />
              <Route path="/withdraw" element={<BankAccounts />} />
              <Route path="/kyc" element={<Kyc />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/transactions" element={<Transactions />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
