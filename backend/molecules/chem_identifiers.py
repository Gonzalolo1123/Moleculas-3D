"""
Cálculo de InChIKey vía RDKit (opcional) y moléculas desde FAIR JSON / formatos comunes.
Si RDKit no está instalado, inchikey permanece None y la deduplicación usa solo hash de contenido.
"""

from __future__ import annotations

import json
import re
from io import BytesIO
from typing import Any

try:
    from rdkit import Chem
    from rdkit.Chem.inchi import MolToInchiKey

    _RDKIT = True
except ImportError:
    _RDKIT = False
    Chem = None  # type: ignore[misc, assignment]


INCHIKEY_PATTERN = re.compile(r"^[A-Z]{14}-[A-Z]{10}-[A-Z]$")


def rdkit_available() -> bool:
    return _RDKIT


def inchikey_from_mol(mol: Any) -> str | None:
    if not _RDKIT or mol is None:
        return None
    try:
        key = MolToInchiKey(mol)
        if key and INCHIKEY_PATTERN.match(key):
            return key
    except Exception:
        pass
    return None


def mol_from_fair_dict(fair: dict[str, Any]) -> Any:
    """Construye RDKit Mol desde geometry + topology (índices 0-based como en FAIR)."""
    if not _RDKIT:
        return None
    g = fair.get("geometry") or {}
    t = fair.get("topology") or {}
    elems = g.get("element") or []
    xs, ys, zs = g.get("x"), g.get("y"), g.get("z")
    bonds = t.get("bonds") or []
    if not elems or not xs or not ys or not zs:
        return None
    n = len(elems)
    if not (n == len(xs) == len(ys) == len(zs)):
        return None

    rw = Chem.RWMol()
    for el in elems:
        sym = (el or "C").strip()
        if not sym:
            sym = "C"
        try:
            rw.AddAtom(Chem.Atom(sym))
        except Exception:
            return None

    order_to_type = {
        1: Chem.BondType.SINGLE,
        2: Chem.BondType.DOUBLE,
        3: Chem.BondType.TRIPLE,
        4: Chem.BondType.AROMATIC,
    }
    for b in bonds:
        try:
            i, j = int(b["i"]), int(b["j"])
            o = int(b.get("order", 1))
            o = min(4, max(1, o))
            rw.AddBond(i, j, order_to_type.get(o, Chem.BondType.SINGLE))
        except (KeyError, TypeError, ValueError):
            return None

    mol = rw.GetMol()
    try:
        Chem.SanitizeMol(mol)
    except Exception:
        return None

    conf = Chem.Conformer(mol.GetNumAtoms())
    for i in range(n):
        conf.SetAtomPosition(i, (float(xs[i]), float(ys[i]), float(zs[i])))
    mol.RemoveAllConformers()
    mol.AddConformer(conf)
    return mol


def mol_from_mol_block_text(text: str) -> Any:
    if not _RDKIT:
        return None
    try:
        m = Chem.MolFromMolBlock(text, sanitize=True, removeHs=False)
    except Exception:
        m = None
    return m


def mol_from_sdf_bytes(raw: bytes) -> Any:
    if not _RDKIT:
        return None
    try:
        sup = Chem.ForwardSDMolSupplier(BytesIO(raw))
        for m in sup:
            if m is not None:
                return m
    except Exception:
        pass
    return None


def mol_from_pdb_text(text: str) -> Any:
    if not _RDKIT:
        return None
    try:
        m = Chem.MolFromPDBBlock(text, sanitize=True, removeHs=False)
    except Exception:
        m = None
    return m


def try_inchikey_from_fair_dict(fair: dict[str, Any]) -> str | None:
    return inchikey_from_mol(mol_from_fair_dict(fair))


def try_inchikey_from_bytes(raw: bytes, ext: str) -> str | None:
    """
    Intenta obtener InChIKey según extensión. None si RDKit no está o no aplica.
    """
    if not _RDKIT or not raw:
        return None
    ext = ext.lower().strip(".")
    text = raw.decode("utf-8", errors="replace")

    if ext == "sdf":
        return inchikey_from_mol(mol_from_sdf_bytes(raw))
    if ext in ("mol", "mdl"):
        return inchikey_from_mol(mol_from_mol_block_text(text))
    if ext == "pdb":
        return inchikey_from_mol(mol_from_pdb_text(text))
    if ext == "json":
        try:
            data = json.loads(text)
            if isinstance(data, dict) and "geometry" in data and "topology" in data:
                return try_inchikey_from_fair_dict(data)
        except (json.JSONDecodeError, TypeError):
            return None
    return None
