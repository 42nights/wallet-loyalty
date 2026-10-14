"use client";

// window.print() needs the browser; the rest of the poster renders on the server.
export default function PrintButton() {
  return (
    <button
      type="button"
      className="btn btn-primary"
      style={{ width: "auto", padding: "14px 26px" }}
      onClick={() => window.print()}
    >
      Print
    </button>
  );
}
