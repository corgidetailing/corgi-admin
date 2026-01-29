import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { replaceCeramicLineItems, updateQuoteTotals } from "../lib/api";

function n(v) { return Number(v) || 0; }
function formatMxn(x) { return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n(x)); }

export default function CeramicBuilderCard({ quote, sizeCode, difficulty, sizeDifficultyMultiplier, fixedFamily, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [packages, setPackages] = useState([]);
  const [saving, setSaving] = useState(false);
  
  const [activeTab, setActiveTab] = useState("PACKAGES"); 
  const [selectedPkgId, setSelectedPkgId] = useState(null);

  const [layers, setLayers] = useState({
    paint1: "", paint2: "", paint3: "",
    glass1: "", glass2: "",
    wheels: "", trim: "", leather: "", fabric: ""
  });

  const [multiplier, setMultiplier] = useState(5.0); 
  
  const estimates = { 
    paint: { S: 15, M: 25, L: 35, XL: 45 },
    glass: { S: 10, M: 15, L: 20, XL: 25 },
    wheels: { S: 10, M: 15, L: 20, XL: 25 },
    interior: { S: 20, M: 30, L: 40, XL: 50 }
  };

  useEffect(() => {
    async function load() {
      if(!quote?.rule_version_id) return;
      const { data: prods } = await supabase.from('products').select('*').in('brand', ['CarPro', 'STEK']).eq('active', true).order('name');
      const { data: pkgs } = await supabase.from('service_packages').select(`*, items:service_package_items(layer_type, service_offer:service_offers(display_name, protection_product_id))`).eq('family', 'CERAMIC').eq('rule_version_id', quote.rule_version_id).order('sort_order');
      setProducts(prods || []);
      setPackages(pkgs || []);
      setLoading(false);
    }
    load();
  }, [quote.rule_version_id]);

  function getUsage(type) {
    const est = estimates[type] || estimates.paint;
    return est[sizeCode] || 25;
  }

  function getDetailedPrice(productId, type = 'paint') {
    if (!productId) return { price: 0, cost: 0, margin: 0 };
    const prod = products.find(p => p.id === productId);
    if (!prod) return { price: 0, cost: 0, margin: 0 }; 
    const vol = n(prod.volume_ml);
    if (vol <= 0) return { price: 0, cost: 0, margin: 0 };
    const usage = getUsage(type);
    const costPerMl = n(prod.cost_mxn) / vol;
    const rawCost = usage * costPerMl;
    let finalPrice = Math.ceil((rawCost * multiplier * n(sizeDifficultyMultiplier)) / 50) * 50;
    return { price: finalPrice, cost: rawCost, margin: finalPrice - rawCost };
  }

  function getPackagePrice(pkg) {
    if(!pkg?.items) return 0;
    let total = 0;
    pkg.items.forEach(i => {
       const pid = i.service_offer?.protection_product_id;
       if(pid) {
         let type = 'paint';
         const lt = (i.layer_type||'').toUpperCase();
         if(lt.includes('GLASS')) type='glass';
         if(lt.includes('WHEELS')) type='wheels';
         total += getDetailedPrice(pid, type).price;
       }
    });
    return total;
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      const items = [];
      if (activeTab === "PACKAGES" && selectedPkgId) {
        const pkg = packages.find(p => p.id === selectedPkgId);
        if (pkg) {
           let totalP = 0, totalC = 0;
           if(pkg.items) {
             pkg.items.forEach(i => {
               const pid = i.service_offer?.protection_product_id;
               if(pid) {
                 const d = getDetailedPrice(pid, 'paint');
                 totalP += d.price; totalC += d.cost;
               }
             });
           }
           items.push({ zone: "EXTERIOR", name: `Package: ${pkg.name}`, is_main: true, calc: { numbers: { final_price_mxn: totalP }, breakdown: { material_cost: totalC, margin: totalP - totalC } } });
        }
      }
      if (activeTab === "BESPOKE") {
        const add = (pid, name, zone, type, isMain) => {
          if(!pid) return;
          const prod = products.find(p => p.id === pid);
          if(!prod) return;
          const d = getDetailedPrice(pid, type);
          items.push({ zone, name: `${name}: ${prod.name}`, is_main: isMain, calc: { numbers: { final_price_mxn: d.price }, breakdown: { material_cost: d.cost, margin: d.margin } } });
        };
        ['paint1', 'paint2', 'paint3'].forEach((k, i) => add(layers[k], `Paint Layer ${i+1}`, "EXTERIOR", 'paint', i===0));
        ['glass1', 'glass2'].forEach((k, i) => add(layers[k], `Glass Layer ${i+1}`, "EXTERIOR", 'glass'));
        add(layers.wheels, "Wheels", "EXTERIOR", 'wheels');
        add(layers.trim, "Plastics", "EXTERIOR", 'wheels');
        add(layers.leather, "Leather", "INTERIOR", 'interior');
        add(layers.fabric, "Fabric", "INTERIOR", 'interior');
      }
      await replaceCeramicLineItems({ quoteId: quote.id, items });
      if(onSaved) onSaved();
    } catch (e) {
      alert("Error saving: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const paintProds = products.filter(p => p.category === 'ceramic_coating');
  const glassProds = products.filter(p => p.category === 'glass_coating' || p.name.includes('Lite'));
  const wheelProds = products.filter(p => p.category === 'wheel_coating' || p.name.includes('Lite'));
  const interiorProds = products.filter(p => p.category === 'interior_coating');

  if (loading) return <div className="card">Loading Menu...</div>;
  if (fixedFamily === 'SWISSVAX') return null;

  // --- UI RENDER HELPERS ---
  const getUITotal = () => {
    if(activeTab === 'PACKAGES' && selectedPkgId) return getPackagePrice(packages.find(p=>p.id===selectedPkgId));
    return Object.entries(layers).reduce((sum, [key, pid]) => {
        let type = 'paint';
        if (key.includes('glass')) type = 'glass';
        if (key === 'wheels' || key === 'trim') type = 'wheels';
        if (key === 'leather' || key === 'fabric') type = 'interior';
        return sum + getDetailedPrice(pid, type).price;
    }, 0);
  };

  return (
    <div className="card">
      <style>{`
        /* 2x2 GRID FOR PACKAGES */
        .pkg-grid-2x2 { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        
        /* CLEAN BESPOKE LAYOUT */
        .h-section { margin-bottom: 25px; padding-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .h-section:last-child { border-bottom: none; }
        .h-title { font-size: 0.8em; text-transform: uppercase; color: #888; margin-bottom: 12px; letter-spacing: 1px; font-weight: 700; }
        
        .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }

        @media (max-width: 700px) {
          .pkg-grid-2x2, .grid-3, .grid-2 { grid-template-columns: 1fr; }
        }

        .pkg-item-list { font-size: 0.75em; color: #aaa; margin-top: 8px; line-height: 1.4; }
        .pkg-item-row { display: flex; justify-content: space-between; }
        .pkg-price { font-size: 1.1em; color: #4ade80; font-weight: 800; margin-top: 10px; text-align: right; }
      `}</style>

      <div className="card-title">
        Step 4: Ceramic Coating
        <div style={{opacity:0.7}}>{formatMxn(getUITotal())}</div>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === "PACKAGES" ? "active" : ""}`} onClick={() => setActiveTab("PACKAGES")}>Premade Kits</button>
        <button className={`tab ${activeTab === "BESPOKE" ? "active" : ""}`} onClick={() => setActiveTab("BESPOKE")}>Bespoke (Custom)</button>
      </div>

      <div style={{background: "rgba(255,255,255,0.03)", padding:20, borderRadius:12}}>
        
        {/* --- TAB 1: PACKAGES (2x2 Grid) --- */}
        {activeTab === "PACKAGES" && (
           <div className="pkg-grid-2x2">
             {packages.map(pkg => {
                const price = getPackagePrice(pkg);
                const isSelected = selectedPkgId === pkg.id;
                return (
                  <div key={pkg.id} onClick={() => setSelectedPkgId(isSelected ? null : pkg.id)}
                    style={{ 
                      border: isSelected ? '2px solid #fff' : '1px solid #444', 
                      background: isSelected ? '#222' : 'rgba(255,255,255,0.02)',
                      padding: 15, borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s ease'
                    }}>
                    <div style={{fontWeight:800, fontSize:'1.1em', marginBottom:4}}>{pkg.name}</div>
                    <div style={{fontSize:'0.85em', opacity:0.7, marginBottom:10}}>{pkg.description}</div>
                    
                    {/* CONTENTS LIST */}
                    <div className="pkg-item-list" style={{borderTop:'1px solid #333', paddingTop:8}}>
                       {pkg.items?.map((item, idx) => (
                         <div key={idx} className="pkg-item-row">
                           <span>• {item.service_offer?.display_name || 'Item'}</span>
                           <span style={{opacity:0.5}}>{item.layer_type}</span>
                         </div>
                       ))}
                    </div>

                    <div className="pkg-price">{formatMxn(price)}</div>
                  </div>
                );
             })}
           </div>
        )}

        {/* --- TAB 2: BESPOKE (Cleaner Layout) --- */}
        {activeTab === "BESPOKE" && (
          <div>
            {/* PAINT */}
            <div className="h-section">
              <div className="h-title">Paint Protection</div>
              <div className="grid-3">
                {['paint1', 'paint2', 'paint3'].map((k, i) => (
                  <div key={k}>
                    <label style={{fontSize:'0.75em', color:'#666', marginBottom:4, display:'block'}}>Layer {i+1}</label>
                    <select className="input" value={layers[k]} onChange={e => setLayers({...layers, [k]: e.target.value})}>
                      <option value="">— Select —</option>
                      {paintProds.map(p => {
                        const price = getDetailedPrice(p.id, 'paint').price;
                        return <option key={p.id} value={p.id}>{p.name} ({formatMxn(price)})</option>;
                      })}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* GLASS & WHEELS */}
            <div className="h-section">
              <div className="grid-2">
                <div>
                   <div className="h-title">Glass</div>
                   <div style={{display:'flex', flexDirection:'column', gap:10}}>
                     {['glass1', 'glass2'].map((k, i) => (
                       <div key={k}>
                         <select className="input" value={layers[k]} onChange={e => setLayers({...layers, [k]: e.target.value})}>
                           <option value="">— Select Layer {i+1} —</option>
                           {glassProds.map(p => {
                              const price = getDetailedPrice(p.id, 'glass').price;
                              return <option key={p.id} value={p.id}>{p.name} ({formatMxn(price)})</option>;
                           })}
                         </select>
                       </div>
                     ))}
                   </div>
                </div>
                <div>
                   <div className="h-title">Exterior Detail</div>
                   <div style={{display:'flex', flexDirection:'column', gap:10}}>
                     <div>
                       <select className="input" value={layers.wheels} onChange={e => setLayers({...layers, wheels: e.target.value})}>
                         <option value="">— Wheels —</option>
                         {wheelProds.map(p => {
                           const price = getDetailedPrice(p.id, 'wheels').price;
                           return <option key={p.id} value={p.id}>{p.name} ({formatMxn(price)})</option>;
                         })}
                       </select>
                     </div>
                     <div>
                       <select className="input" value={layers.trim} onChange={e => setLayers({...layers, trim: e.target.value})}>
                         <option value="">— Plastics / Trim —</option>
                         {wheelProds.map(p => {
                           const price = getDetailedPrice(p.id, 'wheels').price;
                           return <option key={p.id} value={p.id}>{p.name} ({formatMxn(price)})</option>;
                         })}
                       </select>
                     </div>
                   </div>
                </div>
              </div>
            </div>

            {/* INTERIOR */}
            <div className="h-section">
              <div className="h-title">Interior Surfaces</div>
              <div className="grid-2">
                 <div>
                   <select className="input" value={layers.leather} onChange={e => setLayers({...layers, leather: e.target.value})}>
                     <option value="">— Leather —</option>
                     {interiorProds.map(p => {
                       const price = getDetailedPrice(p.id, 'interior').price;
                       return <option key={p.id} value={p.id}>{p.name} ({formatMxn(price)})</option>;
                     })}
                   </select>
                 </div>
                 <div>
                   <select className="input" value={layers.fabric} onChange={e => setLayers({...layers, fabric: e.target.value})}>
                     <option value="">— Fabric —</option>
                     {interiorProds.map(p => {
                       const price = getDetailedPrice(p.id, 'interior').price;
                       return <option key={p.id} value={p.id}>{p.name} ({formatMxn(price)})</option>;
                     })}
                   </select>
                 </div>
              </div>
            </div>

          </div>
        )}
      </div>

      <button className="btn btn-primary" style={{marginTop:20}} onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save Ceramic"}
      </button>
    </div>
  );
}