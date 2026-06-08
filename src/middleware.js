import { auth } from "@/auth";

// Rotas públicas — NUNCA exigem login (máquina/aluno):
// /api/webhook (ManyChat), /api/cron (Vercel cron), /api/push, /api/booking
// (Greenn webhook + reservas de aluno), /booking (páginas do aluno),
// /api/auth e /sign-in (fluxo de login).
const PUBLIC_PREFIXES = [
  "/api/auth",
  "/api/webhook",
  "/api/cron",
  "/api/push",
  "/api/booking",
  "/booking",
  "/sign-in",
];

export default auth((req) => {
  const { nextUrl, auth: session } = req;
  const p = nextUrl.pathname;
  if (PUBLIC_PREFIXES.some((pre) => p === pre || p.startsWith(pre + "/"))) return;
  if (!session) {
    return Response.redirect(new URL("/sign-in", nextUrl));
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
