#!/usr/bin/env python3
"""
Deterministic bare-metal Android APK compiler, 4-byte zipaligner, and
APK Signature Scheme v1 + v2 + v3 signer for VIBEX (`dev.viswesh.vibex`).

Pipeline:
  1. Build fresh Vite web bundle (`music-app/dist`)
  2. Compile Android XML/PNG/adaptive-icon resources with Google `aapt2`
  3. Link `AndroidManifest.xml` + `res` + `assets/www` against `android-34.jar` -> base APK + `R.java`
  4. Compile all `dev.viswesh.vibex.*` Java sources + `R.java` via `ecj`
  5. Dex all `.class` files via Google `D8` (`--min-api 26 --release`) -> `classes.dex`
  6. Repackage APK with uncompressed (`ZIP_STORED`) 4-byte aligned `resources.arsc`
     (mandatory for `targetSdkVersion >= 30` on Android 11–16)
  7. Sign with RSA-2048 release certificate using Google `apksigner` (v1 + v2 + v3)
  8. Run cryptographic & manifest verification (`apksigner verify --verbose`, `aapt2 dump badging`,
     and `resources.arsc` alignment check) and copy into `music-app/dist/downloads/` as well.
"""

from __future__ import annotations

import hashlib
import os
import pathlib
import shutil
import struct
import subprocess
import sys
import zipfile

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
MUSIC_APP = REPO_ROOT / "music-app"
ANDROID_MAIN = MUSIC_APP / "android" / "app" / "src" / "main"
SDK_DIR = pathlib.Path(os.environ.get("VIBEX_ANDROID_SDK", "/tmp/android-sdk"))
WORK_DIR = pathlib.Path("/tmp/vibex-apk-build")

APK_NAME = "VIBEX-v3.2.0-universal.apk"
PUBLIC_DOWNLOAD_DIR = MUSIC_APP / "public" / "downloads"
DIST_DOWNLOAD_DIR = MUSIC_APP / "dist" / "downloads"
FINAL_APK_PUBLIC = PUBLIC_DOWNLOAD_DIR / APK_NAME
FINAL_APK_DIST = DIST_DOWNLOAD_DIR / APK_NAME


def find_java_bin(tool: str) -> str:
    env_home = os.environ.get("JAVA_HOME")
    if env_home:
        cand = pathlib.Path(env_home) / "bin" / tool
        if cand.exists():
            return str(cand)
    try:
        import jdk4py  # type: ignore

        cand = pathlib.Path(jdk4py.JAVA_HOME) / "bin" / tool
        if cand.exists():
            return str(cand)
    except Exception:
        pass
    found = shutil.which(tool)
    if found:
        return found
    raise FileNotFoundError(f"Required JDK binary not found: {tool}")


def run(cmd: list[str], cwd: pathlib.Path | None = None) -> str:
    res = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if res.returncode != 0:
        raise RuntimeError(f"Command failed ({res.returncode}): {' '.join(cmd)}\n{res.stdout}")
    return res.stdout


