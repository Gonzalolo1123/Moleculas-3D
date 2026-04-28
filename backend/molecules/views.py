from pathlib import Path

from bson import ObjectId
from django.conf import settings
from django.http import FileResponse, Http404
from django.shortcuts import redirect
from django.shortcuts import render
from django.utils import timezone
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .chem_identifiers import rdkit_available, try_inchikey_from_bytes, try_smiles_from_bytes
from .conformer_labels import (
    CONFORMER_DISPLAY,
    conformer_label_es,
    conformer_sort_key,
    normalize_conformer_custom,
    normalize_conformer_type,
)
from .mongo import molecules_collection
from .storage import BULK_ALLOWED_EXT, persist_molecule, safe_ext


def _object_id_or_404(id_str: str) -> ObjectId:
    try:
        return ObjectId(id_str)
    except Exception as e:
        raise Http404("id inválido") from e


def _bulk_import_from_post(request) -> list[dict]:
    """Procesa POST de carga masiva (solo archivos o carpeta desde el navegador)."""
    results: list[dict] = []
    files = request.FILES.getlist("files")
    if not files:
        results.append({"ok": False, "name": "—", "detail": "No se seleccionaron archivos."})
    for f in files:
        orig = f.name.replace("\\", "/")
        short_name = Path(orig).name
        stem = Path(short_name).stem or short_name
        ext = safe_ext(short_name)
        if ext not in BULK_ALLOWED_EXT:
            results.append({
                "ok": False,
                "name": short_name,
                "detail": f"Extensión .{ext} no permitida en carga masiva.",
            })
            continue
        try:
            raw = f.read()
            oid, info = persist_molecule(stem, short_name, raw, fmt=None)
            if info.get("duplicate"):
                results.append({
                    "ok": True,
                    "duplicate": True,
                    "name": stem,
                    "detail": "Ya existía un archivo idéntico (mismo contenido).",
                    "id": oid,
                })
            else:
                results.append({
                    "ok": True,
                    "name": stem,
                    "detail": "Importado correctamente.",
                    "id": oid,
                })
        except Exception as e:
            results.append({
                "ok": False,
                "name": stem,
                "detail": str(e) or "Error al guardar.",
            })
    return results


DEMO_SUBJECTS = (
    "Química orgánica",
    "Química general",
    "Fisicoquímica",
    "Bioquímica",
    "Química inorgánica",
)


def _annotate_demo_subjects(items: list[dict]) -> list[dict]:
    """Etiquetas de materia solo para vistas demo (profesor/estudiante)."""
    for i, doc in enumerate(items):
        doc["demo_subject"] = DEMO_SUBJECTS[i % len(DEMO_SUBJECTS)]
    return items


def _group_key_from_doc(doc: dict) -> str:
    """Clave de agrupación para listado general: manual > InChIKey > id."""
    manual = (doc.get("manual_group_key") or "").strip()
    if manual:
        return f"manual:{manual}"
    ik = (doc.get("inchikey") or "").strip()
    if ik:
        return f"inchikey:{ik}"
    return f"id:{doc.get('_id')}"


def _ensure_doc_identifiers(doc: dict) -> dict:
    """
    Garantiza campos `inchikey` y `smiles` en Mongo para documentos existentes.
    Si faltan, intenta calcularlos desde el archivo original y persiste el resultado.
    """
    coll = molecules_collection()
    has_inchikey = "inchikey" in doc
    has_smiles = "smiles" in doc
    inchikey_val = (doc.get("inchikey") or "").strip()
    smiles_val = (doc.get("smiles") or "").strip()

    needs_compute = (not inchikey_val) or (not smiles_val)
    if needs_compute:
        rel = doc.get("file_path")
        if rel:
            try:
                abs_path = Path(settings.MEDIA_ROOT) / rel
                if abs_path.exists():
                    raw = abs_path.read_bytes()
                    ext_guess = safe_ext(doc.get("original_filename") or abs_path.name)
                    if not inchikey_val:
                        inchikey_val = try_inchikey_from_bytes(raw, ext_guess) or ""
                    if not smiles_val:
                        smiles_val = try_smiles_from_bytes(raw, ext_guess) or ""
            except Exception:
                pass

    needs_set = (not has_inchikey) or (not has_smiles) or needs_compute
    if needs_set and doc.get("_id") is not None:
        coll.update_one(
            {"_id": doc["_id"]},
            {"$set": {"inchikey": inchikey_val, "smiles": smiles_val}},
        )

    doc["inchikey"] = inchikey_val
    doc["smiles"] = smiles_val
    return doc


