import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import {
  createDraftQuote,
  getActiveRuleVersionId,
  listSizeDifficultyMultipliers,
} from "../api";

export default function NewQuotePage() {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);

  const [ruleVersionId, setRuleVersionId] = useState(null);
  const [multipliers, setMultipliers] = useState([]);

  const [vehicle, setVehicle] = useState("");
  const [color, setColor] = useState("");
  const [notes, setNotes] = useState("");

  const [sizeCode, setSizeCode] = useState("M");
  const [difficulty, setDifficulty] = useState(1);

  // Prevent any implicit form submission behavior anywhere on this page
  function blockSubmit(e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
  }

  // Prevent Enter key from submitting (common cause of "reload" symptoms)
  function blockEnter(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  useEffect(() => {
    let mounted = true;

    async function boot() {
      setLoading(true);
      setError(null);

      try {
        // Auth session
        const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
        if (sessionErr) throw sessionErr;

        const u = sessionData?.session?.user ?? null;
        if (!u) throw new Error("You must be logged in to start a quote.");
        if (!mounted) return;
        setUser(u);

        // Active rule version
        const rvId = await getActiveRuleVersionId();
        if (!mounted) return;
        setRuleVersionId(rvId);

        // Multipliers
        const rows = await listSizeDifficultyMultipliers(rvId);
        if (!mounted) return;
        setMultipliers(Array.isArray(rows) ? rows : []);
      } catch (e) {
        console.error("[NewQuotePage.boot] error:", e);
        if (!mounted) return;
        setError(e?.message ?? "Failed to load quote setup.");
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    boot();

    // Keep user state synced
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  const availableSizes = useMemo(() => {
    const uniq = Array.from(new Set((multipliers ?? []).map((m) => m.size_code))).filter(Boolean);
    return uniq.length ? uniq : ["S", "M", "L", "XL"];
  }, [multipliers]);

  const availableDifficulties = useMemo(() => {
    if (!multipliers || multipliers.length === 0) return [1, 2, 3];

    const uniq = Array.from(
      new Set(
        multipliers
          .filter((m) => m.size_code === sizeCode)
          .map((m) => Number(m.difficulty))
          .filter((n) => Number.isFinite(n))
      )
    ).sort((a, b) => a - b);

    return uniq.length ? uniq : [1, 2, 3];
  }, [multipliers, sizeCode]);

  // Keep selected size valid when data loads
  useEffect(() => {
    if (!availableSizes.includes(sizeCode)) setSizeCode(availableSizes[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableSizes.join("|")]);

  // Keep selected difficulty valid when data loads / size changes
  useEffect(() => {
    if (!availableDifficulties.includes(Number(difficulty))) setDifficulty(availableDifficulties[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableDifficulties.join("|")]);

  const selectedMultiplierRow = useMemo(() => {
    if (!multipliers || multipliers.length === 0) return null;
    return multipliers.find(
      (m) => m.size_code === sizeCode && Number(m.difficulty) === Number(difficulty)
    );
  }, [multipliers, sizeCode, difficulty]);

  async function onStartQuote(e) {
    blockSubmit(e);
    setError(null);

    try {
      if (!user?.id) throw new Error("Not logged in.");
      if (!ruleVersionId) throw new Error("No active rule version loaded.");
      if (!selectedMultiplierRow) {
        throw new Error(
          `Size/difficulty multiplier not found for size=${sizeCode}, difficulty=${difficulty}.`
        );
      }

      setStarting(true);

      const q = await createDraftQuote({
        userId: user.id,
        ruleVersionId,
        vehicle: vehicle.trim() || null,
        color: color.trim() || null,
        notes: notes.trim() || null,
        size_code: sizeCode,
        difficulty: Number(difficulty),
        size_difficulty_multiplier: Number(selectedMultiplierRow.multiplier),
      });

      // Navigate without reload
      navigate(`/quote/${q.id}`, { replace: false });
    } catch (e2) {
      console.error("[NewQuotePage.onStartQuote] error:", e2);
      setError(e2?.message ?? "Unable to start quote.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div onSubmitCapture={blockSubmit} style={{ maxWidth: 980, margin: "0 auto", padding: 18 }}>
      <h1 style={{ margin: "8px 0 16px" }}>New Quote</h1>

      {loading ? (
        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>Loading…</div>
      ) : (
        <>
          {error ? (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                border: "1px solid #f5c2c7",
                borderRadius: 10,
                background: "#fff5f5",
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Error</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{error}</div>
            </div>
          ) : null}

          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              padding: 14,
              border: "1px solid #ddd",
              borderRadius: 10,
            }}
          >
            <label style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontWeight: 700 }}>Vehicle</div>
              <input
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value)}
                onKeyDown={blockEnter}
                style={{ width: "100%", padding: 10, marginTop: 6 }}
                placeholder="e.g., 2023 Tesla Model 3"
              />
            </label>

            <label>
              <div style={{ fontWeight: 700 }}>Color</div>
              <input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                onKeyDown={blockEnter}
                style={{ width: "100%", padding: 10, marginTop: 6 }}
                placeholder="e.g., White"
              />
            </label>

            <label>
              <div style={{ fontWeight: 700 }}>Notes (optional)</div>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onKeyDown={blockEnter}
                style={{ width: "100%", padding: 10, marginTop: 6 }}
                placeholder="Optional notes"
              />
            </label>

            <label>
              <div style={{ fontWeight: 700 }}>Size</div>
              <select
                value={sizeCode}
                onChange={(e) => setSizeCode(e.target.value)}
                style={{ width: "100%", padding: 10, marginTop: 6 }}
              >
                {availableSizes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <div style={{ fontWeight: 700 }}>Difficulty</div>
              <select
                value={String(difficulty)}
                onChange={(e) => setDifficulty(Number(e.target.value))}
                style={{ width: "100%", padding: 10, marginTop: 6 }}
              >
                {availableDifficulties.map((d) => (
                  <option key={d} value={String(d)}>
                    {d}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, marginTop: 8 }}>
              <button
                type="button"
                onClick={onStartQuote}
                disabled={starting || !ruleVersionId}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #111",
                  background: starting ? "#eee" : "#111",
                  color: starting ? "#111" : "#fff",
                  cursor: starting ? "not-allowed" : "pointer",
                  fontWeight: 800,
                }}
              >
                {starting ? "Starting…" : "Start Quote"}
              </button>

              <div style={{ alignSelf: "center", fontSize: 13, opacity: 0.8 }}>
                Rule version: {ruleVersionId ? ruleVersionId : "(none)"}
                {selectedMultiplierRow ? ` • Multiplier: ${selectedMultiplierRow.multiplier}` : ""}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
