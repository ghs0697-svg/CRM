"use client";

import { useRouter, useSearchParams } from "next/navigation";

// Seletor de versão do quiz do Peitão. Preserva os outros params da URL (ex: ?mes=
// do funil do metodogh) e só troca ?pv=. As versões vêm da aba QUIZ_VERSOES.
export default function VersaoFilter({ versoes = [], versaoSel, base = "/quiz" }) {
  const router = useRouter();
  const sp = useSearchParams();
  function onChange(v) {
    const params = new URLSearchParams(sp?.toString() || "");
    params.set("pv", v);
    router.push(`${base}?${params.toString()}`);
  }
  return (
    <select
      value={versaoSel}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Versão do quiz do Peitão"
      style={{
        background: "transparent",
        color: "inherit",
        border: "1px solid rgba(128,128,128,0.4)",
        borderRadius: 8,
        padding: "5px 10px",
        fontSize: "0.85rem",
        cursor: "pointer",
      }}
    >
      {versoes.map((v) => (
        <option key={v.label} value={v.label}>{v.label}</option>
      ))}
    </select>
  );
}
