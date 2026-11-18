import { useState } from "react";
import "./App.css";

function App() {
  const [email, setEmail] = useState("user@example.com");
  const [password, setPassword] = useState("UserDemo123!");
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("http://localhost:8000/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.detail);

      setUser(data);
    } catch (err) {
      setError(err.message || "Unable to log in");
    } finally {
      setLoading(false);
    }
  }

  if (user) {
    return (
      <main className="container">
        <h1>Approval Portal</h1>
        <p>Welcome, {user.name}</p>
        <p>Role: {user.role}</p>
        <button onClick={() => setUser(null)}>Continue</button>
      </main>
    );
  }

  return (
    <main className="container">
      <h1>Approval Portal</h1>
      <p>Sign in to continue</p>

      <form className="login-form" onSubmit={handleLogin}>
        <label>Email</label>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />

        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}

export default App;