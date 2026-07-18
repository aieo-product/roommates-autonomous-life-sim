# ROOMMATES repository guidance

## Sites deployment

- This repository already has a Sites project. Never create a replacement site for a normal update.
- Reuse the `project_id` and bindings in `.openai/hosting.json` so every release keeps the same public URL.
- Before publishing, run `npm run prepare:sites`. It rebuilds the web app and Worker, assembles the Sites layout, validates required files, and writes `.sites/roommates-sites.tgz`.
- Use the `sites-building` and `sites-hosting` skills for every publish. If there is no still-valid credential in the active session, request a fresh source write credential for the existing project. Never save that credential in a file, remote URL, or Git configuration.
- Push the exact validated source, save one new version from `.sites/roommates-sites.tgz`, deploy it, and poll until it succeeds.
- Preserve public access and confirm that the deployed URL is `https://roommates-heart-game.donald-25.chatgpt.site`.
- If the D1 schema changes, generate and inspect a new migration under `drizzle/` before running `npm run prepare:sites`.
