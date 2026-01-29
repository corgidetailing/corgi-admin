import React, { useEffect, useState } from "react";
import { listStandalonePrepPrices, savePrepLineItem, listQuoteLineItems } from "../lib/api";

function formatMxn(n) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n || 0);
}

export default function PrepBuilderCard({ quote, sizeCode, onSaved }) {
  const [options, setOptions] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [isExteriorIncluded, setIsExteriorIncluded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!quote?.rule_version_id || !sizeCode) return;
      
      const [rows, items] = await Promise.all([
        listStandalonePrepPrices(quote.rule_version_id),
        listQuoteLineItems(quote.id)
      ]);

      // 1. Check for Exterior Services (PPF, Ceramic, Swissvax)
      const hasExterior = items.some(i => 
        (i.family === 'PPF' && i.zone === 'EXTERIOR') || 
        (i.family === 'CERAMIC' && i.zone === 'EXTERIOR') || 
        (i.family === 'SWISSVAX' && i.zone === 'EXTERIOR')
      );
      setIsExteriorIncluded(hasExterior);

      // 2. Filter Prep Options
      const valid = rows.filter((r) => r.vehicle_size === sizeCode);
      setOptions(valid);
      
      // 3. Detect current selection
      const currentPrep = items.find(i => i.family === 'PREP');
      if (currentPrep) setSelectedId(currentPrep.inputs?.prep_price_id || "");
      
      setLoading(false);
    }
    load();
  }, [quote, sizeCode]);

  const handleSave = async () => {
    if (!selectedId) {
      await savePrepLineItem({ quoteId: quote.id, item: null });
    } else {
      const opt = options.find((o) => o.id === selectedId);
      if (opt) {
        // LOGIC: If 1-Step is selected AND Exterior is Included, Price is $0
        const isOneStep = opt.correction_packages?.level === 'one_step';
        const finalPrice = (isOneStep && isExteriorIncluded) ? 0 : opt.price_mxn;
        const nameSuffix = (isOneStep && isExteriorIncluded) ? " (Included with Exterior)" : "";

        await savePrepLineItem({
          quoteId: quote.id,
          item: {
            name: `Paint Prep: ${opt.correction_packages?.name}${nameSuffix}`,
            inputs: { prep_price_id: opt.id, correction_package_id: opt.correction_package_id },
            calc: { numbers: { final_price_mxn: finalPrice, original_price: opt.price_mxn } },
          },
        });
      }
    }
    onSaved();
  };

  if (loading) return <div className="card">Loading Prep...</div>;

  return (
    <div className="card">
      <div className="card-title">Step 2: Paint Correction</div>
      
      {isExteriorIncluded && (
        <div className="ok" style={{marginBottom:15, fontSize:13}}>
          <b>Exterior Service Detected:</b> 1-Step Polishing is included (Free).
        </div>
      )}

      <div className="field">
        <label>Correction Level ({sizeCode})</label>
        <select className="input" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          <option value="">None / Wash Only</option>
          {options.map((opt) => {
            const isOneStep = opt.correction_packages?.level === 'one_step';
            const priceDisplay = (isOneStep && isExteriorIncluded) 
              ? `${formatMxn(opt.price_mxn)} ➔ $0 (Included)` 
              : formatMxn(opt.price_mxn);
            
            return (
              <option key={opt.id} value={opt.id}>
                {opt.correction_packages?.name} — {priceDisplay}
              </option>
            );
          })}
        </select>
      </div>

      <button className="btn btn-primary" style={{ marginTop: 15 }} onClick={handleSave}>
        Save Prep
      </button>
    </div>
  );
}