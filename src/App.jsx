import React from "react";
import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home.jsx";
import NewQuotePage from "./pages/NewQuotePage.jsx";
import QuoteBuilder from "./pages/QuoteBuilder.jsx";
import PpfBuilderPage from "./pages/PpfBuilderPage.jsx"; // Import the PPF Page
import LoginPage from "./pages/LoginPage.jsx";
import AppShell from "./shell/AppShell.jsx";
import RequireAuth from "./auth/RequireAuth.jsx";
import { AuthProvider } from "./auth/AuthProvider.jsx";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        
        {/* Protected Routes */}
        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route path="/" element={<Home />} />
          <Route path="/new" element={<NewQuotePage />} />
          
          {/* Main Quote Builder */}
          <Route path="/quote/:quoteId" element={<QuoteBuilder />} />
          
          {/* THE MISSING LINK: PPF Builder */}
          <Route path="/quote/:quoteId/ppf" element={<PpfBuilderPage />} />
        </Route>

        <Route path="*" element={<Home />} />
      </Routes>
    </AuthProvider>
  );
}