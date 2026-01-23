# FAIR / MDDB: Estructura JSON y CML → JSON

## Resumen

El sistema utiliza un **JSON autodescriptivo** para intercambio de estructuras moleculares, alineado con **FAIR** (Findable, Accessible, Interoperable, Reusable) y **MDDB** (Molecular Dynamics Data Bank).

### Cómo esta estructura facilita FAIR (resumen)

| FAIR | Implementación |
|------|----------------|
| **Findable** | `metadata` con nombre, DOI, InChIKey y `provenance` (origen, software). |
| **Accessible** | `metadata.license` y URIs en `@context`; datos accesibles vía API. |
| **Interoperable** | `@context` (JSON-LD) mapea términos a vocabularios estándar (schema.org, ChEBI, QUDT). Unidades explícitas (`units.length`: angstrom). JSON Schema define el formato. |
| **Reusable** | Geometría (`geometry`) separada de visualización (`visualization`). Topología (`topology.bonds`) y unidades claras. Esquema validable y documentado. |

---

## 1. Esquema `standard_molecule.json`

- **Esquema:** `molecules/schemas/standard_molecule.json`
- **Ejemplo válido:** `molecules/schemas/standard_molecule_example.json`

- **`@context` (JSON-LD):** Términos semánticos (URIs) para que máquinas interpreten `metadata`, `geometry`, `atoms`, `bonds`, `units`, etc. Facilita **Interoperability** y **Reusability**.
- **`metadata`:** Identificadores persistentes (DOI, InChIKey), licencia, procedencia (Avogadro2, OpenBabel, etc.). Facilita **Findability** y **Accessibility**.
- **`geometry`:** Arreglos tipados `x`, `y`, `z`, `element`, `atomic_number` [, `atom_ids`]. Topología en **`topology.bonds`** con `i`, `j`, `order`.
- **`visualization`:** Opcional. `cpk_colors`, `vdw_radii` separados de la geometría.
- **`units`:** Explícitos (`length`: angstrom, `angle`: degree) para **MDDB**.

---

## 2. Uso en Python

```python
from molecules.fair_json import (
    cml_to_fair_json,
    cml_to_fair_json_normalized,
    fair_json_to_sdf,
    validate_fair_molecule,
    validate_fair_molecule_strict,
)

# CML → JSON FAIR
cml = open("mol.cml").read()
doc = cml_to_fair_json(
    cml,
    name="Cafeína",
    source_software="Avogadro2",
    license_="CC-BY-4.0",
    include_visualization=True,
)

# Normalizar CML y luego convertir
doc = cml_to_fair_json_normalized(cml, name="Cafeína")

# Validar contra standard_molecule.json
ok, errors = validate_fair_molecule(doc)
validate_fair_molecule_strict(doc)  # lanza si inválido

# JSON → SDF (para 3Dmol.js u otros)
sdf = fair_json_to_sdf(doc)
```

---

## 3. Validador y normalización

- **Validador:** `validate_fair_molecule(doc)` usa JSON Schema (`standard_molecule.json`). Requiere `jsonschema`.
- **Normalización:** `normalize_cml(cml)` limpia atributos redundantes del CML y reduce el payload sin perder fidelidad científica.

---

## 4. Serialización hacia 3Dmol.js

- **Backend:** `fair_json_to_sdf(doc)` convierte el JSON FAIR a **SDF V2000**.
- **Frontend (multiplataforma):** El visor **consume FAIR JSON directamente** cuando existe (p. ej. moléculas subidas como CML). Se usa `fair-json.js` para convertir JSON → SDF en el cliente y cargar en 3Dmol.js. Si no hay FAIR JSON o falla la petición, se usa el archivo tradicional (SDF, PDB, etc.). Esto reduce payload, aprovecha parsing nativo de JSON y mejora el comportamiento en móviles y distintos dispositivos.
