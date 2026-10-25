
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { useState, useEffect } from "react";

import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import Dashboard from "./pages/Dashboard";
import Prescriptions from "./pages/Prescriptions";
import Medicines from "./pages/Medicines";
import Schedule from "./pages/Schedule";

const API_BASE_URL = "http://127.0.0.1:8000/api";
const TOKEN_KEY = "medimate_access_token";

/* -------------------- Token helpers -------------------- */

function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}

/* -------------------- Login / Signup page -------------------- */

function AuthPage({ onLogin, initialMode = "login" }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMode(initialMode);
    setError("");
    setPassword("");
    setConfirmPassword("");
  }, [initialMode]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    const normalizedEmail = email.trim().toLowerCase();

    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    setLoading(true);

    try {
      const endpoint =
        mode === "signup" ? "/auth/signup" : "/auth/login";

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          email: normalizedEmail,
          password,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.detail ||
            data.message ||
            `${mode === "signup" ? "Signup" : "Login"} failed.`
        );
      }

      let authData = data;
      let token = authData.access_token || authData.token;

      // Some signup endpoints create the account but do not
      // return a token. In that case, log in after signup.
      if (mode === "signup" && !token) {
        const loginResponse = await fetch(
          `${API_BASE_URL}/auth/login`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              email: normalizedEmail,
              password,
            }),
          }
        );

        authData = await loginResponse.json().catch(() => ({}));

        if (!loginResponse.ok) {
          setMode("login");
          setPassword("");
          setConfirmPassword("");
          setError(
            "Account created successfully. Please log in with your credentials."
          );
          return;
        }

        token = authData.access_token || authData.token;
      }

      if (!token) {
        throw new Error(
          "The server did not return an access token. Check the login API response."
        );
      }

      localStorage.setItem(TOKEN_KEY, token);
      onLogin(token);

      const destination = location.state?.from || "/";
      navigate(destination, { replace: true });
    } catch (err) {
      setError(
        err.message ||
          "Unable to connect to MediSeva. Please check that the backend is running."
      );
    } finally {
      setLoading(false);
    }
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    setError("");
    setPassword("");
    setConfirmPassword("");
    navigate(nextMode === "signup" ? "/signup" : "/login", {
      replace: true,
      state: location.state,
    });
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <span className="auth-brand-icon">M</span>

          <div>
            <h1>MediSeva</h1>
            <p>Your health, thoughtfully organized.</p>
          </div>
        </div>

        <div className="auth-heading">
          <h2>
            {mode === "login"
              ? "Welcome back"
              : "Create your account"}
          </h2>

          <p>
            {mode === "login"
              ? "Log in to access your medicines and prescriptions."
              : "Sign up to get started with MediSeva."}
          </p>
        </div>

        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <label htmlFor="auth-email">Email address</label>

          <input
            id="auth-email"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <label htmlFor="auth-password">Password</label>

          <input
            id="auth-password"
            type="password"
            name="password"
            autoComplete={
              mode === "login"
                ? "current-password"
                : "new-password"
            }
            placeholder="Enter your password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />

          {mode === "signup" && (
            <>
              <label htmlFor="auth-confirm-password">
                Confirm password
              </label>

              <input
                id="auth-confirm-password"
                type="password"
                name="confirmPassword"
                autoComplete="new-password"
                placeholder="Enter your password again"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.target.value)
                }
                minLength={8}
                required
              />
            </>
          )}

          <button
            type="submit"
            className="auth-submit"
            disabled={loading}
          >
            {loading
              ? "Please wait..."
              : mode === "login"
                ? "Log in"
                : "Create account"}
          </button>
        </form>

        <p className="auth-switch">
          {mode === "login"
            ? "Don't have an account?"
            : "Already have an account?"}{" "}

          <button
            type="button"
            onClick={() =>
              switchMode(mode === "login" ? "signup" : "login")
            }
          >
            {mode === "login" ? "Sign up" : "Log in"}
          </button>
        </p>
      </section>
    </main>
  );
}

/* -------------------- Existing application layout -------------------- */

function ProtectedLayout({ onLogout }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="app-shell">
      <div
        className={`sidebar-wrapper ${
          mobileMenuOpen ? "mobile-open" : ""
        }`}
      >
        <Sidebar />
      </div>

      {mobileMenuOpen && (
        <button
          className="mobile-overlay"
          aria-label="Close navigation"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <div className="main-area">
        <Topbar onLogout={onLogout} />

        <button
          className="mobile-menu-button"
          onClick={() =>
            setMobileMenuOpen((open) => !open)
          }
          aria-expanded={mobileMenuOpen}
          aria-label="Toggle navigation menu"
        >
          {mobileMenuOpen ? "Close menu" : "☰ Menu"}
        </button>

        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route
            path="/prescriptions"
            element={<Prescriptions />}
          />
          <Route path="/medicines" element={<Medicines />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        <footer className="app-footer">
          MediSeva · Your health information, thoughtfully organized.
        </footer>
      </div>
    </div>
  );
}

/* -------------------- Authentication and routing -------------------- */

function AppRoutes() {
  const [token, setToken] = useState(() => getStoredToken());
  const [checkingAuth, setCheckingAuth] = useState(
    () => Boolean(getStoredToken())
  );

  const location = useLocation();

  useEffect(() => {
    let cancelled = false;

    async function verifySession() {
      if (!token) {
        setCheckingAuth(false);
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          localStorage.removeItem(TOKEN_KEY);

          if (!cancelled) {
            setToken(null);
          }
        }
      } catch {
        // The backend may be temporarily unavailable.
        // Preserve the token and let API requests retry later.
      } finally {
        if (!cancelled) {
          setCheckingAuth(false);
        }
      }
    }

    verifySession();

    return () => {
      cancelled = true;
    };
  }, [token]);

  function handleLogin(newToken) {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
  }

  if (checkingAuth) {
    return (
      <div className="auth-loading" role="status">
        Checking your session...
      </div>
    );
  }

  if (!token) {
    return (
      <Routes>
        <Route
          path="/login"
          element={<AuthPage onLogin={handleLogin} />}
        />

        <Route
          path="/signup"
          element={
            <AuthPage
              key="signup"
              onLogin={handleLogin}
              initialMode="signup"
            />
          }
        />

        <Route
          path="*"
          element={
            <Navigate
              to="/login"
              replace
              state={{ from: location.pathname }}
            />
          }
        />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={<Navigate to="/" replace />}
      />

      <Route
        path="/signup"
        element={<Navigate to="/" replace />}
      />

      <Route
        path="/*"
        element={<ProtectedLayout onLogout={handleLogout} />}
      />
    </Routes>
  );
}

/* -------------------- Root component -------------------- */

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
