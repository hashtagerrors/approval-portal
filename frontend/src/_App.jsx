
import { useEffect, useState } from "react";
import "./App.css";

const API = "http://localhost:8000";

function App() {
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [completedProjects, setCompletedProjects] = useState([]);
  const [myCompletedProjects, setMyCompletedProjects] = useState([]);
  const [activeInstance, setActiveInstance] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [signatures, setSignatures] = useState([]);
  const [emailPreview, setEmailPreview] = useState(null);
  const [emailSent, setEmailSent] = useState(false);

  const [email, setEmail] = useState("user@example.com");
  const [password, setPassword] = useState("UserDemo123!");
  const [signerName, setSignerName] = useState("");

  const [loading, setLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [error, setError] = useState("");
  

  async function loadProjects() {
    const response = await fetch(`${API}/api/projects`, {
      credentials: "include",
    });

    if (!response.ok) throw new Error("Unable to load projects");

    setProjects(await response.json());
  }

async function loadApprovals() {
  const response = await fetch(`${API}/api/approvals`, {
    credentials: "include",
  });

  if (!response.ok) throw new Error("Unable to load approvals");

  const data = await response.json();
  console.log("Pending approvals:", data);
  setApprovals(data);
}

  async function loadMyCompletedProjects() {
    const response = await fetch(`${API}/api/completed`, {
      credentials: "include",
    });

    if (!response.ok) throw new Error("Failed to load completed projects");

    setMyCompletedProjects(await response.json());
  }
  async function loadCompletedProjects() {
    const response = await fetch(`${API}/api/completed`, {
      credentials: "include",
    });

    if (!response.ok) throw new Error("Failed to load completed projects");

    setCompletedProjects(await response.json());
  }
  async function loadSignatures() {
    const response = await fetch(`${API}/api/signatures`, {
      credentials: "include",
    });

    if (!response.ok) throw new Error("Unable to load signatures");

    setSignatures(await response.json());
  }

  async function loadDashboard(currentUser) {
    if (currentUser.role === "APPROVER") {
      await Promise.all([
        loadApprovals(),
        loadSignatures(),
        loadCompletedProjects(),
      ]);
     } else {
      await Promise.all([
        loadProjects(),
        loadMyCompletedProjects(),
      ]);
    }
  }

  useEffect(() => {
    async function restoreSession() {
      try {
        const response = await fetch(`${API}/api/me`, {
          credentials: "include",
        });

        if (!response.ok) return;
const data = await response.json();
const currentUser = data.user ?? data;

setUser(currentUser);
setSignerName(currentUser.name);
await loadDashboard(currentUser);
      } catch {
        setError("Unable to connect to the server");
      } finally {
        setAuthLoading(false);
      }
    }

    restoreSession();
  }, []);

  async function handleLogin(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`${API}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.detail);

      setUser(data.user);
      setSignerName(data.name);
      await loadDashboard(data.user);
    } catch (err) {
      setError(err.message || "Unable to log in");
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await fetch(`${API}/api/logout`, {
      method: "POST",
      credentials: "include",
    });

    setUser(null);
    setProjects([]);
    setSelectedProject(null);
    setActiveInstance(null);
    setDocuments([]);
    setApprovals([]);
    setSignatures([]);
    setEmailPreview(null);
    setError("");
  }

  async function handleStartProject() {
    if (!selectedProject) return;

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${API}/api/projects/${selectedProject.id}/start`,
        {
          method: "POST",
          credentials: "include",
        }
      );

      const data = await response.json();

      if (!response.ok) throw new Error(data.detail);

      setActiveInstance(data);
      setDocuments([]);
    } catch (err) {
      setError(err.message || "Unable to start project");
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(event) {
    const file = event.target.files[0];

    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${API}/api/projects/instances/${activeInstance.id}/documents`,
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
      setLoading(false);
    }
  }

  async function handleRequestApproval() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${API}/api/projects/instances/${activeInstance.id}/request-approval`,
        {
          method: "POST",
          credentials: "include",
        }
      );

      const data = await response.json();

      if (!response.ok) throw new Error(data.detail);

      setActiveInstance((current) => ({
        ...current,
        status: data.status,
      }));
    } catch (err) {
      setError(err.message || "Unable to request approval");
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(instanceId) {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${API}/api/approvals/${instanceId}/approve`,
        {
          method: "POST",
          credentials: "include",
        }
      );

      const data = await response.json();

      if (!response.ok) throw new Error(data.detail);

      setEmailPreview(data.email_preview);
      setEmailSent(data.email_sent);

      await Promise.all([loadApprovals(), loadSignatures()]);
    } catch (err) {
      setError(err.message || "Approval failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSign(instanceId) {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${API}/api/signatures/${instanceId}/sign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ signer_name: signerName }),
        }
      );

      const data = await response.json();

      if (!response.ok) throw new Error(data.detail);

      await loadSignatures();
      setError("");
    } catch (err) {
      setError(err.message || "Signing failed");
    } finally {
      setLoading(false);
    }
  }

  if (authLoading) {
    return <main className="container">Loading...</main>;
  }

  if (!user) {
    return (
      <main className="container">
        <header>
          <h1>Approval Portal</h1>
          <p>Sign in to continue</p>
        </header>

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

  if (user.role === "APPROVER") {
  return (
    <main className="container">
      <header>
        <h1>Approval Portal</h1>
        <p>Welcome, {user.name}</p>
        <button onClick={handleLogout}>Logout</button>
      </header>

      {error && <p className="error">{error}</p>}

      {emailPreview && (
        <section className="project-card">
          <h2>Signature Email</h2>
          <p>
            <strong>Delivery status:</strong>{" "}
            {emailSent ? "Email sent" : "Local preview only"}
          </p>
          <p><strong>To:</strong> {emailPreview.to}</p>
          <p><strong>Subject:</strong> {emailPreview.subject}</p>
          <p>{emailPreview.body}</p>
        </section>
      )}

      <section className="projects">
        <h2>Pending Approvals</h2>

        {approvals.length === 0 && <p>No pending approvals.</p>}

        {approvals.map((item) => (
          <article className="project-card" key={item.instance_id}>
            <h3>{item.project_name}</h3>
            <p>Requested by: {item.requested_by}</p>
            <p>Documents: {item.document_count}</p>
            <p>Instance: {item.instance_id}</p>

            {item.documents.map((document) => (
              <p key={document.id}>
                <a
                  href={`${API}/api/documents/${document.id}/view`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View PDF: {document.filename}
                </a>
              </p>
            ))}

            <button
              onClick={() => handleApprove(item.instance_id)}
              disabled={loading}
            >
              Approve
            </button>
          </article>
        ))}
      </section>

      <section className="projects">
        <h2>Pending Signatures</h2>

        {signatures.length === 0 && <p>No pending signatures.</p>}

        {signatures.map((item) => (
          <article className="project-card" key={item.instance_id}>
            <h3>{item.project_name}</h3>
            <p>Requested by: {item.requested_by}</p>

            {item.documents.map((document) => (
              <p key={document.id}>
                <a
                  href={`${API}/api/documents/${document.id}/view`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Review PDF: {document.filename}
                </a>
              </p>
            ))}

            <label>Type your name to sign</label>
            <input
              value={signerName}
              onChange={(event) => setSignerName(event.target.value)}
            />

            <button
              onClick={() => handleSign(item.instance_id)}
disabled={loading || !signerName?.trim()}            >
              Sign Document
            </button>
          </article>
        ))}
      </section>

      <section className="projects">
        <h2>Completed Projects</h2>

        {completedProjects.length === 0 && (
          <p>No completed projects yet.</p>
        )}

        {completedProjects.map((project) => (
          <article className="project-card" key={project.instance_id}>
            <h3>{project.project_name}</h3>
            <p>Requested by: {project.requester}</p>
            <p>
              Signed:{" "}
              {project.signed_at
                ? new Date(`${project.signed_at.replace(" ", "T")}Z`).toLocaleString()
                : "—"}
            </p>

            {project.documents.map((document) => (
              <p key={document.id}>
                <a
                  href={`${API}/api/documents/${document.id}/view`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View PDF: {document.filename}
                </a>
              </p>
            ))}
          </article>
        ))}
      </section>
    </main>
  );
}


  if (activeInstance) {
  return (
    <main className="container">
      <header>
        <h1>Approval Portal</h1>
        <p>Welcome, {user.name}</p>
        <button onClick={handleLogout}>Logout</button>
      </header>

      <section className="projects">
        <h2>{selectedProject?.name}</h2>
        <p>Project Instance: {activeInstance.id}</p>
        <p>Status: <strong>{activeInstance.status}</strong></p>

        {activeInstance.status === "DRAFT" && (
          <>
            <h3>Upload Documents (PDF only)</h3>

            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleUpload}
              disabled={loading}
            />

            {documents.length > 0 && (
              <>
                <h3>Uploaded Documents</h3>
                <ul>
                  {documents.map((document) => (
                    <li key={document.id}>{document.filename}</li>
                  ))}
                </ul>
              </>
            )}

            <button
              onClick={handleRequestApproval}
              disabled={loading || documents.length === 0}
            >
              {loading ? "Please wait..." : "Request Approval"}
            </button>
          </>
        )}

        {activeInstance.status === "PENDING_APPROVAL" && (
          <p>Waiting for User A to review and approve your documents.</p>
        )}

        {activeInstance.status === "PENDING_SIGNATURE" && (
          <p>Your documents have been approved and are awaiting signature.</p>
        )}

        {activeInstance.status === "COMPLETED" && (
          <p>Your project has been completed.</p>
        )}
      </section>

      {error && <p className="error">{error}</p>}
    </main>
  );
}

 return (
  <main className="container">
    <header>
      <h1>Approval Portal</h1>
      <p>Welcome, {user.name}</p>
      <button onClick={handleLogout}>Logout</button>
    </header>

    <section className="projects">
      <h2>Available Projects</h2>

      <div className="project-list">
        {projects.map((project) => (
          <button
            key={project.id}
            className={`project-card ${
              selectedProject?.id === project.id ? "selected" : ""
            }`}
            onClick={() => setSelectedProject(project)}
          >
            <h3>{project.name}</h3>
            <p>{project.description}</p>
          </button>
        ))}
      </div>

      {selectedProject && (
        <>
          <p className="selection">
            Selected: <strong>{selectedProject.name}</strong>
          </p>

          <button onClick={handleStartProject} disabled={loading}>
            {loading ? "Starting..." : "Start Project"}
          </button>
        </>
      )}

      {error && <p className="error">{error}</p>}
    </section>

    <section className="projects">
      <h2>My Completed Projects</h2>

      {myCompletedProjects.length === 0 && (
        <p>No completed projects yet.</p>
      )}

      {myCompletedProjects.map((project) => (
        <article className="project-card" key={project.instance_id}>
          <h3>{project.project_name}</h3>
          <p>
            Signed:{" "}
            {project.signed_at
              ? new Date(`${project.signed_at.replace(" ", "T")}Z`).toLocaleString()
              : "—"}
          </p>

          {project.documents.map((document) => (
            <p key={document.id}>
              <a
                href={`${API}/api/documents/${document.id}/view`}
                target="_blank"
                rel="noreferrer"
              >
                View PDF: {document.filename}
              </a>
            </p>
          ))}
        </article>
      ))}
    </section>
  </main>
);
}

export default App;
