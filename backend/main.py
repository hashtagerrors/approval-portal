from contextlib import closing
import hashlib
import hmac
import os
import time
import uuid
from pathlib import Path

from fastapi import FastAPI,File, UploadFile, Depends, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from database import get_connection

app = FastAPI(title="Approval Portal API")

APP_SECRET = os.getenv("APP_SECRET", "local-development-only")
SESSION_COOKIE = "approval_session"
SESSION_DURATION = 8 * 60 * 60


class LoginRequest(BaseModel):
    email: str
    password: str


def verify_password(password, password_hash):
    salt, expected_hash = password_hash.split(":")
    actual_hash = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt), 600_000
    ).hex()

    return hmac.compare_digest(actual_hash, expected_hash)


def create_session(user_id):
    expires_at = int(time.time()) + SESSION_DURATION
    payload = f"{user_id}:{expires_at}"
    signature = hmac.new(
        APP_SECRET.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()

    return f"{payload}:{signature}"


def get_current_user(request: Request):
    token = request.cookies.get(SESSION_COOKIE)

    if not token:
        raise HTTPException(status_code=401, detail="Please log in")

    try:
        user_id, expires_at, signature = token.split(":")
        payload = f"{user_id}:{expires_at}"
        expected_signature = hmac.new(
            APP_SECRET.encode(), payload.encode(), hashlib.sha256
        ).hexdigest()

        if int(expires_at) < time.time() or not hmac.compare_digest(
            signature, expected_signature
        ):
            raise ValueError

    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    with closing(get_connection()) as conn:
        user = conn.execute(
            "SELECT id, name, email, role FROM users WHERE id = ?",
            (int(user_id),),
        ).fetchone()

    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return dict(user)


@app.post("/api/login")
def login(data: LoginRequest, response: Response):
    with closing(get_connection()) as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE email = ?", (data.email,)
        ).fetchone()

    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    response.set_cookie(
        SESSION_COOKIE,
        create_session(user["id"]),
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=SESSION_DURATION,
    )

    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
    }


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE)
    return {"message": "Logged out"}


