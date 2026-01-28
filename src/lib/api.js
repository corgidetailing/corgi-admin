// src/lib/api.js
import { supabase } from "./supabaseClient";

/* ----------------------------- small utilities ---------------------------- */

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.data)) return v.data;
  if (v && Array.isArray(v.rows)) return v.rows;
  if (v && Array.isArray(v.items)) return v.items;
  return [];
}

function uniq(arr) {
  return Array.from(new Set((arr ?? []).filter(Boolean)));
}

function throwSupabase(error, context = "Supabase error") {
  if (!error) return;
  const msg = error?.message || error?.error_description || error?.hint || JSON.stringify(error);
  throw new Error(`${context}: ${msg}`);
}

function isMissingTableOrView(error) {
  const msg = String(error?.message || "");
  return msg.includes("Could not find the table") || msg.includes("schema cache");
}

function isMissingColumn(error, colName) {
  const msg = String(error?.message || "").toLowerCase();
  if (!msg.includes("does not exist")) return false;
  if (!msg.includes("column")) return false;
  if (!colName) return true;
  const c = String(colName).toLowerCase();
  return msg.includes(`.${c}`) || msg.includes(` ${c} `) || msg.includes(`"${c}"`) || msg.includes(`'${c}'`);
}

async function requireUserId() {
  const { data, error } = await supabase.auth.getUser();
  throwSupabase(error, "Auth getUser failed");
  const uid = data?.user?.id;
  if (!uid) throw new Error("You must be logged in.");
  return uid;
}

async function tryRpc(names, args) {
  for (const fn of names) {
    const { data, error } = await supabase.rpc(fn, args);
    if (!error) return data;
  }
  return null;
}

async function safeFrom(table, queryFn, fallbackValue) {
  const q = queryFn(supabase.from(table));
  const { data, error } = await q;
  if (error) {
    if (isMissingTableOrView(error)) return fallbackValue;
    throwSupabase(error, `Failed query on ${table}`);
  }
  return data ?? fallbackValue;
}

/* --------------------------------- QUOTES -------------------------------- */

export async function createQuote({ ruleVersionId = null } = {}) {
  const createdBy = await requireUserId();

  const payload = {
    created_by: createdBy,
    rule_version_id: ruleVersionId,
    totals: {
      inputs: {},
      ppf: { subtotal_mxn: 0, count: 0 },
      ceramic: { subtotal_mxn: 0, count: 0 },
      swissvax: { subtotal_mxn: 0, count: 0 },
      tint: { subtotal_mxn: 0, count: 0 },
      grand_total_mxn: 0,
      warnings: [],
    },
    warnings: [],
  };

  const { data, error } = await supabase.from("quotes").insert(payload).select("*").single();
  throwSupabase(error, "Failed to create quote");
  return data;
}

export async function getQuoteById(quoteId) {
  if (!quoteId) throw new Error("getQuoteById: quoteId is required");

  const { data, error } = await supabase.from("quotes").select("*").eq("id", quoteId).single();
  throwSupabase(error, "Failed to load quote");
  return data;
}

export async function listRecentQuotes({ limit = 25 } = {}) {
  const lim = Math.max(1, Math.min(200, n(limit, 25)));

  const { data, error } = await supabase
    .from("quotes")
    .select("id, created_at, rule_version_id, totals, warnings")
    .order("created_at", { ascending: false })
    .limit(lim);

  throwSupabase(error, "Failed to list recent quotes");
  return data || [];
}

export async function updateQuoteTotals({ quoteId, totals, warnings = [] }) {
  if (!quoteId) throw new Error("updateQuoteTotals: quoteId is required");

  const patch = { totals: totals ?? {}, warnings: warnings ?? [] };

  const { data, error } = await supabase.from("quotes").update(patch).eq("id", quoteId).select("*").single();
  throwSupabase(error, "Failed to update quote totals");
  return data;
}

/* ----------------------------- QUOTE LINE ITEMS --------------------------- */

