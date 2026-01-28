/**
 * Phase 1 PPF price computation (MXN only)
 *
 * area_in2 = width_in * length_in
 * area_waste_in2 = area_in2 * (1 + waste_pct)
 * raw_cost_mxn = area_waste_in2 * cost_per_in2_mxn
 * marked_up_mxn:
 *   clear: raw_cost_mxn * clear_multiplier
 *   matte: raw_cost_mxn * clear_multiplier * (1 + matte_uplift_pct)
 *   color/special: same as clear (Phase 1)
 * final_mxn = marked_up_mxn * size_difficulty_multiplier
 */

export function classifyFilmType(materialCode) {
  const mc = String(materialCode || "").toLowerCase();
  if (mc.includes("dynoshield")) return "clear";
  if (mc.includes("matte") || mc.includes("flat") || mc.startsWith("dynomatte")) return "matte";
  return "color_special";
}

function roundMoney(n) {
  // cents precision
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function computePpfLineItem({
  material_code,
  width_in,
  length_in,
  roll_sku_id,
  cost_per_in2_mxn,
  max_length_in,

  // rules
  waste_pct,
  clear_multiplier,
  matte_uplift_pct,

  // quote-level
  size_code,
  difficulty,
  size_difficulty_multiplier,
}) {
  const warnings = [];
  const errors = [];

  const w = Number(width_in);
  const l = Number(length_in);
  const cpp = Number(cost_per_in2_mxn);

  if (!material_code) errors.push("Missing material.");
  if (!roll_sku_id) errors.push("Missing roll selection.");
  if (!Number.isFinite(w) || w <= 0) errors.push("Width must be a positive number.");
  if (!Number.isFinite(l) || l <= 0) errors.push("Length must be a positive number.");
  if (!Number.isFinite(cpp) || cpp <= 0) errors.push("Invalid cost_per_in2_mxn.");
  if (!Number.isFinite(size_difficulty_multiplier) || size_difficulty_multiplier <= 0) errors.push("Missing size/difficulty multiplier.");

  if (Number.isFinite(max_length_in) && max_length_in != null && l > Number(max_length_in)) {
    errors.push(`Length (${l}) exceeds max_length_in (${max_length_in}).`);
  }

  const film_type = classifyFilmType(material_code);

  const area_in2 = w * l;
  const area_waste_in2 = area_in2 * (1 + Number(waste_pct || 0));
  const raw_cost_mxn = area_waste_in2 * cpp;

  let marked_up_mxn = raw_cost_mxn * Number(clear_multiplier || 1);

  if (film_type === "matte") {
    marked_up_mxn = marked_up_mxn * (1 + Number(matte_uplift_pct || 0));
  }

  const final_mxn = marked_up_mxn * Number(size_difficulty_multiplier || 1);

  // Round outputs for display / storage
  const calc = {
    film_type,
    area_in2: roundMoney(area_in2),
    area_waste_in2: roundMoney(area_waste_in2),
    raw_cost_mxn: roundMoney(raw_cost_mxn),
    marked_up_mxn: roundMoney(marked_up_mxn),
    size_difficulty_multiplier: Number(size_difficulty_multiplier),
    final_mxn: roundMoney(final_mxn),
    warnings,
    errors,
    rules: {
      waste_pct: Number(waste_pct || 0),
      clear_multiplier: Number(clear_multiplier || 1),
      matte_uplift_pct: Number(matte_uplift_pct || 0),
    },
    quote_inputs: { size_code, difficulty },
  };

  return calc;
}
