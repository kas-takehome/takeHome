import { useEffect, useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { api } from "./api";
import App from "./App";

interface Session {
  user: { username: string };
}

export default function Auth() {
  const [user, setUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api<Session>("/auth/session", { signal: controller.signal })
      .then((session) => {
        if (!controller.signal.aborted) setUser(session.user.username);
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    const expired = () => {
      setUser(null);
      setPassword("");
      setError("Your session ended. Please sign in again.");
    };
    window.addEventListener("session-expired", expired);
    return () => {
      controller.abort();
      window.removeEventListener("session-expired", expired);
    };
  }, []);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const session = await api<Session>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setPassword("");
      setUser(session.user.username);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/auth/logout", { method: "POST", body: "{}" });
      setUser(null);
      setPassword("");
      window.location.hash = "";
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to sign out. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <main className="auth-page" role="status">
        Checking session…
      </main>
    );
  if (user)
    return (
      <App
        username={user}
        onSignOut={signOut}
        signingOut={busy}
        authError={error}
      />
    );
  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={signIn}>
        <ShieldCheck size={28} aria-hidden="true" />
        <div className="eyebrow">DISPUTE OPERATIONS</div>
        <h1>Sign in to Dispute Triage</h1>
        <p>Access your operations workspace.</p>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <label className="field-label" htmlFor="login-username">
          Username
        </label>
        <input
          id="login-username"
          className="text-input"
          autoComplete="username"
          required
          maxLength={80}
          value={username}
          disabled={busy}
          onChange={(event) => setUsername(event.target.value)}
        />
        <label className="field-label" htmlFor="login-password">
          Password
        </label>
        <input
          id="login-password"
          className="text-input"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
          value={password}
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button className="button primary" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="field-hint">Synthetic dispute data only.</p>
      </form>
    </main>
  );
}
