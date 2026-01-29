import React, { useEffect, useState } from "react";
import { listAvailableCoatings, getUsageEstimates, replaceSwissvaxLineItems, updateQuoteTotals } from "../lib/api";

function n(v) { return Number(v) || 0; }
function formatMxn(n) { return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n || 0); }

export default function SwissvaxBuilderCard({ quote, sizeCode, difficulty, sizeDifficultyMultiplier, onSaved }) {
  const [waxes, setWaxes] = useState([]);
  const [selectedWaxId, setSelectedWaxId] = useState("");
  const [estimates, setEstimates] = useState({});
  const [multiplier, setMultiplier] = useState(4.0); // Higher margin for Swissvax

  useEffect(() => {
    if(!quote?.rule_version_id) return;
    Promise.all([
      listAvailableCoatings(quote.rule_version_id, "wax"),
      getUsageEstimates(quote.rule_version_id)
    ]).then(([prods, est]) => {
      setWaxes(prods || []);
      setEstimates(est?.wax || { S:10, M:15, L:20, XL:25 });
    });
  }, [quote]);

  const calcPrice = (prodId) => {
    const prod = waxes.find(p => p.id === prodId)?.product;
    if (!prod) return 0;
    const usage = estimates[sizeCode] || 15;
    const costPerMl = n(prod.cost_mxn) / n(prod.volume_ml);
    return Math.ceil((usage * costPerMl * multiplier * n(sizeDifficultyMultiplier)) / 100) * 100;
  };

  const handleSave = async () => {
    const items = [];
    if (selectedWaxId) {
      const wax = waxes.find(w => w.id === selectedWaxId);
      items.push({
        family: "SWISSVAX", zone: "EXTERIOR",
        name: `Swissvax: ${wax.display_name}`,
        is_main: true, is_standalone: true,
        calc: { numbers: { final_price_mxn: calcPrice(selectedWaxId) } }
      });
    }

    await replaceSwissvaxLineItems({ quoteId: quote.id, items });
    
    // Update Totals
    const subtotal = items.reduce((sum, i) => sum + n(i.calc?.numbers?.final_price_mxn), 0);
    const existing = quote.totals || {};
    await updateQuoteTotals({ 
      quoteId: quote.id, 
      totals: { ...existing, swissvax: { subtotal_mxn: subtotal, count: items.length } } 
    });
    
    onSaved();
  };

  return (
    <div className="card">
      <div className="card-title">Step 5: Swissvax</div>
      <div style={{background: "rgba(255,255,255,0.03)", padding:15, borderRadius:12}}>
        <div className="field">
          <label>Select Wax</label>
          <div style={{display:'flex', gap:10}}>
            <select className="input" value={selectedWaxId} onChange={e => setSelectedWaxId(e.target.value)}>
              <option value="">None</option>
              {waxes.map(w => <option key={w.id} value={w.id}>{w.display_name}</option>)}
            </select>
            <div style={{minWidth:100, paddingTop:10, fontWeight:700}}>
              {selectedWaxId ? formatMxn(calcPrice(selectedWaxId)) : "$0"}
            </div>
          </div>
        </div>
      </div>
      <button className="btn btn-primary" style={{marginTop:15}} onClick={handleSave}>Save Swissvax</button>
    </div>
  );
}