export async function listQuoteLineItems(quoteId) {
  if (!quoteId) throw new Error("listQuoteLineItems: quoteId is required");

  const { data, error } = await supabase
    .from("quote_line_items")
    .select("*")
    .eq("quote_id", quoteId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  throwSupabase(error, "Failed to list quote line items");
  return data || [];
}

async function replaceFamilyLineItems({ quoteId, family, items }) {
  if (!quoteId) throw new Error("replaceFamilyLineItems: quoteId is required");
  if (!family) throw new Error("replaceFamilyLineItems: family is required");

  const safeItems = Array.isArray(items) ? items : [];

  const del = await supabase.from("quote_line_items").delete().eq("quote_id", quoteId).eq("family", family);
  throwSupabase(del.error, `Failed to clear ${family} line items`);

  if (!safeItems.length) return [];

  const insertRows = safeItems.map((it, idx) => ({
    quote_id: quoteId,
    service_item_id: it.service_item_id ?? null,
    family,
    zone: it.zone,
    name: it.name,
    is_main: Boolean(it.is_main),
    is_standalone: Boolean(it.is_standalone),
    sort_order: n(it.sort_order, idx * 10),
    inputs: it.inputs ?? {},
    calc: it.calc ?? {},
  }));

  const ins = await supabase.from("quote_line_items").insert(insertRows).select("*");
  throwSupabase(ins.error, `Failed to insert ${family} line items`);
  return ins.data || [];
}

export async function replacePpfLineItems({ quoteId, items }) {
  return replaceFamilyLineItems({ quoteId, family: "PPF", items });
}

export async function replaceCeramicLineItems({ quoteId, items }) {
  return replaceFamilyLineItems({ quoteId, family: "CERAMIC", items });
}

export async function replaceSwissvaxLineItems({ quoteId, items }) {
  return replaceFamilyLineItems({ quoteId, family: "SWISSVAX", items });
}

/* ---------------------------------- PPF ---------------------------------- */

export async function getPpfPricingRule(ruleVersionId) {
  if (!ruleVersionId) return null;

  const rpc = await tryRpc(["get_ppf_pricing_rule", "ppf_get_pricing_rule", "get_ppf_rule"], {
    rule_version_id: ruleVersionId,
  });
  if (rpc) return rpc;

  const { data, error } = await supabase
    .from("ppf_pricing_rules")
    .select("*")
    .eq("rule_version_id", ruleVersionId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    if (isMissingTableOrView(error)) return null;
    throwSupabase(error, "Failed to load PPF pricing rule");
  }
  return (data && data[0]) || null;
}

export async function getPpfBundles(ruleVersionId) {
  if (!ruleVersionId) return [];

  const rpc = await tryRpc(["get_ppf_bundles", "list_ppf_bundles", "ppf_list_bundles"], {
    rule_version_id: ruleVersionId,
  });
  if (rpc) return asArray(rpc);

  const rows = await safeFrom(
    "ppf_bundles",
    (t) =>
      t.select("*")
        .eq("rule_version_id", ruleVersionId)
        .eq("active", true)
        .order("sort_order", { ascending: true }),
    []
  );
  return rows || [];
}

export async function getPpfBundlePricing(ruleVersionId) {
  if (!ruleVersionId) return [];

  const rpc = await tryRpc(["get_ppf_bundle_pricing", "list_ppf_bundle_pricing", "ppf_list_bundle_pricing"], {
    rule_version_id: ruleVersionId,
  });
  if (rpc) return asArray(rpc);

  const rows = await safeFrom("ppf_bundle_pricing", (t) => t.select("*").eq("rule_version_id", ruleVersionId), []);
  return rows || [];
}

/**
 * IMPORTANT FIX:
 * - do NOT filter `.active` because your roll_skus table doesn't have it
 * - return array of strings (material codes) because QuoteBuilder expects strings
 */
export async function getMaterialsForRuleVersion(ruleVersionId) {
  if (!ruleVersionId) return [];

  const tryTables = ["ppf_roll_skus", "roll_skus"];
  for (const table of tryTables) {
    const { data, error } = await supabase.from(table).select("material_code").eq("rule_version_id", ruleVersionId);
    if (!error) {
      const codes = uniq((data || []).map((r) => String(r.material_code || "").trim()).filter(Boolean));
      return codes.sort((a, b) => a.localeCompare(b));
    }
    if (!isMissingTableOrView(error)) throwSupabase(error, `Failed to load PPF materials (${table})`);
  }

  return [];
}

/**
 * IMPORTANT FIX:
 * QuoteBuilder expects: { widths: number[], skuByWidth: { [width]: skuRow } }
 */
export async function getWidthOptionsForMaterial(ruleVersionId, materialCode) {
  if (!ruleVersionId) throw new Error("getWidthOptionsForMaterial: ruleVersionId is required");
  if (!materialCode) return { widths: [], skuByWidth: {} };

  const tryTables = ["ppf_roll_skus", "roll_skus"];

  for (const table of tryTables) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("rule_version_id", ruleVersionId)
      .eq("material_code", materialCode);

    if (error) {
      if (isMissingTableOrView(error)) continue;
      throwSupabase(error, `Failed to load roll SKUs (${table})`);
    }

    const rows = data || [];

    // choose best row per width (prefer warning_only=false)
    const skuByWidth = {};
    for (const r of rows) {
      const w = n(r.width_in, NaN);
      if (!Number.isFinite(w)) continue;

      const cur = skuByWidth[w];
      if (!cur) {
        skuByWidth[w] = r;
        continue;
      }
      const curWarn = Boolean(cur.warning_only);
      const nextWarn = Boolean(r.warning_only);
      if (curWarn && !nextWarn) skuByWidth[w] = r;
    }

    const widths = Object.keys(skuByWidth)
      .map((k) => Number(k))
      .filter((x) => Number.isFinite(x))
      .sort((a, b) => a - b);

    return { widths, skuByWidth };
  }

  return { widths: [], skuByWidth: {} };
}