def write_zipaligned_apk(src_apk: pathlib.Path, dex_path: pathlib.Path, dst_apk: pathlib.Path) -> None:
    """
    Rewrites `src_apk` + `classes.dex` into `dst_apk` ensuring:
      - `resources.arsc` is stored uncompressed (`ZIP_STORED`) and 4-byte aligned on file data offset
      - PNG/WebP/WOFF2 media resources stored uncompressed are also 4-byte aligned on file data offset
      - `classes.dex` is compressed cleanly at maximum level (`ZIP_DEFLATED`)
    """
    uncompressed_exts = {".arsc", ".png", ".webp", ".jpg", ".jpeg", ".woff2", ".mp3", ".m4a", ".ogg"}

    with zipfile.ZipFile(src_apk, "r") as zin, open(dst_apk, "wb") as fout:
        with zipfile.ZipFile(fout, "w") as zout:
            entries: list[tuple[str, bytes, bool]] = []
            for info in zin.infolist():
                if info.filename == "classes.dex" or info.filename.startswith("META-INF/"):
                    continue
                raw = zin.read(info.filename)
                ext = pathlib.Path(info.filename).suffix.lower()
                store_raw = info.filename == "resources.arsc" or ext in uncompressed_exts
                entries.append((info.filename, raw, store_raw))

            entries.append(("classes.dex", dex_path.read_bytes(), False))

            for filename, payload, store_raw in entries:
                zi = zipfile.ZipInfo(filename=filename, date_time=(2026, 10, 23, 0, 0, 0))
                zi.external_attr = 0o644 << 16
                if store_raw:
                    zi.compress_type = zipfile.ZIP_STORED
                    header_pos = fout.tell()
                    fname_bytes = filename.encode("utf-8")
                    data_start = header_pos + 30 + len(fname_bytes)
                    pad = (4 - (data_start % 4)) % 4
                    if pad:
                        # Valid 0xFFFF zipalign extra field padding (`pad` bytes)
                        zi.extra = b"\x00" * pad
                    zout.writestr(zi, payload, compress_type=zipfile.ZIP_STORED)
                else:
                    zi.compress_type = zipfile.ZIP_DEFLATED
                    zout.writestr(zi, payload, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def verify_zipalignment(apk_path: pathlib.Path) -> int:
    raw = apk_path.read_bytes()
    with zipfile.ZipFile(apk_path, "r") as zf:
        arsc = zf.getinfo("resources.arsc")
        if arsc.compress_type != zipfile.ZIP_STORED:
            raise AssertionError("FATAL: resources.arsc MUST be ZIP_STORED for Android 11+ (targetSdk 34)!")
        hdr = arsc.header_offset
        sig, _, _, _, _, _, _, _, _, name_len, extra_len = struct.unpack_from("<4sHHHHHIIIHH", raw, hdr)
        assert sig == b"PK\x03\x04", "Invalid local ZIP header signature"
        data_offset = hdr + 30 + name_len + extra_len
        if data_offset % 4 != 0:
            raise AssertionError(f"FATAL: resources.arsc offset {data_offset} is not 4-byte aligned!")
        return data_offset


def main() -> None:
    java = find_java_bin("java")
    keytool = find_java_bin("keytool")
    aapt2 = SDK_DIR / "aapt2"
    android_jar = SDK_DIR / "android-34.jar"
    ecj_jar = SDK_DIR / "ecj.jar"
    d8_jar = SDK_DIR / "d8.jar"
    apksigner_jar = SDK_DIR / "apksigner.jar"

    for p in (aapt2, android_jar, ecj_jar, d8_jar, apksigner_jar):
        if not p.exists():
            raise FileNotFoundError(f"Missing SDK component: {p}")

    # Remove stale built APK inside public/downloads before `vite build` so `assets/www` stays clean
    for old_apk in (FINAL_APK_PUBLIC, FINAL_APK_DIST):
        if old_apk.exists():
            old_apk.unlink()

    print("[1/7] Building fresh production web bundle (`npm run build --prefix music-app`)...")
    run(["npm", "run", "build", "--prefix", str(MUSIC_APP)], cwd=REPO_ROOT)

    if WORK_DIR.exists():
        shutil.rmtree(WORK_DIR)
    res_flat_dir = WORK_DIR / "res_flat"
    gen_r_dir = WORK_DIR / "gen_r"
    classes_dir = WORK_DIR / "classes"
    dex_dir = WORK_DIR / "dex"
    assets_stage = WORK_DIR / "assets"
    www_stage = assets_stage / "www"
    for d in (res_flat_dir, gen_r_dir, classes_dir, dex_dir, www_stage):
        d.mkdir(parents=True, exist_ok=True)

    # Copy `music-app/dist/*` into `assets/www/*` (excluding any `.apk` files)
    dist_src = MUSIC_APP / "dist"
    for item in dist_src.rglob("*"):
        rel = item.relative_to(dist_src)
        if item.is_dir():
            (www_stage / rel).mkdir(parents=True, exist_ok=True)
        elif item.suffix.lower() != ".apk":
            target = www_stage / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target)

    print("[2/7] Compiling Android resources with `aapt2 compile`...")
    res_dir = ANDROID_MAIN / "res"
    res_zip = WORK_DIR / "compiled_res.zip"
    run([str(aapt2), "compile", "--dir", str(res_dir), "-o", str(res_zip)])

    print("[3/7] Linking `AndroidManifest.xml`, resources & bundled `assets/www` with `aapt2 link`...")
    unaligned_apk = WORK_DIR / "vibex-unaligned.apk"
    run(
        [
            str(aapt2),
            "link",
            "-o",
            str(unaligned_apk),
            "-I",
            str(android_jar),
            "--manifest",
            str(ANDROID_MAIN / "AndroidManifest.xml"),
            "-A",
            str(assets_stage),
            "--java",
            str(gen_r_dir),
            "--auto-add-overlay",
            str(res_zip),
        ]
    )

    print("[4/7] Compiling Java sources (`dev.viswesh.vibex.*` + `R.java`) against `android-34.jar`...")
    java_sources = sorted(
        [
            str(p)
            for p in (ANDROID_MAIN / "java").rglob("*.java")
            if not p.name.endswith("Plugin.java")
        ]
        + [str(p) for p in gen_r_dir.rglob("*.java")]
    )
    run(
        [
            java,
            "-jar",
            str(ecj_jar),
            "-1.8",
            "-encoding",
            "UTF-8",
            "-classpath",
            str(android_jar),
            "-d",
            str(classes_dir),
            "-nowarn",
            *java_sources,
        ]
    )

    print("[5/7] Compiling JVM `.class` bytecode into optimized ART `classes.dex` via `D8`...")
    class_files = sorted(str(p) for p in classes_dir.rglob("*.class"))
    run(
        [
            java,
            "-cp",
            str(d8_jar),
            "com.android.tools.r8.D8",
            "--release",
            "--min-api",
            "26",
            "--lib",
            str(android_jar),
            "--output",
            str(dex_dir),
            *class_files,
        ]
    )

    print("[6/7] Assembling 4-byte aligned universal APK & signing with v1 + v2 + v3 schemes...")
    aligned_unsigned = WORK_DIR / "vibex-aligned-unsigned.apk"
    write_zipaligned_apk(unaligned_apk, dex_dir / "classes.dex", aligned_unsigned)
    arsc_offset = verify_zipalignment(aligned_unsigned)
    print(f"      Verified uncompressed `resources.arsc` at 4-byte aligned offset {arsc_offset} (mod 4 == {arsc_offset % 4})")

    keystore = SDK_DIR / "vibex-release.p12"
    ks_pass = "vibexAndroid2026!"
    if not keystore.exists():
        run(
            [
                keytool,
                "-genkeypair",
                "-v",
                "-keystore",
                str(keystore),
                "-storetype",
                "PKCS12",
                "-storepass",
                ks_pass,
                "-keypass",
                ks_pass,
                "-alias",
                "vibex-release",
                "-keyalg",
                "RSA",
                "-keysize",
                "2048",
                "-validity",
                "10950",
                "-dname",
                "CN=VIBEX Music Streaming, OU=Mobile Audio, O=Viswesh, L=Chennai, ST=Tamil Nadu, C=IN",
            ]
        )

    PUBLIC_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    DIST_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    run(
        [
            java,
            "-jar",
            str(apksigner_jar),
            "sign",
            "--ks",
            str(keystore),
            "--ks-pass",
            f"pass:{ks_pass}",
            "--ks-key-alias",
            "vibex-release",
            "--key-pass",
            f"pass:{ks_pass}",
            "--min-sdk-version",
            "18",
            "--v1-signing-enabled",
            "true",
            "--v2-signing-enabled",
            "true",
            "--v3-signing-enabled",
            "true",
            "--out",
            str(FINAL_APK_PUBLIC),
            str(aligned_unsigned),
        ]
    )
    shutil.copy2(FINAL_APK_PUBLIC, FINAL_APK_DIST)

    print("[7/7] Running post-sign cryptographic & manifest verification...")
    post_offset = verify_zipalignment(FINAL_APK_PUBLIC)
    sig_out = run(
        [
            java,
            "-jar",
            str(apksigner_jar),
            "verify",
            "--verbose",
            "--print-certs",
            str(FINAL_APK_PUBLIC),
        ]
    )
    badging = run([str(aapt2), "dump", "badging", str(FINAL_APK_PUBLIC)])
    sha256 = hashlib.sha256(FINAL_APK_PUBLIC.read_bytes()).hexdigest()
    size_bytes = FINAL_APK_PUBLIC.stat().st_size

    print(sig_out.strip())
    for line in badging.splitlines()[:10]:
        print("     ", line)
    print(f"SUCCESS: {FINAL_APK_PUBLIC} ({size_bytes:,} bytes, SHA-256: {sha256}, resources.arsc offset={post_offset})")


if __name__ == "__main__":
    main()
