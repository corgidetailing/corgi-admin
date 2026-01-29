import React, { useEffect, useState } from "react";
import { listAddons, replaceAddonLineItems } from "../lib/api";

export default function AddonBuilderCard({ quote, onSaved }) {
  const [catalog, setCatalog] = useState([]);
  const [selections, setSelections] = useState(new Set()); // Set of IDs

  useEffect(() => {
    if (quote?.rule_version_id) {
      listAddons(quote.rule_version_id).then(setCatalog);
    }
  }, [quote?.rule_version_id]);

  const toggle = (id) => {
    setSelections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    const items = [];
    for (const id of selections) {
      const item = catalog.find((x) => x.id === id);
      if (item) {
        items.push({
          zone: "OTHER",
          name: `Add-on: ${item.name}`,
          is_standalone: true,
          inputs: { addon_id: item.id },
          calc: { numbers: { final_price_mxn: item.base_price_mxn } },
        });
      }
    }
    await replaceAddonLineItems({ quoteId: quote.id, items });
    onSaved();
  };

  return (
    <div className="card">
      <div className="card-title">Step 7: Add-ons</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {catalog.map((item) => (
          <label key={item.id} className="rowLink" style={{ justifyContent: "flex-start" }}>
            <input
              type="checkbox"
              checked={selections.has(item.id)}
              onChange={() => toggle(item.id)}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{item.name}</div>
              <div className="mini">{item.category}</div>
            </div>
            <div style={{ fontWeight: 900 }}>
              ${Number(item.base_price_mxn).toLocaleString()}
            </div>
          </label>
        ))}
        {catalog.length === 0 && <div className="help">No add-ons found in catalog.</div>}
      </div>
      <button className="btn btn-primary" style={{ marginTop: 15 }} onClick={handleSave}>
        Save Add-ons
      </button>
    </div>
  );
}