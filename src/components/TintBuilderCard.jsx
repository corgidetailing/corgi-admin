import React, { useEffect, useState } from "react";
import { listTintOptions, replaceTintLineItems, updateQuoteTotals, listQuoteLineItems } from "../lib/api";

const ZONES = [
  { code: 'FRONT_2', label: 'Front 2 Windows' },
  { code: 'FULL_CAR', label: 'Full Car (Sides + Rear)' },
  { code: 'WINDSHIELD', label: 'Windshield' },
  { code: 'SUNROOF', label: 'Sunroof' }
];

export default function TintBuilderCard({ quote, sizeCode, onSaved }) {
  const [films, setFilms] = useState([]);
  const [selections, setSelections] = useState({}); // { ZONE_CODE: { filmId, price } }

  useEffect(() => {
    if (quote?.rule_version_id) {
      listTintOptions(quote.rule_version_id).then(setFilms);
    }
  }, [quote?.rule_version_id]);

  const handleSelect = (zoneCode, filmId) => {
    if (!filmId) {
      const next = { ...selections };
      delete next[zoneCode];
      setSelections(next);
      return;
    }

    const film = films.find(f => f.id === filmId);
    const priceRow = film?.prices?.find(p => p.zone_code === zoneCode);
    
    // Pick price based on sizeCode (S, M, L, XL)
    const sizeKey = `price_${sizeCode.toLowerCase()}_mxn`;
    const price = priceRow ? Number(priceRow[sizeKey]) || 0 : 0;

    setSelections(prev => ({
      ...prev,
      [zoneCode]: { filmId, price, name: `${film.brand} ${film.name}` }
    }));
  };

  const handleSave = async () => {
    const items = Object.entries(selections).map(([zone, data]) => ({
      zone: "GLASS",
      name: `Tint: ${data.name} (${ZONES.find(z => z.code === zone)?.label})`,
      family: "TINT",
      is_standalone: true,
      inputs: { film_id: data.filmId, zone_code: zone },
      calc: { numbers: { final_price_mxn: data.price } }
    }));

    await replaceTintLineItems({ quoteId: quote.id, items });
    // IMPORTANT: You must call a function to recalculate totals here or in parent
    onSaved(); 
  };

  return (
    <div className="card">
      <div className="card-title">Step 6: Window Tint</div>
      <div className="grid2">
        {ZONES.map(zone => (
          <div key={zone.code} className="field">
            <label>{zone.label}</label>
            <select 
              className="input" 
              value={selections[zone.code]?.filmId || ""}
              onChange={(e) => handleSelect(zone.code, e.target.value)}
            >
              <option value="">None</option>
              {films.map(f => (
                <option key={f.id} value={f.id}>{f.brand} - {f.name}</option>
              ))}
            </select>
            {selections[zone.code] && (
              <div className="help">Price: ${selections[zone.code].price}</div>
            )}
          </div>
        ))}
      </div>
      <button className="btn btn-primary" style={{marginTop: 15}} onClick={handleSave}>
        Save Tint
      </button>
    </div>
  );
}