import React, { useEffect, useMemo, useState } from "react";
import {
  getCeramicPricingRule,
  listCeramicSystems,
  listServiceOffersWithTemplate,
  getProductsByIds,
  listOfferSurfacesByOfferIds,
  listOfferUsageMlByOfferIds,
  listOfferPricingBySizeByOfferIds,
  replaceCeramicLineItems,
  replaceSwissvaxLineItems,
  updateQuoteTotals,
  listQuoteLineItems,
} from "../lib/api";

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function normalizeMultiplier(v) {
  // handles 1.2 or 120 => 1.2
  const x = n(v, 1);
  if (!Number.isFinite(x) || x <= 0) return 1;
  if (x > 10) return x / 100;
  return x;
}

function formatMxn(x) {
  const v = n(x, 0);
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(v);
  } catch {
    return `MXN ${v.toFixed(2)}`;
  }
}

function uniq(arr) {
  return Array.from(new Set((arr ?? []).filter(Boolean)));
}

const SECTION_DEFS = [
  { key: "paint", title: "Paint", surfaces: ["paint", "paint_matte"], zone: "EXTERIOR", isPaint: true, defaultEnabled: true },
  { key: "glass", title: "Glass", surfaces: ["glass"], zone: "EXTERIOR" },
  { key: "wheels", title: "Wheels", surfaces: ["wheels"], zone: "EXTERIOR" },
  { key: "trim_plastics", title: "Trim / Plastics", surfaces: ["trim_plastics"], zone: "EXTERIOR" },
  { key: "wrap", title: "Wrap", surfaces: ["wrap"], zone: "EXTERIOR" },
  { key: "ppf_existing_film", title: "PPF (Existing Film)", surfaces: ["ppf_existing_film"], zone: "EXTERIOR" },
  { key: "ppf_stek_film", title: "PPF (STEK Film)", surfaces: ["ppf_stek_film"], zone: "EXTERIOR" },
  { key: "leather", title: "Interior (Leather)", surfaces: ["leather"], zone: "INTERIOR" },
  { key: "fabric", title: "Interior (Fabric)", surfaces: ["fabric"], zone: "INTERIOR" },
];

function initEnabled() {
  const out = {};
  for (const s of SECTION_DEFS) out[s.key] = Boolean(s.defaultEnabled);
  return out;
}

function initSlotsForFamily(familyKey) {
  const out = {};
  for (const s of SECTION_DEFS) {
    // Ceramic gets 3 coats allowed, Swissvax gets 1
    out[s.key] = familyKey === "SWISSVAX" ? { base: "" } : { base: "", top1: "", top2: "" };
  }
  return out;
}

function pickDistributorCostMxn(product) {
  const c = n(product?.cost_mxn, NaN);
  if (Number.isFinite(c) && c >= 0) return c;
  const p = n(product?.price_mxn, NaN);
  if (Number.isFinite(p) && p >= 0) return p;
  const msrp = n(product?.msrp_mxn, NaN);
  if (Number.isFinite(msrp) && msrp >= 0) return msrp;
  return 0;
}

const LAYER_DISCOUNT_CHEAPEST = 0.07;
const LAYER_DISCOUNT_SECOND = 0.05;

function offerFamilyTag(offer, product) {
  const candidates = [
    offer?.service_templates?.family,
    offer?.template_family,
    offer?.family,
    offer?.pricing_model, 
  ].map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);

  for (const c of candidates) {
    if (c === "ceramic") return "CERAMIC";
    if (c === "swissvax") return "SWISSVAX";
  }

  const dn = String(offer?.display_name || "").toLowerCase();
  const pn = String(product?.name || "").toLowerCase();
  if (dn.includes("swissvax") || pn.includes("swissvax")) return "SWISSVAX";
  if (dn.includes("ceramic") || pn.includes("ceramic")) return "CERAMIC";

  return "UNKNOWN";
}

