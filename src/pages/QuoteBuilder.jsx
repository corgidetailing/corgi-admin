import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getQuoteById, listQuoteLineItems } from "../lib/api";

// Import Components
import VehicleInfoCard from "../components/VehicleInfoCard";
import PrepBuilderCard from "../components/PrepBuilderCard";
import PpfBuilderCard from "../components/PpfBuilderCard";
import CeramicBuilderCard from "../components/CeramicBuilderCard";
import SwissvaxBuilderCard from "../components/SwissvaxBuilderCard";
import TintBuilderCard from "../components/TintBuilderCard";
import AddonBuilderCard from "../components/AddonBuilderCard";

function formatMxn(n) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(n) || 0);
}
function n(v) { return Number(v) || 0; }

/* --- NEW: ACCORDION SUMMARY --- */
function FamilyAccordion({ label, items, showBreakdown }) {
  const [isOpen, setIsOpen] = useState(true);

  if (!items || items.length === 0) return null;

  const total = items.reduce((sum, i) => sum + n(i.calc?.numbers?.final_price_mxn), 0);

  return (
    <div style={{marginBottom: 10, border: '1px solid #333', borderRadius: 8, overflow: 'hidden'}}>
      {/* Header */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'rgba(255,255,255,0.05)', 
          padding: '12px 15px', 
          cursor: 'pointer',
          display: 'flex', 
          justifyContent: 'space-between',
          alignItems: 'center',
          fontWeight: 700
        }}
      >
        <div style={{display:'flex', gap:10}}>
          <span>{isOpen ? "▼" : "▶"}</span>
          <span>{label}</span>
          <span style={{fontSize:'0.8em', opacity:0.5, fontWeight:400, paddingTop:2}}>({items.length} items)</span>
        </div>
        <div>{formatMxn(total)}</div>
      </div>

      {/* Body */}
      {isOpen && (
        <div style={{background: 'rgba(0,0,0,0.2)'}}>
          <table className="table" style={{width:'100%', borderCollapse:'collapse'}}>
            <thead>
              <tr style={{fontSize:'0.75em', textTransform:'uppercase', color:'#666', borderBottom:'1px solid #333'}}>
                <th style={{textAlign:'left', padding:'8px 15px'}}>Service Item</th>
                {showBreakdown && <th style={{textAlign:'right', padding:8}}>Est. Cost</th>}
                {showBreakdown && <th style={{textAlign:'right', padding:8}}>Est. Margin</th>}
                <th style={{textAlign:'right', padding:'8px 15px'}}>Price</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} style={{borderBottom:'1px solid #222'}}>
                  <td style={{padding:'10px 15px'}}>
                    <div style={{fontWeight:500}}>{item.name}</div>
                    <div style={{fontSize:'0.8em', opacity:0.5}}>{item.zone}</div>
                  </td>
                  {showBreakdown && (
                    <td style={{textAlign:'right', padding:8, color:'#aaa', fontFamily:'monospace'}}>
                      ~{formatMxn(item.calc?.breakdown?.material_cost)}
                    </td>
                  )}
                  {showBreakdown && (
                    <td style={{textAlign:'right', padding:8, color:'#4ade80', fontFamily:'monospace'}}>
                      ~{formatMxn(item.calc?.breakdown?.margin)}
                    </td>
                  )}
                  <td style={{textAlign:'right', padding:'10px 15px', fontWeight:600}}>
                    {formatMxn(item.calc?.numbers?.final_price_mxn)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TotalsCard({ quote, items }) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  // Group items
  const groups = {
    PREP: items.filter(i => i.family === 'PREP'),
    PPF: items.filter(i => i.family === 'PPF'),
    CERAMIC: items.filter(i => i.family === 'CERAMIC'),
    SWISSVAX: items.filter(i => i.family === 'SWISSVAX'),
    TINT: items.filter(i => i.family === 'TINT'),
    ADDON: items.filter(i => i.family === 'ADDON'),
  };

  const grandTotal = items.reduce((sum, i) => sum + n(i.calc?.numbers?.final_price_mxn), 0);
  const totalCost = items.reduce((sum, i) => sum + n(i.calc?.breakdown?.material_cost), 0);
  const totalMargin = items.reduce((sum, i) => sum + n(i.calc?.breakdown?.margin), 0);

  return (
    <div className="card">
      <div className="card-title" style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <span>Quote Summary</span>
        <button 
          onClick={() => setShowBreakdown(!showBreakdown)}
          style={{
            fontSize:'12px', padding:'6px 12px', 
            background: showBreakdown ? '#333' : 'transparent', 
            border: '1px solid #444', 
            color: showBreakdown ? '#fff' : '#888', 
            borderRadius:'4px', cursor:'pointer'
          }}
        >
          {showBreakdown ? "Hide Costs" : "Show Costs"}
        </button>
      </div>

      <div style={{display:'flex', flexDirection:'column', gap:5}}>
        <FamilyAccordion label="Paint Prep" items={groups.PREP} showBreakdown={showBreakdown} />
        <FamilyAccordion label="PPF Services" items={groups.PPF} showBreakdown={showBreakdown} />
        <FamilyAccordion label="Ceramic Coating" items={groups.CERAMIC} showBreakdown={showBreakdown} />
        <FamilyAccordion label="Swissvax" items={groups.SWISSVAX} showBreakdown={showBreakdown} />
        <FamilyAccordion label="Window Tint" items={groups.TINT} showBreakdown={showBreakdown} />
        <FamilyAccordion label="Add-ons" items={groups.ADDON} showBreakdown={showBreakdown} />
      </div>

      <div style={{marginTop: 20, paddingTop: 15, borderTop: '2px solid #444', display:'flex', justifyContent:'flex-end', alignItems:'flex-end', flexDirection:'column'}}>
        {showBreakdown && (
          <div style={{display:'flex', gap:20, marginBottom:5, fontSize:'0.9em', opacity:0.8}}>
            <div>Total Est. Cost: <b>~{formatMxn(totalCost)}</b></div>
            <div>Total Est. Margin: <b style={{color:'#4ade80'}}>~{formatMxn(totalMargin)}</b></div>
          </div>
        )}
        <div style={{fontSize:'1.8em', fontWeight:900}}>
          {formatMxn(grandTotal)}
        </div>
      </div>
    </div>
  );
}

export default function QuoteBuilder() {
  const { quoteId } = useParams();
  const [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState(null);
  const [lineItems, setLineItems] = useState([]);
  const [step, setStep] = useState("INFO"); 

  const steps = [
    { key: "INFO", label: "1. Vehicle" },
    { key: "PREP", label: "2. Prep" },
    { key: "PPF", label: "3. PPF" },
    { key: "CERAMIC", label: "4. Ceramic" },
    { key: "SWISSVAX", label: "5. Swissvax" },
    { key: "TINT", label: "6. Tint" },
    { key: "ADDON", label: "7. Add-ons" },
    { key: "SUMMARY", label: "Summary" },
  ];

  async function loadData() {
    setLoading(true);
    try {
      const [q, items] = await Promise.all([ getQuoteById(quoteId), listQuoteLineItems(quoteId) ]);
      setQuote(q);
      setLineItems(items);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [quoteId]);

  const sizeCode = quote?.totals?.inputs?.size_code || "M";
  const diff = quote?.totals?.inputs?.difficulty || 1;
  const sizeMult = quote?.totals?.inputs?.size_difficulty_multiplier || 1;

  if (loading) return <div style={{padding:20}}>Loading...</div>;

  return (
    <div className="qb-page">
      <style>{`
        .qb-page { min-height:100vh; background:#141415; padding:20px; color:#f8fafc; font-family:system-ui; }
        .qb-wrap { max-width:1000px; margin:0 auto; }
        .tabs { display:flex; gap:8px; overflow-x:auto; padding-bottom:10px; margin-bottom:15px; border-bottom:1px solid #333; }
        .tab { background:transparent; border:none; color:#888; padding:8px 16px; font-weight:700; cursor:pointer; white-space:nowrap; border-radius:20px; }
        .tab:hover { background:rgba(255,255,255,0.05); color:#ddd; }
        .tab.active { background:#f8fafc; color:#111; }
        .card { background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:20px; margin-bottom:20px; }
        .card-title { font-size:18px; font-weight:800; margin-bottom:15px; }
        .input { width:100%; padding:10px; background:#222; border:1px solid #444; color:#fff; border-radius:8px; }
        .btn { padding:10px 20px; border-radius:8px; font-weight:700; cursor:pointer; border:none; background:#333; color:#fff; }
        .btn-primary { background:#fff; color:#000; }
        .help { fontSize: 0.8em; opacity: 0.6; }
      `}</style>

      <div className="qb-wrap">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
          <h1 style={{margin:0}}>Quote #{quote.id.slice(0,8)}</h1>
          <div className="card" style={{margin:0, padding:"5px 15px", display:"flex", gap:15}}>
             <span>Size: <b>{sizeCode}</b></span>
             <span>Diff: <b>{diff}</b></span>
          </div>
        </div>

        <div className="tabs">
          {steps.map(s => (
            <button key={s.key} className={`tab ${step === s.key ? "active" : ""}`} onClick={() => setStep(s.key)}>
              {s.label}
            </button>
          ))}
        </div>

        {step === "INFO" && <VehicleInfoCard quote={quote} onSaved={loadData} />}
        {step === "PREP" && <PrepBuilderCard quote={quote} sizeCode={sizeCode} onSaved={loadData} />}
        {step === "PPF" && <PpfBuilderCard quote={quote} sizeCode={sizeCode} difficulty={diff} sizeDifficultyMultiplier={sizeMult} onSaved={loadData} />}
        
        {step === "CERAMIC" && (
          <CeramicBuilderCard 
            quote={quote} 
            sizeCode={sizeCode} 
            difficulty={diff} 
            sizeDifficultyMultiplier={sizeMult}
            fixedFamily="CERAMIC" 
            onSaved={loadData} 
          />
        )}

        {step === "SWISSVAX" && (
          <SwissvaxBuilderCard 
            quote={quote} 
            sizeCode={sizeCode} 
            difficulty={diff} 
            sizeDifficultyMultiplier={sizeMult}
            onSaved={loadData} 
          />
        )}

        {step === "TINT" && <TintBuilderCard quote={quote} sizeCode={sizeCode} onSaved={loadData} />}
        {step === "ADDON" && <AddonBuilderCard quote={quote} onSaved={loadData} />}
        
        {step === "SUMMARY" && <TotalsCard quote={quote} items={lineItems} />}

      </div>
    </div>
  );
}