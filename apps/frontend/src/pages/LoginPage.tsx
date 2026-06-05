import { FormEvent, useState } from "react";

import { Link, Navigate, useNavigate } from "react-router-dom";

import { getAuthSession } from "../app/api";

import { useAuth } from "../auth/AuthContext";

import { getHomePathForRole } from "../auth/roleRedirect";

import { toUserFacingError } from "../lib/networkError";



export function LoginPage() {

  const { login, user } = useAuth();

  const navigate = useNavigate();

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const [status, setStatus] = useState("");

  const [submitting, setSubmitting] = useState(false);



  const session = getAuthSession();

  if (session?.accessToken && user) {

    return <Navigate to={getHomePathForRole(user.role)} replace />;

  }



  async function handleSubmit(event: FormEvent) {

    event.preventDefault();

    setSubmitting(true);

    setStatus("");

    try {

      const homePath = await login(email.trim(), password);

      navigate(homePath, { replace: true });

    } catch (error) {

      setStatus(toUserFacingError(error, "Sign in failed. Check your email and password."));

    } finally {

      setSubmitting(false);

    }

  }



  return (

    <main className="login-page">

      <p className="login-back">

        <Link to="/">← Back to BMS home</Link>

      </p>

      <section className="login-card">

        <div className="dash-brand" style={{ marginBottom: "1rem" }}>

          <div className="dash-brand-icon" aria-hidden>

            B

          </div>

          <div>

            <p className="dash-brand-name">BMS</p>

            <p className="dash-brand-tag">Banking Management System</p>

          </div>

        </div>

        <h1>Sign in</h1>

        <p className="muted">Use the email and password provided by your administrator.</p>

        <form className="login-form" onSubmit={handleSubmit}>

          <label className="field">

            <span>Email</span>

            <input

              type="email"

              autoComplete="username"

              value={email}

              onChange={(event) => setEmail(event.target.value)}

              required

            />

          </label>

          <label className="field">

            <span>Password</span>

            <input

              type="password"

              autoComplete="current-password"

              value={password}

              onChange={(event) => setPassword(event.target.value)}

              required

            />

          </label>

          <button type="submit" className="button" disabled={submitting}>

            {submitting ? "Signing in..." : "Sign in"}

          </button>

        </form>

        {status ? <p className="login-status login-status--error">{status}</p> : null}

      </section>

    </main>

  );

}


