import React, { useEffect, useState } from "react";
import {
  getPpfPricingRule,
  getPpfBundles,
  getPpfBundlePricing,
  getMaterialsForRuleVersion,
  getWidthOptionsForMaterial,
  replacePpfLineItems,
  listQuoteLineItems,
  updateQuoteTotals,
} from "../lib/api";
import { computePpfLineItem } from "../lib/ppfPricing";

/* --- Helpers --- */
function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function normalizeMultiplier(v) {
  const x = n(v, 1);
  return x > 10 ? x / 100 : x;
}

function formatMxn(x) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n(x));
}

function makeLocalId() {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// DEFINED FILM OPTIONS
const FILM_TYPES = [
  { label: "Shield (Gloss)", code: "DYNOshield", upliftKey: "none" },
  { label: "Matte (Satin)", code: "DYNOmatte", upliftKey: "matte" },
  { label: "Flat (Matte)", code: "DYNOmatte-flat", upliftKey: "flat" },
];

export default function PpfBuilderCard({ quote, sizeCode, difficulty, sizeDifficultyMultiplier, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Data from API
  const [ppfRule, setPpfRule] = useState(null);
  const [bundles, setBundles] = useState([]);
  const [pricingRows, setPricingRows] = useState([]);
  const [materials, setMaterials] = useState([]);

  const [mode, setMode] = useState("KITS"); // "KITS" | "CUSTOM"

  // --- STATE: TAB 1 (KITS) ---
  const [masterFilm, setMasterFilm] = useState(FILM_TYPES[0]); 
  const [selectedKitsMap, setSelectedKitsMap] = useState({}); // { bundleId: filmCode }

  // --- STATE: TAB 2 (CUSTOM) ---
  const [draftItems, setDraftItems] = useState([]);
  const [customMaterial, setCustomMaterial] = useState("");
  const [customWidthIn, setCustomWidthIn] = useState("");
  const [customLengthIn, setCustomLengthIn] = useState("");
  const [customHours, setCustomHours] = useState("");
  const [customName, setCustomName] = useState("");
  
  // Dropdown options
  const [widths, setWidths] = useState([]);
  const [skuByWidth, setSkuByWidth] = useState({});

  const ruleVersionId = quote?.rule_version_id;
  const sizeMult = normalizeMultiplier(sizeDifficultyMultiplier);

  // --- LOAD DATA ---
  useEffect(() => {
    if (!ruleVersionId) return;
    setLoading(true);

    Promise.all([
      getPpfPricingRule(ruleVersionId),
      getPpfBundles(ruleVersionId),
      getPpfBundlePricing(ruleVersionId),
      getMaterialsForRuleVersion(ruleVersionId),
      listQuoteLineItems(quote.id)
    ]).then(([rule, bs, prices, mats, items]) => {
      console.log("Loaded Materials:", mats); // DEBUG LOG
      setPpfRule(rule);
      setBundles(bs || []);
      setPricingRows(prices || []);
      setMaterials(mats || []);
      
      // Select first material default IMMEDIATELY
      if (mats && mats.length > 0) {
        setCustomMaterial(mats[0]);
      } else {
        console.warn("No materials returned from API.");
      }

      // Hydrate Existing Items
      const existing = (items || []).filter(i => i.family === "PPF");
      const newKitMap = {};
      const newDrafts = [];

      existing.forEach(li => {
        if (li.inputs?.mode === "KIT_FIXED") {
          newKitMap[li.inputs.bundle_template_id] = li.inputs.film_type || "DYNOshield";
        } else {
          newDrafts.push({
            id: li.id,
            _localId: li.id,
            name: li.name,
            zone: li.zone,
            material_code: li.inputs?.material_code,
            width_in: li.inputs?.width_in,
            length_in: li.inputs?.length_in,
            calc: li.calc
          });
        }
      });

      setSelectedKitsMap(newKitMap);
      setDraftItems(newDrafts);
      
      if (newDrafts.length > 0 && Object.keys(newKitMap).length === 0) {
        setMode("CUSTOM");
      }
      
      setLoading(false);
    }).catch(e => {
      console.error("PPF Load Error:", e);
      setLoading(false);
    });
  }, [ruleVersionId, quote.id]);

  // --- PRICING LOGIC ---
  function getKitPrice(bundleId, filmCode) {
    const bundlePriceRow = pricingRows.find(r => r.bundle_template_id === bundleId);
    if (!bundlePriceRow) return 0;

    const base = n(bundlePriceRow.base_price_mxn, 0);
    if (base <= 0) return 0; 

    let total = base * sizeMult;
    const fType = FILM_TYPES.find(f => f.code === filmCode) || FILM_TYPES[0];
    let uplift = 1.0;
    if (fType.upliftKey === "matte") uplift += n(ppfRule?.matte_uplift_pct, 0.15);
    if (fType.upliftKey === "flat") uplift += n(ppfRule?.flat_uplift_pct, 0.20);
    
    return total * uplift;
  }

  const toggleKit = (bundleId) => {
    setSelectedKitsMap(prev => {
      const next = { ...prev };
      if (next[bundleId]) {
        delete next[bundleId];
      } else {
        next[bundleId] = masterFilm.code;
      }
      return next;
    });
  };

  // --- ACTIONS: CUSTOM ---
  useEffect(() => {
    if (!ruleVersionId || !customMaterial) {
      setWidths([]); setSkuByWidth({}); return;
    }
    getWidthOptionsForMaterial(ruleVersionId, customMaterial).then(({ widths: w, skuByWidth: map }) => {
      setWidths(w || []);
      setSkuByWidth(map || {});
      if (w.length > 0 && (!customWidthIn || !w.includes(n(customWidthIn)))) {
        setCustomWidthIn(String(w[0]));
      }
    });
  }, [ruleVersionId, customMaterial]);

  const onPreFillTemplate = (e) => {
    const bId = e.target.value;
    if (!bId) return;
    const b = bundles.find(x => x.id === bId);
    if (b) {
      setCustomName(b.name);
      setCustomLengthIn(b.default_length_in ? String(b.default_length_in) : "");
    }
  };

  const onAddCustom = () => {
    if(!customWidthIn || !customMaterial) return alert("Please select material and width");

    const sku = skuByWidth[n(customWidthIn)];
    // Fallback if SKU not found (allow manual entry effectively)
    const costPerSq = sku ? sku.cost_per_in2_mxn : 0;
    
    const calc = computePpfLineItem({
      material_code: customMaterial,
      width_in: customWidthIn,
      length_in: customLengthIn,
      roll_sku_id: sku ? sku.id : null,
      cost_per_in2_mxn: costPerSq,
      waste_pct: ppfRule?.waste_pct,
      clear_multiplier: ppfRule?.clear_multiplier,
      matte_uplift_pct: ppfRule?.matte_uplift_pct,
      size_code: sizeCode,
      difficulty: difficulty,
      size_difficulty_multiplier: sizeMult
    });

    const laborCost = n(customHours) * 500; 
    calc.final_mxn += laborCost;
    calc.breakdown = {
      material_cost: calc.cost_mxn,
      labor_cost: laborCost,
      margin: calc.final_mxn - (calc.cost_mxn + laborCost)
    };

    setDraftItems([...draftItems, {
      _localId: makeLocalId(),
      name: customName || "Custom PPF",
      zone: "CUSTOM",
      material_code: customMaterial,
      width_in: customWidthIn,
      length_in: customLengthIn,
      calc
    }]);
    
    setCustomName("");
    setCustomLengthIn("");
    setCustomHours("");
  };

  const removeDraft = (id) => {
    setDraftItems(prev => prev.filter(x => x._localId !== id));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const items = [];
      // KITS
      for (const [bId, filmCode] of Object.entries(selectedKitsMap)) {
        const bundle = bundles.find(b => b.id === bId);
        if (!bundle) continue;
        const price = getKitPrice(bId, filmCode);
        const filmLabel = FILM_TYPES.find(f => f.code === filmCode)?.label || filmCode;
        const estimatedCost = price * 0.25;

        items.push({
          family: "PPF",
          zone: "EXTERIOR",
          name: `${bundle.name} (${filmLabel})`,
          is_main: true,
          sort_order: bundle.sort_order || 10,
          inputs: { mode: "KIT_FIXED", bundle_template_id: bId, film_type: filmCode, size_code: sizeCode },
          calc: { numbers: { final_price_mxn: price }, breakdown: { material_cost: estimatedCost, margin: price - estimatedCost } }
        });
      }
      // CUSTOM
      for (const d of draftItems) {
        items.push({
          family: "PPF",
          zone: d.zone,
          name: d.name,
          is_main: false,
          sort_order: 100,
          inputs: { mode: "CUSTOM_CALC", material_code: d.material_code, width_in: d.width_in, length_in: d.length_in },
          calc: { numbers: { final_price_mxn: d.calc.final_mxn }, breakdown: d.calc.breakdown }
        });
      }

      await replacePpfLineItems({ quoteId: quote.id, items });
      const total = items.reduce((sum, i) => sum + n(i.calc?.numbers?.final_price_mxn), 0);
      await updateQuoteTotals({ quoteId: quote.id, totals: { ...quote.totals, ppf: { subtotal_mxn: total, count: items.length } } });

      if (onSaved) onSaved();
    } catch(e) {
      alert("Error saving PPF: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const kitSubtotal = Object.entries(selectedKitsMap).reduce((sum, [bId, filmCode]) => sum + getKitPrice(bId, filmCode), 0);
  const customSubtotal = draftItems.reduce((sum, i) => sum + n(i.calc?.final_mxn), 0);
  const grandSubtotal = kitSubtotal + customSubtotal;

  if (loading) return <div className="card">Loading PPF Data...</div>;

  return (
    <div className="card">
      <style>{`
        .ppf-tabs { display:flex; gap:10px; margin-bottom:15px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:10px; }
        .ppf-tab { background:transparent; border:none; color:#888; padding:8px 16px; cursor:pointer; font-weight:700; border-radius:20px; transition: all 0.2s; }
        .ppf-tab.active { background:#f8fafc; color:#141415; }
        .film-toggle { display:grid; grid-template-columns: 1fr 1fr 1fr; background:#222; border-radius:8px; padding:4px; gap:4px; margin-bottom:15px; border:1px solid #444; }
        .film-opt { text-align:center; padding:10px; font-size:13px; font-weight:700; cursor:pointer; border-radius:6px; color:#888; transition:all 0.2s; }
        .film-opt.active { background:#444; color:#fff; border:1px solid #666; box-shadow: 0 2px 4px rgba(0,0,0,0.3); }
        .kit-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:12px; }
        .kit-btn { text-align:left; background:rgba(255,255,255,0.03); border:1px solid #444; padding:15px; border-radius:10px; cursor:pointer; transition:all 0.1s; position: relative; }
        .kit-btn:hover { border-color:#888; background:rgba(255,255,255,0.05); }
        .kit-btn.selected { background: #222; border: 2px solid #4ade80; }
        .kit-btn.selected .kit-price { color: #4ade80; }
        .kit-price { font-weight:900; font-size:1.1em; margin-top:6px; color: #fff; }
        .kit-film-tag { font-size: 10px; background: #4ade80; color: #000; padding: 2px 6px; border-radius: 4px; display: inline-block; font-weight: 800; margin-top: 6px; text-transform: uppercase; }
        .rowLink { display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 8px; margin-bottom: 8px; border: 1px solid #333; }
        .mini { font-size: 0.8em; opacity: 0.6; }
      `}</style>

      <div className="card-title">
        Step 3: PPF Protection
        <div style={{opacity:0.7}}>{formatMxn(grandSubtotal)}</div>
      </div>

      <div className="ppf-tabs">
        <button className={`ppf-tab ${mode === "KITS" ? "active" : ""}`} onClick={() => setMode("KITS")}>Standard Kits</button>
        <button className={`ppf-tab ${mode === "CUSTOM" ? "active" : ""}`} onClick={() => setMode("CUSTOM")}>Custom / Rolls</button>
      </div>

      {mode === "KITS" && (
        <div>
          <div className="film-toggle">
            {FILM_TYPES.map(f => (
              <div 
                key={f.code} 
                className={`film-opt ${masterFilm.code === f.code ? "active" : ""}`}
                onClick={() => setMasterFilm(f)}
              >
                {f.label}
              </div>
            ))}
          </div>
          <div className="kit-grid">
            {bundles.map(b => {
              const selectedFilm = selectedKitsMap[b.id];
              const isSelected = Boolean(selectedFilm);
              const filmToCalc = selectedFilm || masterFilm.code;
              const price = getKitPrice(b.id, filmToCalc);
              const filmLabel = FILM_TYPES.find(f => f.code === filmToCalc)?.label?.split(' ')?.[0] || "Shield";
              return (
                <div key={b.id} className={`kit-btn ${isSelected ? "selected" : ""}`} onClick={() => toggleKit(b.id)}>
                  <div style={{fontSize:14, fontWeight:800}}>{b.name}</div>
                  <div className="kit-price">{price > 0 ? formatMxn(price) : "$-"}</div>
                  {isSelected && <div className="kit-film-tag">✓ {filmLabel}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mode === "CUSTOM" && (
        <div style={{background:"rgba(255,255,255,0.03)", padding:15, borderRadius:12}}>
          {materials.length === 0 && <div className="help" style={{color:'red'}}>No materials found in database.</div>}
          <div className="field" style={{marginBottom:15}}>
            <label>Template (Optional)</label>
            <select className="input" onChange={onPreFillTemplate} defaultValue="">
              <option value="" disabled>Select to pre-fill...</option>
              {bundles.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="grid2">
            <div className="field">
              <label>Name</label>
              <input className="input" value={customName} onChange={e => setCustomName(e.target.value)} placeholder="e.g. Rocker Panels" />
            </div>
            <div className="field">
              <label>Material</label>
              <select className="input" value={customMaterial} onChange={e => setCustomMaterial(e.target.value)}>
                {materials.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div className="grid2" style={{marginTop:10}}>
            <div className="field">
              <label>Roll Width</label>
              <select className="input" value={customWidthIn} onChange={e => setCustomWidthIn(e.target.value)}>
                {widths.map(w => <option key={w} value={w}>{w} inches</option>)}
              </select>
            </div>
            <div className="field">
              <label>Length (inches)</label>
              <input className="input" type="number" value={customLengthIn} onChange={e => setCustomLengthIn(e.target.value)} placeholder="0" />
            </div>
            <div className="field">
              <label>Install Hours</label>
              <input className="input" type="number" value={customHours} onChange={e => setCustomHours(e.target.value)} placeholder="0" />
            </div>
          </div>
          <button className="btn" style={{marginTop:15, width:"100%", fontWeight:700, background:"#444"}} onClick={onAddCustom}>+ Add to List</button>
          
          <div style={{marginTop:20}}>
            <h4 style={{borderBottom:'1px solid #444', paddingBottom:5, marginBottom:10, color:'#888'}}>Custom Items</h4>
            {draftItems.map(item => (
              <div key={item._localId} className="rowLink">
                <div>
                  <div style={{fontWeight:700}}>{item.name}</div>
                  <div className="mini">{item.material_code} • {item.width_in}" × {item.length_in}" {item.calc?.breakdown?.labor_cost > 0 && ` • +Labor`}</div>
                </div>
                <div style={{display:'flex', gap:10, alignItems:'center'}}>
                  <div style={{fontWeight:700, color:'#4ade80'}}>{formatMxn(item.calc?.final_mxn)}</div>
                  <button className="btn" style={{padding:"4px 8px", background:'#333'}} onClick={() => removeDraft(item._localId)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button className="btn btn-primary" style={{marginTop:20}} onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save PPF Selection"}
      </button>
    </div>
  );
}