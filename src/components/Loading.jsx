import React from "react";

export default function Loading({ label = "Loading..." }) {
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div style={{ marginTop: 8, opacity: 0.7 }}>Please wait.</div>
    </div>
  );
}
