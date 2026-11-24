#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
out="$(realpath -m -- "${1:-dist/orbivista-release}")"
mkdir -p "$out"
stage="$(mktemp -d)"
trap 'rm -rf -- "$stage"' EXIT

app=webos/fidelity
service=webos/services/com.webosflux.xuptertv.fidelity.service
archive=tools/vendor/ffmpeg-7.0.2-armhf-static.tar.xz
version="$(node -p 'require("./version.json").version')"
node - "$version" <<'JS'
const assert = require("node:assert/strict");
const fs = require("node:fs");
const version = process.argv[2];
const app = require("./webos/fidelity/appinfo.json");
const service = require("./webos/services/com.webosflux.xuptertv.fidelity.service/package.json");
const source = fs.readFileSync("./webos/fidelity/js/app.js", "utf8");
assert.match(version, /^\d+\.\d+\.\d+$/);
assert.equal(app.version, version);
assert.equal(service.version, version);
assert.ok(source.includes('APP_VERSION = "' + version + '"'));
JS
for source in "$app"/js/app.js "$app"/js/skip-segments.js "$service"/*.js; do
    node --check "$source"
done
if [[ -f scratch/verify_agents_rule.js ]]; then
    node scratch/verify_agents_rule.js
else
    printf 'El verificador scratch/verify_agents_rule.js no está disponible en esta rama.\n'
fi
cp -a "$app" "$stage/app"
cp -a "$service" "$stage/service"
printf '%s  %s\n' '7d41f558cb1f3395b313f8ceabed78b3731c79a0962abf405ebb5cd393e93991' "$archive" | sha256sum -c
tar -xJOf "$archive" ffmpeg-7.0.2-armhf-static/ffmpeg > "$stage/service/ffmpeg"
printf '%s  %s\n' '0afba4a11110e6e402053e0fc14c33a7eb207d7a588688ae87dba471a0f06c71' "$stage/service/ffmpeg" | sha256sum -c
chmod 755 "$stage/service/ffmpeg"
if [[ -n "${ORBIVISTA_ARES_PACKAGE:-}" ]]; then
    node "$ORBIVISTA_ARES_PACKAGE" "$stage/app" "$stage/service" -o "$out" -e shots -e '*.md'
else
    npm exec --yes --package=@webos-tools/cli@3.2.6 -- ares-package "$stage/app" "$stage/service" -o "$out" -e shots -e '*.md'
fi
ipk="$out/com.webosflux.xuptertv.fidelity_${version}_all.ipk"
python3 tools/fix_ipk_modes.py "$ipk"
python3 - "$ipk" <<'PY'
import datetime
import hashlib
import io
import json
import subprocess
import sys
import tarfile
from pathlib import Path

ipk = Path(sys.argv[1])
meta = json.loads(Path("version.json").read_text())
prefix = "usr/palm/services/com.webosflux.xuptertv.fidelity.service/"
data = subprocess.check_output(["ar", "p", str(ipk), "data.tar.gz"])
with tarfile.open(fileobj=io.BytesIO(data)) as package:
    assert package.getmember(prefix + "ffmpeg").mode == 0o755
    commands = json.load(package.extractfile(prefix + "services.json"))["services"]
    assert all(command["public"] is False for entry in commands for command in entry["commands"])

meta.update(
    sourceCommit=subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
    releaseDate=datetime.datetime.now(datetime.timezone.utc).date().isoformat(),
    ipkUrl=f'https://github.com/rogerex007/orbivista/releases/download/v{meta["version"]}/{ipk.name}',
    sha256=hashlib.sha256(ipk.read_bytes()).hexdigest(),
)
manifest = ipk.with_name("version.json")
manifest.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")
print(ipk, meta["sha256"])
PY
