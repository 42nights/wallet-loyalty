import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import LoginForm from "./LoginForm";

export const runtime = "nodejs";

export default async function AdminLoginPage() {
  const enabled = Boolean(process.env.ADMIN_PASSWORD);
  if (enabled && (await isAdmin())) redirect("/admin");

  return (
    <div className="wrap">
      <div className="brand">
        <span className="dot" /> 42nights <small>creator</small>
      </div>
      {enabled ? (
        <LoginForm />
      ) : (
        <div className="card stack">
          <div className="label">Admin is disabled</div>
          <p style={{ margin: 0, lineHeight: 1.6 }}>
            Set the <code>ADMIN_PASSWORD</code> environment variable on the server and redeploy to turn on the
            creator dashboard. Without it, every admin page and API stays locked.
          </p>
        </div>
      )}
    </div>
  );
}