def _recompute_doc_identifiers(doc: dict) -> tuple[dict, bool]:
    """Recalcula identificadores y retorna (doc_actualizado, hubo_cambios)."""
    before_inchikey = (doc.get("inchikey") or "").strip()
    before_smiles = (doc.get("smiles") or "").strip()
    has_before_fields = ("inchikey" in doc) and ("smiles" in doc)
    updated = _ensure_doc_identifiers(doc)
    after_inchikey = (updated.get("inchikey") or "").strip()
    after_smiles = (updated.get("smiles") or "").strip()
    changed = (
        (before_inchikey != after_inchikey)
        or (before_smiles != after_smiles)
        or (not has_before_fields)
    )
    return updated, changed


def index(request):
    """
    Home: importación masiva (principal), subida unitaria opcional, listado reciente.
    """
    ctx: dict = {
        "items": _latest_items(),
        "created_id": None,
        "duplicate": False,
        "bulk_results": None,
        "active_role": "admin",
        "conformer_choices": CONFORMER_DISPLAY,
    }

    if request.method == "POST":
        form_type = (request.POST.get("form_type") or "").strip()

        if form_type == "bulk":
            ctx["bulk_results"] = _bulk_import_from_post(request)
            ctx["items"] = _latest_items()
            return render(request, "molecules/index.html", ctx)

        if form_type == "single":
            name = (request.POST.get("name") or "").strip()
            fmt = (request.POST.get("format") or "").strip().lower()
            upload = request.FILES.get("file")

            if name and upload:
                if not fmt:
                    fmt = safe_ext(upload.name)
                raw = upload.read()
                conf = (request.POST.get("conformer_type") or "").strip()
                conf_custom = (request.POST.get("conformer_custom_label") or "").strip()
                oid, info = persist_molecule(
                    name,
                    upload.name,
                    raw,
                    fmt=fmt,
                    conformer_type=conf or None,
                    conformer_custom_label=conf_custom or None,
                )
                q = f"/?created_id={oid}"
                if info.get("duplicate"):
                    q += "&duplicate=1"
                return redirect(q)

    ctx["created_id"] = request.GET.get("created_id") or None
    ctx["duplicate"] = request.GET.get("duplicate") == "1"
    return render(request, "molecules/index.html", ctx)


def role_professor(request):
    """Vista demo: planificación por materias y búsqueda (sin persistencia de clases)."""
    items = _annotate_demo_subjects(_latest_items(200))
    return render(
        request,
        "molecules/role_professor.html",
        {
            "items": items,
            "active_role": "professor",
            "demo_subject_list": list(DEMO_SUBJECTS),
        },
    )


def role_student(request):
    """Vista demo: biblioteca / glosario, favoritos y carpetas solo en el navegador."""
    items = _annotate_demo_subjects(_latest_items(200))
    return render(
        request,
        "molecules/role_student.html",
        {
            "items": items,
            "active_role": "student",
            "demo_subject_list": list(DEMO_SUBJECTS),
        },
    )


def _latest_items(limit: int = 25) -> list[dict]:
    coll = molecules_collection()
    counts_by_group: dict[str, int] = {}
    for d in coll.find({}, {"inchikey": 1, "manual_group_key": 1}):
        d = _ensure_doc_identifiers(d)
        gk = _group_key_from_doc(d)
        counts_by_group[gk] = counts_by_group.get(gk, 0) + 1

    items = []
    seen_groups: set[str] = set()
    for doc in coll.find({}).sort("created_at", -1):
        doc = _ensure_doc_identifiers(doc)
        group_key = _group_key_from_doc(doc)
        # Si hay variantes con el mismo InChIKey, solo listamos una en el index.
        # Las demás quedan accesibles desde el viewer (desplegable de conformaciones).
        if group_key in seen_groups:
            continue
        seen_groups.add(group_key)
        doc["id"] = str(doc.pop("_id"))
        ct = doc.get("conformer_type") or "unspecified"
        cc = doc.get("conformer_custom_label") or ""
        doc["conformer_type"] = ct
        doc["conformer_custom_label"] = cc
        doc["conformer_label_display"] = conformer_label_es(ct, cc)
        doc["conformer_label_short"] = (
            "General" if ct == "unspecified" else doc["conformer_label_display"]
        )
        doc["group_key"] = group_key
        doc["structure_count"] = counts_by_group.get(group_key, 1)
        items.append(doc)
        if len(items) >= limit:
            break
    return items


