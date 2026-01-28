import React, { useEffect, useState } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import Home from "./pages/Home.jsx";
import QuoteBuilder from "./pages/QuoteBuilder.jsx";
import { createQuote } from "./lib/api";

function NewQuoteRoute() {
  const nav = useNavigate();
  const [err, setErr] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const q = await createQuote();
        if (!mounted) return;
        nav(`/quote/${q.id}`, { replace: true });
      } catch (e) {
        if (!mounted) return;
        setErr(e?.message ?? "Failed to create quote.");
      }
    })();
    return () => {
      mounted = false;
    };
  }, [nav]);

  if (err) return <div style={{ padding: 18 }}>{err}</div>;
  return <div style={{ padding: 18 }}>Creating quote…</div>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/new" element={<NewQuoteRoute />} />
      <Route path="/quote/:quoteId" element={<QuoteBuilder />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
