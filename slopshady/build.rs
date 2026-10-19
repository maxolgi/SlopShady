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
/// Needed because the QuicSRT-wasm submodule's TS uses extensionless
/// specifiers (standard TS style) which browsers can't resolve in native
/// ES modules.
fn rewrite_vendor_imports(dir: &Path) {
    fn visit(dir: &Path) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                visit(&path);
                continue;
            }
            if path.extension().and_then(|s| s.to_str()) != Some("js") {
                continue;
            }
            let Ok(contents) = fs::read_to_string(&path) else {
                continue;
            };
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

/// Newest file modification time under `dir` (recursive), skipping `target/`
/// and `pkg/` build-output directories. Returns `None` if `dir` is missing or
/// holds no files.
fn newest_mtime(dir: &Path) -> Option<std::time::SystemTime> {
    let entries = fs::read_dir(dir).ok()?;
    let mut newest: Option<std::time::SystemTime> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = entry.file_name();
            if name == "target" || name == "pkg" {
                continue;
            }
            if let Some(t) = newest_mtime(&path) {
                newest = Some(newest.map_or(t, |n| n.max(t)));
            }
        } else if let Ok(t) = path.metadata().and_then(|m| m.modified()) {
            newest = Some(newest.map_or(t, |n| n.max(t)));
        }
    }
    newest
}

/// True if any of the engine artifacts is missing or older than its
/// sources under `vendor/QuicSRT-wasm/`. Gates the emcc build so
/// day-to-day builds that don't touch the engine skip the cmake/em++ work.
fn engine_needs_rebuild(repo_root: &Path) -> bool {
    let sub = repo_root.join("vendor").join("QuicSRT-wasm");
    let built = sub.join("build").join("srt_engine.wasm");
    let built_mtime = match built.metadata().and_then(|m| m.modified()) {
        Ok(t) => t,
        Err(_) => return true, // never linked here (fresh clone / cleaned)
    };
    // Sources newer than the last link → relink (cmake recompiles the
    // static libs first — it is incremental). Missing sources count as
    // stale so a broken checkout surfaces rather than silently skipping.
    let mut newest = newest_mtime(&sub.join("harness"));
    for extra in [
        sub.join("js").join("engine_shim.c"),
        sub.join("build")
            .join("libquicsrt")
            .join("libquicsrt_receiver_core.a"),
        sub.join("build").join("libquicsrt").join("libsrt.a"),
    ] {
        if let Ok(t) = extra.metadata().and_then(|m| m.modified()) {
            newest = Some(newest.map_or(t, |n: std::time::SystemTime| n.max(t)));
        }
    }
    match newest {
        None => return true,
        Some(src) if src > built_mtime => return true,
        _ => {}
    }
    // Staged copy missing or older than the link output → restage (covers
    // `rm -rf static/vendor` and interrupted builds).
    let staged = repo_root
        .join("static")
        .join("vendor")
        .join("QuicSRT-wasm")
        .join("build")
        .join("srt_engine.wasm");
    match staged.metadata().and_then(|m| m.modified()) {
        Ok(t) => t < built_mtime,
        Err(_) => true,
    }
}

/// Locate an Emscripten toolchain binary (`emcmake` / `em++`). Resolution
/// order mirrors upstream QuicSRT-wasm's `source ~/emsdk/emsdk_env.sh`:
/// `$EMSDK/upstream/emscripten`, then `~/emsdk/upstream/emscripten`, then
/// PATH. Panics with install instructions when not found.
fn emscripten_bin(tool: &str) -> std::path::PathBuf {
    // Windows emsdk shims carry a .bat extension (same split as tsc_bin).
    let name = if cfg!(windows) {
        format!("{tool}.bat")
    } else {
        tool.to_string()
    };
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(emsdk) = std::env::var("EMSDK") {
        roots.push(Path::new(&emsdk).join("upstream").join("emscripten"));
    }
    if let Ok(home) = std::env::var("HOME") {
        roots.push(
            Path::new(&home)
                .join("emsdk")
                .join("upstream")
                .join("emscripten"),
        );
    }
    for root in &roots {
        let bin = root.join(&name);
        if bin.exists() {
            return bin;
        }
    }
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let bin = dir.join(&name);
            if bin.exists() {
                return bin;
            }
        }
    }
    panic!(
        "Emscripten binary `{tool}` not found (looked in $EMSDK, ~/emsdk, PATH). \
         The QuicSRT-wasm engine builds with emsdk: \
         git clone https://github.com/emscripten-core/emsdk ~/emsdk && \
         ~/emsdk/emsdk install latest && ~/emsdk/emsdk activate latest \
         (upstream CI pins 6.0.8)"
    );
}

