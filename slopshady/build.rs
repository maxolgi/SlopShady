use std::fs;
use std::path::Path;

/// Recursively mirror `.js` and `.mjs` files from `src` into `out`, preserving
/// relative structure and source bytes. Files with other extensions (.ts) are
/// skipped here — they're handled by `tsc` separately.
///
/// We bypass tsc's emit pass for `.js` files because TypeScript's printer
/// reformats hand-edited source (collapses single-line ifs, normalizes
/// whitespace, expands/compresses braces). For Phase 1 (all source is `.js`)
/// this keeps the byte-for-byte source-of-truth intact. Phase 3's `.ts`
/// files go through tsc and adopt tsc's formatting naturally since they're
/// new files.
fn mirror_js_files(src: &Path, out: &Path) -> std::io::Result<()> {
    if out.exists() {
        fs::remove_dir_all(out)?;
    }
    fs::create_dir_all(out)?;
    copy_dir_recursive(src, out)
}

fn copy_dir_recursive(src: &Path, out: &Path) -> std::io::Result<()> {
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name();
        let dest = out.join(&name);
        if path.is_dir() {
            fs::create_dir_all(&dest)?;
            copy_dir_recursive(&path, &dest)?;
        } else if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
            if ext == "js" || ext == "mjs" {
                fs::copy(&path, &dest)?;
            }
            // .ts files are skipped — tsc handles them
        }
    }
    Ok(())
}

/// True if any `.ts` file exists under `src` (recursive).
fn has_ts_files(src: &Path) -> bool {
    if !src.is_dir() {
        return false;
    }
    if let Ok(entries) = fs::read_dir(src) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if has_ts_files(&path) {
                    return true;
                }
            } else if path.extension().and_then(|s| s.to_str()) == Some("ts") {
                return true;
            }
        }
    }
    false
}

/// Walk all `.js` files under `dir` and append `.js` to extensionless
/// relative import specifiers (`from './foo'` → `from './foo.js'`).
/// Needed because the WebSRT submodule's TS uses extensionless specifiers
/// (standard TS style) which browsers can't resolve in native ES modules.
fn rewrite_vendor_imports(dir: &Path) {
    fn visit(dir: &Path) {
        let Ok(entries) = fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                visit(&path);
                continue;
            }
            if path.extension().and_then(|s| s.to_str()) != Some("js") {
                continue;
            }
            let Ok(contents) = fs::read_to_string(&path) else { continue };
            let rewritten = fix_extensionless_specifiers(&contents);
            if rewritten != contents {
                let _ = fs::write(&path, rewritten);
            }
        }
    }
    visit(dir);
}

/// In a single line of JS, find `from '...'` / `from "..."` specifiers that
/// are relative paths (start with `./` or `../`) but lack a file extension,
/// and append `.js`.
fn fix_extensionless_specifiers(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    for line in src.lines() {
        let fixed = fix_line(line);
        out.push_str(&fixed);
        out.push('\n');
    }
    out
}

