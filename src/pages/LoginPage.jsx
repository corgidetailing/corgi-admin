import React, { useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import ErrorBanner from "../components/ErrorBanner";
import { useAuth } from "../auth/AuthProvider";

export default function LoginPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  const from = useMemo(() => loc.state?.from || "/app/new", [loc.state]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (user) {
    nav(from, { replace: true });
    return null;
  }

  async function onLogin(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);

    if (signInError) {
      setError(signInError);
      return;
    }

    nav(from, { replace: true });
  }

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1 style={{ margin: 0 }}>Corgi Detailing Admin</h1>
      <div style={{ opacity: 0.7, marginTop: 6 }}>Login required.</div>

      <div style={{ marginTop: 16 }}>
        <ErrorBanner title="Login failed" error={error} />
        <form onSubmit={onLogin}>
          <label style={{ display: "block", marginBottom: 8 }}>
            <div style={{ fontWeight: 600 }}>Email</div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              autoComplete="email"
              style={{ width: "100%", padding: 10, marginTop: 6 }}
            />
          </label>

          <label style={{ display: "block", marginBottom: 12 }}>
            <div style={{ fontWeight: 600 }}>Password</div>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              autoComplete="current-password"
              style={{ width: "100%", padding: 10, marginTop: 6 }}
            />
          </label>

          <button
            disabled={loading}
            style={{ width: "100%", padding: 10, fontWeight: 700 }}
            type="submit"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>

        <div style={{ marginTop: 12, opacity: 0.75, fontSize: 13 }}>
          Magic link login can be added later (no changes needed to your DB).
        </div>
      </div>
    </div>
  );
}