/// Run a command in `cwd`, panicking with context on failure.
fn run_cmd(bin: &Path, args: &[&str], cwd: &Path, what: &str) {
    let display = format!("{} {}", bin.display(), args.join(" "));
    match std::process::Command::new(bin)
        .args(args)
        .current_dir(cwd)
        .status()
    {
        Ok(s) if s.success() => {}
        Ok(s) => panic!("{what} failed (status {s}): {display}"),
        Err(e) => panic!("failed to invoke {what} ({display}): {e}"),
    }
}

/// Build the QuicSRT C++ engine from `vendor/QuicSRT-wasm/` (mirrors
/// upstream `./build.sh lib` + `./build.sh engine`, invoked directly so it
/// works on any OS without a shell): configure + build libquicsrt's
/// receiver-only flavor and the srt static lib with Emscripten, then link
/// the single emcc engine module `build/srt_engine.mjs` + `.wasm` that
/// both the player and the publisher drive.
fn link_quicsrt_engine(sub: &Path) {
    if !sub.join(".git").exists() {
        panic!(
            "vendor/QuicSRT-wasm submodule not initialized — run \
             `git submodule update --init vendor/QuicSRT-wasm` and init its \
             nested deps (from inside it: `git submodule update --init \
             deps/libquicsrt` then `git -C deps/libquicsrt submodule \
             update --init deps/srt`)"
        );
    }
    // Configure once (CMakeCache gate); cmake is incremental after that.
    if !sub
        .join("build")
        .join("libquicsrt")
        .join("CMakeCache.txt")
        .exists()
    {
        let emcmake = emscripten_bin("emcmake");
        println!("cargo:warning=configuring libquicsrt receiver-only flavor (emcmake)...");
        run_cmd(
            &emcmake,
            &[
                "cmake",
                "-S",
                "deps/libquicsrt",
                "-B",
                "build/libquicsrt",
                "-DCMAKE_BUILD_TYPE=Release",
                "-DQUICSRT_ENABLE_WT=OFF",
                "-DQUICSRT_RECEIVER_ONLY=ON",
                "-DCMAKE_C_FLAGS=-pthread -fexceptions",
                "-DCMAKE_CXX_FLAGS=-pthread -fexceptions",
            ],
            sub,
            "emcmake configure",
        );
    }
    let nproc = std::thread::available_parallelism()
        .map(|n| n.get().to_string())
        .unwrap_or_else(|_| "4".to_string());
    run_cmd(
        Path::new("cmake"),
        &[
            "--build",
            "build/libquicsrt",
            "-j",
            &nproc,
            "--target",
            "quicsrt_receiver_core",
        ],
        sub,
        "cmake --build quicsrt_receiver_core",
    );

    // Link the engine module. The flag list is intentionally verbatim from
    // upstream build.sh (EXPORTED_FUNCTIONS evolves with the engine C ABI)
    // so drift shows up as a link error here rather than a silent API gap.
    println!("cargo:warning=linking srt_engine.mjs (em++)...");
    let emxx = emscripten_bin("em++");
    run_cmd(
        &emxx,
        &[
            "harness/receiver.cpp",
            "harness/stats_map.cpp",
            "harness/ts_demux.cpp",
            "harness/nal.cpp",
            "harness/aes3.cpp",
            "harness/meter.cpp",
            "harness/ts_muxer.cpp",
            "js/engine_shim.c",
            "build/libquicsrt/libquicsrt_receiver_core.a",
            "build/libquicsrt/libsrt.a",
            "-o",
            "build/srt_engine.mjs",
            "-fexceptions",
            "-ffp-contract=off",
            "-pthread",
            "-sUSE_PTHREADS=1",
            "-sALLOW_MEMORY_GROWTH=1",
            "-Os",
            "-sMODULARIZE=1",
            "-sEXPORT_NAME=createSrtEngineModule",
            "-sEXPORT_ES6=1",
            "-sEXPORTED_FUNCTIONS=_srtw_init,_srtw_engine_new,_srtw_engine_receiver,_srtw_handle_datagram,_srtw_poll,_srtw_send_message,_srtw_poll_outgoing,_srtw_dropped_outgoing,_srtw_get_stats,_srtw_engine_free,_srtw_test_publisher_start,_srtw_test_publisher_inject,_srtw_test_publisher_poll,_malloc,_free,_tsd_new,_tsd_free,_tsd_feed,_tsd_event_take,_tsd_event_free,_tsd_ev_kind,_tsd_ev_pid,_tsd_ev_pts,_tsd_ev_dts,_tsd_ev_stream_type,_tsd_ev_program_num,_tsd_ev_random_access,_tsd_ev_data_len,_tsd_ev_data,_tsd_ev_text,_tsd_ev_pmt_entry_count,_tsd_ev_pmt_entry,_tsd_ev_format_id_count,_tsd_ev_format_id,_tsd_ev_nal_offset_count,_tsd_ev_nal_offsets,_tsd_ev_nal_type_count,_tsd_ev_nal_types,_tsd_ev_sample_count,_tsd_ev_samples,_tsd_debug_snapshot,_tsd_snapshot_free,_tsd_snap_field,_tsd_meter_snapshot,_tsd_meter_free,_tsd_meter_field,_tsd_set_meter_selection,_tsm_new,_tsm_free,_tsm_set_video_codec,_tsm_set_video_enabled,_tsm_set_audio_codec,_tsm_add_audio_pid,_tsm_set_sparse_enabled,_tsm_set_sparse_threshold,_tsm_push_video,_tsm_push_audio,_tsm_push_pcm,_tsm_push_pcm_pid,_tsm_poll",
            "-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU16,HEAPU32,HEAP16,HEAP32,HEAPF32,HEAPF64",
            "-DSRT_ENABLE_VIRTUAL_TRANSPORT",
            "-Iharness",
            "-Ideps/libquicsrt/src",
            "-Ideps/libquicsrt/deps/srt/srtcore",
            "-Ideps/libquicsrt/deps/srt/common",
            "-Ibuild/libquicsrt/deps/srt",
        ],
        sub,
        "em++ engine link",
    );
}

