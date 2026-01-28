import React from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

export default function AppShell() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();

  async function onLogout() {
    await signOut();
    nav("/login");
  }

  return (
    <div>
      <header style={{ borderBottom: "1px solid #eee", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link to="/app/new" style={{ fontWeight: 900, textDecoration: "none" }}>
            Corgi Admin
          </Link>
          <span style={{ opacity: 0.6, fontSize: 13 }}>PPF Phase 1</span>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 13, opacity: 0.75 }}>{user?.email}</span>
          <button onClick={onLogout} style={{ padding: "8px 10px", fontWeight: 800 }}>
            Logout
          </button>
        </div>
      </header>

      <main>
        <Outlet />
      </main>
    </div>
  );
}
