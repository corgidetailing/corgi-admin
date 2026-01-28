import React from "react";

export default function ErrorBanner({ title = "Error", error }) {
  if (!error) return null;

  const message =
    typeof error === "string"
      ? error
      : error?.message || error?.error_description || JSON.stringify(error);

  return (
    <div style={{ padding: 12, border: "1px solid #f1c4c4", background: "#fff5f5", borderRadius: 8, marginBottom: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div>
      <div style={{ whiteSpace: "pre-wrap" }}>{message}</div>
    </div>
  );
}
