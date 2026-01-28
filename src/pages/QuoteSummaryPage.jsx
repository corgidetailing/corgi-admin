import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ErrorBanner from "../components/ErrorBanner";
import Loading from "../components/Loading";
import { listQuoteLineItems, getQuoteById } from "../lib/api";

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

export default function QuoteSummaryPage() {
  const { quoteId } = useParams();
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [quote, setQuote] = useState(null);
  const [items, setItems] = useState([]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [q, li] = await Promise.all([getQuoteById(quoteId), listQuoteLineItems(quoteId)]);
        if (!mounted) return;
        setQuote(q);
        setItems(li);
      } catch (e) {
        if (!mounted) return;
        setError(e);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => { mounted = false; };
  }, [quoteId]);

  const total = useMemo(() => Number(quote?.totals?.grand_total_mxn || 0), [quote]);

  if (loading) return <Loading label="Loading quote summary..." />;

  return (
    <div style={{ maxWidth: 980, margin: "20px auto", padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Quote Summary</h2>
      <div style={{ opacity: 0.75, marginBottom: 12 }}>
        Quote: <code>{quoteId}</code>
      </div>

      <ErrorBanner title="Summary error" error={error} />

      <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 8, marginBottom: 16 }}>
        <div style={{ fontWeight: 900 }}>Total: {money(total)}</div>
        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
          Status: {quote?.status} • Currency: {quote?.currency}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <button onClick={() => nav(`/app/quote/${quoteId}/ppf`)} style={{ padding: "10px 14px", fontWeight: 800 }}>
          Edit PPF
        </button>
        <button onClick={() => nav(`/app/new`)} style={{ padding: "10px 14px", fontWeight: 800 }}>
          New Quote
        </button>
      </div>

      <div style={{ border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: 12, fontWeight: 900, background: "#fafafa", borderBottom: "1px solid #eee" }}>
          Line Items
        </div>

        {items.length === 0 ? (
          <div style={{ padding: 12, opacity: 0.75 }}>No line items yet.</div>
        ) : (
          <div>
            {items.map((it) => (
              <div key={it.id} style={{ padding: 12, borderBottom: "1px solid #eee" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>{it.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      {it.family} • {it.zone} • {it.is_main ? "MAIN" : "ADD"} • order {it.sort_order}
                    </div>
                  </div>
                  <div style={{ fontWeight: 900 }}>{money(it.calc?.final_mxn || 0)}</div>
                </div>

                <div style={{ marginTop: 8, fontSize: 13, opacity: 0.9 }}>
                  Material: <b>{it.inputs?.material_code || "—"}</b> • Width: <b>{it.inputs?.width_in || "—"}</b> • Length: <b>{it.inputs?.length_in || "—"}</b>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
