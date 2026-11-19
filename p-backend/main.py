import hashlib
import hmac
import os
import smtplib
import time
import uuid
from contextlib import closing
from email.message import EmailMessage
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from database import get_connection


app = FastAPI(title="Approval Portal API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

APP_SECRET = os.getenv("APP_SECRET", "local-development-only")
SESSION_COOKIE = "approval_session"
SESSION_DURATION = 8 * 60 * 60
MAX_FILE_SIZE = 10 * 1024 * 1024
STORAGE_DIR = Path(__file__).resolve().parent.parent / "storage"
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")


class LoginRequest(BaseModel):
    email: str
    password: str


class SignatureRequest(BaseModel):
    signer_name: str


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

        user_id = int(user_id)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    with closing(get_connection()) as conn:
        user = conn.execute(
            "SELECT id, name, email, role FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()

    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return dict(user)


def require_approver(user):
    if user["role"] != "APPROVER":
        raise HTTPException(status_code=403, detail="Access denied")


def send_signature_email(recipient, project_name, instance_id):
    host = os.getenv("SMTP_HOST")
    username = os.getenv("SMTP_USERNAME")
    password = os.getenv("SMTP_PASSWORD")
    sender = os.getenv("SMTP_FROM")

    if not all((host, username, password, sender)):
        return False

    message = EmailMessage()
    message["Subject"] = f"Signature required: {project_name}"
    message["From"] = sender
    message["To"] = recipient
    message.set_content(
        f"""Hello,

The project "{project_name}" has been approved.

Please log in to the Approval Portal to review and sign the document.

Project reference: {instance_id}

Open the portal: {FRONTEND_URL}

Regards,
Approval Portal
"""
    )

    try:
        with smtplib.SMTP(host, int(os.getenv("SMTP_PORT", "587"))) as smtp:
            smtp.starttls()
            smtp.login(username, password)
            smtp.send_message(message)
        return True
    except (OSError, smtplib.SMTPException):
        return False


@app.get("/")
def home():
    return {"message": "Approval Portal API is running"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.post("/api/login")
def login(data: LoginRequest, response: Response):
    with closing(get_connection()) as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE email = ?", (data.email.strip().lower(),)
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


@app.get("/api/projects")
def get_projects(user=Depends(get_current_user)):
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
                VALUES (?, ?, 'PROJECT_STARTED')
                """,
                (instance_id, user["id"]),
            )

    return {
        "id": instance_id,
        "project_id": project_id,
        "status": "DRAFT",
    }


@app.post("/api/projects/instances/{instance_id}/documents", status_code=201)
def upload_document(
    instance_id: int,
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    extension = Path(file.filename or "").suffix.lower()

    if extension != ".pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    with closing(get_connection()) as conn:
        instance = conn.execute(
            """
            SELECT id FROM project_instances
            WHERE id = ? AND created_by = ? AND status = 'DRAFT'
            """,
            (instance_id, user["id"]),
        ).fetchone()

    if not instance:
        raise HTTPException(status_code=404, detail="Draft project not found")

    content = file.file.read(MAX_FILE_SIZE + 1)

    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File exceeds 10 MB")

    if not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="Invalid PDF file")

    filename = f"{uuid.uuid4().hex}.pdf"
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
                    "application/pdf",
                    user["id"],
                ),
            )

    return {
        "id": cursor.lastrowid,
        "filename": file.filename,
        "message": "Document uploaded successfully",
    }


@app.get("/api/documents/{document_id}/view")
def view_document(document_id: int, user=Depends(get_current_user)):
    with closing(get_connection()) as conn:
        document = conn.execute(
            """
            SELECT d.file_path, d.filename, pi.created_by, pi.status
            FROM documents d
            JOIN project_instances pi ON pi.id = d.instance_id
            WHERE d.id = ?
            """,
            (document_id,),
        ).fetchone()

    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    is_owner = document["created_by"] == user["id"]

    can_review = (
        user["role"] == "APPROVER"
        and document["status"] in (
            "PENDING_APPROVAL",
            "PENDING_SIGNATURE",
            "COMPLETED",
        )
    )

    if not is_owner and not can_review:
        raise HTTPException(status_code=403, detail="Access denied")

    if not is_owner and not can_review:
        raise HTTPException(status_code=403, detail="Access denied")

    file_path = Path(document["file_path"])

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        file_path,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{Path(document["filename"]).name}"'
        },
    )


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
                raise HTTPException(status_code=404, detail="Draft project not found")

            document = conn.execute(
                "SELECT id FROM documents WHERE instance_id = ? LIMIT 1",
                (instance_id,),
            ).fetchone()

            if not document:
                raise HTTPException(
                    status_code=400,
                    detail="Upload at least one PDF before requesting approval",
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

    return {"message": "Approval requested", "status": "PENDING_APPROVAL"}


@app.get("/api/approvals")
def get_pending_approvals(user=Depends(get_current_user)):
    require_approver(user)

    with closing(get_connection()) as conn:
        rows = conn.execute(
            """
            SELECT pi.id AS instance_id, p.name AS project_name,
                   u.name AS requested_by, pi.created_at,
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

        approvals = []

        for row in rows:
            item = dict(row)
            item["documents"] = [
                dict(document)
                for document in conn.execute(
                    "SELECT id, filename FROM documents WHERE instance_id = ?",
                    (item["instance_id"],),
                ).fetchall()
            ]
            approvals.append(item)

    return approvals


@app.post("/api/approvals/{instance_id}/approve")
def approve_project(instance_id: int, user=Depends(get_current_user)):
    require_approver(user)

    with closing(get_connection()) as conn:
        with conn:
            project = conn.execute(
                """
                SELECT p.name
                FROM project_instances pi
                JOIN projects p ON p.id = pi.project_id
                WHERE pi.id = ? AND pi.status = 'PENDING_APPROVAL'
                """,
                (instance_id,),
            ).fetchone()

            if not project:
                raise HTTPException(
                    status_code=404, detail="Pending approval not found"
                )

            conn.execute(
                """
                UPDATE project_instances
                SET status = 'PENDING_SIGNATURE',
                    approved_by = ?,
                    approved_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (user["id"], instance_id),
            )

            conn.execute(
                """
                INSERT INTO workflow_events (instance_id, actor_id, event_type)
                VALUES (?, ?, 'APPROVED')
                """,
                (instance_id, user["id"]),
            )

    email_sent = send_signature_email(
        user["email"], project["name"], instance_id
    )

    email_preview = {
        "to": user["email"],
        "subject": f"Signature required: {project['name']}",
        "body": (
            f"Hello {user['name']},\n\n"
            f"The project {project['name']} has been approved. "
            f"Please log in to the Approval Portal to review and sign it.\n\n"
            f"{FRONTEND_URL}"
        ),
    }

    with closing(get_connection()) as conn:
        with conn:
            conn.execute(
                """
                INSERT INTO workflow_events (instance_id, actor_id, event_type)
                VALUES (?, ?, ?)
                """,
                (
                    instance_id,
                    user["id"],
                    "SIGNATURE_EMAIL_SENT" if email_sent else "SIGNATURE_EMAIL_PREVIEWED",
                ),
            )

    return {
        "message": "Project approved",
        "status": "PENDING_SIGNATURE",
        "email_sent": email_sent,
        "email_preview": email_preview,
    }


@app.get("/api/signatures")
def get_pending_signatures(user=Depends(get_current_user)):
    require_approver(user)

    with closing(get_connection()) as conn:
        rows = conn.execute(
            """
            SELECT pi.id AS instance_id, p.name AS project_name,
                   u.name AS requested_by
            FROM project_instances pi
            JOIN projects p ON p.id = pi.project_id
            JOIN users u ON u.id = pi.created_by
            WHERE pi.status = 'PENDING_SIGNATURE' AND pi.approved_by = ?
            """,
            (user["id"],),
        ).fetchall()

        signatures = []

        for row in rows:
            item = dict(row)
            item["documents"] = [
                dict(document)
                for document in conn.execute(
                    "SELECT id, filename FROM documents WHERE instance_id = ?",
                    (item["instance_id"],),
                ).fetchall()
            ]
            signatures.append(item)

    return signatures


@app.post("/api/signatures/{instance_id}/sign")
def sign_project(
    instance_id: int,
    data: SignatureRequest,
    user=Depends(get_current_user),
):
    require_approver(user)

    if data.signer_name.strip().casefold() != user["name"].casefold():
        raise HTTPException(
            status_code=400,
            detail="Signature name does not match logged-in user",
        )

    with closing(get_connection()) as conn:
        with conn:
            cursor = conn.execute(
                """
                UPDATE project_instances
                SET status = 'COMPLETED',
                    signed_by = ?,
                    signed_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND status = 'PENDING_SIGNATURE'
                  AND approved_by = ?
                """,
                (user["id"], instance_id, user["id"]),
            )

            if cursor.rowcount == 0:
                raise HTTPException(
                    status_code=404, detail="Pending signature not found"
                )

            conn.execute(
                """
                INSERT INTO workflow_events (instance_id, actor_id, event_type)
                VALUES (?, ?, 'SIGNED')
                """,
                (instance_id, user["id"]),
            )

    return {"message": "Document signed successfully", "status": "COMPLETED"}

@app.get("/api/completed")
def get_completed_projects(user=Depends(get_current_user)):
    if user["role"] == "APPROVER":
        filter_column = "pi.approved_by"
    else:
        filter_column = "pi.created_by"

    with closing(get_connection()) as conn:
        projects = conn.execute(
            f"""
            SELECT
                pi.id AS instance_id,
                p.name AS project_name,
                u.name AS requester,
                pi.signed_at
            FROM project_instances pi
            JOIN projects p ON p.id = pi.project_id
            JOIN users u ON u.id = pi.created_by
            WHERE pi.status = 'COMPLETED'
              AND {filter_column} = ?
            ORDER BY pi.signed_at DESC
            """,
            (user["id"],),
        ).fetchall()

        result = []
        for project in projects:
            documents = conn.execute(
                """
                SELECT id, filename
                FROM documents
                WHERE instance_id = ?
                ORDER BY uploaded_at
                """,
                (project["instance_id"],),
            ).fetchall()

            result.append({
                **dict(project),
                "documents": [dict(document) for document in documents],
            })

    return result