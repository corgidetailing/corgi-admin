import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createQuote } from "../lib/api";

export default function NewQuote() {
  const nav = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function go() {
      try {
        const q = await createQuote();
        if (!mounted) return;
        nav(`/quote/${q.id}`, { replace: true });
      } catch (e) {
        if (!mounted) return;
        setError(e?.message ?? "Failed to create quote.");
      }
    }

    go();
    return () => {
      mounted = false;
    };
  }, [nav]);

  return (
    <div style={{ padding: 18 }}>
      {error ? (
        <div style={{ whiteSpace: "pre-wrap", color: "#b91c1c", fontWeight: 800 }}>
          {error}
        </div>
      ) : (
        <div style={{ fontWeight: 900 }}>Creating quote…</div>
      )}
    </div>
  );
}
