"""Persistencia de archivos moleculares y documentos Mongo (compartido por API y carga masiva)."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any

from django.conf import settings
from django.utils import timezone

from .chem_identifiers import try_inchikey_from_bytes, try_inchikey_from_fair_dict
from .fair_json import cml_to_fair_json_normalized, fair_json_to_json_string, validate_fair_molecule
from .mongo import molecules_collection

BULK_ALLOWED_EXT = frozenset({
    "cml", "pdb", "sdf", "mol", "xyz", "mol2", "cif", "mmcif",
    "gro", "pqr", "pdbqt", "json",
})


def safe_ext(filename: str) -> str:
    ext = Path(filename).suffix.lower().strip(".")
    if not ext:
        return "dat"
    return ext[:10]


def _content_sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _find_duplicate(inchikey: str | None, content_sha256: str) -> dict[str, Any] | None:
    coll = molecules_collection()
    if inchikey:
        doc = coll.find_one({"inchikey": inchikey})
        if doc:
            return doc
    return coll.find_one({"content_sha256": content_sha256})


def persist_molecule(
    name: str,
    original_filename: str,
    raw: bytes,
    fmt: str | None = None,
) -> tuple[str, dict[str, Any]]:
    """
    Escribe archivo en MEDIA, genera FAIR JSON si aplica (CML), inserta en Mongo.
    Dedup: primero por InChIKey (si se calcula); si no, por SHA-256 del archivo.

    Devuelve (object_id_str, info) con claves id, name, format, file_path,
    duplicate (bool), dedup (inchikey|content_sha256|None), inchikey (opcional).
    """
    if not fmt:
        fmt = safe_ext(original_filename)
    safe_extension = safe_ext(original_filename)
    content_sha256 = _content_sha256(raw)

    fair_doc: dict[str, Any] | None = None
    inchikey_val: str | None = None

    if safe_extension == "cml" or fmt == "cml":
        cml_text = raw.decode("utf-8", errors="replace")
        try:
            candidate = cml_to_fair_json_normalized(
                cml_text,
                name=name,
                source_software="Avogadro2",
                source_file=original_filename,
            )
            ok, _ = validate_fair_molecule(candidate)
            if ok:
                fair_doc = candidate
                inchikey_val = try_inchikey_from_fair_dict(fair_doc)
                if inchikey_val:
                    fair_doc.setdefault("metadata", {})["inchikey"] = inchikey_val
        except Exception as e:
            print(f"Error preparando FAIR/InChI desde CML: {e}")

    if inchikey_val is None:
        inchikey_val = try_inchikey_from_bytes(raw, safe_extension)

    existing = _find_duplicate(inchikey_val, content_sha256)
    if existing:
        oid = str(existing["_id"])
        reason = (
            "inchikey"
            if inchikey_val and existing.get("inchikey") == inchikey_val
            else "content_sha256"
        )
        return oid, {
            "id": oid,
            "name": existing.get("name") or name,
            "format": existing.get("format") or fmt,
            "file_path": existing.get("file_path"),
            "duplicate": True,
            "dedup": reason,
            "inchikey": inchikey_val or existing.get("inchikey"),
        }

    os.makedirs(settings.MEDIA_ROOT, exist_ok=True)
    Path(settings.MEDIA_ROOT, "molecules").mkdir(parents=True, exist_ok=True)

    base = f"{timezone.now().strftime('%Y%m%d_%H%M%S')}_{len(raw)}"
    rel_path = Path("molecules") / f"{base}.{safe_extension}"
    abs_path = Path(settings.MEDIA_ROOT) / rel_path
    abs_path.write_bytes(raw)

    fair_json_path = None
    if fair_doc is not None:
        if inchikey_val:
            fair_doc.setdefault("metadata", {})["inchikey"] = inchikey_val
        try:
            ok, _ = validate_fair_molecule(fair_doc)
            if ok:
                fair_rel = Path("molecules") / f"{base}.fair.json"
                (Path(settings.MEDIA_ROOT) / fair_rel).write_text(
                    fair_json_to_json_string(fair_doc), encoding="utf-8"
                )
                fair_json_path = str(fair_rel).replace("\\", "/")
        except Exception as e:
            print(f"Error escribiendo FAIR JSON: {e}")

    doc: dict[str, Any] = {
        "name": name,
        "format": fmt,
        "original_filename": original_filename,
        "file_path": str(rel_path).replace("\\", "/"),
        "size_bytes": int(len(raw)),
        "created_at": timezone.now(),
        "content_sha256": content_sha256,
    }
    if inchikey_val:
        doc["inchikey"] = inchikey_val
    if fair_json_path is not None:
        doc["fair_json_path"] = fair_json_path

    result = molecules_collection().insert_one(doc)
    oid = str(result.inserted_id)
    return oid, {
        "id": oid,
        "name": name,
        "format": fmt,
        "file_path": doc["file_path"],
        "duplicate": False,
        "dedup": None,
        "inchikey": inchikey_val,
    }
