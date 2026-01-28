import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getQuoteById,
  listQuoteLineItems,
  updateQuoteTotals,
  replacePpfLineItems,
  getPpfBundles,
  getPpfPricingRule,
  getPpfBundlePricing,
  getMaterialsForRuleVersion,
  getWidthOptionsForMaterial,
  listSizeDifficultyMultipliers,
  getPpfLaborRates,
} from "../lib/api";
import { supabase } from "../lib/supabaseClient";
import CeramicBuilderCard from "../components/CeramicBuilderCard";

/* --- Helper Functions (Same as before) --- */
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

function makeLocalId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `local_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function pctToFactor(pctRaw) {
  const p = n(pctRaw, 0);
  const pct = p > 1 ? p / 100 : p;
  return 1 + pct;
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.data)) return v.data;
  if (v && Array.isArray(v.rows)) return v.rows;
  if (v && Array.isArray(v.items)) return v.items;
  return [];
}

function normalizeMultiplier(v) {
  const x = n(v, 1);
  if (!Number.isFinite(x) || x <= 0) return 1;
  if (x > 10) return x / 100;
  return x;
}

/* --- Calculation Logic (Same as before) --- */
function calcPpfLineClient({
  ppfRule,
  bundlePricing,
  sku,
  widthIn,
  lengthIn,
  hours,
  sizeDifficultyMultiplier,
  materialCode,
}) {
  if (!ppfRule) throw new Error("PPF pricing rule not loaded.");
  if (!bundlePricing) throw new Error("Bundle pricing not loaded.");
  if (!sku) throw new Error("Roll SKU not selected.");

  const width = n(widthIn);
  const length = n(lengthIn);
  const hrs = n(hours, 0);

  if (!(width > 0)) throw new Error("Width must be > 0.");
  if (!(length > 0)) throw new Error("Length must be > 0.");

  const maxLen = sku.max_length_in != null ? n(sku.max_length_in, null) : null;
  if (maxLen != null && length > maxLen) throw new Error(`Max length is ${maxLen}" for this roll.`);

  const wasteFactor = pctToFactor(ppfRule.waste_pct);
  const matteMult = n(ppfRule.matte_multiplier, 1.25);
  const clearBase =
    bundlePricing.clear_multiplier_override != null
      ? n(bundlePricing.clear_multiplier_override)
      : n(ppfRule.clear_multiplier, 1);

  const specialBase =
    bundlePricing.special_multiplier_override != null
      ? n(bundlePricing.special_multiplier_override)
      : n(ppfRule.special_multiplier, 4.5);

  let materialKind = sku.material_kind;
  if (!materialKind) materialKind = materialCode === "DYNOshield" ? "CLEAR" : "SPECIAL";

  let finish = sku.finish;
  if (!finish) {
    const m = String(materialCode || "").toLowerCase();
    finish = m.includes("matte") ? "MATTE" : "GLOSS";
  } else {
    finish = String(finish).toUpperCase();
  }

  const baseMultiplier = materialKind === "SPECIAL" ? specialBase : clearBase;
  const extraMultiplier = n(bundlePricing.extra_multiplier, 1);
  const filmMultiplier = baseMultiplier * extraMultiplier;

  const areaIn2 = width * length;
  const costPerIn2 = n(sku.cost_per_in2_mxn, 0);

  const rawCostMxn = areaIn2 * costPerIn2;
  const costWithWasteMxn = rawCostMxn * wasteFactor;

  let filmSellPriceMxn = costWithWasteMxn * filmMultiplier;

  const isDynoBlackMatte = String(materialCode || "").toLowerCase().includes("dynoblack-matte");
  if (bundlePricing.apply_matte_multiplier && finish === "MATTE" && !isDynoBlackMatte) {
    filmSellPriceMxn *= matteMult;
  }

  const headlightUplift = n(bundlePricing.headlight_material_multiplier, 1.25);
  if (sku.is_headlight_specific) {
    filmSellPriceMxn *= headlightUplift;
  }

  const laborRate = n(bundlePricing.labor_rate_mxn_per_hour, 0);
  const laborPriceMxn = hrs * laborRate;

  const totalBeforeSize = filmSellPriceMxn + laborPriceMxn;
  const sizeMult = normalizeMultiplier(sizeDifficultyMultiplier);
  const finalPriceMxn = totalBeforeSize * sizeMult;

  return {
    inputs: { material_code: materialCode, width_in: width, length_in: length, hours: hrs },
    sku: {
      roll_sku_id: sku.id,
      warning_only: Boolean(sku.warning_only),
      max_length_in: sku.max_length_in ?? null,
      material_kind: materialKind,
      finish,
      is_headlight_specific: Boolean(sku.is_headlight_specific),
    },
    numbers: {
      area_in2: areaIn2,
      cost_per_in2_mxn: costPerIn2,
      raw_cost_mxn: rawCostMxn,
      waste_factor: wasteFactor,
      cost_with_waste_mxn: costWithWasteMxn,
      base_multiplier: baseMultiplier,
      extra_multiplier: extraMultiplier,
      film_multiplier: filmMultiplier,
      matte_multiplier: matteMult,
      applied_matte: bundlePricing.apply_matte_multiplier && finish === "MATTE" && !isDynoBlackMatte,
      dynoblack_matte_special_rule: isDynoBlackMatte,
      headlight_material_multiplier: headlightUplift,
      film_sell_price_mxn: filmSellPriceMxn,
      labor_rate_mxn_per_hour: laborRate,
      labor_price_mxn: laborPriceMxn,
      total_before_size_mxn: totalBeforeSize,
      size_difficulty_multiplier: sizeMult,
      final_price_mxn: finalPriceMxn,
    },
  };
}

