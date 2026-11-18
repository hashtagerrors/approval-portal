
import os
from contextlib import closing
import hashlib

def hash_password(password):
    salt = os.urandom(16)
    hashed = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt, 600_000
    )
    return f"{salt.hex()}:{hashed.hex()}"
from database import get_connection
    
users = [
    ("Demo User", "user@example.com", os.getenv("DEMO_USER_PASSWORD", "UserDemo123!"), "USER"),
    ("User A", "approver@example.com", os.getenv("DEMO_APPROVER_PASSWORD", "ApproverDemo123!"), "APPROVER"),
]

projects = [
    ("Vendor Onboarding", "Register and approve a new vendor."),
    ("New Product Launch", "Review and approve a new product launch."),
    ("Contract Renewal", "Review and approve a contract renewal."),
]

with closing(get_connection()) as conn:
    with conn:
        for name, email, password, role in users:
            conn.execute(
                """
                INSERT INTO users (name, email, password_hash, role)
                VALUES (?, ?, ?, ?)
                """,
                (name, email, hash_password(password), role),
            )

        for name, description in projects:
            conn.execute(
                """
                INSERT INTO projects (name, description)
                SELECT ?, ?
                WHERE NOT EXISTS (
                    SELECT 1 FROM projects WHERE name = ?
                )
                """,
                (name, description, name),
            )

print("Demo data seeded successfully.")
