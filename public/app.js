const MAX_PLAINTEXT_BYTES = 24 * 1024 * 1024;
const MAGIC = new TextEncoder().encode("CS01");
const uploadForm = document.querySelector("#upload-form");
const fileInput = document.querySelector("#file-input");
const fileLabel = document.querySelector("#file-label");
const uploadStatus = document.querySelector("#upload-status");
const shareResult = document.querySelector("#share-result");
const receiveView = document.querySelector("#receive-view");
const sendView = document.querySelector("#send-view");
const decryptForm = document.querySelector("#decrypt-form");
const secretInput = document.querySelector("#secret-input");
const decryptStatus = document.querySelector("#decrypt-status");
const downloadResult = document.querySelector("#download-result");
let currentObjectUrl;

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid secret format.");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function setStatus(element, message, kind = "") {
  element.hidden = false;
  element.textContent = message;
  element.className = `status ${kind}`.trim();
}

function packFile(file, content) {
  const metadata = new TextEncoder().encode(JSON.stringify({
    name: file.name,
    type: file.type || "application/octet-stream",
  }));
  const packed = new Uint8Array(4 + metadata.length + content.byteLength);
  new DataView(packed.buffer).setUint32(0, metadata.length);
  packed.set(metadata, 4);
  packed.set(new Uint8Array(content), 4 + metadata.length);
  return packed;
}

function unpackFile(plaintext) {
  if (plaintext.byteLength < 5) throw new Error("Invalid encrypted file.");
  const view = new DataView(plaintext);
  const metadataLength = view.getUint32(0);
  if (metadataLength > plaintext.byteLength - 4) throw new Error("Invalid encrypted file.");
  const metadata = JSON.parse(new TextDecoder().decode(plaintext.slice(4, 4 + metadataLength)));
  if (typeof metadata.name !== "string" || typeof metadata.type !== "string") throw new Error("Invalid metadata.");
  return {
    name: metadata.name.replaceAll("/", "_").replaceAll("\\", "_"),
    type: metadata.type,
    bytes: plaintext.slice(4 + metadataLength),
  };
}

async function encryptFile(file) {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const packed = packFile(file, await file.arrayBuffer());
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, packed));
  const envelope = new Uint8Array(MAGIC.length + iv.length + ciphertext.length);
  envelope.set(MAGIC);
  envelope.set(iv, MAGIC.length);
  envelope.set(ciphertext, MAGIC.length + iv.length);
  return { envelope, secret: bytesToBase64Url(rawKey) };
}

async function decryptEnvelope(envelope, secret) {
  if (envelope.byteLength < 33 || !MAGIC.every((byte, index) => envelope[index] === byte)) {
    throw new Error("This is not a supported encrypted file.");
  }
  const rawKey = base64UrlToBytes(secret.trim());
  if (rawKey.byteLength !== 32) throw new Error("The secret must be a 256-bit key.");
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
  const iv = envelope.slice(4, 16);
  const ciphertext = envelope.slice(16);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return unpackFile(plaintext);
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  fileLabel.textContent = file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB` : "Up to 25 MB";
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;
  if (file.size > MAX_PLAINTEXT_BYTES) {
    setStatus(uploadStatus, "That file is too large. Choose a file under 24 MB.", "error");
    return;
  }
  const button = uploadForm.querySelector("button");
  button.disabled = true;
  shareResult.hidden = true;
  try {
    setStatus(uploadStatus, "Encrypting locally…");
    const { envelope, secret } = await encryptFile(file);
    setStatus(uploadStatus, "Uploading encrypted data…");
    const response = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: envelope,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Upload failed.");
    const link = `${location.origin}/share/${result.id}#${secret}`;
    document.querySelector("#share-link").value = link;
    document.querySelector("#share-secret").value = secret;
    shareResult.hidden = false;
    setStatus(uploadStatus, "Encrypted upload complete.", "success");
  } catch (error) {
    setStatus(uploadStatus, error.message || "Could not encrypt and upload the file.", "error");
  } finally {
    button.disabled = false;
  }
});

async function copyFrom(selector, button) {
  await navigator.clipboard.writeText(document.querySelector(selector).value);
  const original = button.textContent;
  button.textContent = "Copied";
  setTimeout(() => { button.textContent = original; }, 1200);
}
document.querySelector("#copy-link").addEventListener("click", (event) => copyFrom("#share-link", event.currentTarget));
document.querySelector("#copy-secret").addEventListener("click", (event) => copyFrom("#share-secret", event.currentTarget));

decryptForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = location.pathname.split("/").filter(Boolean)[1];
  const button = decryptForm.querySelector("button");
  button.disabled = true;
  downloadResult.hidden = true;
  try {
    setStatus(decryptStatus, "Downloading encrypted data…");
    const response = await fetch(`/api/files/${encodeURIComponent(id)}`);
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || "Could not download the encrypted file.");
    }
    const envelope = new Uint8Array(await response.arrayBuffer());
    setStatus(decryptStatus, "Decrypting locally…");
    const file = await decryptEnvelope(envelope, secretInput.value);
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    const blob = new Blob([file.bytes], { type: file.type });
    currentObjectUrl = URL.createObjectURL(blob);
    const downloadLink = document.querySelector("#download-link");
    downloadLink.href = currentObjectUrl;
    downloadLink.download = file.name;
    document.querySelector("#decrypted-name").textContent = file.name;
    document.querySelector("#decrypted-details").textContent = `${(blob.size / 1024).toFixed(1)} KB · ${file.type}`;
    const preview = document.querySelector("#preview");
    preview.replaceChildren();
    if (file.type.startsWith("image/")) {
      const image = document.createElement("img");
      image.src = currentObjectUrl;
      image.alt = `Preview of ${file.name}`;
      preview.append(image);
    } else if (file.type.startsWith("text/") && blob.size < 1024 * 1024) {
      const pre = document.createElement("pre");
      pre.textContent = await blob.text();
      preview.append(pre);
    }
    downloadResult.hidden = false;
    setStatus(decryptStatus, "File decrypted successfully.", "success");
  } catch (error) {
    const message = error.name === "OperationError"
      ? "Decryption failed. Check that the secret is correct."
      : error.message || "Decryption failed.";
    setStatus(decryptStatus, message, "error");
  } finally {
    button.disabled = false;
  }
});

if (location.pathname.startsWith("/share/")) {
  sendView.hidden = true;
  receiveView.hidden = false;
  const fragmentSecret = location.hash.slice(1);
  if (fragmentSecret) secretInput.value = fragmentSecret;
}
