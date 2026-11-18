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
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [approvals, setApprovals] = useState([]);

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
      if (data.role === "APPROVER") {
        await loadApprovals();
      } else {
        await loadProjects();
      }
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
  async function handleUpload(event) {
    const file = event.target.files[0];

    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    setUploading(true);
    setError("");

    try {
      const response = await fetch(
        `http://localhost:8000/api/projects/instances/${activeInstance.id}/documents`,
        {
          method: "POST",
          credentials: "include",
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok) throw new Error(data.detail);

      setDocuments((current) => [...current, data]);
      event.target.value = "";
    } catch (err) {
      setError(err.message || "Document upload failed");
    } finally {
      setUploading(false);
    }
  }
  async function loadApprovals() {
    const response = await fetch("http://localhost:8000/api/approvals", {
      credentials: "include",
    });

    if (!response.ok) throw new Error("Unable to load approvals");

    setApprovals(await response.json());
  }
  async function handleApprove(instanceId) {
    setError("");

    try {
      const response = await fetch(
        `http://localhost:8000/api/approvals/${instanceId}/approve`,
        {
          method: "POST",
          credentials: "include",
        }
      );

      const data = await response.json();

      if (!response.ok) throw new Error(data.detail);

      setApprovals((current) =>
        current.filter((item) => item.instance_id !== instanceId)
      );
    } catch (err) {
      setError(err.message || "Approval failed");
    }
  }
  if (user) {
    if (user?.role === "APPROVER") {
      return (
        <main className="container">
          <h1>Approval Portal</h1>
          <h2>Pending Approvals</h2>
          <p>Welcome, {user.name}</p>

          {error && <p className="error">{error}</p>}

          {approvals.length === 0 && <p>No pending approvals.</p>}

          {approvals.map((item) => (
            <section className="project-card" key={item.instance_id}>
              <h3>{item.project_name}</h3>
              <p>Requested by: {item.requested_by}</p>
              <p>Documents: {item.document_count}</p>
              <p>Instance ID: {item.instance_id}</p>

              <button onClick={() => handleApprove(item.instance_id)}>
                Approve
              </button>
            </section>
          ))}
        </main>
      );
    }
    if (activeInstance) {
      return (
        <main className="container">
          <h1>Approval Portal</h1>
          <h2>{selectedProject.name}</h2>
          <p>Project Instance: {activeInstance.id}</p>
          <p>Status: {activeInstance.status}</p>

          <section>
            <h3>Upload Documents</h3>

            <input
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={handleUpload}
              disabled={uploading}
            />

            {uploading && <p>Uploading document...</p>}
            {error && <p className="error">{error}</p>}

            <ul>
              {documents.map((document) => (
                <li key={document.id}>{document.filename}</li>
              ))}
            </ul>
          </section>
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