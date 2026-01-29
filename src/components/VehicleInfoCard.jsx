import React, { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { listSizeDifficultyMultipliers } from "../lib/api";

export default function VehicleInfoCard({ quote, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    client_name: quote.client_name || "",
    vehicle_notes: quote.vehicle_notes || "",
    size_code: quote.totals?.inputs?.size_code || "M",
    difficulty: quote.totals?.inputs?.difficulty || 1
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      // 1. Fetch the correct multiplier for the selected Size/Difficulty
      // This ensures we don't get stuck with an old multiplier (like 1.1 for M)
      const multipliers = await listSizeDifficultyMultipliers(quote.rule_version_id);
      
      const match = multipliers.find(
        m => m.size_code === formData.size_code && 
             Number(m.difficulty) === Number(formData.difficulty)
      );
      
      // Default to 1.0 if not found, but we expect to find it
      const newMultiplier = match ? Number(match.multiplier) : 1.0;

      // 2. Update columns (Text fields)
      await supabase.from("quotes").update({
        client_name: formData.client_name,
        vehicle_notes: formData.vehicle_notes
      }).eq("id", quote.id);

      // 3. Update JSON inputs (CRITICAL: Include size_difficulty_multiplier)
      const newTotals = {
        ...quote.totals,
        inputs: {
          ...quote.totals.inputs,
          size_code: formData.size_code,
          difficulty: Number(formData.difficulty),
          size_difficulty_multiplier: newMultiplier // <--- This fixes the math
        }
      };
      
      await supabase.from("quotes").update({ totals: newTotals }).eq("id", quote.id);
      
      setEditing(false);
      onSaved(); // Refresh parent to apply new math
    } catch (e) {
      console.error("Failed to update vehicle info", e);
      alert("Failed to save changes. Check console.");
    } finally {
      setSaving(false);
    }
  };

  // Helper to format the displayed multiplier
  const currentMult = quote.totals?.inputs?.size_difficulty_multiplier || 1;

  if (!editing) {
    return (
      <div className="card">
        <div className="card-title">
          Step 1: Vehicle Details
          <button className="btn" style={{padding:"4px 12px", fontSize:12}} onClick={() => setEditing(true)}>Edit</button>
        </div>
        <div className="grid2">
          <div>
            <div className="help">Client / Vehicle</div>
            <div style={{fontWeight:800, fontSize:16}}>{quote.client_name || "—"}</div>
            <div className="mini">{quote.vehicle_notes}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div className="help">Configuration</div>
            <div>Size: <b>{quote.totals?.inputs?.size_code}</b></div>
            <div>Difficulty: <b>{quote.totals?.inputs?.difficulty}</b></div>
            <div className="mini" style={{opacity:0.6}}>Multiplier: ×{currentMult.toFixed(2)}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">Edit Vehicle</div>
      <div className="grid2">
        <div className="field">
          <label>Vehicle Name / Client</label>
          <input className="input" value={formData.client_name} onChange={e => setFormData({...formData, client_name: e.target.value})} />
        </div>
        <div className="field">
          <label>Notes</label>
          <input className="input" value={formData.vehicle_notes} onChange={e => setFormData({...formData, vehicle_notes: e.target.value})} />
        </div>
        <div className="field">
          <label>Size</label>
          <select className="input" value={formData.size_code} onChange={e => setFormData({...formData, size_code: e.target.value})}>
            {["S","M","L","XL"].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Difficulty</label>
          <select className="input" value={formData.difficulty} onChange={e => setFormData({...formData, difficulty: e.target.value})}>
            {[1,2,3].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>
      <button className="btn btn-primary" style={{marginTop:15}} onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save & Update Prices"}
      </button>
    </div>
  );
}