export async function listSizeDifficultyMultipliers(ruleVersionId) {
  if (!ruleVersionId) return [];

  const { data, error } = await supabase
    .from("size_difficulty_multipliers")
    .select("*")
    .eq("rule_version_id", ruleVersionId);

  if (error) {
    if (isMissingTableOrView(error)) return [];
    throwSupabase(error, "Failed to load size/difficulty multipliers");
  }
  return data || [];
}

export async function getPpfLaborRates(ruleVersionId) {
  if (!ruleVersionId) return [];

  const tryTables = ["ppf_labor_rates"];
  for (const table of tryTables) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("rule_version_id", ruleVersionId)
      .eq("active", true)
      .order("sort_order", { ascending: true });

    if (!error) return data || [];
    if (!isMissingTableOrView(error)) throwSupabase(error, `Failed to load PPF labor rates (${table})`);
  }

  return [];
}

/* -------------------------------- CERAMIC / SWISSVAX --------------------- */

export async function getCeramicPricingRule(ruleVersionId) {
  if (!ruleVersionId) return null;

  const { data, error } = await supabase
    .from("ceramic_pricing_rules")
    .select("*")
    .eq("rule_version_id", ruleVersionId)
    .order("updated_at", { ascending: false })
    .limit(1);

  throwSupabase(error, "Failed to load ceramic pricing rule");
  return (data && data[0]) || null;
}

export async function listCeramicSystems(ruleVersionId) {
  if (!ruleVersionId) return [];

  const { data, error } = await supabase
    .from("ceramic_systems")
    .select("*")
    .eq("rule_version_id", ruleVersionId)
    .eq("active", true)
    .order("name", { ascending: true });

  throwSupabase(error, "Failed to load ceramic systems");
  return data || [];
}

/**
 * NOTE: allow calling with or without ruleVersionId
 */
export async function listServiceOffersWithTemplate(ruleVersionId) {
  const args = ruleVersionId ? { rule_version_id: ruleVersionId } : {};

  const rpc = await tryRpc(["list_service_offers_with_template", "listServiceOffersWithTemplate"], args);
  if (rpc) return asArray(rpc);

  // fallback table-only: we don't have templates here, so we tag family by name
  const { data, error } = await supabase
    .from("service_offers")
    .select("id, display_name, pricing_model, sort_order, protection_product_id, active")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    if (isMissingTableOrView(error)) return [];
    throwSupabase(error, "Failed to load service offers (fallback)");
  }

  return (data || []).map((r) => {
    const dn = String(r.display_name || "").toLowerCase();
    const family = dn.includes("swissvax") ? "swissvax" : "ceramic";
    return {
      id: r.id,
      display_name: r.display_name,
      pricing_model: r.pricing_model,
      sort_order: r.sort_order,
      protection_product_id: r.protection_product_id ?? null,
      service_templates: { family, name: "" },
    };
  });
}

export async function getProductsByIds(ids) {
  const list = uniq((ids || []).filter(Boolean));
  if (!list.length) return [];

  const { data, error } = await supabase.from("products").select("*").in("id", list);
  throwSupabase(error, "Failed to load products");
  return data || [];
}

export async function listOfferSurfacesByOfferIds(offerIds) {
  const list = uniq((offerIds || []).filter(Boolean));
  if (!list.length) return [];

  const { data, error } = await supabase.from("offer_surfaces").select("*").in("service_offer_id", list);
  throwSupabase(error, "Failed to load offer surfaces");
  return data || [];
}

export async function listOfferUsageMlByOfferIds(offerIds) {
  const list = uniq((offerIds || []).filter(Boolean));
  if (!list.length) return [];

  const { data, error } = await supabase.from("offer_usage_ml").select("*").in("service_offer_id", list);
  throwSupabase(error, "Failed to load offer usage (ml)");
  return data || [];
}

export async function listOfferPricingBySizeByOfferIds(offerIds) {
  const list = uniq((offerIds || []).filter(Boolean));
  if (!list.length) return [];

  // some schemas do not have offer_pricing_by_size.active → retry without it
  const first = await supabase
    .from("offer_pricing_by_size")
    .select("*")
    .in("service_offer_id", list)
    .eq("active", true);

  if (!first.error) return first.data || [];

  if (isMissingColumn(first.error, "active")) {
    const retry = await supabase.from("offer_pricing_by_size").select("*").in("service_offer_id", list);
    throwSupabase(retry.error, "Failed to load offer pricing by size");
    return retry.data || [];
  }

  throwSupabase(first.error, "Failed to load offer pricing by size");
}
/* ----------------------------- PREP / TINT / ADDONS ---------------------- */

