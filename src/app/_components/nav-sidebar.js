"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import styles from "./nav-sidebar.module.css";

const THEME_KEY = "crm-theme";

export default function NavSidebar() {
  const pathname = usePathname() || "/";
  const [theme, setTheme] = useState("light");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "dark") {
        setTheme("dark");
        document.documentElement.classList.add("dark");
      }
    } catch {}
    setHydrated(true);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch {}
    document.documentElement.classList.toggle("dark", next === "dark");
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>GH</div>
      <nav className={styles.nav}>
        <Link href="/" className={`${styles.navLink} ${pathname === "/" ? styles.active : ""}`} title="Alunos">
          <span className={styles.icon}>👥</span>
          <span className={styles.label}>Alunos</span>
        </Link>
        <Link href="/followup" className={`${styles.navLink} ${pathname.startsWith("/followup") ? styles.active : ""}`} title="Retornos">
          <span className={styles.icon}>📞</span>
          <span className={styles.label}>Retornos</span>
        </Link>
        <Link href="/funil" className={`${styles.navLink} ${pathname.startsWith("/funil") ? styles.active : ""}`} title="Funil">
          <span className={styles.icon}>🌡️</span>
          <span className={styles.label}>Funil</span>
        </Link>
        <Link href="/metricas" className={`${styles.navLink} ${pathname.startsWith("/metricas") ? styles.active : ""}`} title="Métricas">
          <span className={styles.icon}>📊</span>
          <span className={styles.label}>Métricas</span>
        </Link>
        <Link href="/quiz" className={`${styles.navLink} ${pathname.startsWith("/quiz") ? styles.active : ""}`} title="Quiz">
          <span className={styles.icon}>🎯</span>
          <span className={styles.label}>Quiz</span>
        </Link>
        <Link href="/faturamento" className={`${styles.navLink} ${pathname.startsWith("/faturamento") ? styles.active : ""}`} title="Faturamento">
          <span className={styles.icon}>💰</span>
          <span className={styles.label}>Receita</span>
        </Link>
        <Link href="/suporte" className={`${styles.navLink} ${pathname.startsWith("/suporte") ? styles.active : ""}`} title="Suporte">
          <span className={styles.icon}>💬</span>
          <span className={styles.label}>Suporte</span>
        </Link>
      </nav>
      <button className={styles.themeToggle} onClick={toggleTheme} title="Alternar tema" aria-label="Alternar tema">
        {hydrated ? (theme === "dark" ? "☀️" : "🌙") : "·"}
      </button>
    </aside>
  );
}
