"use client";

import { useRouter } from "next/navigation";

const OPCOES = [
  { v: "30", label: "Últimos 30 dias" },
  { v: "60", label: "Últimos 60 dias" },
  { v: "90", label: "Últimos 90 dias" },
  { v: "", label: "Tudo" },
];

// Seletor de janela de dias (?dias=30|60|90, vazio = tudo). `base` = rota destino.
export default function PeriodoFilter({ diasSel = "", base = "/quiz" }) {
  const router = useRouter();
  return (
    <select
      value={diasSel}
      onChange={(e) => router.push(e.target.value ? `${base}?dias=${e.target.value}` : base)}
      aria-label="Filtrar por período"
      style={{
        background: "transparent",
        color: "inherit",
        border: "1px solid rgba(128,128,128,0.4)",
        borderRadius: 8,
        padding: "6px 12px",
        fontSize: "0.9rem",
        cursor: "pointer",
      }}
    >
      {OPCOES.map((o) => (
        <option key={o.v} value={o.v}>{o.label}</option>
      ))}
    </select>
  );
}