function calcFullPpfClient({ ppfRule, sku, widthIn, lengthIn, sizeDifficultyMultiplier, laborRates, hoursByCode }) {
  if (!ppfRule) throw new Error("PPF pricing rule not loaded.");
  if (!sku) throw new Error("Roll SKU not selected.");

  const width = n(widthIn);
  const length = n(lengthIn);
  if (!(width > 0)) throw new Error("Width must be > 0.");
  if (!(length > 0)) throw new Error("Length must be > 0.");

  const maxLen = sku.max_length_in != null ? n(sku.max_length_in, null) : null;
  if (maxLen != null && length > maxLen) throw new Error(`Max length is ${maxLen}" for this roll.`);

  const wasteFactor = pctToFactor(ppfRule.waste_pct);
  const clearMult = n(ppfRule.clear_multiplier, 3.5);
  const matteMult = n(ppfRule.matte_multiplier, 1.25);

  const areaIn2 = width * length;
  const costPerIn2 = n(sku.cost_per_in2_mxn, 0);
  const filmCostRaw = areaIn2 * costPerIn2;
  const filmCostWithWaste = filmCostRaw * wasteFactor;

  const finish = String(sku.finish || "").toUpperCase();
  const isMatte = finish === "MATTE";

  let filmSell = filmCostWithWaste * clearMult;
  if (isMatte) filmSell *= matteMult;

  const rateMap = {};
  for (const r of laborRates || []) rateMap[String(r.code)] = n(r.rate_mxn_per_hour, 0);

  let laborTotal = 0;
  const laborBreakdown = {};
  for (const code of Object.keys(rateMap)) {
    const hrs = n(hoursByCode?.[code], 0);
    const rate = n(rateMap[code], 0);
    const line = hrs * rate;
    if (hrs > 0) laborBreakdown[code] = { hours: hrs, rate, total: line };
    laborTotal += line;
  }

  const sizeMult = normalizeMultiplier(sizeDifficultyMultiplier);
  const totalBeforeSize = filmSell + laborTotal;
  const final = totalBeforeSize * sizeMult;

  return {
    sku: {
      roll_sku_id: sku.id,
      max_length_in: sku.max_length_in ?? null,
      finish: isMatte ? "MATTE" : "GLOSS",
      material_kind: sku.material_kind ?? "CLEAR",
      warning_only: Boolean(sku.warning_only),
      is_headlight_specific: Boolean(sku.is_headlight_specific),
    },
    numbers: {
      area_in2: areaIn2,
      cost_per_in2_mxn: costPerIn2,
      film_cost_raw_mxn: filmCostRaw,
      waste_factor: wasteFactor,
      film_cost_with_waste_mxn: filmCostWithWaste,
      clear_multiplier: clearMult,
      matte_multiplier: matteMult,
      film_sell_price_mxn: filmSell,
      labor_total_mxn: laborTotal,
      labor_breakdown: laborBreakdown,
      total_before_size_mxn: totalBeforeSize,
      size_difficulty_multiplier: sizeMult,
      final_price_mxn: final,
    },
  };
}