export default function CeramicBuilderCard({
  quote,
  quoteId,
  sizeCode,
  difficulty,
  sizeDifficultyMultiplier,
  onSaved,
  onRefresh,
}) {
  const ruleVersionId = quote?.rule_version_id ?? null;
  const sizeMult = normalizeMultiplier(sizeDifficultyMultiplier);

  const [activeFamily, setActiveFamily] = useState("CERAMIC"); // CERAMIC | SWISSVAX
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState(null);

  const [ceramicRule, setCeramicRule] = useState(null);
  const [systems, setSystems] = useState([]);
  const [offersAll, setOffersAll] = useState([]);
  const [productsById, setProductsById] = useState({});

  const [offerSurfaces, setOfferSurfaces] = useState([]);
  const [offerUsageMl, setOfferUsageMl] = useState([]);
  const [offerPricingRows, setOfferPricingRows] = useState([]);

  const [enabledByFamily, setEnabledByFamily] = useState(() => ({
    CERAMIC: initEnabled(),
    SWISSVAX: initEnabled(),
  }));

  const [slotsByFamily, setSlotsByFamily] = useState(() => ({
    CERAMIC: initSlotsForFamily("CERAMIC"),
    SWISSVAX: initSlotsForFamily("SWISSVAX"),
  }));

  const [specialPaint, setSpecialPaint] = useState(Boolean(quote?.totals?.inputs?.special_paint ?? false));

  const enabledBySection = enabledByFamily?.[activeFamily] ?? initEnabled();
  const slotsBySection = slotsByFamily?.[activeFamily] ?? initSlotsForFamily(activeFamily);

  const sysByProductId = useMemo(() => {
    const map = {};
    for (const s of systems || []) if (s.product_id) map[String(s.product_id)] = s;
    return map;
  }, [systems]);

  const surfacesByOfferId = useMemo(() => {
    const map = {};
    for (const r of offerSurfaces || []) {
      const oid = r.service_offer_id;
      if (!oid) continue;
      if (!map[oid]) map[oid] = [];
      map[oid].push(String(r.surface));
    }
    return map;
  }, [offerSurfaces]);

  const usageByOfferSizeSurface = useMemo(() => {
    const map = {};
    for (const r of offerUsageMl || []) {
      const oid = r.service_offer_id;
      if (!oid) continue;
      const vs = String(r.vehicle_size);
      const surf = String(r.surface);
      if (!map[oid]) map[oid] = {};
      if (!map[oid][vs]) map[oid][vs] = {};
      map[oid][vs][surf] = n(r.ml_used, 0);
    }
    return map;
  }, [offerUsageMl]);

  const pricingByOfferSize = useMemo(() => {
    const map = {};
    for (const r of offerPricingRows || []) {
      const oid = r.service_offer_id;
      if (!oid) continue;
      const vs = String(r.vehicle_size);
      if (!map[oid]) map[oid] = {};
      map[oid][vs] = r;
    }
    return map;
  }, [offerPricingRows]);

  function normalizeOfferRow(o) {
    if (!o) return null;
    const id = o.id ?? o.service_offer_id;
    if (!id) return null;
    return {
      ...o,
      id,
      protection_product_id: o.protection_product_id ?? null,
      sort_order: o.sort_order ?? 0,
      service_templates: o.service_templates ?? { family: o.template_family, name: o.template_name },
    };
  }

  function offerProductName(offer) {
    const pid = offer?.protection_product_id ?? null;
    const p = pid ? productsById?.[pid] : null;
    return p?.name || offer?.display_name || "Offer";
  }

  const offersByFamily = useMemo(() => {
    const normalized = (offersAll || []).map(normalizeOfferRow).filter(Boolean);
    const out = { CERAMIC: [], SWISSVAX: [] };
    for (const o of normalized) {
      const pid = o.protection_product_id ?? null;
      const prod = pid ? productsById?.[pid] : null;
      const tag = offerFamilyTag(o, prod);
      if (tag === "CERAMIC") out.CERAMIC.push(o);
      if (tag === "SWISSVAX") out.SWISSVAX.push(o);
    }
    out.CERAMIC.sort((a, b) => n(a.sort_order, 0) - n(b.sort_order, 0));
    out.SWISSVAX.sort((a, b) => n(a.sort_order, 0) - n(b.sort_order, 0));
    return out;
  }, [offersAll, productsById]);

  const offers = offersByFamily?.[activeFamily] ?? [];

  function offersForSection(section) {
    const list = (offers || []).filter((o) => {
      const surfs = surfacesByOfferId[o.id] ?? [];
      const matches = section.surfaces.some((s) => surfs.includes(String(s)));
      if (!matches) return false;
      if (activeFamily === "CERAMIC" && section.isPaint && specialPaint) {
        return surfs.includes("paint_matte");
      }
      return true;
    });
    return list.sort((a, b) => n(a.sort_order, 0) - n(b.sort_order, 0));
  }

  function pickSurfaceUsed(offerId, section) {
    const surfs = surfacesByOfferId?.[offerId] ?? [];
    if (activeFamily === "CERAMIC" && section.isPaint && specialPaint) return "paint_matte";
    for (const s of section.surfaces) if (surfs.includes(String(s))) return String(s);
    return section.surfaces[0];
  }

  useEffect(() => {
    let mounted = true;
    async function boot() {
      if (!ruleVersionId) { setLoading(false); return; }
      setLoading(true); setError(null); setOkMsg(null);
      try {
        const [rule, sys, allOffers] = await Promise.all([
          getCeramicPricingRule(ruleVersionId),
          listCeramicSystems(ruleVersionId),
          listServiceOffersWithTemplate(ruleVersionId),
        ]);
        if (!mounted) return;
        setCeramicRule(rule ?? null);
        setSystems(sys || []);
        const normalizedOffers = (allOffers || []).map(normalizeOfferRow).filter(Boolean);
        setOffersAll(normalizedOffers);
        const productIds = uniq(normalizedOffers.map((o) => o.protection_product_id).filter(Boolean));
        const products = await getProductsByIds(productIds);
        if (!mounted) return;
        const byId = {};
        for (const p of products || []) byId[p.id] = p;
        setProductsById(byId);
        const offerIds = uniq(normalizedOffers.map((o) => o.id));
        const [surfs, usage, pricing] = await Promise.all([
          listOfferSurfacesByOfferIds(offerIds),
          listOfferUsageMlByOfferIds(offerIds),
          listOfferPricingBySizeByOfferIds(offerIds),
        ]);
        if (!mounted) return;
        setOfferSurfaces(surfs || []);
        setOfferUsageMl(usage || []);
        setOfferPricingRows(pricing || []);
      } catch (e) {
        console.error("[CeramicBuilder.boot]", e);
        if (!mounted) return;
        setError(e?.message ?? "Failed to load coating data.");
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }
    boot();
    return () => { mounted = false; };
  }, [ruleVersionId]);

  useEffect(() => {
    if (activeFamily !== "CERAMIC") return;
    if (!specialPaint) return;
    setSlotsByFamily((prev) => {
      const next = { ...(prev || {}) };
      const cur = next.CERAMIC ?? initSlotsForFamily("CERAMIC");
      const paint = cur.paint ?? { base: "", top1: "", top2: "" };
      const keep = (offerId) => {
        if (!offerId) return "";
        const surfs = surfacesByOfferId?.[offerId] ?? [];
        return surfs.includes("paint_matte") ? offerId : "";
      };
      next.CERAMIC = {
        ...(cur || {}),
        paint: { base: keep(paint.base), top1: keep(paint.top1), top2: keep(paint.top2) },
      };
      return next;
    });
  }, [specialPaint, activeFamily, surfacesByOfferId]);

  function calcSlot(section, offerId) {
    if (!offerId) return null;
    const offer = (offers || []).find((x) => (x.id ?? x.service_offer_id) === offerId) || null;
    const pid = offer?.protection_product_id ?? null;
    const product = pid ? productsById?.[pid] : null;
    const pricingRow = pricingByOfferSize?.[offerId]?.[String(sizeCode)] ?? null;

    const unitCost = product ? pickDistributorCostMxn(product) : 0;
    const volumeMl = n(product?.volume_ml, 0);
    const surfaceUsed = pickSurfaceUsed(offerId, section);
    const mlUsed = n(usageByOfferSizeSurface?.[offerId]?.[String(sizeCode)]?.[String(surfaceUsed)], 0);
    const materialCost = volumeMl > 0 ? (mlUsed / volumeMl) * unitCost : 0;

    const laborSell = n(pricingRow?.labor_mxn, 0);
    const fixed = n(pricingRow?.fixed_price_mxn, NaN);
    const mult = normalizeMultiplier(pricingRow?.multiplier);

    let materialSell = 0;
    if (Number.isFinite(fixed) && fixed > 0) materialSell = fixed;
    else materialSell = materialCost * mult;

    let spMult = 1;
    if (activeFamily === "CERAMIC" && section.isPaint && specialPaint) {
      const fromRule = n(ceramicRule?.special_paint_multiplier, NaN);
      spMult = Number.isFinite(fromRule) && fromRule > 0 ? fromRule : 1;
      materialSell *= spMult;
    }

    const preSizeSell = materialSell + laborSell;
    const final = preSizeSell * sizeMult;

    return {
      offer,
      product,
      surfaceUsed,
      numbers: {
        ml_used: mlUsed,
        volume_ml: volumeMl,
        unit_cost_mxn: unitCost,
        cost_mxn: materialCost,
        material_cost_mxn: materialCost,
        multiplier_used: mult,
        fixed_used: Number.isFinite(fixed) ? fixed : null,
        special_paint_multiplier: spMult,
        material_sell_mxn: materialSell,
        labor_sell_mxn: laborSell,
        pre_size_sell_mxn: preSizeSell,
        size_difficulty_multiplier: sizeMult,
        final_price_mxn: final,
        subtotal_mxn: final,
      },
    };
  }

  const sectionCalcs = useMemo(() => {
    const out = {};
    for (const section of SECTION_DEFS) {
      const enabled = Boolean(enabledBySection?.[section.key]);
      const slots = slotsBySection?.[section.key] ?? (activeFamily === "SWISSVAX" ? { base: "" } : { base: "", top1: "", top2: "" });

      const cBase = enabled ? calcSlot(section, slots.base) : null;
      const cTop1 = activeFamily === "CERAMIC" && enabled ? calcSlot(section, slots.top1) : null;
      const cTop2 = activeFamily === "CERAMIC" && enabled ? calcSlot(section, slots.top2) : null;

      const anySelected = Boolean(cBase || cTop1 || cTop2);
      let materialCost = 0; let materialSell = 0; let laborSell = 0;

      const calcs = activeFamily === "SWISSVAX" ? [cBase] : [cBase, cTop1, cTop2];
      for (const c of calcs) {
        if (!c) continue;
        materialCost += n(c.numbers.cost_mxn, 0);
        materialSell += n(c.numbers.material_sell_mxn, 0);
        laborSell += n(c.numbers.labor_sell_mxn, 0);
      }

      let discount = 0;
      if (activeFamily === "CERAMIC" && section.isPaint && anySelected) {
        const ids = [slots.base, slots.top1, slots.top2].filter(Boolean);
        const unique = new Set(ids);
        if (ids.length === 3 && unique.size === 3) {
          const sells = [
            { sell: n(cBase?.numbers?.material_sell_mxn, 0) },
            { sell: n(cTop1?.numbers?.material_sell_mxn, 0) },
            { sell: n(cTop2?.numbers?.material_sell_mxn, 0) },
          ].sort((a, b) => a.sell - b.sell);
          discount = sells[0].sell * LAYER_DISCOUNT_CHEAPEST + sells[1].sell * LAYER_DISCOUNT_SECOND;
        }
      }

      const preSizeSell = (materialSell - discount) + laborSell;
      const final = preSizeSell * sizeMult;

      out[section.key] = {
        enabled,
        anySelected,
        slots,
        slots_calc: { base: cBase, top1: cTop1, top2: cTop2 },
        numbers: {
          cost_mxn: materialCost,
          material_cost_mxn: materialCost,
          material_sell_mxn: materialSell,
          labor_sell_mxn: laborSell,
          discount_mxn: discount,
          pre_size_sell_mxn: preSizeSell,
          size_difficulty_multiplier: sizeMult,
          final_price_mxn: final,
          subtotal_mxn: final,
        },
      };
    }
    return out;
  }, [enabledBySection, slotsBySection, offers, productsById, pricingByOfferSize, usageByOfferSizeSurface, surfacesByOfferId, ceramicRule, specialPaint, sizeMult, sizeCode, activeFamily]);

  const totals = useMemo(() => {
    let cost = 0; let materialSell = 0; let laborSell = 0; let discount = 0; let preSize = 0; let final = 0; let count = 0;
    for (const section of SECTION_DEFS) {
      const t = sectionCalcs?.[section.key];
      if (!t?.enabled || !t?.anySelected) continue;
      cost += n(t.numbers.cost_mxn, 0);
      materialSell += n(t.numbers.material_sell_mxn, 0);
      laborSell += n(t.numbers.labor_sell_mxn, 0);
      discount += n(t.numbers.discount_mxn, 0);
      preSize += n(t.numbers.pre_size_sell_mxn, 0);
      final += n(t.numbers.final_price_mxn, 0);
      count += 1;
    }
    return {
      cost_mxn: cost, material_sell_mxn: materialSell, labor_sell_mxn: laborSell, discount_mxn: discount, pre_size_sell_mxn: preSize, final_price_mxn: final, subtotal_mxn: final, sections_count: count,
    };
  }, [sectionCalcs]);

  async function saveCurrentFamily() {
    setError(null); setOkMsg(null);
    if (!quoteId) return setError("Quote not loaded.");
    if (!ruleVersionId) return setError("Missing rule_version_id.");
    setSaving(true);
    try {
      const itemsPayload = [];
      let sort = 0;
      for (const section of SECTION_DEFS) {
        const t = sectionCalcs?.[section.key];
        if (!t?.enabled || !t?.anySelected) continue;
        const slots = t.slots;
        const cBase = t.slots_calc.base; const cTop1 = t.slots_calc.top1; const cTop2 = t.slots_calc.top2;
        const coats = activeFamily === "SWISSVAX" ? { coat1: slots.base || null } : { base: slots.base || null, top1: slots.top1 || null, top2: slots.top2 || null };
        
        itemsPayload.push({
          service_item_id: null,
          zone: section.zone,
          name: `${activeFamily === "CERAMIC" ? "Ceramic" : "Swissvax"} — ${section.title}`,
          is_main: section.zone === "EXTERIOR",
          is_standalone: true,
          sort_order: sort,
          inputs: { section_key: section.key, surfaces: section.surfaces, vehicle_size: sizeCode, difficulty, size_difficulty_multiplier: sizeMult, special_paint: Boolean(activeFamily === "CERAMIC" && section.isPaint && specialPaint), coats },
          calc: {
            family: activeFamily,
            slots: activeFamily === "SWISSVAX" ? {
                coat1: cBase ? { offer_id: slots.base, product_name: offerProductName(cBase.offer), surface_used: cBase.surfaceUsed, numbers: cBase.numbers } : null,
              } : {
                base: cBase ? { offer_id: slots.base, product_name: offerProductName(cBase.offer), surface_used: cBase.surfaceUsed, numbers: cBase.numbers } : null,
                top1: cTop1 ? { offer_id: slots.top1, product_name: offerProductName(cTop1.offer), surface_used: cTop1.surfaceUsed, numbers: cTop1.numbers } : null,
                top2: cTop2 ? { offer_id: slots.top2, product_name: offerProductName(cTop2.offer), surface_used: cTop2.surfaceUsed, numbers: cTop2.numbers } : null,
              },
            numbers: t.numbers,
          },
        });
        sort += 10;
      }

      if (activeFamily === "CERAMIC") await replaceCeramicLineItems({ quoteId, items: itemsPayload });
      else await replaceSwissvaxLineItems({ quoteId, items: itemsPayload });

      const existingTotals = quote?.totals ?? {};
      const ppfSubtotal = n(existingTotals?.ppf?.subtotal_mxn, 0);
      const tintSubtotal = n(existingTotals?.tint?.subtotal_mxn, 0);
      const ceramicSubtotal = activeFamily === "CERAMIC" ? n(totals.subtotal_mxn, 0) : n(existingTotals?.ceramic?.subtotal_mxn, 0);
      const swissSubtotal = activeFamily === "SWISSVAX" ? n(totals.subtotal_mxn, 0) : n(existingTotals?.swissvax?.subtotal_mxn, 0);

      const nextTotals = {
        ...(existingTotals ?? {}),
        inputs: { ...(existingTotals?.inputs ?? {}), size_code: sizeCode, difficulty, size_difficulty_multiplier: sizeMult, special_paint: Boolean(activeFamily === "CERAMIC" ? specialPaint : existingTotals?.inputs?.special_paint) },
        ceramic: { ...(existingTotals?.ceramic ?? {}), subtotal_mxn: ceramicSubtotal, count: activeFamily === "CERAMIC" ? n(totals.sections_count, 0) : n(existingTotals?.ceramic?.count, 0) },
        swissvax: { ...(existingTotals?.swissvax ?? {}), subtotal_mxn: swissSubtotal, count: activeFamily === "SWISSVAX" ? n(totals.sections_count, 0) : n(existingTotals?.swissvax?.count, 0) },
        grand_total_mxn: ppfSubtotal + ceramicSubtotal + swissSubtotal + tintSubtotal,
      };

      await updateQuoteTotals({ quoteId, totals: nextTotals, warnings: existingTotals.warnings ?? [] });
      await listQuoteLineItems(quoteId);
      setOkMsg(itemsPayload.length ? `${activeFamily === "CERAMIC" ? "Ceramic" : "Swissvax"} saved.` : "Cleared.");
      onSaved?.(); onRefresh?.();
    } catch (e) {
      console.error("[CeramicBuilder.save]", e);
      setError(e?.message ?? "Failed to save.");
    } finally { setSaving(false); }
  }

  async function clearCurrentFamily() {
    setEnabledByFamily((p) => ({ ...(p || {}), [activeFamily]: initEnabled() }));
    setSlotsByFamily((p) => ({ ...(p || {}), [activeFamily]: initSlotsForFamily(activeFamily) }));
    if (activeFamily === "CERAMIC") setSpecialPaint(false);
    await saveCurrentFamily();
  }

  if (loading) return <div className="card"><div className="card-title">Coatings</div><div className="help">Loading…</div></div>;

  return (
    <div className="card">
      <style>{`
        .cb-head{ display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap; }
        .cb-summary{ border:1px solid rgba(255,255,255,.12); background: rgba(0,0,0,.18); border-radius:16px; padding:10px 12px; flex: 1; min-width: 250px; }
        .cb-sumrow{ display:flex; justify-content:space-between; gap:12px; margin:6px 0; }
        .cb-row{ display:flex; gap:14px; flex-wrap:wrap; align-items:center; margin-top:10px; }
        .cb-check{ display:flex; gap:10px; align-items:center; font-weight:900; cursor:pointer; }
        .cb-section{ margin-top:16px; border-top:1px solid rgba(255,255,255,.08); padding-top:14px; }
        .cb-section-title{ font-weight:950; margin-bottom:10px; display:flex; justify-content:space-between; gap:10px; align-items:center; }
        .cb-grid3{ display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap:10px; }
        .cb-miniCard{ border:1px solid rgba(255,255,255,.10); background: rgba(0,0,0,.18); border-radius:16px; padding:12px; }
        .cb-miniTitle{ font-weight:950; margin-bottom:8px; }
        .cb-desc{ font-size:12px; color: rgba(248,250,252,.70); margin-top:8px; line-height: 1.35; white-space: pre-wrap; }
        .input, select.input { width:100%; border-radius:14px; border:1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.25); padding:10px 12px; outline:none; font-size:14px; color:#f8fafc; }
        option { color: #141415; }
        .help { margin-top:6px; font-size:12px; color:#b8b8bf; }
        .cb-actions{ display:flex; gap:10px; flex-wrap:wrap; margin-top:14px; }
        .tabs { display:flex; gap:10px; flex-wrap:wrap; }
        .tab { border-radius:999px; border:1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); padding: 8px 12px; font-weight: 950; cursor: pointer; color: #f8fafc; line-height: 1; }
        .tab:hover { background: rgba(255,255,255,.10); }
        .tab.is-on { background:#f8fafc; color:#141415; }
        @media (max-width:900px){ .cb-grid3{ grid-template-columns: 1fr; } }
      `}</style>

      <div className="cb-head">
        <div>
          <div className="card-title" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span>Coatings</span>
            <div className="tabs">
              <button className={`tab ${activeFamily === "CERAMIC" ? "is-on" : ""}`} type="button" onClick={() => setActiveFamily("CERAMIC")}>Ceramic</button>
              <button className={`tab ${activeFamily === "SWISSVAX" ? "is-on" : ""}`} type="button" onClick={() => setActiveFamily("SWISSVAX")}>Swissvax</button>
            </div>
          </div>
          <div className="help">
            Pricing = <strong>(ml/volume × cost)</strong> → <strong>× multiplier</strong> → <strong>+ labor</strong> → <strong>× size/difficulty</strong>.
          </div>
        </div>

        <div className="cb-summary">
          <div className="cb-sumrow"><span className="muted">Subtotal (sell)</span><strong>{formatMxn(totals.subtotal_mxn)}</strong></div>
          <div className="cb-sumrow"><span className="muted">Pre-size</span><span>{formatMxn(totals.pre_size_sell_mxn)}</span></div>
          <div className="cb-sumrow"><span className="muted">Material sell</span><span>{formatMxn(totals.material_sell_mxn)}</span></div>
          <div className="cb-sumrow"><span className="muted">Labor sell</span><span>{formatMxn(totals.labor_sell_mxn)}</span></div>
          {activeFamily === "CERAMIC" && <div className="cb-sumrow"><span className="muted">Paint discount</span><span>{formatMxn(totals.discount_mxn)}</span></div>}
          <div className="cb-sumrow"><span className="muted">× size/difficulty</span><span>{sizeMult.toFixed(2)}</span></div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {okMsg && <div className="ok">{okMsg}</div>}

      {activeFamily === "CERAMIC" && (
        <div className="cb-row">
          <label className="cb-check">
            <input type="checkbox" checked={specialPaint} onChange={(e) => setSpecialPaint(e.target.checked)} />
            <span>Special paint (matte/special) — paint becomes matte-only</span>
          </label>
        </div>
      )}

      {SECTION_DEFS.map((section) => {
        const enabled = Boolean(enabledBySection?.[section.key]);
        const options = offersForSection(section);
        const slots = slotsBySection?.[section.key] ?? (activeFamily === "SWISSVAX" ? { base: "" } : { base: "", top1: "", top2: "" });
        const sec = sectionCalcs?.[section.key];
        const sectionSubtotal = enabled && sec?.anySelected ? n(sec.numbers.subtotal_mxn, 0) : 0;

        const slotDesc = (offerId) => {
          if (!offerId) return "None selected.";
          const offer = (offers || []).find((x) => (x.id ?? x.service_offer_id) === offerId) || null;
          const pid = offer?.protection_product_id ?? null;
          const product = pid ? productsById?.[pid] : null;
          const sys = pid ? sysByProductId?.[String(pid)] : null;
          const usedSurface = pickSurfaceUsed(offerId, section);

          const lines = [];
          if (product?.name) lines.push(`Product: ${product.name}`);
          lines.push(`Surface used: ${usedSurface}`);
          if (sys?.is_topcoat_only) lines.push("Flag: Topcoat-only");
          if (sys?.for_ppf_only) lines.push("Flag: PPF-only");

          const slotCalc = activeFamily === "SWISSVAX"
            ? sec?.slots_calc?.base
            : [sec?.slots_calc?.base, sec?.slots_calc?.top1, sec?.slots_calc?.top2].find((x) => x?.offer?.id === offerId) || null;

          if (slotCalc?.numbers) {
            const nn = slotCalc.numbers;
            lines.push("");
            lines.push(`Cost: ${formatMxn(n(nn.cost_mxn, 0))}`);
            lines.push(`Multiplier: × ${n(nn.multiplier_used, 1).toFixed(2)}`);
            lines.push(`Final: ${formatMxn(n(nn.final_price_mxn, 0))}`);
          }
          return lines.join("\n");
        };

        return (
          <div key={section.key} className="cb-section">
            <div className="cb-section-title">
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div>{section.title}</div>
                {!enabled ? (
                  <button type="button" className="tab" onClick={() => setEnabledByFamily((p) => ({ ...(p || {}), [activeFamily]: { ...(p?.[activeFamily] || {}), [section.key]: true } }))}>Add</button>
                ) : (
                  <button type="button" className="tab is-on" onClick={() => {
                    setEnabledByFamily((p) => ({ ...(p || {}), [activeFamily]: { ...(p?.[activeFamily] || {}), [section.key]: false } }));
                    setSlotsByFamily((p) => ({ ...(p || {}), [activeFamily]: { ...(p?.[activeFamily] || {}), [section.key]: activeFamily === "SWISSVAX" ? { base: "" } : { base: "", top1: "", top2: "" } } }));
                  }}>Remove</button>
                )}
              </div>
              <div className="muted">{formatMxn(sectionSubtotal)}</div>
            </div>

            {!enabled ? (
              <div className="help">Not included. Click “Add”.</div>
            ) : activeFamily === "SWISSVAX" ? (
              <div className="cb-miniCard">
                <div className="cb-miniTitle">Coat (Swissvax = 1 coat only)</div>
                <select className="input" value={slots.base || ""} onChange={(e) => setSlotsByFamily((p) => ({ ...(p || {}), [activeFamily]: { ...(p?.[activeFamily] || {}), [section.key]: { base: e.target.value } } }))}>
                  <option value="">None</option>
                  {options.map((o) => <option key={o.id} value={o.id}>{offerProductName(o)}</option>)}
                </select>
                <div className="cb-desc">{slotDesc(slots.base)}</div>
              </div>
            ) : (
              <>
                <div className="cb-grid3">
                  {[{ slot: "base", label: "Coat 1" }, { slot: "top1", label: "Coat 2" }, { slot: "top2", label: "Coat 3" }].map((col) => (
                    <div key={`${section.key}:${col.slot}`} className="cb-miniCard">
                      <div className="cb-miniTitle">{col.label}</div>
                      <select className="input" value={slots[col.slot] || ""} onChange={(e) => setSlotsByFamily((p) => ({ ...(p || {}), [activeFamily]: { ...(p?.[activeFamily] || {}), [section.key]: { ...(p?.[activeFamily]?.[section.key] || { base: "", top1: "", top2: "" }), [col.slot]: e.target.value } } }))}>
                        <option value="">None</option>
                        {options.map((o) => <option key={o.id} value={o.id}>{offerProductName(o)}</option>)}
                      </select>
                      <div className="cb-desc">{slotDesc(slots[col.slot])}</div>
                    </div>
                  ))}
                </div>
                {section.isPaint && <div className="help" style={{ marginTop: 10 }}>Ceramic paint discount applied automatically when 3 distinct products are selected.</div>}
              </>
            )}
          </div>
        );
      })}

      <div className="cb-actions">
        <button className="btn" type="button" onClick={clearCurrentFamily} disabled={saving}>No {activeFamily === "CERAMIC" ? "Ceramic" : "Swissvax"}</button>
        <button className="btn btn-primary" type="button" onClick={saveCurrentFamily} disabled={saving}>{saving ? "Saving…" : `Save ${activeFamily === "CERAMIC" ? "Ceramic" : "Swissvax"} to Quote`}</button>
      </div>
    </div>
  );
}