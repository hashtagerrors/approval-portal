
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
      setSignerName(data.user.name);
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
    return (
      <main className="app-shell">
        <div className="loading-state">Loading Approval Portal...</div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="brand-mark">
            <span className="brand-icon">✓</span>
          </div>
          <p className="eyebrow">WORKFLOW MANAGEMENT</p>
          <h1>Approval Portal</h1>
          <p className="muted auth-description">Sign in to manage project approvals and documents.</p>

          <form className="login-form" onSubmit={handleLogin}>
            <label htmlFor="login-email">Email address</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
            />

            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />

            {error && <p className="error">{error}</p>}

            <button className="button button-primary button-full" type="submit" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  const formatDate = (value) =>
    value ? new Date(`${value.replace(" ", "T")}Z`).toLocaleString() : "—";

  const renderDocuments = (items, actionLabel = "View document") => (
    <div className="document-list">
      {(items || []).map((document) => (
        <a
          className="document-link"
          href={`${API}/api/documents/${document.id}/view`}
          target="_blank"
          rel="noreferrer"
          key={document.id}
        >
          <span className="document-icon">PDF</span>
          <span className="document-name">{document.filename}</span>
          <span className="document-action">{actionLabel} ↗</span>
        </a>
      ))}
    </div>
  );

  if (user.role === "APPROVER") {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="topbar-inner">
            <a className="brand" href="#" onClick={(event) => event.preventDefault()}>
              <span className="brand-icon">✓</span>
              <span>Approval Portal</span>
            </a>
            <div className="user-menu">
              <div className="user-avatar">{user.name?.charAt(0)?.toUpperCase() || "A"}</div>
              <div className="user-details">
                <span className="user-name">{user.name}</span>
                <span className="user-role">Approver</span>
              </div>
              <button className="button button-quiet" onClick={handleLogout}>Logout</button>
            </div>
          </div>
        </header>

        <main className="dashboard">
          <div className="page-heading">
            <div>
              <p className="eyebrow">APPROVER WORKSPACE</p>
              <h1>Welcome, {user.name}</h1>
              <p className="muted">Review requests, sign approved documents and track completed work.</p>
            </div>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          {emailPreview && (
            <section className="email-notice">
              <div className="notice-icon">✉</div>
              <div className="notice-content">
                <div className="section-title-row">
                  <h2>Signature email</h2>
                  <span className={`status-pill ${emailSent ? "status-complete" : "status-info"}`}>
                    {emailSent ? "Email sent" : "Local preview only"}
                  </span>
                </div>
                <p><strong>To:</strong> {emailPreview.to}</p>
                <p><strong>Subject:</strong> {emailPreview.subject}</p>
                <p className="email-body">{emailPreview.body}</p>
              </div>
            </section>
          )}

          <div className="stat-grid">
            <div className="stat-card">
              <span className="stat-label">Pending approvals</span>
              <strong className="stat-value">{approvals.length}</strong>
              <span className="stat-caption">Require your review</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Pending signatures</span>
              <strong className="stat-value">{signatures.length}</strong>
              <span className="stat-caption">Awaiting your signature</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Completed projects</span>
              <strong className="stat-value">{completedProjects.length}</strong>
              <span className="stat-caption">Successfully signed</span>
            </div>
          </div>

          <section className="dashboard-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">ACTION REQUIRED</p>
                <h2>Pending approvals</h2>
              </div>
              <span className="count-pill">{approvals.length}</span>
            </div>

            {approvals.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">✓</span>
                <h3>You're all caught up</h3>
                <p>No projects are waiting for approval.</p>
              </div>
            ) : (
              <div className="card-grid">
                {approvals.map((item) => (
                  <article className="workflow-card" key={item.instance_id}>
                    <div className="workflow-card-top">
                      <span className="status-pill status-pending">Awaiting approval</span>
                      <span className="instance-label">#{item.instance_id}</span>
                    </div>
                    <h3>{item.project_name}</h3>
                    <p className="card-meta">Requested by <strong>{item.requested_by}</strong></p>
                    <div className="card-facts">
                      <span>{item.document_count} {item.document_count === 1 ? "document" : "documents"}</span>
                    </div>
                    {renderDocuments(item.documents)}
                    <div className="card-actions">
                      <button
                        className="button button-primary"
                        onClick={() => handleApprove(item.instance_id)}
                        disabled={loading}
                      >
                        {loading ? "Please wait..." : "Approve request"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="dashboard-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">YOUR ACTION</p>
                <h2>Pending signatures</h2>
              </div>
              <span className="count-pill">{signatures.length}</span>
            </div>

            {signatures.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">✍</span>
                <h3>No signatures pending</h3>
                <p>Approved documents requiring your signature will appear here.</p>
              </div>
            ) : (
              <div className="card-grid">
                {signatures.map((item) => (
                  <article className="workflow-card" key={item.instance_id}>
                    <div className="workflow-card-top">
                      <span className="status-pill status-signature">Signature required</span>
                      <span className="instance-label">#{item.instance_id}</span>
                    </div>
                    <h3>{item.project_name}</h3>
                    <p className="card-meta">Requested by <strong>{item.requested_by}</strong></p>
                    {renderDocuments(item.documents, "Review PDF")}
                    <div className="signature-form">
                      <label htmlFor={`signer-${item.instance_id}`}>Type your name to sign</label>
                      <input
                        id={`signer-${item.instance_id}`}
                        value={signerName}
                        onChange={(event) => setSignerName(event.target.value)}
                        placeholder="Enter your full name"
                      />
                      <button
                        className="button button-primary"
                        onClick={() => handleSign(item.instance_id)}
                        disabled={loading || !signerName?.trim()}
                      >
                        {loading ? "Signing..." : "Sign document"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="dashboard-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">HISTORY</p>
                <h2>Completed projects</h2>
              </div>
              <span className="count-pill">{completedProjects.length}</span>
            </div>

            {completedProjects.length === 0 ? (
              <div className="empty-state">
                <h3>No completed projects yet</h3>
                <p>Signed projects will be listed here.</p>
              </div>
            ) : (
              <div className="completed-list">
                {completedProjects.map((project) => (
                  <article className="completed-row" key={project.instance_id}>
                    <div className="completed-main">
                      <span className="completed-check">✓</span>
                      <div>
                        <h3>{project.project_name}</h3>
                        <p className="card-meta">Requested by {project.requester}</p>
                        <p className="completed-date">Signed: {formatDate(project.signed_at)}</p>
                        {renderDocuments(project.documents)}
                      </div>
                    </div>
                    <span className="status-pill status-complete">Completed</span>
                  </article>
                ))}
              </div>
            )}
          </section>

          <footer className="page-footer">Approval Portal · Secure document workflow</footer>
        </main>
      </div>
    );
  }

  if (activeInstance) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="topbar-inner">
            <a className="brand" href="#" onClick={(event) => event.preventDefault()}>
              <span className="brand-icon">✓</span>
              <span>Approval Portal</span>
            </a>
            <div className="user-menu">
              <div className="user-avatar">{user.name?.charAt(0)?.toUpperCase() || "U"}</div>
              <div className="user-details">
                <span className="user-name">{user.name}</span>
                <span className="user-role">User</span>
              </div>
              <button className="button button-quiet" onClick={handleLogout}>Logout</button>
            </div>
          </div>
        </header>

        <main className="dashboard dashboard-narrow">
          <div className="page-heading">
            <div>
              <p className="eyebrow">PROJECT WORKSPACE</p>
              <h1>{selectedProject?.name || "Project"}</h1>
              <p className="muted">Project instance #{activeInstance.id}</p>
            </div>
            <span className={`status-pill ${activeInstance.status === "COMPLETED" ? "status-complete" : "status-pending"}`}>
              {activeInstance.status.replaceAll("_", " ")}
            </span>
          </div>

          <section className="panel">
            {activeInstance.status === "DRAFT" && (
              <>
                <h2>Upload documents</h2>
                <p className="muted">Add the required PDF documents to this project.</p>
                <label className="upload-area">
                  <span className="upload-symbol">↑</span>
                  <strong>Choose a PDF file</strong>
                  <span className="muted">PDF format only</span>
                  <input
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={handleUpload}
                    disabled={loading}
                  />
                </label>

                {documents.length > 0 && (
                  <div className="uploaded-files">
                    <h3>Uploaded documents</h3>
                    {documents.map((document) => (
                      <div className="uploaded-file" key={document.id}>
                        <span className="document-icon">PDF</span>
                        <span>{document.filename}</span>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  className="button button-primary"
                  onClick={handleRequestApproval}
                  disabled={loading || documents.length === 0}
                >
                  {loading ? "Please wait..." : "Submit for approval"}
                </button>
              </>
            )}

            {activeInstance.status === "PENDING_APPROVAL" && (
              <div className="empty-state">
                <span className="empty-icon">◷</span>
                <h2>Waiting for approval</h2>
                <p>Your documents have been submitted and are waiting for the approver to review them.</p>
              </div>
            )}

            {activeInstance.status === "PENDING_SIGNATURE" && (
              <div className="empty-state">
                <span className="empty-icon">✍</span>
                <h2>Awaiting signature</h2>
                <p>Your documents have been approved and are awaiting signature.</p>
              </div>
            )}

            {activeInstance.status === "COMPLETED" && (
              <div className="empty-state">
                <span className="empty-icon">✓</span>
                <h2>Project completed</h2>
                <p>Your documents have been signed successfully.</p>
              </div>
            )}
          </section>
          {error && <div className="alert alert-error">{error}</div>}
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#" onClick={(event) => event.preventDefault()}>
            <span className="brand-icon">✓</span>
            <span>Approval Portal</span>
          </a>
          <div className="user-menu">
            <div className="user-avatar">{user.name?.charAt(0)?.toUpperCase() || "U"}</div>
            <div className="user-details">
              <span className="user-name">{user.name}</span>
              <span className="user-role">User</span>
            </div>
            <button className="button button-quiet" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </header>

      <main className="dashboard">
        <div className="page-heading">
          <div>
            <p className="eyebrow">USER WORKSPACE</p>
            <h1>Welcome, {user.name}</h1>
            <p className="muted">Start a project or access your completed documents.</p>
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">GET STARTED</p>
              <h2>Available projects</h2>
            </div>
          </div>

          <div className="card-grid project-selection-grid">
            {projects.map((project) => (
              <button
                type="button"
                key={project.id}
                className={`workflow-card project-option ${selectedProject?.id === project.id ? "selected" : ""}`}
                onClick={() => setSelectedProject(project)}
              >
                <span className="project-option-icon">▤</span>
                <h3>{project.name}</h3>
                <p>{project.description}</p>
                <span className="selection-indicator">
                  {selectedProject?.id === project.id ? "Selected ✓" : "Select project"}
                </span>
              </button>
            ))}
          </div>

          {selectedProject && (
            <div className="start-project-bar">
              <div>
                <span className="muted">Selected project</span>
                <strong>{selectedProject.name}</strong>
              </div>
              <button className="button button-primary" onClick={handleStartProject} disabled={loading}>
                {loading ? "Starting..." : "Start project"}
              </button>
            </div>
          )}
        </section>

        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">HISTORY</p>
              <h2>My completed projects</h2>
            </div>
            <span className="count-pill">{myCompletedProjects.length}</span>
          </div>

          {myCompletedProjects.length === 0 ? (
            <div className="empty-state">
              <h3>No completed projects yet</h3>
              <p>Your signed projects and documents will appear here.</p>
            </div>
          ) : (
            <div className="completed-list">
              {myCompletedProjects.map((project) => (
                <article className="completed-row" key={project.instance_id}>
                  <div className="completed-main">
                    <span className="completed-check">✓</span>
                    <div>
                      <h3>{project.project_name}</h3>
                      <p className="completed-date">Signed: {formatDate(project.signed_at)}</p>
                      {renderDocuments(project.documents)}
                    </div>
                  </div>
                  <span className="status-pill status-complete">Completed</span>
                </article>
              ))}
            </div>
          )}
        </section>

        <footer className="page-footer">Approval Portal · Secure document workflow</footer>
      </main>
    </div>
  );
}
export default App;
