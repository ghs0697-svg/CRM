import { auth, signOut } from "@/auth";
import styles from "./user-badge.module.css";

export default async function UserBadge() {
  const session = await auth();
  if (!session?.user) return null;
  return (
    <form
      className={styles.badge}
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/sign-in" });
      }}
    >
      <span className={styles.email}>{session.user.email}</span>
      <button type="submit" className={styles.btn}>Sair</button>
    </form>
  );
}