/// Stage the engine module, its JS wrappers, and the SlopShady-authored
/// wrapper `.d.ts` files under `static/vendor/QuicSRT-wasm/`.
///
/// Layout contract: `js/engine_module.js` imports `'../build/srt_engine.mjs'`
/// relative to itself, and the emcc module self-imports to spawn its
/// pthread workers and fetches its `.wasm` relative to itself. Staging
/// `js/` and `build/` as siblings of the tsc-emitted `page/vendor/` tree
/// keeps every relative import resolving at the served `/static/...` URLs
/// with zero rewrites. The `.d.ts` files are staged into the submodule's
/// `js/` directory (untracked there — same trick the old wasm-pack flow
/// used for crate `.d.ts` files) so tsc.vendor resolves the vendored TS's
/// relative `'../../js/<wrapper>.js'` imports, which paths mappings cannot
/// redirect.
fn stage_quicsrt_engine(repo_root: &Path) {
    let sub = repo_root.join("vendor").join("QuicSRT-wasm");
    let out = repo_root.join("static").join("vendor").join("QuicSRT-wasm");

    let out_build = out.join("build");
    if let Err(e) = fs::create_dir_all(&out_build) {
        panic!("failed to create {}: {}", out_build.display(), e);
    }
    for fname in ["srt_engine.mjs", "srt_engine.wasm"] {
        let src = sub.join("build").join(fname);
        if let Err(e) = fs::copy(&src, out_build.join(fname)) {
            panic!(
                "failed to copy {} (run the engine build first): {}",
                src.display(),
                e
            );
        }
    }

    let out_js = out.join("js");
    if let Err(e) = fs::create_dir_all(&out_js) {
        panic!("failed to create {}: {}", out_js.display(), e);
    }
    for fname in [
        "srt_engine.js",
        "demux_engine.js",
        "muxer_engine.js",
        "engine_module.js",
        "pthread_spawn_guard.js",
    ] {
        let src = sub.join("js").join(fname);
        if let Err(e) = fs::copy(&src, out_js.join(fname)) {
            panic!("failed to copy {}: {} (stale submodule?)", src.display(), e);
        }
    }

    let dts_dir = repo_root.join("src").join("types").join("quicsrt");
    match fs::read_dir(&dts_dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                let is_dts = path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .map(|n| n.ends_with(".d.ts"))
                    .unwrap_or(false);
                if is_dts {
                    if let Err(e) = fs::copy(&path, sub.join("js").join(entry.file_name())) {
                        panic!("failed to stage {}: {}", path.display(), e);
                    }
                }
            }
        }
        Err(e) => panic!("failed to read_dir {}: {}", dts_dir.display(), e),
    }
}

/// Path to the tsc binary in `node_modules/.bin`, with the extension npm
/// installs for the host platform (`tsc.cmd` on Windows; extensionless `tsc`
/// elsewhere). The extensionless shim npm emits on Windows is a POSIX shell
/// script that `CreateProcess` cannot execute (os error 193, "%1 is not a valid
/// Win32 application"), so we must select the `.cmd` shim there.
fn tsc_bin(repo_root: &Path) -> std::path::PathBuf {
    let name = if cfg!(windows) { "tsc.cmd" } else { "tsc" };
    repo_root.join("node_modules").join(".bin").join(name)
}

