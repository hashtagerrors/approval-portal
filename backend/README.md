# Approval Portal — Node.js backend

This backend replaces the Python/FastAPI backend with **Node.js, Express and TypeScript** while preserving the existing React frontend API contract.

## Important: preserve existing data

The application expects the existing SQLite database at:

```text
approval-portal/
  storage/
  backend/
    approval_portal.db
    schema.sql
    package.json
    src/
```

The backend reads the existing database from `backend/approval_portal.db` and the schema from `backend/schema.sql`. Keep both files in place. Keep the existing `storage/` directory at the project root so previously uploaded PDFs remain available.

Do not delete the Python backend until the Node backend has been tested successfully.

## Setup

Run these commands from the new `backend` folder:

```powershell
npm install
Copy-Item .env.example .env
```

Edit `.env` and set a long random `APP_SECRET`. SMTP values are optional; without them, the approval flow returns a local email preview.

Start development server:

```powershell
npm run dev
```

API: http://localhost:8000  
Health check: http://localhost:8000/health

Build and run:

```powershell
npm run build
npm start
```

## Existing frontend

No frontend API changes should be required. Keep the frontend API base URL as `http://localhost:8000` and continue using `credentials: "include"` for requests.

## Demo accounts

If you need to create seed users/projects in a fresh database:

```powershell
npm run seed
```

- User: `user@example.com` / `UserDemo123!`
- Approver: `approver@example.com` / `ApproverDemo123!`

`INSERT OR IGNORE` preserves existing users. If you already have the Python-created database, do not run the seed command unless you need to ensure the demo records exist.

## Endpoints

- `POST /api/login`, `POST /api/logout`, `GET /api/me`
- `GET /api/projects`, `POST /api/projects/:projectId/start`
- `POST /api/projects/instances/:instanceId/documents`
- `GET /api/documents/:documentId/view`
- `POST /api/projects/instances/:instanceId/request-approval`
- `GET /api/approvals`, `POST /api/approvals/:instanceId/approve`
- `GET /api/signatures`, `POST /api/signatures/:instanceId/sign`
- `GET /api/completed`

## Notes

- PDF uploads are limited to 10 MB and validated by PDF content signature.
- Files are stored under the root `storage/` directory.
- Authentication uses a signed HTTP-only cookie compatible with the existing React frontend.
- The typed-name signature is an application audit record, not a cryptographic or legally certified digital signature.
- For production, use HTTPS, a strong secret manager value, managed database/storage, and stricter operational controls.