/* --- Display Components --- */
function TotalsCard({ quote }) {
  const totals = quote?.totals ?? {};
  const grand = n(totals?.grand_total_mxn, 0);
  const ppf = n(totals?.ppf?.subtotal_mxn, 0);
  const ceramic = n(totals?.ceramic?.subtotal_mxn, 0);
  const swiss = n(totals?.swissvax?.subtotal_mxn, 0);
  const tint = n(totals?.tint?.subtotal_mxn, 0);
  const inputs = totals?.inputs ?? {};
  const size = String(inputs?.size_code ?? "—");
  const diff = inputs?.difficulty ?? "—";
  const mult = normalizeMultiplier(inputs?.size_difficulty_multiplier ?? 1);

  return (
    <div className="card">
      <div className="card-title">Totals</div>
      <div className="grid2">
        <div>
          <div className="help">Vehicle</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            <span className="pill">Size: {size}</span>
            <span className="pill">Difficulty: {String(diff)}</span>
            <span className="pill">Size mult: ×{mult.toFixed(4)}</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="help">Grand total</div>
          <div style={{ fontSize: 26, fontWeight: 950, marginTop: 6 }}>{formatMxn(grand)}</div>
        </div>
      </div>
      <table className="table" style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Service</th>
            <th className="right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>PPF</td><td className="right">{formatMxn(ppf)}</td></tr>
          <tr><td>Ceramic</td><td className="right">{formatMxn(ceramic)}</td></tr>
          <tr><td>Swissvax</td><td className="right">{formatMxn(swiss)}</td></tr>
          <tr><td>Tint</td><td className="right">{formatMxn(tint)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function LineItemsCard({ items }) {
  const rows = items ?? [];
  return (
    <div className="card">
      <div className="card-title">Saved line items</div>
      {!rows.length ? (
        <div className="help">No line items yet.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Family</th>
              <th>Zone</th>
              <th>Name</th>
              <th className="right">Sell</th>
              <th className="right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const sell =
                n(r?.calc?.numbers?.final_price_mxn, NaN) ||
                n(r?.calc?.numbers?.sell_mxn, NaN) ||
                n(r?.calc?.numbers?.total_sell_mxn, NaN) ||
                n(r?.calc?.numbers?.subtotal_mxn, NaN) ||
                0;
              const cost =
                n(r?.calc?.numbers?.cost_mxn, NaN) ||
                n(r?.calc?.numbers?.total_cost_mxn, NaN) ||
                n(r?.calc?.numbers?.cost_with_waste_mxn, NaN) ||
                n(r?.calc?.numbers?.film_cost_with_waste_mxn, NaN) ||
                0;
              return (
                <tr key={r.id}>
                  <td className="muted">{r.family}</td>
                  <td className="muted">{r.zone}</td>
                  <td>{r.name}</td>
                  <td className="right">{formatMxn(sell)}</td>
                  <td className="right">{formatMxn(cost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err) {
    console.error("[ErrorBoundary]", err);
  }
  render() {
    if (this.state.err) return this.props.fallback || null;
    return this.props.children;
  }
}

/* =========================================================================
   MAIN COMPONENT
   ========================================================================= */
export default function QuoteBuilder() {
  const { quoteId } = useParams();
  const nav = useNavigate();

  const [booting, setBooting] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState(null);

  const [quote, setQuote] = useState(null);
  const [lineItems, setLineItems] = useState([]);

  const [ppfRule, setPpfRule] = useState(null);
  const [ppfBundles, setPpfBundles] = useState([]);
  const [ppfPricingRows, setPpfPricingRows] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [multipliers, setMultipliers] = useState([]);
  const [laborRates, setLaborRates] = useState([]);

  const [step, setStep] = useState("PPF"); // PPF | CERAMIC | SUMMARY
  const [ppfMode, setPpfMode] = useState("FULL"); // FULL | DETAILED

  /* --- DETAILED PPF SPLIT --- */
  const [detailedType, setDetailedType] = useState("KITS"); // KITS | CUSTOM
  const [customItemName, setCustomItemName] = useState("");

  /* --- FULL PPF STATE --- */
  const FULL_ALLOWED = ["DYNOshield", "DYNOmatte", "DYNOmatte-flat"];
  const [fullMaterial, setFullMaterial] = useState("");
  const [fullWidths, setFullWidths] = useState([]);
  const [fullSkuByWidth, setFullSkuByWidth] = useState({});
  const [fullWidthIn, setFullWidthIn] = useState("60");
  const [fullLengthIn, setFullLengthIn] = useState("");
  const [laborOpen, setLaborOpen] = useState(false);
  const [hoursByCode, setHoursByCode] = useState({});
  const [fullItem, setFullItem] = useState(null);

  /* --- DETAILED PPF STATE --- */
  const [bundleId, setBundleId] = useState("");
  const [material, setMaterial] = useState("");
  const [widths, setWidths] = useState([]);
  const [skuByWidth, setSkuByWidth] = useState({});
  const [widthIn, setWidthIn] = useState("");
  const [lengthIn, setLengthIn] = useState("");
  const [hours, setHours] = useState("");
  const [draftItems, setDraftItems] = useState([]);

  function blockEnter(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  const ruleVersionId = quote?.rule_version_id ?? null;
  const quoteInputs = quote?.totals?.inputs ?? {};
  const sizeCode = String(quoteInputs.size_code || "M");
  const difficulty = n(quoteInputs.difficulty, 1);

  const sizeDifficultyMultiplier = useMemo(() => {
    const fromTotals = n(quoteInputs.size_difficulty_multiplier, NaN);
    if (Number.isFinite(fromTotals) && fromTotals > 0) return normalizeMultiplier(fromTotals);
    const row = (multipliers || []).find((m) => String(m.size_code) === sizeCode && n(m.difficulty) === difficulty);
    return row ? normalizeMultiplier(n(row.multiplier, 1)) : 1;
  }, [multipliers, quoteInputs.size_difficulty_multiplier, sizeCode, difficulty]);

  function hydratePpfDraftsFromLineItems(items) {
    const existingPpf = (items || []).filter((li) => li.family === "PPF");

    const maybeFull = existingPpf.find((li) => li.inputs?.mode === "FULL_PPF");
    if (maybeFull) {
      setFullItem({
        id: maybeFull.id,
        zone: maybeFull.zone,
        name: maybeFull.name,
        material_code: maybeFull.inputs?.material_code ?? "",
        width_in: n(maybeFull.inputs?.width_in, 60),
        length_in: n(maybeFull.inputs?.length_in, ""),
        hours_by_code: maybeFull.inputs?.hours_by_code ?? {},
        calc: maybeFull.calc ?? {},
      });
      setFullMaterial(maybeFull.inputs?.material_code ?? "");
      setFullWidthIn(String(n(maybeFull.inputs?.width_in, 60)));
      setFullLengthIn(String(n(maybeFull.inputs?.length_in, "")));
      setHoursByCode(maybeFull.inputs?.hours_by_code ?? {});
    } else {
      setFullItem(null);
    }

    const existingDetailed = existingPpf.filter((li) => li.inputs?.mode !== "FULL_PPF");
    setDraftItems(
      existingDetailed.map((li) => ({
        id: li.id,
        zone: li.zone,
        name: li.name,
        bundle_template_id: li.inputs?.bundle_template_id ?? null,
        bundle_code: li.inputs?.bundle_code ?? null,
        material_code: li.inputs?.material_code ?? null,
        width_in: n(li.inputs?.width_in, null),
        length_in: n(li.inputs?.length_in, null),
        hours: n(li.inputs?.hours, 0),
        calc: li.calc ?? {},
      }))
    );
  }

  /* --- DATA LOADING --- */
  useEffect(() => {
    let mounted = true;
    async function boot() {
      setBooting(true);
      setError(null);
      try {
        if (!quoteId) throw new Error("Missing quoteId in route.");
        const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
        if (sessionErr) throw sessionErr;
        if (!sessionData?.session?.user) throw new Error("You must be logged in.");

        const q = await getQuoteById(quoteId);
        if (!mounted) return;
        setQuote(q);

        const items = await listQuoteLineItems(quoteId);
        if (!mounted) return;
        setLineItems(items || []);
        hydratePpfDraftsFromLineItems(items || []);

        const rvId = q.rule_version_id;
        const [ruleRow, bundlesRes, pricingRes, matsRes, multsRes, laborRes] = await Promise.all([
          getPpfPricingRule(rvId),
          getPpfBundles(rvId),
          getPpfBundlePricing(rvId),
          getMaterialsForRuleVersion(rvId),
          listSizeDifficultyMultipliers(rvId),
          getPpfLaborRates(rvId).catch(() => []),
        ]);

        if (!mounted) return;
        setPpfRule(ruleRow || null);
        setPpfBundles(asArray(bundlesRes));
        setPpfPricingRows(asArray(pricingRes));
        setMaterials(asArray(matsRes));
        setMultipliers(asArray(multsRes));
        setLaborRates(asArray(laborRes));
        setStep("PPF");
        setPpfMode("FULL");
      } catch (e) {
        if (!mounted) return;
        setError(e?.message ?? "Failed to load quote.");
      } finally {
        if (!mounted) return;
        setBooting(false);
      }
    }
    boot();
    return () => { mounted = false; };
  }, [quoteId]);

  async function refresh() {
    setError(null);
    setOkMsg(null);
    try {
      const fresh = await getQuoteById(quoteId);
      const items = await listQuoteLineItems(quoteId);
      setQuote(fresh);
      setLineItems(items || []);
      hydratePpfDraftsFromLineItems(items || []);
      setOkMsg("Refreshed.");
    } catch (e) {
      setError(e?.message ?? "Failed to refresh.");
    }
  }

  /* --- DETAILED HELPERS --- */
  const selectedBundle = useMemo(() => (ppfBundles || []).find((b) => b.id === bundleId) || null, [ppfBundles, bundleId]);

  // For CUSTOM mode, we need a fallback pricing rule if no bundle is selected
  // We'll try to find a generic bundle, or use the first one available
  const activeBundlePricing = useMemo(() => {
    if (detailedType === "KITS" && selectedBundle) {
        return (ppfPricingRows || []).find((r) => r.bundle_template_id === selectedBundle.id) || null;
    }
    if (detailedType === "CUSTOM") {
        // Find a bundle that looks generic, or just use the first one to get labor rates/multipliers
        // Ideally you'd have a specific "Custom" bundle in DB, but this works for now.
        if (selectedBundle) {
             return (ppfPricingRows || []).find((r) => r.bundle_template_id === selectedBundle.id) || null;
        }
        // Fallback: pick the first available bundle pricing
        return (ppfPricingRows || [])[0] || null;
    }
    return null;
  }, [ppfPricingRows, selectedBundle, detailedType]);

  const selectedSku = useMemo(() => {
    const w = n(widthIn, NaN);
    if (!Number.isFinite(w)) return null;
    return skuByWidth?.[w] ?? null;
  }, [skuByWidth, widthIn]);

  const lengthMax = selectedSku?.max_length_in != null ? n(selectedSku.max_length_in, null) : null;
  const lengthVal = n(lengthIn, NaN);
  const lengthError = useMemo(() => {
    if (!lengthIn) return null;
    if (!Number.isFinite(lengthVal) || lengthVal <= 0) return "Length must be positive.";
    if (lengthMax != null && lengthVal > lengthMax) return `Max length is ${lengthMax}".`;
    return null;
  }, [lengthIn, lengthVal, lengthMax]);

  useEffect(() => {
    let mounted = true;
    async function loadWidths() {
      setWidths([]);
      setSkuByWidth({});
      setWidthIn("");
      if (!ruleVersionId || !material) return;
      try {
        const { widths: w, skuByWidth: map } = await getWidthOptionsForMaterial(ruleVersionId, material);
        if (!mounted) return;
        setWidths(w || []);
        setSkuByWidth(map || {});
        if (w.includes(60)) setWidthIn("60");
        else if (w.length) setWidthIn(String(w[0]));
      } catch (e) {
        if (!mounted) return;
        setError("Failed to load width options.");
      }
    }
    loadWidths();
    return () => { mounted = false; };
  }, [ruleVersionId, material]);

  function canAddDetailed() {
    if (!activeBundlePricing) return false;
    if (!material) return false;
    if (!selectedSku) return false;
    if (!widthIn) return false;
    if (!lengthIn) return false;
    if (lengthError) return false;
    if (detailedType === "CUSTOM" && !customItemName.trim()) return false;
    if (activeBundlePricing.requires_hours && n(hours, 0) <= 0) return false;
    return true;
  }

  async function onAddDetailed() {
    setError(null);
    setOkMsg(null);
    if (!canAddDetailed()) {
      setError("Please complete all fields (Material, Width, Length, Name).");
      return;
    }

    try {
      const calc = calcPpfLineClient({
        ppfRule,
        bundlePricing: activeBundlePricing,
        sku: selectedSku,
        widthIn: n(widthIn),
        lengthIn: n(lengthIn),
        hours: activeBundlePricing.requires_hours ? n(hours) : 0,
        sizeDifficultyMultiplier,
        materialCode: material,
      });

      // Name Logic:
      // If KITS, use the Bundle Name.
      // If CUSTOM, use user input.
      const finalName = detailedType === "CUSTOM" ? customItemName : selectedBundle.name;
      const finalZone = detailedType === "CUSTOM" ? "CUSTOM" : selectedBundle.zone;

      const newItem = {
        _localId: makeLocalId(),
        zone: finalZone,
        name: finalName,
        bundle_template_id: selectedBundle?.id ?? null,
        bundle_code: selectedBundle?.code ?? "CUSTOM",
        material_code: material,
        width_in: n(widthIn),
        length_in: n(lengthIn),
        hours: activeBundlePricing.requires_hours ? n(hours) : 0,
        calc,
      };

      setDraftItems((prev) => [...prev, newItem]);
      
      // Reset fields but keep material for speed
      setLengthIn("");
      setHours("");
      setCustomItemName("");
      // Don't reset material/width as user likely wants to use same roll
      setOkMsg("Added line item.");
    } catch (e) {
      setError(e?.message ?? "Failed to calculate.");
    }
  }

  function onRemoveDetailed(idOrLocal) {
    setDraftItems((prev) => prev.filter((x) => x.id !== idOrLocal && x._localId !== idOrLocal));
  }
  const detailedSubtotal = useMemo(() => (draftItems || []).reduce((sum, it) => sum + n(it?.calc?.numbers?.final_price_mxn, 0), 0), [draftItems]);

  /* --- FULL PPF HELPERS --- */
  const allowedFullMaterials = useMemo(() => {
    const set = new Set(materials || []);
    return FULL_ALLOWED.filter((m) => set.has(m));
  }, [materials]);

  useEffect(() => {
    if (!fullMaterial && allowedFullMaterials.length) setFullMaterial(allowedFullMaterials[0]);
  }, [allowedFullMaterials, fullMaterial]);

  const fullSelectedSku = useMemo(() => {
    const w = n(fullWidthIn, NaN);
    if (!Number.isFinite(w)) return null;
    return fullSkuByWidth?.[w] ?? null;
  }, [fullSkuByWidth, fullWidthIn]);

  useEffect(() => {
    let mounted = true;
    async function loadFullWidths() {
      setFullWidths([]);
      setFullSkuByWidth({});
      setFullWidthIn("60");
      if (!ruleVersionId || !fullMaterial) return;
      try {
        const { widths: w, skuByWidth: map } = await getWidthOptionsForMaterial(ruleVersionId, fullMaterial);
        if (!mounted) return;
        setFullWidths(w || []);
        setFullSkuByWidth(map || {});
        if (w.includes(60)) setFullWidthIn("60");
        else if (w.length) setFullWidthIn(String(w[0]));
      } catch (e) {
        if (!mounted) return;
        setError("Failed to load width options (Full PPF).");
      }
    }
    loadFullWidths();
    return () => { mounted = false; };
  }, [ruleVersionId, fullMaterial]);

  const fullLengthMax = fullSelectedSku?.max_length_in != null ? n(fullSelectedSku.max_length_in, null) : null;
  const fullLengthVal = n(fullLengthIn, NaN);
  const fullLengthError = useMemo(() => {
    if (!fullLengthIn) return null;
    if (!Number.isFinite(fullLengthVal) || fullLengthVal <= 0) return "Length must be positive.";
    if (fullLengthMax != null && fullLengthVal > fullLengthMax) return `Max length is ${fullLengthMax}".`;
    return null;
  }, [fullLengthIn, fullLengthVal, fullLengthMax]);

  const fullCalcPreview = useMemo(() => {
    if (!ppfRule || !fullSelectedSku || !fullMaterial || !fullWidthIn || !fullLengthIn || fullLengthError) return null;
    try {
      return calcFullPpfClient({ ppfRule, sku: fullSelectedSku, widthIn: n(fullWidthIn), lengthIn: n(fullLengthIn), sizeDifficultyMultiplier, laborRates, hoursByCode });
    } catch { return null; }
  }, [ppfRule, fullSelectedSku, fullMaterial, fullWidthIn, fullLengthIn, fullLengthError, sizeDifficultyMultiplier, laborRates, hoursByCode]);
  
  const fullLaborTotal = n(fullCalcPreview?.numbers?.labor_total_mxn, 0);

  function canSetFull() {
    if (!ppfRule || !fullMaterial || !fullSelectedSku || !fullWidthIn || !fullLengthIn || fullLengthError) return false;
    return true;
  }
  function onSetFullItem() {
    setError(null);
    setOkMsg(null);
    if (!canSetFull()) return setError("Complete Full PPF details.");
    try {
      const calc = calcFullPpfClient({ ppfRule, sku: fullSelectedSku, widthIn: n(fullWidthIn), lengthIn: n(fullLengthIn), sizeDifficultyMultiplier, laborRates, hoursByCode });
      const item = {
        id: fullItem?.id ?? null,
        _localId: fullItem?.id ? null : makeLocalId(),
        zone: "EXTERIOR",
        name: "Full PPF (Total Cut)",
        material_code: fullMaterial,
        width_in: n(fullWidthIn),
        length_in: n(fullLengthIn),
        hours_by_code: hoursByCode,
        calc,
      };
      setFullItem(item);
      setOkMsg("Full PPF updated.");
    } catch (e) {
      setError(e?.message ?? "Failed Full PPF.");
    }
  }

  const ppfDraftSubtotal = useMemo(() => n(fullItem?.calc?.numbers?.final_price_mxn, 0) + detailedSubtotal, [fullItem, detailedSubtotal]);

  async function onSavePpf() {
    setError(null); setOkMsg(null);
    if (!quote?.id) return setError("Quote not loaded.");
    setSaving(true);
    try {
      const itemsPayload = [];
      if (fullItem) {
        itemsPayload.push({
          service_item_id: null,
          zone: "EXTERIOR",
          name: fullItem.name,
          is_main: true,
          is_standalone: true,
          sort_order: 0,
          inputs: { mode: "FULL_PPF", material_code: fullItem.material_code, width_in: fullItem.width_in, length_in: fullItem.length_in, hours_by_code: fullItem.hours_by_code, size_code: sizeCode, difficulty },
          calc: fullItem.calc,
        });
      }
      for (const [idx, it] of draftItems.entries()) {
        itemsPayload.push({
          service_item_id: null,
          zone: it.zone,
          name: it.name,
          is_main: String(it.zone) === "EXTERIOR",
          is_standalone: true,
          sort_order: 10 + idx,
          inputs: { bundle_template_id: it.bundle_template_id, bundle_code: it.bundle_code, material_code: it.material_code, width_in: it.width_in, length_in: it.length_in, hours: it.hours, size_code: sizeCode, difficulty },
          calc: it.calc,
        });
      }
      await replacePpfLineItems({ quoteId: quote.id, items: itemsPayload });
      const warnings = itemsPayload.filter(it => it.calc?.sku?.warning_only).map(it => `PPF "${it.name}" used warning_only roll.`);
      const pt = quote?.totals ?? {};
      const grand = ppfDraftSubtotal + n(pt?.ceramic?.subtotal_mxn, 0) + n(pt?.swissvax?.subtotal_mxn, 0) + n(pt?.tint?.subtotal_mxn, 0);
      const newTotals = { ...pt, inputs: { ...pt.inputs, size_code: sizeCode, difficulty, size_difficulty_multiplier: sizeDifficultyMultiplier }, ppf: { subtotal_mxn: ppfDraftSubtotal, count: itemsPayload.length }, grand_total_mxn: grand };
      const updated = await updateQuoteTotals({ quoteId: quote.id, totals: newTotals, warnings });
      const freshItems = await listQuoteLineItems(quote.id);
      setLineItems(freshItems || []);
      setQuote(updated);
      hydratePpfDraftsFromLineItems(freshItems || []);
      setOkMsg("PPF saved.");
    } catch (e) {
      setError(e?.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function onClearPpf() {
    setSaving(true);
    try {
      await replacePpfLineItems({ quoteId: quote.id, items: [] });
      const pt = quote?.totals ?? {};
      const grand = n(pt?.ceramic?.subtotal_mxn, 0) + n(pt?.swissvax?.subtotal_mxn, 0) + n(pt?.tint?.subtotal_mxn, 0);
      const newTotals = { ...pt, inputs: { ...pt.inputs, size_code: sizeCode, difficulty, size_difficulty_multiplier: sizeDifficultyMultiplier }, ppf: { subtotal_mxn: 0, count: 0 }, grand_total_mxn: grand };
      const updated = await updateQuoteTotals({ quoteId: quote.id, totals: newTotals, warnings: [] });
      setQuote(updated);
      setLineItems([]);
      setFullItem(null);
      setDraftItems([]);
      setOkMsg("PPF cleared.");
    } catch (e) { setError("Failed to clear PPF."); }
    finally { setSaving(false); }
  }

  if (booting) return <div style={{ padding: 18, color: "#f8fafc", background: "#141415" }}>Loading…</div>;

  return (
    <div className="qb-page">
      <style>{`
        .qb-page { min-height:100vh; background:#141415; padding:22px 14px; font-family: ui-sans-serif, system-ui; color:#f8fafc; }
        .qb-wrap { max-width:1180px; margin:0 auto; }
        .qb-top { display:flex; justify-content:space-between; gap:14px; align-items:flex-start; margin-bottom:14px; }
        .qb-title { font-size:22px; font-weight:900; letter-spacing:-0.02em; margin:0; }
        .qb-sub { margin-top:8px; display:flex; gap:10px; flex-wrap:wrap; }
        .qb-code { font-family: ui-monospace; background: rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.08); padding:2px 6px; border-radius:10px; color:#f8fafc; }
        .qb-actions { display:flex; gap:10px; flex-wrap:wrap; align-items:center; justify-content:flex-end; }
        .btn { border-radius:14px; border:1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); padding:10px 12px; font-weight:900; cursor:pointer; color:#f8fafc; }
        .btn:hover { background: rgba(255,255,255,.10); }
        .btn-primary { border:1px solid rgba(255,255,255,.22); background:#f8fafc; color:#141415; }
        .btn-primary:hover { background:#fff; }
        .btn:disabled { opacity:.55; cursor:not-allowed; }
        .card { background: rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.10); border-radius:18px; box-shadow: 0 1px 0 rgba(0,0,0,.20); padding:14px; margin-top:12px; }
        .card-title { font-weight:950; font-size:16px; margin-bottom:10px; display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
        .grid2 { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
        .field label { display:block; font-size:12px; color:#c9c9d2; font-weight:900; margin-bottom:6px; }
        .input, select.input { width:100%; border-radius:14px; border:1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.25); padding:10px 12px; outline:none; font-size:14px; color:#f8fafc; }
        .input:focus { border-color: rgba(248,250,252,.55); box-shadow: 0 0 0 3px rgba(248,250,252,.10); }
        .help { margin-top:6px; font-size:12px; color:#b8b8bf; }
        .mini { font-size:12px; color:#b8b8bf; margin-top:4px; }
        .error { margin-top:12px; padding:12px; border-radius:16px; border:1px solid rgba(244,63,94,.35); background: rgba(244,63,94,.10); color:#fecdd3; font-weight:800; white-space:pre-wrap; }
        .ok { margin-top:12px; padding:10px 12px; border-radius:16px; border:1px solid rgba(34,197,94,.35); background: rgba(34,197,94,.10); color:#bbf7d0; font-weight:900; }
        .pill { display:inline-flex; align-items:center; gap:8px; font-size:12px; padding:6px 10px; border:1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); border-radius:999px; color:#f8fafc; font-weight:900; }
        .table { width:100%; border-collapse:collapse; margin-top:10px; }
        .table th,.table td { border-top:1px solid rgba(255,255,255,.10); padding:10px 8px; font-size:13px; text-align:left; vertical-align:top; }
        .table th { font-size:12px; color:#b8b8bf; font-weight:950; }
        .muted { color:#b8b8bf; }
        .right { text-align:right; }
        .tabs { display:flex; gap:10px; flex-wrap:wrap; }
        .tab { border-radius:999px; border:1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); padding:8px 12px; font-weight:950; cursor:pointer; color:#f8fafc; line-height:1; }
        .tab:hover { background: rgba(255,255,255,.10); }
        .tab.is-on { background:#f8fafc; color:#141415; }
        .rowLink{ display:flex; align-items:center; justify-content:space-between; gap:12px; border:1px solid rgba(255,255,255,.10); background: rgba(0,0,0,.18); border-radius:16px; padding:12px; cursor:pointer; user-select:none; }
        .serviceGrid{ display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap:10px; margin-top:10px; }
        .svcBtn{ text-align:left; border-radius:16px; border:1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); padding:12px; cursor:pointer; color:#f8fafc; }
        .svcBtn.is-on{ background:#f8fafc; color:#141415; border-color: rgba(255,255,255,.22); }
        .svcName{ font-weight:950; }
        .svcMeta{ margin-top:6px; font-size:12px; color: rgba(248,250,252,.70); }
        .svcBtn.is-on .svcMeta{ color: rgba(20,20,21,.72); }
        @media (max-width:860px) { .grid2{grid-template-columns:1fr;} .qb-top{flex-direction:column;} .serviceGrid{ grid-template-columns: repeat(2, minmax(0,1fr)); } }
        @media (max-width:640px){ .serviceGrid{ grid-template-columns: 1fr; } }
      `}</style>

      <div className="qb-wrap">
        <div className="qb-top">
          <div>
            <h1 className="qb-title">Quote Builder</h1>
            <div className="qb-sub">
              <span className="pill">Quote <span className="qb-code">{quote?.id}</span></span>
              <span className="pill">Size: {sizeCode}</span>
              <span className="pill">Difficulty: {difficulty}</span>
              <span className="pill">Total: {formatMxn(n(quote?.totals?.grand_total_mxn))}</span>
            </div>
          </div>
          <div className="qb-actions">
            <button className="btn" onClick={() => nav("/new")}>New Quote</button>
            <button className="btn" onClick={refresh}>Refresh</button>
            {step === "PPF" && (
              <>
                <button className="btn" onClick={onClearPpf} disabled={saving}>No PPF</button>
                <button className="btn btn-primary" onClick={onSavePpf} disabled={saving}>{saving ? "Saving…" : "Save PPF"}</button>
              </>
            )}
            <button className="btn" onClick={() => setStep("SUMMARY")}>Summary</button>
          </div>
        </div>

        {error && <div className="error">{error}</div>}
        {okMsg && <div className="ok">{okMsg}</div>}

        <div className="card">
          <div className="card-title">
            <div>Steps</div>
            <div className="tabs">
              <button className={`tab ${step === "PPF" ? "is-on" : ""}`} onClick={() => setStep("PPF")}>1. PPF</button>
              <button className={`tab ${step === "CERAMIC" ? "is-on" : ""}`} onClick={() => setStep("CERAMIC")}>2. Ceramic</button>
              <button className={`tab ${step === "SUMMARY" ? "is-on" : ""}`} onClick={() => setStep("SUMMARY")}>Summary</button>
            </div>
          </div>
        </div>

        {/* ===================== STEP 1: PPF ===================== */}
        {step === "PPF" && (
          <div className="card">
            <div className="card-title">
              <div>PPF</div>
              <div className="tabs">
                <button className={`tab ${ppfMode === "FULL" ? "is-on" : ""}`} onClick={() => setPpfMode("FULL")}>Full PPF</button>
                <button className={`tab ${ppfMode === "DETAILED" ? "is-on" : ""}`} onClick={() => setPpfMode("DETAILED")}>Detailed PPF</button>
              </div>
            </div>

            {/* ---------- FULL PPF ---------- */}
            {ppfMode === "FULL" && (
              <div style={{ marginTop: 12 }}>
                <div className="card-title">Full PPF (Total Cut)</div>
                <div className="grid2">
                  <div className="field">
                    <label>Material (Full PPF)</label>
                    <select className="input" value={fullMaterial} onChange={(e) => setFullMaterial(e.target.value)}>
                      <option value="">Select…</option>
                      {allowedFullMaterials.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Roll Width (in)</label>
                    <select className="input" value={fullWidthIn} onChange={(e) => setFullWidthIn(e.target.value)} disabled={!fullMaterial || fullWidths.length === 0}>
                      {fullWidths.map((w) => <option key={w} value={String(w)}>{w}"</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <label>Total Length Needed (in)</label>
                    <input className="input" value={fullLengthIn} onChange={(e) => setFullLengthIn(e.target.value)} onKeyDown={blockEnter} type="number" min="1" placeholder="Example: 600" />
                    <div className="help">{fullLengthError || (fullLengthMax ? `Max length: ${fullLengthMax}"` : "")}</div>
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <div className="rowLink" onClick={() => setLaborOpen((v) => !v)}>
                    <div><strong>Labor</strong> <span className="mini">• Click to {laborOpen ? "hide" : "edit"}</span></div>
                    <div style={{ fontWeight: 950 }}>{formatMxn(fullLaborTotal)}</div>
                  </div>
                  {laborOpen && (
                    <div className="card" style={{ marginTop: 10 }}>
                      <div className="grid2">
                        {laborRates.map((r) => (
                          <div className="field" key={r.code}>
                            <label>{r.label} <span className="mini">• {n(r.rate_mxn_per_hour, 0)} MXN/hr</span></label>
                            <input className="input" type="number" min="0" step="0.25" value={hoursByCode?.[r.code] ?? ""} onChange={(e) => setHoursByCode(prev => ({ ...prev, [r.code]: e.target.value }))} placeholder="0" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                  <button className="btn btn-primary" onClick={onSetFullItem} disabled={!canSetFull()}>
                    {fullItem ? "Update Full PPF Draft" : "Set Full PPF Draft"}
                  </button>
                  {fullItem && <button className="btn" onClick={() => setFullItem(null)}>Remove Full PPF</button>}
                </div>

                {fullItem && (
                   <div style={{ marginTop: 14 }}>
                      <table className="table">
                        <thead>
                           <tr><th>Full PPF</th><th>Material</th><th className="right">Cost</th><th className="right">Final</th></tr>
                        </thead>
                        <tbody>
                           <tr>
                              <td>{fullItem.name}</td>
                              <td>{fullItem.material_code}<br/><span className="mini">{n(fullItem.width_in)}" × {n(fullItem.length_in)}"</span></td>
                              <td className="right">{formatMxn(n(fullItem.calc?.numbers?.film_cost_with_waste_mxn))}</td>
                              <td className="right">{formatMxn(n(fullItem.calc?.numbers?.final_price_mxn))}</td>
                           </tr>
                        </tbody>
                      </table>
                   </div>
                )}
              </div>
            )}

            {/* ---------- DETAILED PPF (MODIFIED FOR DUAL MODE) ---------- */}
            {ppfMode === "DETAILED" && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                    <button 
                        className={`tab ${detailedType === "KITS" ? "is-on" : ""}`} 
                        onClick={() => { setDetailedType("KITS"); setBundleId(""); }}
                        style={{ fontSize: 13, padding: "6px 14px" }}
                    >
                        Pre-made Kits (Parts)
                    </button>
                    <button 
                        className={`tab ${detailedType === "CUSTOM" ? "is-on" : ""}`} 
                        onClick={() => { setDetailedType("CUSTOM"); setBundleId(""); }}
                        style={{ fontSize: 13, padding: "6px 14px" }}
                    >
                        Custom / Bulk Cut
                    </button>
                </div>

                {/* --- MODE 1: KITS --- */}
                {detailedType === "KITS" && (
                    <div className="field">
                        <label>Select a Part</label>
                        <div className="serviceGrid">
                        {(ppfBundles || []).map((b) => (
                            <button
                            key={b.id}
                            type="button"
                            className={`svcBtn ${b.id === bundleId ? "is-on" : ""}`}
                            onClick={() => setBundleId(b.id)}
                            >
                            <div className="svcName">{b.name}</div>
                            <div className="svcMeta">{b.zone}</div>
                            </button>
                        ))}
                        </div>
                    </div>
                )}

                {/* --- MODE 2: CUSTOM --- */}
                {detailedType === "CUSTOM" && (
                    <div className="field">
                        <label>Custom Item Name</label>
                        <input 
                            className="input" 
                            placeholder="e.g. Color PPF Roof, Custom Stripe..."
                            value={customItemName}
                            onChange={(e) => setCustomItemName(e.target.value)}
                        />
                        <div className="help">
                           Select the complexity by picking a similar part logic if available, or just use the generic calculation below.
                        </div>
                    </div>
                )}

                {/* --- COMMON INPUTS FOR BOTH --- */}
                <div className="grid2" style={{ marginTop: 12, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 12 }}>
                  <div className="field">
                    <label>Material</label>
                    <select className="input" value={material} onChange={(e) => setMaterial(e.target.value)}>
                      <option value="">Select…</option>
                      {materials.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>

                  <div className="field">
                    <label>Roll Width</label>
                    <select className="input" value={widthIn} onChange={(e) => setWidthIn(e.target.value)} disabled={!material || widths.length === 0}>
                       <option value="">Select…</option>
                       {widths.map((w) => <option key={w} value={String(w)}>{w}"</option>)}
                    </select>
                  </div>

                  <div className="field">
                    <label>Length Needed (in)</label>
                    <input className="input" value={lengthIn} onChange={(e) => setLengthIn(e.target.value)} onKeyDown={blockEnter} type="number" min="1" placeholder="e.g. 72" />
                    {lengthError && <div className="mini" style={{ color: "#fecdd3" }}>{lengthError}</div>}
                  </div>

                  {activeBundlePricing?.requires_hours && (
                    <div className="field">
                      <label>Hours ({n(activeBundlePricing.labor_rate_mxn_per_hour)}/hr)</label>
                      <input className="input" value={hours} onChange={(e) => setHours(e.target.value)} type="number" min="0" step="0.25" />
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 12 }}>
                  <button className="btn btn-primary" onClick={onAddDetailed} disabled={!canAddDetailed()}>
                    Add {detailedType === "CUSTOM" ? "Custom Item" : "Kit Item"}
                  </button>
                </div>

                {/* --- DRAFT TABLE --- */}
                <div style={{ marginTop: 14 }}>
                  {draftItems.length === 0 ? (
                    <div className="help" style={{ padding: 12, border: "1px dashed rgba(255,255,255,.18)", borderRadius: 16 }}>No items added yet.</div>
                  ) : (
                    <table className="table">
                      <thead>
                        <tr><th>Name</th><th>Material</th><th className="right">Cost</th><th className="right">Final</th><th></th></tr>
                      </thead>
                      <tbody>
                        {draftItems.map((it) => (
                          <tr key={it.id || it._localId}>
                            <td>{it.name}<br/><span className="mini">{it.zone}</span></td>
                            <td>{it.material_code}<br/><span className="mini">{n(it.width_in)}" × {n(it.length_in)}"</span></td>
                            <td className="right">{formatMxn(n(it.calc?.numbers?.cost_with_waste_mxn))}</td>
                            <td className="right">{formatMxn(n(it.calc?.numbers?.final_price_mxn))}</td>
                            <td className="right"><button className="btn" onClick={() => onRemoveDetailed(it.id || it._localId)}>✕</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===================== STEP 2: CERAMIC ===================== */}
        {step === "CERAMIC" && (
          <ErrorBoundary fallback={<div className="error">Ceramic builder crashed.</div>}>
            <CeramicBuilderCard key={`${quote?.id}:${ruleVersionId}`} quote={quote} quoteId={quote?.id} sizeCode={sizeCode} difficulty={difficulty} sizeDifficultyMultiplier={sizeDifficultyMultiplier} onSaved={refresh} onRefresh={refresh} />
          </ErrorBoundary>
        )}

        {/* ===================== SUMMARY ===================== */}
        {step === "SUMMARY" && (
          <>
            <TotalsCard quote={quote} />
            <LineItemsCard items={lineItems} />
          </>
        )}
      </div>
    </div>
  );
}