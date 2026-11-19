# AI Usage Notes

## Tools used

- **ChatGPT (OpenAI):** Used as a development assistant during implementation and debugging. It helped reason through the API/UI workflow, suggest code changes, diagnose frontend state and response-handling issues, and prepare documentation and test cases.
- **VS Code:** Used as the development environment to edit and run the application. No claim is made here that an AI coding extension inside VS Code was used.

AI-generated suggestions were reviewed against the running application and the actual source code. The developer remained responsible for applying changes and verifying behavior.

## Example prompts

1. "Design a clean, presentable dashboard for the user and approver roles without changing the existing API workflow."
5. "Create a short AWS deployment design for this React and Express application, covering hosting, database, uploaded PDFs, security and CI/CD."

## Example of an AI mistake and how it was corrected

A separate login-state issue came from treating the login response as though the user's name were at the top level. The API actually returns the user inside a `user` object (`{ "user": { ... } }`). Reading `data.name` therefore produced an undefined value. The code was corrected to read `data.user.name`, and the session-restore path was made tolerant of the `{ user: ... }` response shape returned by `/api/me`.

The lesson was to inspect the real API response and trace the value through the component state, rather than accepting a plausible fix based only on the visible symptom. The application was then retested by signing in as both roles and exercising the approval/signature flow.