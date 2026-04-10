"""Tests de InChIKey (requieren RDKit)."""

from __future__ import annotations

import unittest

from molecules.chem_identifiers import mol_from_fair_dict, rdkit_available, try_inchikey_from_fair_dict

SIMPLE_FAIR = {
    "geometry": {
        "x": [0.0, 1.1],
        "y": [0.0, 0.0],
        "z": [0.0, 0.0],
        "element": ["N", "N"],
    },
    "topology": {"bonds": [{"i": 0, "j": 1, "order": 3}]},
}


@unittest.skipUnless(rdkit_available(), "RDKit no instalado")
class TestInchiFromFair(unittest.TestCase):
    def test_n2_connectivity_yields_inchikey(self):
        mol = mol_from_fair_dict(SIMPLE_FAIR)
        self.assertIsNotNone(mol)
        key = try_inchikey_from_fair_dict(SIMPLE_FAIR)
        self.assertIsNotNone(key)
        self.assertEqual(len(key), 27)
        self.assertEqual(key.count("-"), 2)


if __name__ == "__main__":
    unittest.main()