fn fix_line(line: &str) -> String {
    // Quick skip: no `from '` or `from "` on this line.
    if !line.contains("from '") && !line.contains("from \"") {
        return line.to_string();
    }
    let chars: Vec<char> = line.chars().collect();
    let mut result = String::new();
    let mut i = 0;
    while i < chars.len() {
        // Look for `from '` or `from "`
        if i + 6 < chars.len()
            && chars[i] == 'f'
            && chars[i + 1] == 'r'
            && chars[i + 2] == 'o'
            && chars[i + 3] == 'm'
            && chars[i + 4] == ' '
            && (chars[i + 5] == '\'' || chars[i + 5] == '"')
        {
            let quote = chars[i + 5];
            result.push_str("from ");
            result.push(quote);
            i += 6;
            // Collect the specifier until the closing quote.
            let start = i;
            while i < chars.len() && chars[i] != quote {
                result.push(chars[i]);
                i += 1;
            }
            let specifier: String = chars[start..i].iter().collect();
            // Check if it's a relative path without an extension.
            let needs_js = (specifier.starts_with("./") || specifier.starts_with("../"))
                && !specifier.ends_with(".js")
                && !specifier.ends_with(".mjs")
                && !specifier.ends_with(".json")
                && !specifier.ends_with("/")
                && !specifier.contains('?');
            if needs_js {
                // Append .js before the closing quote.
                result.push_str(".js");
            }
            // The closing quote (if present) is consumed by the outer loop.
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }
    result
}

fn main() {
    #[cfg(target_os = "windows")]
    {
        let mut res = winres::WindowsResource::new();
        res.set_icon("icon.ico");
        if let Err(e) = res.compile() {
            println!("cargo:warning = failed to compile windows resource: {e}");
        }
    }

    let repo_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let src_js = repo_root.join("src").join("js");
    let out_js = repo_root.join("static").join("js");
    let vendor_src = repo_root.join("vendor").join("WebSRT").join("web").join("src");

    println!("cargo:rerun-if-changed={}", src_js.display());
    println!("cargo:rerun-if-changed={}", vendor_src.display());
    println!("cargo:rerun-if-changed={}/tsconfig.json", repo_root.display());
    println!("cargo:rerun-if-changed={}/tsconfig.emit.json", repo_root.display());
    println!("cargo:rerun-if-changed={}/tsconfig.vendor.json", repo_root.display());
    println!("cargo:rerun-if-changed={}/package.json", repo_root.display());
    println!("cargo:rerun-if-changed={}/src/types", repo_root.display());

    // Step 1: Mirror `.js` and `.mjs` files verbatim from src/js → static/js.
    // rust-embed's #[folder = "../static/"] picks these up unchanged.
    if let Err(e) = mirror_js_files(&src_js, &out_js) {
        panic!(
            "failed to mirror {} → {}: {}",
            src_js.display(),
            out_js.display(),
            e
        );
    }

    // Step 2: Compile upstream WebSRT viewer `.ts` files via tsc.vendor FIRST,
    // so its .d.ts declarations exist when SlopShady's tsc.emit runs. The
    // submodule is canonical; we only emit the .js + .d.ts artifacts here,
    // never modify the source. Produces decode.js + demux.js (and .d.ts).
    //
    // demux.ts imports the mpeg2ts-wasm .d.ts via a relative specifier
    // (`../wasm/mpeg2ts-wasm/mpeg2ts_wasm.js`). tsc paths mappings don't
    // apply to relative specifiers, so we stage the .d.ts at the expected
    // physical location (vendor/WebSRT/web/wasm/mpeg2ts-wasm/) before tsc
    // runs. Files are untracked in the submodule; regenerated every build.
    //
    // We then post-process emitted demux.js (and demux.d.ts) to rewrite the
    // upstream-relative `../wasm/mpeg2ts-wasm/...` import specifier to
    // SlopShady's absolute `/wasm/mpeg2ts-wasm/...` path. Upstream's web/
    // layout has wasm/ as a sibling of src/; SlopShady serves wasm from
    // static/wasm/ at /wasm/. Without this rewrite the emitted demux.js
    // would 404 at runtime.
    let vendor_out = repo_root.join("static").join("vendor").join("WebSRT").join("web").join("src");

    // Stage mpeg2ts-wasm .d.ts files where tsc expects them.
    let stage_dir = repo_root.join("vendor").join("WebSRT").join("web").join("wasm").join("mpeg2ts-wasm");
    let wasm_src_dir = repo_root.join("static").join("wasm").join("mpeg2ts-wasm");
    if wasm_src_dir.exists() {
        if let Err(e) = fs::create_dir_all(&stage_dir) {
            panic!("failed to create {}: {}", stage_dir.display(), e);
        }
        match fs::read_dir(&wasm_src_dir) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let is_dts = path.file_name()
                        .and_then(|s| s.to_str())
                        .map(|n| n.ends_with(".d.ts"))
                        .unwrap_or(false);
                    if is_dts {
                        let dest = stage_dir.join(entry.file_name());
                        if let Err(e) = fs::copy(&path, &dest) {
                            panic!("failed to copy {} → {}: {}", path.display(), dest.display(), e);
                        }
                    }
                }
            }
            Err(e) => panic!("failed to read_dir {}: {}", wasm_src_dir.display(), e),
        }
    }

    if has_ts_files(&vendor_src) {
        let tsc_bin = repo_root.join("node_modules").join(".bin").join("tsc");
        if !tsc_bin.exists() {
            panic!(
                "TypeScript files found under {} but tsc is not installed.\n\
                 Run `npm install` in {} (the repo root), then rebuild.",
                vendor_src.display(),
                repo_root.display()
            );
        }
        let status = std::process::Command::new(&tsc_bin)
            .current_dir(&repo_root)
            .arg("-p")
            .arg("tsconfig.vendor.json")
            .status();
        match status {
            Ok(s) if s.success() => {}
            Ok(s) => panic!("tsc -p tsconfig.vendor.json failed with status {}", s),
            Err(e) => panic!(
                "failed to invoke tsc -p tsconfig.vendor.json at {}: {}",
                tsc_bin.display(),
                e
            ),
        }

        // Rewrite the WASM import path in emitted demux.{js,d.ts}. The exact
        // upstream specifier is `'../wasm/mpeg2ts-wasm/mpeg2ts_wasm.js'` —
        // panic if it's not found so a future submodule bump that changes
        // the path surfaces here, not as a silent runtime 404.
        for fname in ["demux.js", "demux.d.ts"] {
            let path = vendor_out.join(fname);
            if !path.exists() {
                continue;
            }
            let contents = fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("failed to read {}: {}", path.display(), e));
            let needle = "'../wasm/mpeg2ts-wasm/mpeg2ts_wasm.js'";
            let replacement = "'/wasm/mpeg2ts-wasm/mpeg2ts_wasm.js'";
            if !contents.contains(needle) {
                panic!(
                    "expected to find `{}` in {}; upstream specifier may have changed",
                    needle,
                    path.display()
                );
            }
            let rewritten = contents.replace(needle, replacement);
            fs::write(&path, rewritten)
                .unwrap_or_else(|e| panic!("failed to write {}: {}", path.display(), e));
        }

        // Rewrite extensionless relative imports in emitted vendor .js files.
        // The WebSRT submodule's TS source uses extensionless specifiers
        // (standard TS with moduleResolution: "Bundler"), but browsers require
        // explicit .js extensions in native ES module imports. Without this,
        // `import { looksLikeAv1 } from './shared/av1'` 404s in the browser.
        rewrite_vendor_imports(&vendor_out);
    }

    // Step 3: Compile SlopShady's `.ts` files under src/js via tsc.emit.
    // Writes to static/js/. Now that vendor .d.ts files exist (Step 2),
    // the upstream decode/demux imports type-check properly.
    if has_ts_files(&src_js) {
        let tsc_bin = repo_root.join("node_modules").join(".bin").join("tsc");
        if !tsc_bin.exists() {
            panic!(
                "TypeScript files found under {} but tsc is not installed.\n\
                 Run `npm install` in {} (the repo root), then rebuild.",
                src_js.display(),
                repo_root.display()
            );
        }
        let status = std::process::Command::new(&tsc_bin)
            .current_dir(&repo_root)
            .arg("-p")
            .arg("tsconfig.emit.json")
            .status();
        match status {
            Ok(s) if s.success() => {}
            Ok(s) => panic!("tsc -p tsconfig.emit.json failed with status {}", s),
            Err(e) => panic!(
                "failed to invoke tsc -p tsconfig.emit.json at {}: {}",
                tsc_bin.display(),
                e
            ),
        }
    }
}