def web_delete(request, molecule_id: str):
    """
    Delete desde la UI (POST) y luego vuelve al home.
    """
    if request.method != "POST":
        raise Http404()

    oid = _object_id_or_404(molecule_id)
    doc = molecules_collection().find_one({"_id": oid})
    if doc:
        rel = doc.get("file_path")
        if rel:
            try:
                abs_path = Path(settings.MEDIA_ROOT) / rel
                if abs_path.exists():
                    abs_path.unlink()
            except Exception:
                pass
        fair_rel = doc.get("fair_json_path")
        if fair_rel:
            try:
                fair_path = Path(settings.MEDIA_ROOT) / fair_rel
                if fair_path.exists():
                    fair_path.unlink()
            except Exception:
                pass
        molecules_collection().delete_one({"_id": oid})
    return redirect("/")


class MoleculeListCreate(APIView):
    parser_classes = (MultiPartParser, FormParser)

    def get(self, request):
        items = []
        for doc in molecules_collection().find({}, {"file_path": 0}).sort("created_at", -1).limit(100):
            doc["id"] = str(doc.pop("_id"))
            items.append(doc)
        return Response(items)

    def post(self, request):
        name = (request.data.get("name") or "").strip()
        fmt = (request.data.get("format") or "").strip().lower()
        upload = request.FILES.get("file")

        if not name:
            return Response({"error": "Falta 'name'."}, status=400)
        if upload is None:
            return Response({"error": "Falta 'file' (multipart/form-data)."}, status=400)

        # format: si no lo envían, lo inferimos por extensión
        if not fmt:
            fmt = safe_ext(upload.name)

        raw = upload.read()
        conf = (request.data.get("conformer_type") or "").strip()
        conf_custom = (request.data.get("conformer_custom_label") or "").strip()
        oid, info = persist_molecule(
            name,
            upload.name,
            raw,
            fmt=fmt,
            conformer_type=conf or None,
            conformer_custom_label=conf_custom or None,
        )
        payload = {
            "id": oid,
            "name": info.get("name") or name,
            "format": fmt,
            "file_url": request.build_absolute_uri(f"/api/molecules/{oid}/file/"),
            "viewer_url": request.build_absolute_uri(f"/viewer/{oid}/"),
            "conformer_type": info.get("conformer_type") or "unspecified",
            "conformer_custom_label": info.get("conformer_custom_label") or "",
        }
        if info.get("duplicate"):
            payload["duplicate"] = True
            payload["dedup"] = info.get("dedup")
            payload["inchikey"] = info.get("inchikey")
            return Response(payload, status=409)
        payload["inchikey"] = info.get("inchikey")
        return Response(payload, status=201)


class MoleculeDetail(APIView):
    def get(self, request, molecule_id: str):
        oid = _object_id_or_404(molecule_id)
        doc = molecules_collection().find_one({"_id": oid}, {"file_path": 0})
        if not doc:
            raise Http404("No existe.")
        doc["id"] = str(doc.pop("_id"))
        return Response(doc)

    def patch(self, request, molecule_id: str):
        """
        Actualiza campos básicos (name, format).
        """
        oid = _object_id_or_404(molecule_id)
        updates = {}
        if "name" in request.data:
            updates["name"] = (request.data.get("name") or "").strip()
        if "format" in request.data:
            updates["format"] = (request.data.get("format") or "").strip().lower()
        if "conformer_type" in request.data:
            ct = normalize_conformer_type(request.data.get("conformer_type"))
            updates["conformer_type"] = ct
            if ct != "other":
                updates["conformer_custom_label"] = ""
        if "conformer_custom_label" in request.data:
            updates["conformer_custom_label"] = normalize_conformer_custom(
                request.data.get("conformer_custom_label")
            )

        # Limpia vacíos (excepto campos que se pueden limpiar explícitamente)
        updates = {
            k: v
            for k, v in updates.items()
            if (k == "conformer_custom_label") or bool(v)
        }
        if not updates:
            return Response({"error": "Nada que actualizar."}, status=400)

        res = molecules_collection().update_one({"_id": oid}, {"$set": updates})
        if res.matched_count == 0:
            raise Http404("No existe.")
        doc = molecules_collection().find_one({"_id": oid}, {"file_path": 0})
        doc["id"] = str(doc.pop("_id"))
        return Response(doc)

    def delete(self, request, molecule_id: str):
        oid = _object_id_or_404(molecule_id)
        doc = molecules_collection().find_one({"_id": oid})
        if not doc:
            raise Http404("No existe.")

        # Borra archivo asociado si existe
        rel = doc.get("file_path")
        if rel:
            try:
                abs_path = Path(settings.MEDIA_ROOT) / rel
                if abs_path.exists():
                    abs_path.unlink()
            except Exception:
                pass
        fair_rel = doc.get("fair_json_path")
        if fair_rel:
            try:
                fair_path = Path(settings.MEDIA_ROOT) / fair_rel
                if fair_path.exists():
                    fair_path.unlink()
            except Exception:
                pass

        molecules_collection().delete_one({"_id": oid})
        return Response(status=204)


