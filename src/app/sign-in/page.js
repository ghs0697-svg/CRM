import { signIn } from "@/auth";
import styles from "./sign-in.module.css";

export const metadata = { title: "Entrar — CRM GH" };

export default async function SignInPage({ searchParams }) {
  const params = await searchParams;
  const error = params?.error;

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logo}>GH</div>
        <h1 className={styles.title}>CRM Consultoria GH</h1>
        <p className={styles.subtitle}>Acesso restrito ao time</p>

        {error === "AccessDenied" && (
          <div className={styles.error}>
            Esse email não está autorizado a acessar o CRM.
            <br />
            Peça acesso ao Gabriel.
          </div>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button type="submit" className={styles.btn}>
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <path d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18Z" fill="#4285F4"/>
              <path d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17Z" fill="#34A853"/>
              <path d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07Z" fill="#FBBC05"/>
              <path d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3Z" fill="#EA4335"/>
            </svg>
            Entrar com Google
          </button>
        </form>
      </div>
    </div>
  );
}
