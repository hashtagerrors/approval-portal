# Approval Portal

A lightweight full-stack document approval workflow built with React, Node.js, Express, TypeScript and SQLite.

## Features

- Demo login with separate `USER` and `APPROVER` roles
- Project selection and project-instance creation
- PDF upload with a 10 MB limit and basic PDF signature validation
- Approval request and approver review
- Signature email delivery when SMTP is configured, or a local email preview otherwise
- Typed-name signing tied to the authenticated approver
- Completed-project views for both the requester and approver

## Tech stack

| Area | Technology |
|---|---|
| Frontend | React, JavaScript, Vite |
| Backend | Node.js, Express, TypeScript |
| Database | SQLite using `better-sqlite3` |
| Authentication | Signed HTTP-only session cookie |
| File storage (local) | Local `storage/` directory |
| Email | Nodemailer (optional SMTP) |

## Prerequisites

- Node.js 22 LTS (recommended for the native `better-sqlite3` dependency)
- npm
- Windows PowerShell, macOS Terminal or Linux shell

## Project structure

```text
approval-portal/
├── frontend/              # React + Vite application
├── backend/
│   ├── src/               # Express API and database/authentication code
│   ├── tests/              # Backend unit tests
│   ├── schema.sql
│   ├── approval_portal.db # Local SQLite database (created/used by backend)
│   ├── package.json
│   └── .env
└── storage/                # Uploaded PDFs, grouped by project instance
```

Keep the existing `backend/approval_portal.db`, `backend/schema.sql` and root `storage/` directory when using the supplied demo data. Do not delete the database or storage directory when updating application code.

## Run locally

Open two terminals from the project root.

### 1. Start the backend

```powershell
cd backend
npm install
```

Create the environment file:

```powershell
Copy-Item .env.example .env
```

Set a long, random `APP_SECRET` in `backend/.env`. The SMTP settings are optional. If they are not configured, approving a project returns an email preview instead of sending an email.

Start the API:

```powershell
npm run dev
```

The API runs at `http://localhost:8000`.

Check it at `http://localhost:8000/health`; the expected response is:

```json
{"status":"ok"}
```

### 2. Start the frontend

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal (normally `http://localhost:5173`).

The frontend currently uses `http://localhost:8000` as its API base URL. Both frontend and backend must be running.

### 3. Demo accounts

If the existing database does not contain the demo users and projects, run this once from `backend/`:

```powershell
npm run seed
```

| Role | Email | Password |
|---|---|---|
| User | `user@example.com` | `UserDemo123!` |
| Approver | `approver@example.com` | `ApproverDemo123!` |

The seed operation uses insert-if-missing behavior. It is intended for local demonstration, not production account provisioning.

## Run tests and build

From `backend/`:

```powershell
npm test
npm run build
```

`npm test` runs focused unit tests for PDF validation, signer-name matching and document access rules. `npm run build` compiles the TypeScript backend into `dist/`.

To run the compiled backend:

```powershell
npm start
```

## Typical workflow

1. Sign in as the demo user.
2. Select a project and start it.
3. Upload one or more PDF documents.
4. Submit the project for approval.
5. Sign out and sign in as the approver.
6. Review the PDF and approve the request.
7. Sign the approved document using the approver's authenticated name.
8. View the completed project from either account.

## Key design decisions

- **React + Vite:** keeps the UI small and quick to iterate on for a time-boxed demo.
- **Express + TypeScript:** provides a straightforward REST API with typed request/user contracts, without introducing a larger framework.
- **SQLite:** keeps local setup simple and makes the assessment easy to run without provisioning a database server.
- **Local PDF storage:** avoids adding cloud infrastructure to the local demo. Files are stored outside the frontend's public directory and served through an authenticated API route.
- **Role checks in the API:** the backend enforces approver-only actions and document visibility; the UI is not treated as the security boundary.
- **HTTP-only signed session cookie:** keeps the session token out of browser JavaScript. The local setup uses a development secret; production must use a strong secret and HTTPS.
- **SMTP is optional:** the workflow can be demonstrated without external email credentials, while still showing the email content as a preview.
- **Typed-name signature:** records the authenticated approver's action in the workflow. It is an audit marker for this demo, not a cryptographic or legally certified digital signature.

## Trade-offs and known limitations

- SQLite and local disk storage are suitable for a single-instance demo, but are not appropriate shared infrastructure for a horizontally scaled production deployment.
- The application uses a small custom cookie-session implementation rather than a managed identity provider.
- The frontend API base URL is currently a local constant rather than environment-specific configuration.
- The email preview is intentionally used when SMTP is absent or delivery fails; this does not prove delivery.
- The current tests focus on important validation and access-control rules. Full API integration tests and browser end-to-end tests are not yet included.
- The current typed-name signature does not provide signer identity verification beyond the authenticated session and name comparison.

## What I would improve with more time

1. Add API integration tests for the complete workflow, including login, upload, approval, signing and negative authorization cases.
2. Add frontend component tests and Playwright end-to-end tests for both roles.
3. Move authentication to a managed identity provider or a hardened server-side session store; add CSRF protection, rate limiting and account lockout controls.
4. Replace SQLite/local disk with RDS PostgreSQL and private S3 storage; use short-lived, authorization-checked download links or stream files through the API.
5. Add malware scanning, stronger content inspection, file retention rules and audit-log export.
6. Add pagination, filtering, clearer workflow history and structured operational logging.
7. Add CI/CD, automated dependency/security scanning, infrastructure as code and separate development/staging/production environments.
8. For legally binding signatures, integrate a compliant e-signature provider rather than treating a typed name as a digital signature.