class MoleculeFile(APIView):
    def get(self, request, molecule_id: str):
        oid = _object_id_or_404(molecule_id)
        doc = molecules_collection().find_one({"_id": oid})
        if not doc:
            raise Http404("No existe.")

        rel = doc.get("file_path")
        if not rel:
            raise Http404("Sin archivo.")

        abs_path = Path(settings.MEDIA_ROOT) / rel
        if not abs_path.exists():
            raise Http404("Archivo no encontrado.")

        return FileResponse(
            abs_path.open("rb"),
            as_attachment=False,
            filename=doc.get("original_filename") or abs_path.name,
        )


class MoleculeFairJson(APIView):
    """Devuelve el FAIR JSON de una molécula (solo si existe .fair.json, p. ej. CML origen)."""

    def get(self, request, molecule_id: str):
        oid = _object_id_or_404(molecule_id)
        doc = molecules_collection().find_one({"_id": oid})
        if not doc:
            raise Http404("No existe.")
        rel = doc.get("fair_json_path")
        if not rel:
            raise Http404("FAIR JSON no disponible para esta molécula.")

        abs_path = Path(settings.MEDIA_ROOT) / rel
        if not abs_path.exists():
            raise Http404("Archivo FAIR JSON no encontrado.")

        from django.http import HttpResponse
        return HttpResponse(
            abs_path.read_text(encoding="utf-8"),
            content_type="application/json",
        )


def viewer(request, molecule_id: str):
    oid = _object_id_or_404(molecule_id)
    doc = molecules_collection().find_one({"_id": oid})
    if not doc:
        raise Http404("No existe.")
    doc = _ensure_doc_identifiers(doc)

    ct = doc.get("conformer_type") or "unspecified"
    cc = doc.get("conformer_custom_label") or ""
    return render(
        request,
        "molecules/viewer.html",
        {
            "molecule_id": str(oid),
            "name": doc.get("name", ""),
            "format": doc.get("format", "pdb"),
            "file_url": f"/api/molecules/{oid}/file/",
            "fair_json_url": f"/api/molecules/{oid}/fair/" if doc.get("fair_json_path") else "",
            "inchikey": doc.get("inchikey") or "",
            "smiles": doc.get("smiles") or "",
            "conformer_type": ct,
            "conformer_label": conformer_label_es(ct, cc),
        },
    )


class MoleculeConformerVariants(APIView):
    """Listado de registros de la misma familia (manual_group_key o InChIKey)."""

    def get(self, request, molecule_id: str):
        oid = _object_id_or_404(molecule_id)
        coll = molecules_collection()
        doc = coll.find_one({"_id": oid}, {"inchikey": 1, "manual_group_key": 1})
        if not doc:
            raise Http404("No existe.")

        manual = (doc.get("manual_group_key") or "").strip()
        ik = (doc.get("inchikey") or "").strip()

        query: dict
        family_key: str | None
        if manual:
            query = {"manual_group_key": manual}
            family_key = manual
        elif ik:
            query = {"inchikey": ik}
            family_key = ik
        else:
            # Sin grupo ni InChIKey: solo la molécula actual.
            query = {"_id": oid}
            family_key = None

        variants: list[dict] = []
        for d in coll.find(query, {"file_path": 0}).sort("created_at", 1):
            vid = str(d["_id"])
            ct = d.get("conformer_type") or "unspecified"
            cc = d.get("conformer_custom_label") or ""
            variants.append({
                "id": vid,
                "name": d.get("name") or "",
                "conformer_type": ct,
                "conformer_label": conformer_label_es(ct, cc),
                "viewer_url": request.build_absolute_uri(f"/viewer/{vid}/"),
                "file_url": request.build_absolute_uri(f"/api/molecules/{vid}/file/"),
            })
        variants.sort(
            key=lambda x: (conformer_sort_key(x["conformer_type"]), (x["name"] or "").lower())
        )
        return Response({"inchikey": ik or None, "group_key": family_key, "variants": variants})


