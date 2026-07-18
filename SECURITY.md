# Security Policy

## Supported versions

SlopShady is a single-`main`-branch project. Only the latest commit on `main` and tagged releases receive security fixes.

## Reporting a vulnerability

If you discover a security issue, **please do not open a public GitHub issue**. Instead, report it privately:

- Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) ("Report a vulnerability" on the **Security** tab), or
- Open a private security advisory in the repository.

Please include a description of the issue, reproduction steps, and any relevant logs or screenshots. You should receive an initial response within a few days.

## Important security notes

Please read these before running SlopShady, especially if you intend to expose it beyond your local machine.

### Self-signed HTTPS certificate (local-only by design)

SlopShady generates a self-signed `cert.pem` / `key.pem` into the `--data-dir` on first run so that `https://localhost:8100` works (the Web MIDI API and several other browser features require a secure context). **This certificate is not signed by any trusted authority** and is intended for local use only. Browsers will warn about it; the native webview builds ignore TLS errors via the patched `wry` so the warning is bypassed automatically in the desktop window.

Do **not** expose the server to untrusted networks without replacing the self-signed certificate with one from a real CA, and do **not** treat the TLS channel as authenticated.

### Bearer keys (LLM API credentials)

The LLM proxy in `slopshady/src/llm.rs` forwards the `bearerKey` you enter in the UI to your configured OpenAI-compatible endpoint (LM Studio, etc.). Be aware that:

- The key is sent from the browser to the local Rust backend in the request body, then attached as an `Authorization: Bearer` header to the upstream call.
- **The full-state JSON export (`Ctrl+S`, or "Save to JSON") includes `bearerKey` in plaintext.** See [README.md — Save/Load System](README.md#saveload-system). Do not share full save files publicly if they contain credentials. Shaders-only exports do not include the key.
- The key is **never** written to `shaders.json` (it is not in `PERSIST_KEYS`) and is **never** committed by the project.

### LLM endpoint URL validation

The backend rejects non-`http`/`https` URL schemes (`file://`, `ftp://`, etc.) in the configured LLM endpoint to prevent SSRF-style abuse via `lm_studio_url`. See `validate_lm_url` in `slopshady/src/llm.rs`.

### Attack surface

SlopShady binds its HTTPS server to `0.0.0.0:8100` by default and the OSC UDP bridge to `0.0.0.0:8101`. Both are reachable by anything on your local network. If that is not desired, run behind a firewall or restrict binding. The WebSocket and HTTP APIs perform no authentication — they are designed for single-user local use.
