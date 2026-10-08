# PulseDrop Web Dashboard

Node.js and Express dashboard/API for the PulseDrop Android client. The app files are at this repository root; `public/` contains the browser UI and `scripts/` contains setup utilities.

## Run locally

Requires Node.js and npm. From the repository root:

```sh
npm install
node scripts/set-password.js
export SESSION_SECRET="$(openssl rand -hex 32)"
export DEVICE_TOKEN="$(openssl rand -hex 32)"
export USE_HTTPS=false
npm start
```

Open `http://localhost:3000`. The password script stores the admin password hash in `.admin_hash` (ignored by Git); set `ADMIN_USER` to the username entered in that script if it is not `admin`. `OPENAI_API_KEY` is optional and only needed for transcription/translation.

For HTTPS hosting, set `USE_HTTPS=true` and provide `SSL_KEY`, `SSL_CERT`, and optionally `HTTPS_PORT`. Use strong, private values for `SESSION_SECRET` and `DEVICE_TOKEN`; do not commit them.

Use only on devices you own or with the device owner's explicit, informed consent.