class MoleculeGroupLink(APIView):
    """
    Vincula manualmente varias moléculas como una sola familia visual.
    Permite agrupar estructuras aun cuando no compartan InChIKey.
    """

    def post(self, request, molecule_id: str):
        coll = molecules_collection()
        oid = _object_id_or_404(molecule_id)
        root = coll.find_one({"_id": oid})
        if not root:
            raise Http404("No existe.")

        raw_ids = request.data.get("molecule_ids") or []
        if not isinstance(raw_ids, list):
            return Response({"error": "'molecule_ids' debe ser una lista."}, status=400)

        ids: list[ObjectId] = [oid]
        for v in raw_ids:
            try:
                ids.append(ObjectId(str(v)))
            except Exception:
                continue

        seed_docs = list(coll.find({"_id": {"$in": ids}}, {"manual_group_key": 1}))
        manual_keys = {
            str(d.get("manual_group_key")).strip()
            for d in seed_docs
            if str(d.get("manual_group_key") or "").strip()
        }

        group_key = next(iter(manual_keys), "") or f"grp:{molecule_id}"

        # Si alguno ya estaba en otro grupo manual, absorbemos todos esos miembros.
        absorb_ids: set[ObjectId] = set(ids)
        if manual_keys:
            for d in coll.find({"manual_group_key": {"$in": list(manual_keys)}}, {"_id": 1}):
                absorb_ids.add(d["_id"])

        res = coll.update_many(
            {"_id": {"$in": list(absorb_ids)}},
            {"$set": {"manual_group_key": group_key}},
        )
        return Response({
            "group_key": group_key,
            "linked_count": int(res.modified_count),
            "total_members": len(absorb_ids),
        })


class MoleculeRecomputeIdentifiers(APIView):
    """Recalcula InChIKey y SMILES para una molécula específica."""

    def post(self, request, molecule_id: str):
        try:
            oid = _object_id_or_404(molecule_id)
            doc = molecules_collection().find_one({"_id": oid})
            if not doc:
                raise Http404("No existe.")
            updated, changed = _recompute_doc_identifiers(doc)
            return Response({
                "ok": True,
                "id": str(updated.get("_id") or oid),
                "inchikey": updated.get("inchikey") or "",
                "smiles": updated.get("smiles") or "",
                "changed": changed,
            })
        except Http404:
            raise
        except Exception as e:
            return Response(
                {"ok": False, "error": "No se pudo recalcular identificadores.", "detail": str(e)},
                status=500,
            )


class MoleculeRecomputeIdentifiersAll(APIView):
    """Recalcula InChIKey y SMILES para toda la colección (uso temporal)."""

    def post(self, request):
        try:
            coll = molecules_collection()
            total = 0
            changed = 0
            errors = 0
            failed_ids: list[str] = []
            missing_inchikey = 0
            missing_smiles = 0
            parsed_ok = 0
            diagnostics: list[dict[str, str]] = []
            for doc in coll.find({}):
                total += 1
                try:
                    _, c = _recompute_doc_identifiers(doc)
                    if c:
                        changed += 1
                    refreshed = coll.find_one({"_id": doc.get("_id")}, {"inchikey": 1, "smiles": 1})
                    ik = (refreshed or {}).get("inchikey") or ""
                    smi = (refreshed or {}).get("smiles") or ""
                    if ik:
                        parsed_ok += 1
                    else:
                        missing_inchikey += 1
                    if not smi:
                        missing_smiles += 1
                except Exception:
                    errors += 1
                    failed_ids.append(str(doc.get("_id")))
                    if len(diagnostics) < 20:
                        diagnostics.append({
                            "id": str(doc.get("_id")),
                            "reason": "exception_during_recompute",
                        })
            return Response({
                "ok": True,
                "total": total,
                "updated": changed,
                "unchanged": max(total - changed - errors, 0),
                "errors": errors,
                "failed_ids": failed_ids[:20],
                "rdkit_available": rdkit_available(),
                "missing_inchikey": missing_inchikey,
                "missing_smiles": missing_smiles,
                "parsed_ok": parsed_ok,
                "diagnostics": diagnostics,
            })
        except Exception as e:
            return Response(
                {"ok": False, "error": "No se pudo ejecutar el recálculo global.", "detail": str(e)},
                status=500,
            )

