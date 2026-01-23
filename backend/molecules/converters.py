from __future__ import annotations

import re
import xml.etree.ElementTree as ET


def _strip_ns(tag: str) -> str:
    # "{namespace}atomArray" -> "atomArray"
    return tag.split("}", 1)[-1]


def cml_to_sdf(cml_text: str, name: str = "molecule") -> str:
    """
    Convierte un CML (Avogadro) a SDF (V2000) mínimo, suficiente para 3Dmol.js.
    Soporta: atomArray/atom (elementType, x3/y3/z3) y bondArray/bond (atomRefs2, order).
    """
    # Normalizamos un poco (Avogadro suele incluir entidades / espacios)
    cml_text = cml_text.strip()
    root = ET.fromstring(cml_text)

    # Buscar el primer <molecule> (con o sin namespace)
    molecule = None
    for el in root.iter():
        if _strip_ns(el.tag) == "molecule":
            molecule = el
            break
    if molecule is None:
        raise ValueError("CML sin <molecule>.")

    atoms = []
    bonds = []

    # atoms
    for el in molecule.iter():
        if _strip_ns(el.tag) == "atom":
            element = (el.attrib.get("elementType") or "").strip() or "C"
            atom_id = (el.attrib.get("id") or "").strip()
            # Coordenadas 3D (pueden venir como x3/y3/z3 o en otras variantes)
            def _f(key: str) -> float:
                v = el.attrib.get(key)
                if v is None:
                    return 0.0
                try:
                    return float(v)
                except Exception:
                    # Maneja comas decimales "1,23"
                    return float(v.replace(",", "."))

            x = _f("x3")
            y = _f("y3")
            z = _f("z3")
            atoms.append({"id": atom_id, "element": element, "x": x, "y": y, "z": z})

    # bonds
    for el in molecule.iter():
        if _strip_ns(el.tag) == "bond":
            refs = (el.attrib.get("atomRefs2") or "").strip().split()
            if len(refs) != 2:
                continue
            order_raw = (el.attrib.get("order") or "1").strip().lower()
            # order puede venir como "1", "2", "3", "A" (aromático), "S"/"D"/"T"
            order = 1
            if order_raw in ("2", "d", "double"):
                order = 2
            elif order_raw in ("3", "t", "triple"):
                order = 3
            elif order_raw in ("a", "ar", "aromatic"):
                order = 4  # aromático en molfile
            else:
                # intenta extraer dígitos
                m = re.search(r"\d+", order_raw)
                if m:
                    order = int(m.group(0))
            bonds.append({"a1": refs[0], "a2": refs[1], "order": order})

    if not atoms:
        raise ValueError("CML sin átomos.")

    # index map (1-based)
    id_to_idx = {}
    for i, a in enumerate(atoms, start=1):
        # si no trae id, generamos uno
        aid = a["id"] or f"a{i}"
        a["id"] = aid
        id_to_idx[aid] = i

    # Filtra bonds que no calzan
    mol_bonds = []
    for b in bonds:
        if b["a1"] in id_to_idx and b["a2"] in id_to_idx:
            mol_bonds.append((id_to_idx[b["a1"]], id_to_idx[b["a2"]], b["order"]))

    # SDF/MOL V2000
    lines = []
    lines.append(name[:80])
    lines.append("  Moleculas3D  ")
    lines.append("")
    lines.append(f"{len(atoms):>3}{len(mol_bonds):>3}  0  0  0  0  0  0  0  0  1 V2000")

    for a in atoms:
        # x y z (10.4f) + element (3 chars)
        lines.append(
            f"{a['x']:>10.4f}{a['y']:>10.4f}{a['z']:>10.4f} {a['element']:<3} 0  0  0  0  0  0  0  0  0  0  0  0"
        )

    for i1, i2, order in mol_bonds:
        lines.append(f"{i1:>3}{i2:>3}{order:>3}  0  0  0  0")

    lines.append("M  END")
    lines.append("$$$$")
    return "\n".join(lines) + "\n"

