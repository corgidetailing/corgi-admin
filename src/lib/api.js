import { supabase } from "./supabaseClient";

/* =========================================================================
   1. UTILITIES & HELPERS
   ========================================================================= */

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function uniq(arr) {
  return Array.from(new Set((arr ?? []).filter(Boolean)));
}

function throwSupabase(error, context = "Supabase error") {
  if (!error) return;
  const msg = error?.message || error?.error_description || error?.hint || JSON.stringify(error);
  throw new Error(`${context}: ${msg}`);
}

/* =========================================================================
   2. CORE QUOTE FUNCTIONS (CRUD)
   ========================================================================= */

export async function createQuote({ ruleVersionId = null } = {}) {
  const { data: { user } } = await supabase.auth.getUser();
  const uid = user?.id;

  const payload = {
    created_by: uid,
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
  if (!quoteId) throw new Error("quoteId is required");
  const { data, error } = await supabase.from("quotes").select("*").eq("id", quoteId).single();
  throwSupabase(error, "Failed to load quote");
  return data;
}

export async function listRecentQuotes({ limit = 25 } = {}) {
  const { data, error } = await supabase
    .from("quotes")
    .select("id, client_name, created_at, rule_version_id, totals")
    .order("created_at", { ascending: false })
    .limit(limit);
  throwSupabase(error, "Failed to list recent quotes");
  return data || [];
}

export async function updateQuoteTotals({ quoteId, totals }) {
  const { data, error } = await supabase
    .from("quotes")
    .update({ totals })
    .eq("id", quoteId)
    .select()
    .single();
  throwSupabase(error, "Failed to update quote totals");
  return data;
}

export async function listQuoteLineItems(quoteId) {
  const { data, error } = await supabase
    .from("quote_line_items")
    .select("*")
    .eq("quote_id", quoteId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  throwSupabase(error, "Failed to list quote line items");
  return data || [];
}

/* =========================================================================
   3. DASHBOARD HELPERS
   ========================================================================= */

export async function getActiveRuleVersionId() {
  const { data, error } = await supabase
    .from("rule_versions")
    .select("id")
    .eq("is_active", true)
    .maybeSingle();
  if (error) { console.error("getActiveRuleVersionId error", error); return null; }
  return data?.id;
}

export async function createDraftQuote({ userId, ruleVersionId, vehicle, color, notes, size_code, difficulty, size_difficulty_multiplier }) {
  const payload = {
    created_by: userId,
    rule_version_id: ruleVersionId,
    status: 'DRAFT',
    client_name: vehicle || "New Quote", 
    vehicle_notes: [color, notes].filter(Boolean).join(" | "),
    totals: {
      inputs: { size_code, difficulty, size_difficulty_multiplier, color },
      ppf: { subtotal_mxn: 0, count: 0 },
      ceramic: { subtotal_mxn: 0, count: 0 },
      swissvax: { subtotal_mxn: 0, count: 0 },
      tint: { subtotal_mxn: 0, count: 0 },
      grand_total_mxn: 0,
      warnings: []
    }
  };

  const { data, error } = await supabase.from("quotes").insert(payload).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function listSizeDifficultyMultipliers(ruleVersionId) {
  const { data } = await supabase
    .from("size_difficulty_multipliers")
    .select("*")
    .eq("rule_version_id", ruleVersionId)
    .eq("is_active", true);
  return data || [];
}

/* =========================================================================
   4. STEP 2: PREP
   ========================================================================= */

export async function listStandalonePrepPrices(ruleVersionId) {
  if (!ruleVersionId) return [];
  // Try newer table first
  const { data, error } = await supabase
    .from("correction_standalone_prices")
    .select("*, correction_packages(*)")
    .eq("rule_version_id", ruleVersionId);
  
  if (!error && data) return data;

  // Fallback to older table
  const { data: fallback } = await supabase
    .from("prep_prices")
    .select("*, correction_packages(*)")
    .eq("rule_version_id", ruleVersionId)
    .eq("is_active", true)
    .order("price_mxn");
  return fallback || [];
}

export async function savePrepLineItem({ quoteId, item }) {
  await supabase.from("quote_line_items").delete().eq("quote_id", quoteId).eq("family", "PREP");
  if (item) {
    await supabase.from("quote_line_items").insert({
      quote_id: quoteId,
      family: "PREP",
      zone: "EXTERIOR",
      name: item.name,
      is_main: true,
      inputs: item.inputs,
      calc: item.calc,
      sort_order: 5
    });
  }
}

/* =========================================================================
   5. STEP 3: PPF (CALCULATOR & ROLLS)
   ========================================================================= */

export async function getPpfPricingRule(ruleVersionId) {
  const { data } = await supabase.from("ppf_pricing_rules").select("*").eq("rule_version_id", ruleVersionId).single();
  return data;
}

export async function getPpfBundles(ruleVersionId) {
  const { data } = await supabase
    .from("bundle_templates")
    .select(`*, ppf_bundle_pricing!inner(*)`)
    .eq("rule_version_id", ruleVersionId)
    .eq("family", "PPF")
    .eq("active", true)
    .order("sort_order");
  return data || [];
}

export async function getPpfBundlePricing(ruleVersionId) {
  const { data } = await supabase.from("ppf_bundle_pricing").select("*").eq("rule_version_id", ruleVersionId).eq("is_active", true);
  return data;
}

export async function getMaterialsForRuleVersion(ruleVersionId) {
  if (!ruleVersionId) return [];
  
  // 1. Try strict "ppf_roll_skus"
  let { data } = await supabase
    .from("ppf_roll_skus")
    .select("material_code")
    .eq("rule_version_id", ruleVersionId);

  // 2. If empty, try "roll_skus"
  if (!data || data.length === 0) {
     const { data: d2 } = await supabase
       .from("roll_skus")
       .select("material_code")
       .eq("rule_version_id", ruleVersionId);
     if (d2) data = d2;
  }

  // 3. If STILL empty, try ignore rule_version_id (Just get ANY material)
  if (!data || data.length === 0) {
     console.warn("Trying global material lookup...");
     const { data: d3 } = await supabase
       .from("ppf_roll_skus")
       .select("material_code")
       .limit(50);
     if (d3) data = d3;
  }

  // 4. Final attempt: 'roll_skus' global
  if (!data || data.length === 0) {
     const { data: d4 } = await supabase
       .from("roll_skus")
       .select("material_code")
       .limit(50);
     if (d4) data = d4;
  }

  if (!data) return [];

  // Deduplicate & Sort
  const codes = [...new Set(data.map(r => r.material_code).filter(Boolean))];
  return codes.sort();
}

export async function getRollSkusForMaterial({ ruleVersionId, materialCode }) {
  if (!ruleVersionId) throw new Error("getRollSkusForMaterial: ruleVersionId is required");
  
  const { data, error } = await supabase
    .from("roll_skus") 
    .select("*")
    .eq("rule_version_id", ruleVersionId)
    .eq("material_code", materialCode)
    .eq("is_active", true)
    .order("width_in", { ascending: true });

  if (error) {
    const { data: data2 } = await supabase
      .from("ppf_roll_skus")
      .select("*")
      .eq("rule_version_id", ruleVersionId)
      .eq("material_code", materialCode)
      .eq("is_active", true)
      .order("width_in", { ascending: true });
    return { selectable: data2 || [] };
  }
  
  return { selectable: data || [] };
}

export async function getRollWidths(ruleVersionId, materialCode) {
  const { data } = await supabase
    .from("ppf_roll_skus")
    .select("width_in, max_length_in")
    .eq("rule_version_id", ruleVersionId)
    .eq("material_code", materialCode)
    .eq("is_active", true)
    .order("width_in", { ascending: true });
    
  return data || [];
}

/* --- ROBUST WIDTH FINDER --- */
export async function getWidthOptionsForMaterial(ruleVersionId, materialCode) {
  // 1. Try strict lookup first (Best Case)
  let { data } = await supabase
    .from("ppf_roll_skus")
    .select("*")
    .eq("rule_version_id", ruleVersionId)
    .eq("material_code", materialCode)
    .order("width_in");

  // 2. If empty, try legacy table 'roll_skus'
  if (!data || data.length === 0) {
     const { data: d2 } = await supabase
       .from("roll_skus")
       .select("*")
       .eq("rule_version_id", ruleVersionId)
       .eq("material_code", materialCode)
       .order("width_in");
     if (d2) data = d2;
  }

  // 3. (THE FIX) If STILL empty, ignore rule_version_id and just find ANY width for this material
  // This fixes the "I see the material but no sizes" bug
  if (!data || data.length === 0) {
     console.warn(`No widths found for ${materialCode} in version ${ruleVersionId}. Trying global lookup...`);
     
     // Try global ppf_roll_skus
     const { data: d3 } = await supabase
       .from("ppf_roll_skus")
       .select("*")
       .eq("material_code", materialCode)
       .order("width_in");
       
     if (d3 && d3.length > 0) {
       data = d3;
     } else {
       // Try global roll_skus
       const { data: d4 } = await supabase
         .from("roll_skus")
         .select("*")
         .eq("material_code", materialCode)
         .order("width_in");
       if (d4) data = d4;
     }
  }

  if (!data) return { widths: [], skuByWidth: {} };

  // Deduplicate widths (in case global lookup returned duplicates)
  const skuByWidth = {};
  const uniqueWidths = new Set();
  
  data.forEach(r => { 
    const w = Number(r.width_in);
    if (!uniqueWidths.has(w)) {
      uniqueWidths.add(w);
      skuByWidth[w] = r;
    }
  });

  const widths = Array.from(uniqueWidths).sort((a,b) => a - b);
  
  return { widths, skuByWidth };
}

export async function calculatePpfPrice({ ruleVersionId, materialCode, width, length, hours, sizeCode, difficulty }) {
  const { data, error } = await supabase.rpc("ppf_calc_line_item", {
    p_rule_version_id: ruleVersionId,
    p_bundle_template_id: "00000000-0000-0000-0000-000000000000",
    p_material_code: materialCode,
    p_width_in: Number(width),
    p_length_in: Number(length),
    p_hours: Number(hours),
    p_size_code: sizeCode,
    p_difficulty: Number(difficulty)
  });
  if (error) throw error;
  return data; 
}

export async function replacePpfLineItems({ quoteId, items }) {
  await supabase.from("quote_line_items").delete().eq("quote_id", quoteId).eq("family", "PPF");
  if (items.length === 0) return;
  
  const toInsert = items.map((i, idx) => ({
    quote_id: quoteId,
    family: "PPF",
    zone: i.zone || "EXTERIOR",
    name: i.name,
    is_main: i.is_main,
    sort_order: i.sort_order || (10 + idx),
    inputs: i.inputs,
    calc: i.calc
  }));
  await supabase.from("quote_line_items").insert(toInsert);
}

/* =========================================================================
   6. CERAMIC, SWISSVAX, TINT & ADDONS (UNIVERSAL)
   ========================================================================= */

// 1. Fetch Packages (Deep Join)
export async function listServicePackages(ruleVersionId, family) {
  if (!ruleVersionId) return [];
  const { data } = await supabase
    .from("service_packages")
    .select(`
      *,
      items:service_package_items (
        layer_type,
        service_offer:service_offers (
          id, display_name, protection_product_id,
          product:products ( name, brand, cost_mxn, volume_ml )
        )
      )
    `)
    .eq("rule_version_id", ruleVersionId)
    .eq("family", family)
    .order("sort_order");
  return data || [];
}

// 2. Fetch Standalone Coatings (for Bespoke menus)
export async function listAvailableCoatings(ruleVersionId, typeLike) {
  const { data } = await supabase
    .from("service_offers")
    .select(`
      id, display_name, protection_type,
      product:products ( id, name, brand, cost_mxn, volume_ml )
    `)
    .eq("rule_version_id", ruleVersionId)
    .eq("active", true)
    .ilike("protection_type", `%${typeLike}%`);
  return data || [];
}

// 3. Estimates Helper
export async function getUsageEstimates(ruleVersionId) {
  return {
    ceramic: { S: 15, M: 25, L: 35, XL: 45 },
    wax: { S: 10, M: 15, L: 20, XL: 25 }
  };
}

// 4. Tint & Addons Lists
export async function listTintOptions(ruleVersionId) {
  if (!ruleVersionId) return [];
  const { data: films } = await supabase.from("tint_films").select("*").eq("rule_version_id", ruleVersionId).eq("active", true).order("sort_order");
  if (!films?.length) return [];
  
  const { data: prices } = await supabase.from("tint_prices").select("*").in("tint_film_id", films.map(f => f.id));
  
  return films.map(f => ({
    ...f,
    prices: prices.filter(p => p.tint_film_id === f.id)
  }));
}

export async function listAddons(ruleVersionId) {
  if (!ruleVersionId) return [];
  const { data } = await supabase.from("addons_catalog").select("*").eq("rule_version_id", ruleVersionId).eq("active", true).order("sort_order");
  return data || [];
}

export async function getPpfLaborRates(ruleVersionId) {
  const { data } = await supabase.from("ppf_labor_rates").select("*").eq("rule_version_id", ruleVersionId).eq("active", true);
  return data || [];
}

/* --- THE MASTER SAVE FUNCTION (FUTURE PROOF) --- */
export async function replaceStandardLineItems({ quoteId, family, items }) {
  if (!quoteId || !family) throw new Error("quoteId and family are required");

  // 1. Delete existing items
  const { error: delErr } = await supabase
    .from("quote_line_items")
    .delete()
    .eq("quote_id", quoteId)
    .eq("family", family);

  if (delErr) throw delErr;

  if (!items || items.length === 0) return;

  // 2. Insert new items
  const toInsert = items.map((item, idx) => ({
    quote_id: quoteId,
    family: family, 
    zone: item.zone || "EXTERIOR",
    name: item.name,
    is_main: Boolean(item.is_main),
    is_standalone: true, // Universal flag
    // Standardize JSON calc storage
    calc: item.calc || {},
    inputs: item.inputs || {},
    sort_order: (item.sort_order || 50) + idx
  }));

  const { error: insErr } = await supabase.from("quote_line_items").insert(toInsert);
  
  if (insErr) {
    console.error(`Error saving ${family}:`, insErr);
    throw insErr;
  }
}

// Aliases for component compatibility
export const replaceCeramicLineItems = (args) => replaceStandardLineItems({ ...args, family: "CERAMIC" });
export const replaceSwissvaxLineItems = (args) => replaceStandardLineItems({ ...args, family: "SWISSVAX" });
export const replaceTintLineItems = (args) => replaceStandardLineItems({ ...args, family: "TINT" });
export const replaceAddonLineItems = (args) => replaceStandardLineItems({ ...args, family: "ADDON" });