"""
FAIR/MDDB-compliant JSON for molecular structures.

- CML -> JSON conversion with metadata, typed arrays, topology, units.
- Normalization: strip redundant CML data, minimize payload.
- Validation: JSON Schema (standard_molecule.json).
- @context (JSON-LD) for semantic interoperability.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import xml.etree.ElementTree as ET

# -----------------------------------------------------------------------------
# Constants: atomic numbers, CPK colors (hex), Van der Waals radii (Å)
# -----------------------------------------------------------------------------

ELEMENT_TO_ATOMIC_NUMBER: dict[str, int] = {
    "H": 1, "He": 2, "Li": 3, "Be": 4, "B": 5, "C": 6, "N": 7, "O": 8, "F": 9,
    "Ne": 10, "Na": 11, "Mg": 12, "Al": 13, "Si": 14, "P": 15, "S": 16, "Cl": 17,
    "Ar": 18, "K": 19, "Ca": 20, "Sc": 21, "Ti": 22, "V": 23, "Cr": 24, "Mn": 25,
    "Fe": 26, "Co": 27, "Ni": 28, "Cu": 29, "Zn": 30, "Ga": 31, "Ge": 32, "As": 33,
    "Se": 34, "Br": 35, "Kr": 36, "Rb": 37, "Sr": 38, "Y": 39, "Zr": 40, "Nb": 41,
    "Mo": 42, "Tc": 43, "Ru": 44, "Rh": 45, "Pd": 46, "Ag": 47, "Cd": 48, "In": 49,
    "Sn": 50, "Sb": 51, "Te": 52, "I": 53, "Xe": 54,
}

CPK_COLORS_HEX: dict[str, str] = {
    "H": "#FFFFFF", "C": "#C8C8C8", "N": "#8F8FFF", "O": "#F00000", "F": "#90E050",
    "P": "#FFA500", "S": "#FFC832", "Cl": "#00FF00", "Br": "#A52A2A", "I": "#9400D3",
    "Fe": "#FFA500", "Na": "#0000FF", "Mg": "#2A802A", "Ca": "#808090", "Zn": "#7D80B0",
    "Cu": "#7D80B0", "Mn": "#9C7AC7", "Ni": "#50D050", "K": "#8F8FFF", "Unknown": "#FF1493",
}

VDW_RADII_ANGSTROM: dict[str, float] = {
    "H": 1.20, "C": 1.70, "N": 1.55, "O": 1.52, "F": 1.47, "P": 1.80, "S": 1.80,
    "Cl": 1.75, "Br": 1.85, "I": 1.98, "Na": 2.27, "Mg": 1.73, "Ca": 1.97,
    "Fe": 1.80, "Zn": 1.39, "Cu": 1.40, "Ni": 1.63, "K": 2.75, "Unknown": 1.50,
}

DEFAULT_CPK = "#FF1493"
DEFAULT_VDW = 1.50

# JSON-LD @context: URIs para términos semánticos (interoperabilidad máquina)
DEFAULT_CONTEXT = {
    "molecule": "https://schema.org/MolecularEntity",
    "metadata": "https://schema.org/creativeWork",
    "geometry": "https://qudt.org/schema/qudt/Quantity",
    "atoms": "https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI:33250",
    "bonds": "https://www.ebi.ac.uk/ols/ontologies/chebi/terms?iri=http://purl.obolibrary.org/obo/CHEBI_46787",
    "units": "https://qudt.org/vocab/unit/ANGSTROM",
    "inchi": "https://www.inchi-trust.org/",
    "doi": "https://www.doi.org/",
}


def _strip_ns(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def _float_attr(el: ET.Element, key: str) -> float:
    v = el.attrib.get(key)
    if v is None:
        return 0.0
    try:
        return float(v)
    except ValueError:
        return float(v.replace(",", "."))


def _bond_order(raw: str) -> int:
    raw = (raw or "1").strip().lower()
    if raw in ("2", "d", "double"):
        return 2
    if raw in ("3", "t", "triple"):
        return 3
    if raw in ("a", "ar", "aromatic"):
        return 4
    m = re.search(r"\d+", raw)
    return int(m.group(0)) if m else 1


# -----------------------------------------------------------------------------
# Normalización CML: eliminar redundancias, minimizar payload
# -----------------------------------------------------------------------------


def normalize_cml(cml_text: str) -> str:
    """
    Limpia el CML original: elimina atributos redundantes, espacios/entidades,
    y nodos que no aportan para geometría/topología. Minimiza payload sin perder
    fidelidad científica (atomArray/bondArray preservados).
    """
    cml_text = cml_text.strip()
    root = ET.fromstring(cml_text)

    # Atributos a conservar por <atom>: elementType, id, x3, y3, z3
    atom_keep = {"elementType", "id", "x3", "y3", "z3"}
    # Por <bond>: atomRefs2, order
    bond_keep = {"atomRefs2", "order"}

    def clean_el(parent: ET.Element, tag: str, keep: set[str]) -> None:
        for el in list(parent.iter()):
            if _strip_ns(el.tag) != tag:
                continue
            to_del = [k for k in el.attrib if k not in keep]
            for k in to_del:
                del el.attrib[k]

    molecule = None
    for el in root.iter():
        if _strip_ns(el.tag) == "molecule":
            molecule = el
            break
    if molecule is None:
        raise ValueError("CML sin <molecule>.")

    clean_el(molecule, "atom", atom_keep)
    clean_el(molecule, "bond", bond_keep)

    return ET.tostring(root, encoding="unicode", default_namespace="")


# -----------------------------------------------------------------------------
# CML -> JSON FAIR-compliant
# -----------------------------------------------------------------------------


@dataclass
class CmlParseResult:
    atoms: list[dict[str, Any]]
    bonds: list[dict[str, Any]]


def _parse_cml(cml_text: str) -> CmlParseResult:
    """Extrae atoms y bonds del CML (lógica compartida)."""
    cml_text = cml_text.strip()
    root = ET.fromstring(cml_text)
    molecule = None
    for el in root.iter():
        if _strip_ns(el.tag) == "molecule":
            molecule = el
            break
    if molecule is None:
        raise ValueError("CML sin <molecule>.")

    atoms = []
    for el in molecule.iter():
        if _strip_ns(el.tag) != "atom":
            continue
        elem = (el.attrib.get("elementType") or "").strip() or "C"
        aid = (el.attrib.get("id") or "").strip()
        x, y, z = _float_attr(el, "x3"), _float_attr(el, "y3"), _float_attr(el, "z3")
        atoms.append({"id": aid or f"a{len(atoms)+1}", "element": elem, "x": x, "y": y, "z": z})

    bonds = []
    for el in molecule.iter():
        if _strip_ns(el.tag) != "bond":
            continue
        refs = (el.attrib.get("atomRefs2") or "").strip().split()
        if len(refs) != 2:
            continue
        order = _bond_order(el.attrib.get("order") or "1")
        bonds.append({"a1": refs[0], "a2": refs[1], "order": order})

    return CmlParseResult(atoms=atoms, bonds=bonds)


def cml_to_fair_json(
    cml_text: str,
    name: str = "molecule",
    *,
    doi: str | None = None,
    inchikey: str | None = None,
    license_: str = "unknown",
    source_software: str = "Avogadro2",
    source_file: str | None = None,
    include_visualization: bool = True,
    context: dict[str, str] | None = None,
) -> dict[str, Any]:
    """
    Convierte CML a JSON FAIR/MDDB-compliant.

    - metadata: nombre, DOI, InChIKey, licencia, procedencia.
    - geometry: arreglos tipados x, y, z, element, atomic_number [, atom_ids].
    - topology: bonds con (i, j, order) en índices 0-based.
    - visualization (opcional): cpk_colors, vdw_radii por átomo.
    - units: length=angstrom.
    - @context: JSON-LD para interoperabilidad semántica.
    """
    ctx = {**DEFAULT_CONTEXT} if context is None else {**DEFAULT_CONTEXT, **context}
    parsed = _parse_cml(cml_text)
    atoms = parsed.atoms
    bonds = parsed.bonds

    if not atoms:
        raise ValueError("CML sin átomos.")

    id_to_idx: dict[str, int] = {}
    for i, a in enumerate(atoms):
        aid = a["id"] or f"a{i+1}"
        a["id"] = aid
        id_to_idx[aid] = i

    x = [a["x"] for a in atoms]
    y = [a["y"] for a in atoms]
    z = [a["z"] for a in atoms]
    element = [a["element"] for a in atoms]
    atomic_number = [ELEMENT_TO_ATOMIC_NUMBER.get(e, 0) or 6 for e in element]
    atom_ids = [a["id"] for a in atoms]

    bond_list: list[dict[str, int]] = []
    for b in bonds:
        a1, a2 = b["a1"], b["a2"]
        if a1 in id_to_idx and a2 in id_to_idx:
            bond_list.append({
                "i": id_to_idx[a1],
                "j": id_to_idx[a2],
                "order": min(4, max(1, b["order"])),
            })

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    metadata: dict[str, Any] = {
        "name": name,
        "provenance": {
            "source_software": source_software,
            "source_file": source_file,
            "conversion_tool": "molecules.fair_json",
            "conversion_date": now,
        },
    }
    if doi:
        metadata["doi"] = doi
    if inchikey:
        metadata["inchikey"] = inchikey
    if license_:
        metadata["license"] = license_

    geometry: dict[str, Any] = {
        "x": x,
        "y": y,
        "z": z,
        "element": element,
        "atomic_number": atomic_number,
        "atom_ids": atom_ids,
    }

    topology: dict[str, Any] = {"bonds": bond_list}

    out: dict[str, Any] = {
        "@context": ctx,
        "metadata": metadata,
        "geometry": geometry,
        "topology": topology,
        "units": {"length": "angstrom", "angle": "degree"},
    }

    if include_visualization:
        cpk = [CPK_COLORS_HEX.get(e, DEFAULT_CPK) for e in element]
        vdw = [VDW_RADII_ANGSTROM.get(e, DEFAULT_VDW) for e in element]
        out["visualization"] = {"cpk_colors": cpk, "vdw_radii": vdw}

    return out


def fair_json_to_json_string(data: dict[str, Any], *, indent: int | None = 2) -> str:
    """Serializa el dict FAIR a JSON (para almacenar o enviar)."""
    return json.dumps(data, ensure_ascii=False, indent=indent)


# -----------------------------------------------------------------------------
# Validador de esquema (JSON Schema)
# -----------------------------------------------------------------------------

_SCHEMA_PATH = Path(__file__).resolve().parent / "schemas" / "standard_molecule.json"


def _load_schema() -> dict[str, Any]:
    with open(_SCHEMA_PATH, encoding="utf-8") as f:
        return json.load(f)


def validate_fair_molecule(data: dict[str, Any]) -> tuple[bool, list[str]]:
    """
    Valida `data` contra standard_molecule.json.
    Devuelve (True, []) si es válido, o (False, [mensajes de error]).
    """
    try:
        import jsonschema
        from jsonschema import Draft202012Validator
    except ImportError:
        return (False, ["jsonschema no instalado. pip install jsonschema"])

    schema = _load_schema()
    validator = Draft202012Validator(schema)
    errors = [f"{e.json_path or 'root'}: {e.message}" for e in validator.iter_errors(data)]
    return (len(errors) == 0, errors)


def validate_fair_molecule_strict(data: dict[str, Any]) -> None:
    """Valida y lanza ValueError si hay errores."""
    ok, errs = validate_fair_molecule(data)
    if not ok:
        raise ValueError("Esquema FAIR inválido: " + "; ".join(errs))


# -----------------------------------------------------------------------------
# Serialización: FAIR JSON -> SDF (para 3Dmol.js u otros consumidores)
# -----------------------------------------------------------------------------


def fair_json_to_sdf(data: dict[str, Any], name: str | None = None) -> str:
    """
    Convierte FAIR JSON a SDF V2000 mínimo. Útil para 3Dmol.js u otros
    consumidores que esperan SDF/MOL.
    """
    geom = data["geometry"]
    top = data.get("topology") or {}
    bonds = top.get("bonds") or []
    x = geom["x"]
    y = geom["y"]
    z = geom["z"]
    element = geom["element"]
    n = len(x)
    name = name or (data.get("metadata") or {}).get("name") or "molecule"

    lines = [name[:80], "  Moleculas3D FAIR  ", ""]
    lines.append(f"{n:>3}{len(bonds):>3}  0  0  0  0  0  0  0  0  1 V2000")
    for i in range(n):
        lines.append(
            f"{x[i]:>10.4f}{y[i]:>10.4f}{z[i]:>10.4f} {element[i]:<3} 0  0  0  0  0  0  0  0  0  0  0  0"
        )
    for b in bonds:
        i1, i2, order = b["i"] + 1, b["j"] + 1, b.get("order", 1)
        lines.append(f"{i1:>3}{i2:>3}{order:>3}  0  0  0  0")
    lines.append("M  END")
    lines.append("$$$$")
    return "\n".join(lines) + "\n"


# -----------------------------------------------------------------------------
# Utilidad: normalizar CML y luego convertir a JSON
# -----------------------------------------------------------------------------


def cml_to_fair_json_normalized(
    cml_text: str,
    name: str = "molecule",
    **kwargs: Any,
) -> dict[str, Any]:
    """
    1. Normaliza el CML (elimina redundancias).
    2. Convierte a JSON FAIR-compliant.
    """
    normalized = normalize_cml(cml_text)
    return cml_to_fair_json(normalized, name=name, **kwargs)
