# FIXA — Secure Cloud File Storage

An English-only, gold-and-black file vault with an animated security loader, admin-key login, uploads, search, downloads, and deletion.

## Requirements

- Node.js 20 or newer
- A server/host with persistent disk storage
- HTTPS for any public deployment

## Run locally

1. Install Node.js.
2. Extract this project and open a terminal in the project folder.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Copy `.env.example` to `.env`.
5. Replace `ADMIN_KEY` with a long, unique secret (at least 16 characters). Replace `SESSION_SECRET` with a separate random secret (at least 32 characters). Do not share or commit `.env`.
6. Start the server:

   ```bash
   npm start
   ```

7. Open `http://localhost:3000` in your browser and enter the value configured as `ADMIN_KEY`.

## Online deployment

Deploy this Node.js project to a host that supports Node.js and persistent storage. Set the environment variables in the host's private dashboard; do not upload `.env` publicly.

Configure `DATA_DIR` and `UPLOAD_DIR` to persistent disk paths. If the host has an ephemeral filesystem, files may disappear during redeploys or restarts. Back up both the SQLite database and the uploaded files. Use HTTPS.

For production, replace Express's default in-memory session store with a persistent session store (for example, Redis or a compatible database-backed store). Configure rate limiting appropriately for your deployment and reverse proxy. Consider offloading files to private object storage such as an S3-compatible bucket when you need scalable storage. Keep the bucket private and authorize every download.

## Security notes

- The admin key is read from the server environment and is not embedded in browser JavaScript.
- Login requests are rate-limited, sessions use HTTP-only and SameSite cookies, and login rotates the session ID.
- Uploads are stored outside the public web directory. Downloads and file listing require authentication.
- File size is limited by `MAX_FILE_SIZE_MB` (default: 1024 MB).
- Uploading arbitrary file types is intentionally allowed for a private file vault. Only upload files you trust; downloaded APK/EXE files can be dangerous.
- This starter uses Express's in-memory session store, which is not suitable for a production multi-instance deployment. Configure a persistent session store before relying on it for production.
- The app does not claim end-to-end encryption. Use a reputable HTTPS-enabled host, private persistent storage, access controls, and backups.

## Storage paths

- `DATA_DIR`: SQLite metadata database
- `UPLOAD_DIR`: private uploaded file contents

Keep both paths on persistent disk in production.