@app.get("/api/me")
def get_me(user=Depends(get_current_user)):
    return user

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def home():
    return {"message": "Approval Portal API is running"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.get("/api/projects")
def get_projects():
    with closing(get_connection()) as conn:
        rows = conn.execute(
            "SELECT id, name, description FROM projects ORDER BY id"
        ).fetchall()

    return [dict(row) for row in rows]

@app.post("/api/projects/{project_id}/start", status_code=201)
def start_project(project_id: int, user=Depends(get_current_user)):
    with closing(get_connection()) as conn:
        with conn:
            project = conn.execute(
                "SELECT id FROM projects WHERE id = ?", (project_id,)
            ).fetchone()

            if not project:
                raise HTTPException(status_code=404, detail="Project not found")

            cursor = conn.execute(
                """
                INSERT INTO project_instances (project_id, created_by)
                VALUES (?, ?)
                """,
                (project_id, user["id"]),
            )

            instance_id = cursor.lastrowid

            conn.execute(
                """
                INSERT INTO workflow_events (instance_id, actor_id, event_type)
                VALUES (?, ?, ?)
                """,
                (instance_id, user["id"], "PROJECT_STARTED"),
            )

    return {
        "id": instance_id,
        "project_id": project_id,
        "status": "DRAFT",
    }

STORAGE_DIR = Path(__file__).resolve().parent.parent / "storage"


@app.post("/api/projects/instances/{instance_id}/documents", status_code=201)
def upload_document(
    instance_id: int,
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    allowed_extensions = {".pdf", ".doc", ".docx"}
    extension = Path(file.filename or "").suffix.lower()

    if extension not in allowed_extensions:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    with closing(get_connection()) as conn:
        instance = conn.execute(
            """
            SELECT id FROM project_instances
            WHERE id = ? AND created_by = ? AND status = 'DRAFT'
            """,
            (instance_id, user["id"]),
        ).fetchone()

    if not instance:
        raise HTTPException(
            status_code=404, detail="Draft project not found"
        )

    content = file.file.read(10 * 1024 * 1024 + 1)

    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File exceeds 10 MB")

    filename = f"{uuid.uuid4().hex}{extension}"
    upload_dir = STORAGE_DIR / str(instance_id)
    upload_dir.mkdir(parents=True, exist_ok=True)

    file_path = upload_dir / filename
    file_path.write_bytes(content)

    with closing(get_connection()) as conn:
        with conn:
            cursor = conn.execute(
                """
                INSERT INTO documents (
                    instance_id, filename, file_path, content_type, uploaded_by
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    instance_id,
                    file.filename,
                    str(file_path),
                    file.content_type or "application/octet-stream",
                    user["id"],
                ),
            )

    return {
        "id": cursor.lastrowid,
        "filename": file.filename,
        "message": "Document uploaded successfully",
    }

@app.post("/api/projects/instances/{instance_id}/request-approval")
def request_approval(instance_id: int, user=Depends(get_current_user)):
    with closing(get_connection()) as conn:
        with conn:
            instance = conn.execute(
                """
                SELECT id FROM project_instances
                WHERE id = ? AND created_by = ? AND status = 'DRAFT'
                """,
                (instance_id, user["id"]),
            ).fetchone()

            if not instance:
                raise HTTPException(
                    status_code=404, detail="Draft project not found"
                )

            document = conn.execute(
                "SELECT id FROM documents WHERE instance_id = ? LIMIT 1",
                (instance_id,),
            ).fetchone()

            if not document:
                raise HTTPException(
                    status_code=400,
                    detail="Upload at least one document before requesting approval",
                )

            conn.execute(
                """
                UPDATE project_instances
                SET status = 'PENDING_APPROVAL'
                WHERE id = ?
                """,
                (instance_id,),
            )

            conn.execute(
                """
                INSERT INTO workflow_events (instance_id, actor_id, event_type)
                VALUES (?, ?, 'APPROVAL_REQUESTED')
                """,
                (instance_id, user["id"]),
            )

    return {"message": "Approval requested successfully", "status": "PENDING_APPROVAL"}

@app.get("/api/approvals")
def get_pending_approvals(user=Depends(get_current_user)):
    if user["role"] != "APPROVER":
        raise HTTPException(status_code=403, detail="Access denied")

    with closing(get_connection()) as conn:
        rows = conn.execute(
            """
            SELECT
                pi.id AS instance_id,
                p.name AS project_name,
                u.name AS requested_by,
                pi.created_at,
                COUNT(d.id) AS document_count
            FROM project_instances pi
            JOIN projects p ON p.id = pi.project_id
            JOIN users u ON u.id = pi.created_by
            LEFT JOIN documents d ON d.instance_id = pi.id
            WHERE pi.status = 'PENDING_APPROVAL'
            GROUP BY pi.id
            ORDER BY pi.created_at
            """
        ).fetchall()

    return [dict(row) for row in rows]

@app.post("/api/approvals/{instance_id}/approve")
def approve_project(instance_id: int, user=Depends(get_current_user)):
    if user["role"] != "APPROVER":
        raise HTTPException(status_code=403, detail="Access denied")

    with closing(get_connection()) as conn:
        with conn:
            cursor = conn.execute(
                """
                UPDATE project_instances
                SET status = 'PENDING_SIGNATURE',
                    approved_by = ?,
                    approved_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'PENDING_APPROVAL'
                """,
                (user["id"], instance_id),
            )

            if cursor.rowcount == 0:
                raise HTTPException(
                    status_code=404, detail="Pending approval not found"
                )

            conn.execute(
                """
                INSERT INTO workflow_events (instance_id, actor_id, event_type)
                VALUES (?, ?, 'APPROVED')
                """,
                (instance_id, user["id"]),
            )

    return {"message": "Project approved", "status": "PENDING_SIGNATURE"}