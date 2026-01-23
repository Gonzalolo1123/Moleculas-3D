"""
Tests para fair_json: CML->JSON, normalización, validador, JSON->SDF.
Ejecutar desde backend/: python manage.py test molecules.tests_fair_json
O: python -m unittest molecules.tests_fair_json
"""

from __future__ import annotations

import unittest

try:
    import jsonschema
except ImportError:
    jsonschema = None

from molecules.fair_json import (
    cml_to_fair_json,
    cml_to_fair_json_normalized,
    fair_json_to_sdf,
    normalize_cml,
    validate_fair_molecule,
    validate_fair_molecule_strict,
)

SAMPLE_CML = """<?xml version="1.0" encoding="UTF-8"?>
<list xmlns="http://www.xml-cml.org/schema">
  <molecule id="m1">
    <atomArray>
      <atom id="a1" elementType="C" x3="0.0" y3="0.0" z3="0.0"/>
      <atom id="a2" elementType="N" x3="1.2" y3="0.0" z3="0.0"/>
      <atom id="a3" elementType="O" x3="-0.8" y3="0.6" z3="0.0"/>
    </atomArray>
    <bondArray>
      <bond atomRefs2="a1 a2" order="1"/>
      <bond atomRefs2="a1 a3" order="2"/>
    </bondArray>
  </molecule>
</list>
"""


class TestNormalizeCml(unittest.TestCase):
    def test_normalize_cml(self):
        out = normalize_cml(SAMPLE_CML)
        self.assertIn("molecule", out)
        self.assertIn("atomArray", out)
        self.assertIn("atom", out)
        self.assertIn("elementType", out)
        self.assertIn("x3", out)


class TestCmlToFairJson(unittest.TestCase):
    def test_basic(self):
        d = cml_to_fair_json(SAMPLE_CML, name="test_mol", source_software="Avogadro2")
        self.assertIn("@context", d)
        self.assertIn("metadata", d)
        self.assertEqual(d["metadata"]["name"], "test_mol")
        self.assertEqual(d["metadata"]["provenance"]["source_software"], "Avogadro2")
        self.assertIn("geometry", d)
        g = d["geometry"]
        self.assertEqual(len(g["x"]), 3)
        self.assertEqual(g["element"], ["C", "N", "O"])
        self.assertEqual(g["atomic_number"], [6, 7, 8])
        self.assertIn("topology", d)
        self.assertEqual(len(d["topology"]["bonds"]), 2)
        self.assertEqual(d["units"]["length"], "angstrom")
        self.assertIn("visualization", d)
        self.assertEqual(len(d["visualization"]["cpk_colors"]), 3)

    def test_no_visualization(self):
        d = cml_to_fair_json(SAMPLE_CML, name="x", include_visualization=False)
        self.assertNotIn("visualization", d)
        self.assertIn("geometry", d)


@unittest.skipIf(jsonschema is None, "jsonschema no instalado")
class TestValidateFairMolecule(unittest.TestCase):
    def test_valid(self):
        d = cml_to_fair_json(SAMPLE_CML, name="v")
        ok, errs = validate_fair_molecule(d)
        self.assertTrue(ok, errs)
        self.assertEqual(errs, [])

    def test_strict(self):
        d = cml_to_fair_json(SAMPLE_CML, name="v")
        validate_fair_molecule_strict(d)

    def test_invalid(self):
        ok, errs = validate_fair_molecule({})
        self.assertFalse(ok)
        self.assertGreater(len(errs), 0)


class TestFairJsonToSdf(unittest.TestCase):
    def test_sdf_output(self):
        d = cml_to_fair_json(SAMPLE_CML, name="sdf_mol")
        sdf = fair_json_to_sdf(d)
        self.assertIn("V2000", sdf)
        self.assertIn("M  END", sdf)
        self.assertIn("$$$$", sdf)
        self.assertIn("sdf_mol", sdf)

    def test_roundtrip(self):
        d = cml_to_fair_json(SAMPLE_CML, name="r")
        sdf = fair_json_to_sdf(d)
        self.assertIn("C", sdf)
        self.assertIn("N", sdf)
        self.assertIn("O", sdf)
        lines = sdf.strip().split("\n")
        self.assertGreaterEqual(len(lines), 4)
        counts = lines[3].split()
        self.assertEqual(int(counts[0]), 3)
        self.assertEqual(int(counts[1]), 2)


class TestNormalizedConversion(unittest.TestCase):
    def test_normalized(self):
        d = cml_to_fair_json_normalized(SAMPLE_CML, name="norm")
        self.assertEqual(d["metadata"]["name"], "norm")
        self.assertIn("geometry", d)
        self.assertIn("topology", d)
        if jsonschema is not None:
            ok, _ = validate_fair_molecule(d)
            self.assertTrue(ok)


if __name__ == "__main__":
    unittest.main()
