# CipherShare

A minimal end-to-end encrypted file-sharing prototype. Files are encrypted and
decrypted in the browser; the Node server stores only opaque ciphertext.

## Run

Requires Node.js 18 or newer. There are no package dependencies.

```bash
npm start
```

Open <http://127.0.0.1:3000>, choose a file, and send the generated link to the
recipient. Uploaded encrypted blobs are stored in `storage/`.

Run the server tests with:

```bash
npm test
```

Run the browser end-to-end test with:

```bash
npx playwright install chromium
npm run test:e2e
```

## Security design

- The browser generates a random 256-bit AES-GCM key and 96-bit nonce for each file.
- Filename, MIME type, and file bytes are packed and authenticated-encrypted together.
- Only the versioned envelope (`CS01`, nonce, ciphertext, authentication tag) is uploaded.
- The key is base64url encoded in the share URL fragment (`#...`). URL fragments are
  not included in HTTP requests, so the server receives the random file ID but not the key.
- A recipient may also receive the secret separately and paste it into the app.
- A wrong key or modified ciphertext fails AES-GCM authentication and shows a clear error.

This is deliberately demo-grade: files are processed fully in browser memory, capped
at 24 MB, never expire, and have no authentication or deletion flow. The server can
observe ciphertext size, timing, IP addresses, and file IDs. In production, add
streaming/chunked authenticated encryption, quotas, expiration, authenticated access,
malware/product controls appropriate to encrypted storage, TLS, and an independently
audited protocol and implementation. As with any web-based E2EE app, a compromised
server could serve malicious JavaScript that steals plaintext or keys; production
systems need controls such as trusted/native clients or verifiable signed assets.
