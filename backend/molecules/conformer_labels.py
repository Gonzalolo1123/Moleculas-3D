"""
Etiquetas de conformación / pucker para ciclohexano y anillos relacionados.

Referencias didácticas habituales: silla (chair), barco (boat), barco retorcido
(twist-boat), media silla (half-chair), sobre (envelope); más forma planar
como caso límite teórico.
"""

from __future__ import annotations

# (clave interna, etiqueta UI en español)
CONFORMER_DISPLAY: list[tuple[str, str]] = [
    ("unspecified", "Sin especificar (estructura general)"),
    ("chair", "Silla (chair)"),
    ("boat", "Barco (boat)"),
    ("twist_boat", "Barco retorcido (twist-boat)"),
    ("half_chair", "Media silla (half-chair)"),
    ("envelope", "Sobre (envelope)"),
    ("planar", "Plana (planar)"),
    ("other", "Otra (personalizada)"),
]

_VALID = frozenset(k for k, _ in CONFORMER_DISPLAY)


def normalize_conformer_type(raw: str | None) -> str:
    if raw is None:
        return "unspecified"
    key = str(raw).strip().lower().replace("-", "_")
    if key in _VALID:
        return key
    return "unspecified"


def normalize_conformer_custom(raw: str | None) -> str:
    if raw is None:
        return ""
    return str(raw).strip()[:80]


def conformer_label_es(key: str | None, custom_label: str | None = None) -> str:
    k = normalize_conformer_type(key)
    if k == "other":
        custom = normalize_conformer_custom(custom_label)
        return custom or "Otra (personalizada)"
    for sk, lab in CONFORMER_DISPLAY:
        if sk == k:
            return lab
    return CONFORMER_DISPLAY[0][1]


def conformer_sort_key(key: str | None) -> tuple[int, str]:
    k = normalize_conformer_type(key)
    order = {name: i for i, (name, _) in enumerate(CONFORMER_DISPLAY)}
    return (order.get(k, 99), k)