/// Embed `icon.ico` into the Windows executable so Explorer / the taskbar show
/// the app icon. No-op on other platforms. Best-effort: a missing or failing
/// resource compiler only drops the exe icon rather than failing the build.
#[cfg(windows)]
fn embed_windows_icon() {
    println!("cargo:rerun-if-changed=icon.ico");
    let mut res = winres::WindowsResource::new();
    res.set_icon("icon.ico");
    if let Err(e) = res.compile() {
        println!("cargo:warning=winres could not embed exe icon (continuing without it): {e}");
    }
}

#[cfg(not(windows))]
fn embed_windows_icon() {}

fn main() {
    let repo_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let src_js = repo_root.join("src").join("js");
    let out_js = repo_root.join("static").join("js");
    let sub = repo_root.join("vendor").join("QuicSRT-wasm");
    let vendor_src = sub.join("page").join("vendor");

    println!("cargo:rerun-if-changed={}", src_js.display());
    println!("cargo:rerun-if-changed={}", vendor_src.display());
    println!(
        "cargo:rerun-if-changed={}/tsconfig.json",
        repo_root.display()
    );
    println!(
        "cargo:rerun-if-changed={}/tsconfig.emit.json",
        repo_root.display()
    );
    println!(
        "cargo:rerun-if-changed={}/tsconfig.vendor.json",
        repo_root.display()
    );
    println!(
        "cargo:rerun-if-changed={}/package.json",
        repo_root.display()
    );
    println!("cargo:rerun-if-changed={}/src/types", repo_root.display());
    println!("cargo:rerun-if-changed={}/harness", sub.display());
    println!("cargo:rerun-if-changed={}/js", sub.display());
    println!(
        "cargo:rerun-if-changed={}/deps/libquicsrt/src",
        sub.display()
    );
    println!(
        "cargo:rerun-if-changed={}/deps/libquicsrt/include",
        sub.display()
    );
    println!(
        "cargo:rerun-if-changed={}/deps/libquicsrt/CMakeLists.txt",
        sub.display()
    );
    println!(
        "cargo:rerun-if-changed={}/deps/libquicsrt/deps/srt/srtcore",
        sub.display()
    );
    println!(
        "cargo:rerun-if-changed={}/deps/libquicsrt/deps/srt/common",
        sub.display()
    );
    // Watch the staged engine output dir so that deleting it (e.g.
    // `rm -rf static/vendor` or a fresh clone) re-runs build.rs and
    // triggers a rebuild. After a rebuild the next run finds artifacts
    // fresh and skips, so this converges. NOTE: watch only this output
    // subtree, never the submodule's own build/ dir — that would loop.
    println!(
        "cargo:rerun-if-changed={}/static/vendor/QuicSRT-wasm/build",
        repo_root.display()
    );

    // Step 0: Build + stage the QuicSRT C++ engine from
    // vendor/QuicSRT-wasm/. Staging runs every time (cheap copies) so the
    // wrapper .d.ts files exist for the vendor tsc pass below; the
    // cmake/em++ work is gated by engine_needs_rebuild.
    if engine_needs_rebuild(&repo_root) {
        link_quicsrt_engine(&sub);
    }
    stage_quicsrt_engine(&repo_root);

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

    // Step 2: Compile the upstream QuicSRT-wasm viewer `.ts` files via
    // tsc.vendor FIRST, so its .d.ts declarations exist when SlopShady's
    // tsc.emit runs. The submodule is canonical; we only emit the .js +
    // .d.ts artifacts here, never modify the source.
    //
    // The vendored TS imports the engine wrappers via relative
    // '../../js/<wrapper>.js' specifiers, which resolve to the .d.ts files
    // staged into the submodule's js/ dir by stage_quicsrt_engine. In the
    // emitted output those specifiers are preserved verbatim and resolve
    // against the staged static/vendor/QuicSRT-wasm/ layout (js/ and
    // build/ siblings of page/vendor/) — no rewrites needed, unlike the
    // old wasm-pack flow.
    let vendor_out = repo_root
        .join("static")
        .join("vendor")
        .join("QuicSRT-wasm")
        .join("page")
        .join("vendor");

    if has_ts_files(&vendor_src) {
        let tsc_bin = tsc_bin(&repo_root);
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

        // Rewrite extensionless relative imports in emitted vendor .js files.
        // The QuicSRT-wasm submodule's TS source uses extensionless
        // specifiers (standard TS with moduleResolution: "Bundler"), but
        // browsers require explicit .js extensions in native ES module
        // imports. Without this, `import { looksLikeAv1 } from './shared/av1'`
        // 404s in the browser.
        rewrite_vendor_imports(&vendor_out);
    }

    // Step 3: Compile SlopShady's `.ts` files under src/js via tsc.emit.
    // Writes to static/js/. Now that vendor .d.ts files exist (Step 2),
    // the upstream decode/demux imports type-check properly.
    if has_ts_files(&src_js) {
        let tsc_bin = tsc_bin(&repo_root);
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

    embed_windows_icon();
}