export async function listStandalonePrepPrices(ruleVersionId) {
  if (!ruleVersionId) return [];
  const { data, error } = await supabase
    .from("correction_standalone_prices")
    .select("*, correction_packages(*)")
    .eq("rule_version_id", ruleVersionId);
  
  if (error) { console.error("listStandalonePrepPrices", error); return []; }
  return data || [];
}

export async function listTintOptions(ruleVersionId) {
  if (!ruleVersionId) return [];
  // Fetch films and prices manually or via join if relations exist
  const { data: films } = await supabase
    .from("tint_films")
    .select("*")
    .eq("rule_version_id", ruleVersionId)
    .eq("active", true)
    .order("sort_order");

  if (!films?.length) return [];

  const { data: prices } = await supabase
    .from("tint_prices")
    .select("*")
    .in("tint_film_id", films.map(f => f.id));

  // Merge them for the UI
  return films.map(f => ({
    ...f,
    prices: prices.filter(p => p.tint_film_id === f.id)
  }));
}

export async function listAddons(ruleVersionId) {
  if (!ruleVersionId) return [];
  const { data, error } = await supabase
    .from("addons_catalog")
    .select("*")
    .eq("rule_version_id", ruleVersionId)
    .eq("active", true)
    .order("sort_order");

  if (error) return [];
  return data || [];
}

// Helpers to save line items
export async function replaceTintLineItems({ quoteId, items }) {
  // Assuming you have a generic replaceFamilyLineItems function in your api.js
  // If not, use the same logic as replacePpfLineItems but change family to 'TINT'
  return replaceFamilyLineItems({ quoteId, family: "TINT", items });
}

export async function replaceAddonLineItems({ quoteId, items }) {
  return replaceFamilyLineItems({ quoteId, family: "ADDON", items });
}

// NOTE: For Prep, we usually store it as a line item with family='PREP' or 'DET'
export async function savePrepLineItem({ quoteId, item }) {
  // Clear existing prep
  await supabase.from("quote_line_items").delete().eq("quote_id", quoteId).eq("family", "PREP");
  
  if (!item) return; // If clearing, stop here

  const { error } = await supabase.from("quote_line_items").insert({
    quote_id: quoteId,
    family: "PREP",
    zone: "EXTERIOR",
    name: item.name,
    is_main: false,
    inputs: item.inputs,
    calc: item.calc
  });
  if (error) throw error;
}
/* ----------------------------- STEP 3: PPF CALCULATOR --------------------- */

// 1. GET KITS (For the "Easy" Table)
export async function getPpfBundles(ruleVersionId) {
  if (!ruleVersionId) return [];
  
  // We fetch templates and their pricing in one go if possible, 
  // or just fetch templates and we will match pricing later.
  const { data, error } = await supabase
    .from("bundle_templates")
    .select(`
      *,
      ppf_bundle_pricing!inner(*) 
    `)
    .eq("rule_version_id", ruleVersionId)
    .eq("active", true)
    .eq("ppf_bundle_pricing.is_active", true)
    .order("code", { ascending: true });

  if (error) { console.error("getPpfBundles error", error); return []; }
  return data || [];
}

// 2. GET ROLL WIDTHS (For "Complex" Dropdown)
export async function getRollWidths(ruleVersionId, materialCode) {
  const { data } = await supabase
    .from("roll_skus")
    .select("width_in, max_length_in")
    .eq("rule_version_id", ruleVersionId)
    .eq("material_code", materialCode)
    .eq("is_active", true)
    .order("width_in", { ascending: true });
    
  return data || [];
}

// 3. THE CALCULATOR ENGINE (Calls your SQL function)
export async function calculatePpfPrice({ ruleVersionId, materialCode, width, length, hours, sizeCode, difficulty }) {
  const { data, error } = await supabase.rpc("ppf_calc_line_item", {
    p_rule_version_id: ruleVersionId,
    p_bundle_template_id: "00000000-0000-0000-0000-000000000000", // You might need a "Dummy" bundle ID for custom work, or update the SQL function to allow NULL
    p_material_code: materialCode,
    p_width_in: Number(width),
    p_length_in: Number(length),
    p_hours: Number(hours),
    p_size_code: sizeCode,
    p_difficulty: Number(difficulty)
  });

  if (error) throw error;
  return data; // Returns JSON with { final_price_mxn, cost_mxn, etc }
}