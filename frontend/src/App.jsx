import { useState } from "react";
import "./App.css";

function App() {
  const [email, setEmail] = useState("user@example.com");
  const [password, setPassword] = useState("UserDemo123!");
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [activeInstance, setActiveInstance] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  async function loadProjects() {
    const response = await fetch("http://localhost:8000/api/projects", {
      credentials: "include",
    });

    if (!response.ok) throw new Error("Unable to load projects");

    setProjects(await response.json());
  }
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
      await loadProjects();
    } catch (err) {
      setError(err.message || "Unable to log in");
    } finally {
      setLoading(false);
    }
  }
  async function handleStartProject() {
    if (!selectedProject) return;

    setActionLoading(true);
    setError("");

    try {
      const response = await fetch(
        `http://localhost:8000/api/projects/${selectedProject.id}/start`,
        {
          method: "POST",
          credentials: "include",
        }
      );

      const data = await response.json();

      if (!response.ok) throw new Error(data.detail);

      setActiveInstance(data);
    } catch (err) {
      setError(err.message || "Unable to start project");
    } finally {
      setActionLoading(false);
    }
  }
if (user) {
  if (activeInstance) {
  return (
    <main className="container">
      <h1>Approval Portal</h1>
      <h2>{selectedProject.name}</h2>
      <p>Project Instance: {activeInstance.id}</p>
      <p>Status: {activeInstance.status}</p>
      <p>Upload the required project documents to continue.</p>
    </main>
  );
}
  return (
    <main className="container">
      <h1>Approval Portal</h1>
      <p>Welcome, {user.name}</p>

      <section className="projects">
        <h2>Available Projects</h2>

        <div className="project-list">
          {projects.map((project) => (
            <button
              key={project.id}
              className={`project-card ${selectedProject?.id === project.id ? "selected" : ""}`}
              onClick={() => setSelectedProject(project)}
            >
              <h3>{project.name}</h3>
              <p>{project.description}</p>
            </button>
          ))}
        </div>

        {error && <p className="error">{error}</p>}

        {selectedProject && (
          <button onClick={handleStartProject} disabled={actionLoading}>
            {actionLoading ? "Starting..." : "Start Project"}
          </button>
        )}
      </section>
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