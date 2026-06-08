import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Lista branca de emails autorizados. Quem não tá aqui é rejeitado.
const ALLOWLIST = new Set([
  "ghs0697@gmail.com",
  "vitormoto535@gmail.com",
  "brunaferreiravega@gmail.com",
  "scheuermann.gh@gmail.com",
]);

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [Google],
  callbacks: {
    signIn({ user }) {
      const email = (user?.email || "").toLowerCase();
      return ALLOWLIST.has(email);
    },
    session({ session }) {
      return session;
    },
  },
  pages: {
    signIn: "/sign-in",
  },
  trustHost: true,
});
