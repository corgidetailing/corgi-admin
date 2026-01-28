import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listRecentQuotes } from "../lib/api";

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function formatMxn(x) {
  const v = n(x, 0);
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(v);
  } catch {
    return `MXN ${v.toFixed(2)}`;
  }
}

export default function Home() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await listRecentQuotes({ limit: 30 });
      setRows(r || []);
    } catch (e) {
      setError(e?.message ?? "Failed to load quotes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Quotes</h2>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => nav("/new")} style={{ padding: "10px 12px", fontWeight: 900 }}>
            New Quote
          </button>
          <button onClick={load} style={{ padding: "10px 12px", fontWeight: 900 }}>
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ whiteSpace: "pre-wrap", color: "#b91c1c", fontWeight: 800, marginTop: 12 }}>
          {error}
        </div>
      ) : null}

      {loading ? (
        <div style={{ marginTop: 12, fontWeight: 900 }}>Loading…</div>
      ) : rows.length ? (
        <table style={{ width: "100%", marginTop: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Quote ID</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Status</th>
              <th style={{ textAlign: "right", borderBottom: "1px solid #ddd", padding: 8 }}>Grand Total</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Created</th>
              <th style={{ borderBottom: "1px solid #ddd", padding: 8 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.id}>
                <td style={{ padding: 8, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas" }}>
                  {q.id}
                </td>
                <td style={{ padding: 8 }}>{q.status ?? "—"}</td>
                <td style={{ padding: 8, textAlign: "right" }}>
                  {formatMxn(n(q?.totals?.grand_total_mxn, 0))}
                </td>
                <td style={{ padding: 8 }}>{q.created_at ? new Date(q.created_at).toLocaleString() : "—"}</td>
                <td style={{ padding: 8, textAlign: "right" }}>
                  <button onClick={() => nav(`/quote/${q.id}`)} style={{ padding: "8px 10px", fontWeight: 900 }}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ marginTop: 12 }}>No quotes yet.</div>
      )}
    </div>
  );
}
