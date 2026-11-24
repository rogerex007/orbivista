#!/usr/bin/env bash

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)" || exit 1

case "${1:-}" in
    -h|--help)
        printf 'Uso: %s ARCHIVO_JSON [DESTINO_JSON]\n' "$0"
        printf 'Importa un pool local de sesiones autorizadas y conserva las entradas vigentes.\n'
        exit 0
        ;;
esac
if (( $# < 1 || $# > 2 )); then
    printf 'Indica el archivo JSON de origen. Usa --help para ver la sintaxis.\n' >&2
    exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
    printf 'Se necesita Python 3.\n' >&2
    exit 1
fi

exec python3 - "$1" "${2:-$script_dir/dist/seeds/seeds.json}" <<'PY'
import json
import os
import sys
import tempfile
import time
from pathlib import Path

source, destination = map(Path, sys.argv[1:])
now = int(time.time())
temporary = None
try:
    with source.open(encoding="utf-8") as stream:
        document = json.load(stream)
    entries = document.get("seeds") if isinstance(document, dict) else document
    if not isinstance(entries, list):
        raise ValueError("Se esperaba una lista o un objeto con una lista seeds.")

    valid = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if not all(isinstance(entry.get(field), str) and entry[field].strip()
                   for field in ("sn", "userId", "userToken")):
            continue
        expires = entry.get("exp")
        if type(expires) is not int or expires <= now:
            continue
        key = entry["sn"].strip().lower()
        if key not in valid or expires > valid[key]["exp"]:
            valid[key] = entry

    if not valid:
        raise ValueError("El archivo no contiene entradas vigentes y completas.")

    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=destination.parent, delete=False
    ) as stream:
        temporary = Path(stream.name)
        json.dump({"at": int(time.time() * 1000), "seeds": list(valid.values())}, stream, indent=2)
        stream.write("\n")
    os.replace(temporary, destination)
    print(f"Importadas {len(valid)} entradas vigentes en {destination}.")
except (OSError, UnicodeError, ValueError) as error:
    print(f"No se pudo importar el archivo: {error}", file=sys.stderr)
    sys.exit(1)
finally:
    if temporary is not None:
        temporary.unlink(missing_ok=True)
PY
