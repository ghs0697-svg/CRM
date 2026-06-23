"use client";

import { useRouter } from "next/navigation";

const MES_NOMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const label = (m) => {
  if (m === "todos") return "Todos os meses";
  const [y, mo] = String(m).split("-");
  return `${MES_NOMES[+mo - 1] || mo}/${y}`;
};

export default function MesFilter({ meses = [], mesSel }) {
  const router = useRouter();
  return (
    <select
      value={mesSel}
      onChange={(e) => router.push(`/funil?mes=${encodeURIComponent(e.target.value)}`)}
      aria-label="Filtrar por mês"
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
      {meses.map((m) => (
        <option key={m} value={m}>{label(m)}</option>
      ))}
      <option value="todos">Todos os meses</option>
    </select>
  );
}
