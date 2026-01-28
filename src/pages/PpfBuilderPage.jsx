import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ErrorBanner from "../components/ErrorBanner";
import Loading from "../components/Loading";
import {
  getMaterialsForRuleVersion,
  getPpfBundles,
  getPpfPricingRules,
  getQuoteById,
  getRollSkusForMaterial,
  replacePpfLineItems,
} from "../lib/api";
import { computePpfLineItem } from "../lib/ppfPricing";

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

export default function PpfBuilderPage() {
  const { quoteId } = useParams();
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [quote, setQuote] = useState(null);
  const [ppfRules, setPpfRules] = useState(null);
  const [bundles, setBundles] = useState([]);
  const [materials, setMaterials] = useState([]);

  // selection state
  const [selectedBundleIds, setSelectedBundleIds] = useState(() => new Set());
  const [bundleInputs, setBundleInputs] = useState({}); // bundleId -> { material_code, roll_sku_id, width_in, length_in, max_length_in, cost_per_in2_mxn }

  const quoteInputs = quote?.totals?.inputs || {};
  const size_code = quoteInputs.size_code;
  const difficulty = quoteInputs.difficulty;
  const size_difficulty_multiplier = Number(quoteInputs.size_difficulty_multiplier || 0);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const q = await getQuoteById(quoteId);
        const rv = q.rule_version_id;
        const [rules, bs, mats] = await Promise.all([
          getPpfPricingRules(rv),
          getPpfBundles(rv),
          getMaterialsForRuleVersion(rv),
        ]);

        if (!mounted) return;

        setQuote(q);
        setPpfRules(rules);
        setBundles(bs);
        setMaterials(mats);
      } catch (e) {
        if (!mounted) return;
        setError(e);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [quoteId]);

  const selectedBundles = useMemo(() => {
    const ids = selectedBundleIds;
    return bundles.filter((b) => ids.has(b.id));
  }, [bundles, selectedBundleIds]);

  const computedItems = useMemo(() => {
    if (!quote || !ppfRules) return [];
    if (!size_code || !difficulty || !size_difficulty_multiplier) return [];

    return selectedBundles.map((b, idx) => {
      const bi = bundleInputs[b.id] || {};
      const calc = computePpfLineItem({
        material_code: bi.material_code,
        width_in: bi.width_in,
        length_in: bi.length_in,
        roll_sku_id: bi.roll_sku_id,
        cost_per_in2_mxn: bi.cost_per_in2_mxn,
        max_length_in: bi.max_length_in,

        waste_pct: ppfRules.waste_pct,
        clear_multiplier: ppfRules.clear_multiplier,
        matte_uplift_pct: ppfRules.matte_uplift_pct,

        size_code,
        difficulty,
        size_difficulty_multiplier,
      });

      return {
        bundle: b,
        is_main: idx === 0, // Phase 1 rule: first selected is main
        inputs: {
          rule_version_id: quote.rule_version_id,
          quote_id: quote.id,
          bundle_template_id: b.id,
          bundle_template_code: b.code,
          bundle_template_name: b.name,
          material_code: bi.material_code || null,
          roll_sku_id: bi.roll_sku_id || null,
          width_in: bi.width_in ?? null,
          length_in: bi.length_in ?? null,
          size_code,
          difficulty,
        },
        calc,
      };
    });
  }, [quote, ppfRules, selectedBundles, bundleInputs, size_code, difficulty, size_difficulty_multiplier]);

  const subtotal = useMemo(() => {
    return computedItems.reduce((sum, it) => sum + Number(it.calc?.final_mxn || 0), 0);
  }, [computedItems]);

  function toggleBundle(bundleId) {
    setSelectedBundleIds((prev) => {
      const next = new Set(prev);
      if (next.has(bundleId)) {
        next.delete(bundleId);
      } else {
        next.add(bundleId);
      }
      return next;
    });
  }

  async function onMaterialChange(bundleId, materialCode) {
    setError(null);

    // Reset dependent selection
    setBundleInputs((prev) => ({
      ...prev,
      [bundleId]: {
        ...prev[bundleId],
        material_code: materialCode,
        roll_sku_id: null,
        width_in: null,
        max_length_in: null,
        cost_per_in2_mxn: null,
      },
    }));

    try {
      const { selectable } = await getRollSkusForMaterial({
        ruleVersionId: quote.rule_version_id,
        materialCode,
      });

      if (selectable.length === 0) {
        setError(`No selectable roll widths available for material ${materialCode}.`);
      }

      // If only one option, auto-select it
      if (selectable.length === 1) {
        const r = selectable[0];
        setBundleInputs((prev) => ({
          ...prev,
          [bundleId]: {
            ...prev[bundleId],
            material_code: materialCode,
            roll_sku_id: r.id,
            width_in: r.width_in,
            max_length_in: r.max_length_in,
            cost_per_in2_mxn: r.cost_per_in2_mxn,
          },
        }));
      }
    } catch (e) {
      setError(e);
    }
  }

  async function onWidthChange(bundleId, materialCode, rollSkuId) {
    setError(null);
    if (!rollSkuId) return;

    try {
      const { selectable } = await getRollSkusForMaterial({
        ruleVersionId: quote.rule_version_id,
        materialCode,
      });

      const r = selectable.find((x) => x.id === rollSkuId);
      if (!r) {
        setError("Selected roll option not found.");
        return;
      }

      setBundleInputs((prev) => ({
        ...prev,
        [bundleId]: {
          ...prev[bundleId],
          roll_sku_id: r.id,
          width_in: r.width_in,
          max_length_in: r.max_length_in,
          cost_per_in2_mxn: r.cost_per_in2_mxn,
        },
      }));
    } catch (e) {
      setError(e);
    }
  }

  function onLengthChange(bundleId, length) {
    setBundleInputs((prev) => ({
      ...prev,
      [bundleId]: {
        ...prev[bundleId],
        length_in: length === "" ? "" : Number(length),
      },
    }));
  }

  const hasBlockingErrors = useMemo(() => {
    return computedItems.some((it) => (it.calc?.errors || []).length > 0);
  }, [computedItems]);

  async function onSavePpf() {
    setError(null);

    if (!quote) return;

    if (!size_code || !difficulty || !size_difficulty_multiplier) {
      setError("Quote is missing size/difficulty inputs. Go back and create quote again.");
      return;
    }

    if (computedItems.length === 0) {
      setError("Select at least one PPF package.");
      return;
    }

    if (hasBlockingErrors) {
      setError("Fix validation errors before saving.");
      return;
    }

    setSaving(true);
    try {
      const itemsToWrite = computedItems.map((it, idx) => ({
        zone: it.bundle.zone,
        name: it.bundle.name,
        is_main: it.is_main,
        sort_order: idx,
        inputs: it.inputs,
        calc: it.calc,
      }));

      await replacePpfLineItems({
        quoteId: quote.id,
        ruleVersionId: quote.rule_version_id,
        items: itemsToWrite,
      });

      nav(`/app/quote/${quote.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading label="Loading PPF builder..." />;

  return (
    <div style={{ maxWidth: 980, margin: "20px auto", padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>PPF Builder</h2>

      <div style={{ opacity: 0.75, marginBottom: 12 }}>
        Quote: <code>{quoteId}</code>
      </div>

      <ErrorBanner title="PPF builder error" error={error} />

      <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 8, marginBottom: 16 }}>
        <div style={{ fontWeight: 800 }}>Quote inputs</div>
        <div style={{ marginTop: 6 }}>
          Size: <b>{String(size_code || "—")}</b> &nbsp;|&nbsp; Difficulty: <b>{String(difficulty || "—")}</b>
          &nbsp;|&nbsp; Multiplier: <b>{size_difficulty_multiplier ? `x${size_difficulty_multiplier}` : "—"}</b>
        </div>
        <div style={{ marginTop: 6, opacity: 0.75, fontSize: 13 }}>
          PPF rules: waste {ppfRules?.waste_pct * 100}% • clear x{ppfRules?.clear_multiplier} • matte +{ppfRules?.matte_uplift_pct * 100}%
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 16 }}>
        {/* Left: bundle selection */}
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Select PPF packages</div>
          {bundles.map((b) => (
            <label key={b.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0" }}>
              <input
                type="checkbox"
                checked={selectedBundleIds.has(b.id)}
                onChange={() => toggleBundle(b.id)}
                style={{ marginTop: 3 }}
              />
              <div>
                <div style={{ fontWeight: 700 }}>{b.name}</div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>{b.code} • {b.zone}</div>
              </div>
            </label>
          ))}
        </div>

        {/* Right: per bundle inputs */}
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Configure selected packages</div>

          {selectedBundles.length === 0 ? (
            <div style={{ opacity: 0.7 }}>Select at least one package on the left.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {selectedBundles.map((b) => {
                const bi = bundleInputs[b.id] || {};
                const item = computedItems.find((x) => x.bundle.id === b.id);
                const errors = item?.calc?.errors || [];

                return (
                  <div key={b.id} style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                      <div>
                        <div style={{ fontWeight: 800 }}>{b.name}</div>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>{b.code} • zone {b.zone}</div>
                      </div>
                      <div style={{ fontWeight: 800 }}>{money(item?.calc?.final_mxn || 0)}</div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
                      <label>
                        <div style={{ fontWeight: 700 }}>Material</div>
                        <select
                          value={bi.material_code || ""}
                          onChange={(e) => onMaterialChange(b.id, e.target.value)}
                          style={{ width: "100%", padding: 10, marginTop: 6 }}
                        >
                          <option value="" disabled>Select material</option>
                          {materials.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </label>

                      <label>
                        <div style={{ fontWeight: 700 }}>Roll width</div>
                        <select
                          value={bi.roll_sku_id || ""}
                          onChange={(e) => onWidthChange(b.id, bi.material_code, e.target.value)}
                          disabled={!bi.material_code}
                          style={{ width: "100%", padding: 10, marginTop: 6 }}
                        >
                          <option value="" disabled>
                            {!bi.material_code ? "Select material first" : "Select width"}
                          </option>
                          {/* width options are loaded on-demand; re-fetch when changed */}
                          {/* We avoid caching complexity in Phase 1 */}
                        </select>
                        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                          After selecting a material, if only one width exists it will auto-select.
                          Otherwise, pick a width (we will populate options when you click the dropdown in Phase 2 UX polish).
                        </div>
                      </label>

                      <label>
                        <div style={{ fontWeight: 700 }}>
                          Length (inches){bi.max_length_in ? ` (max ${bi.max_length_in})` : ""}
                        </div>
                        <input
                          value={bi.length_in ?? ""}
                          onChange={(e) => onLengthChange(b.id, e.target.value)}
                          type="number"
                          min="0"
                          step="1"
                          style={{ width: "100%", padding: 10, marginTop: 6 }}
                        />
                      </label>
                    </div>

                    <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
                      Film type: <b>{item?.calc?.film_type || "—"}</b> • Area: <b>{item?.calc?.area_in2 || 0}</b> in² • Waste area: <b>{item?.calc?.area_waste_in2 || 0}</b> in²
                    </div>

                    {errors.length > 0 && (
                      <div style={{ marginTop: 10, padding: 10, background: "#fff5f5", border: "1px solid #f1c4c4", borderRadius: 8 }}>
                        <div style={{ fontWeight: 800, marginBottom: 6 }}>Fix before saving</div>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {errors.map((er, i) => (
                            <li key={i}>{er}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 900 }}>Subtotal: {money(subtotal)}</div>
            <button onClick={onSavePpf} disabled={saving || selectedBundles.length === 0 || hasBlockingErrors} style={{ padding: "10px 14px", fontWeight: 900 }}>
              {saving ? "Saving..." : "Save PPF → Summary"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
