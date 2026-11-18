from contextlib import closing
import hashlib
import hmac
import os
import time

from fastapi import FastAPI, Depends, HTTPException, Request, Response
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
