import os
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

from .fair_json import cml_to_fair_json_normalized, fair_json_to_json_string, validate_fair_molecule
from .mongo import molecules_collection


def _object_id_or_404(id_str: str) -> ObjectId:
    try:
        return ObjectId(id_str)
    except Exception as e:
        raise Http404("id inválido") from e


def _safe_ext(filename: str) -> str:
    ext = Path(filename).suffix.lower().strip(".")
    if not ext:
        return "dat"
    return ext[:10]


def index(request):
    """
    Home simple para subir una molécula y listar las últimas cargadas.
    """
    if request.method == "POST":
        # Reutilizamos la misma lógica de guardado del endpoint API, pero sin DRF.
        name = (request.POST.get("name") or "").strip()
        fmt = (request.POST.get("format") or "").strip().lower()
        upload = request.FILES.get("file")

        if name and upload:
            if not fmt:
                fmt = _safe_ext(upload.name)

            os.makedirs(settings.MEDIA_ROOT, exist_ok=True)
            molecules_dir = Path(settings.MEDIA_ROOT) / "molecules"
            molecules_dir.mkdir(parents=True, exist_ok=True)

            # Guardado: CML se guarda directamente, se genera FAIR JSON (optimizado para Avogadro)
            safe_ext = _safe_ext(upload.name)
            base = f"{timezone.now().strftime('%Y%m%d_%H%M%S')}_{upload.size}"

            rel_path = Path("molecules") / f"{base}.{safe_ext}"
            abs_path = Path(settings.MEDIA_ROOT) / rel_path

            raw = upload.read()
            abs_path.write_bytes(raw)

            stored_format = fmt
            stored_rel_path = rel_path
            fair_json_path = None

            # Para CML: generar FAIR JSON directamente (sin convertir a SDF)
            if safe_ext == "cml" or fmt == "cml":
                cml_text = raw.decode("utf-8", errors="replace")
                try:
                    fair = cml_to_fair_json_normalized(
                        cml_text, name=name,
                        source_software="Avogadro2",
                        source_file=upload.name,
                    )
                    ok, _ = validate_fair_molecule(fair)
                    if ok:
                        fair_rel = Path("molecules") / f"{base}.fair.json"
                        (Path(settings.MEDIA_ROOT) / fair_rel).write_text(
                            fair_json_to_json_string(fair), encoding="utf-8"
                        )
                        fair_json_path = str(fair_rel).replace("\\", "/")
                except Exception as e:
                    # Si falla FAIR JSON, guardamos el CML original igualmente
                    print(f"Error generando FAIR JSON: {e}")

            doc = {
                "name": name,
                "format": stored_format,
                "original_filename": upload.name,
                "file_path": str(stored_rel_path).replace("\\", "/"),
                "size_bytes": int(len(raw)),
                "created_at": timezone.now(),
            }
            if fair_json_path is not None:
                doc["fair_json_path"] = fair_json_path
            result = molecules_collection().insert_one(doc)
            # PRG: evita duplicados por refresh (reenvío de POST)
            return redirect(f"/?created_id={result.inserted_id}")

    created_id = request.GET.get("created_id") or None
    return render(request, "molecules/index.html", {"items": _latest_items(), "created_id": created_id})


def _latest_items():
    items = []
    for doc in molecules_collection().find({}).sort("created_at", -1).limit(25):
        doc["id"] = str(doc.pop("_id"))
        items.append(doc)
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
            fmt = _safe_ext(upload.name)

        os.makedirs(settings.MEDIA_ROOT, exist_ok=True)
        molecules_dir = Path(settings.MEDIA_ROOT) / "molecules"
        molecules_dir.mkdir(parents=True, exist_ok=True)

        safe_ext = _safe_ext(upload.name)
        base = f"{timezone.now().strftime('%Y%m%d_%H%M%S')}_{upload.size}"

        rel_path = Path("molecules") / f"{base}.{safe_ext}"
        abs_path = Path(settings.MEDIA_ROOT) / rel_path

        raw = upload.read()
        abs_path.write_bytes(raw)

        stored_format = fmt
        stored_rel_path = rel_path
        fair_json_path = None

        # Para CML: generar FAIR JSON directamente (sin convertir a SDF)
        if safe_ext == "cml" or fmt == "cml":
            cml_text = raw.decode("utf-8", errors="replace")
            try:
                fair = cml_to_fair_json_normalized(
                    cml_text, name=name,
                    source_software="Avogadro2",
                    source_file=upload.name,
                )
                ok, _ = validate_fair_molecule(fair)
                if ok:
                    fair_rel = Path("molecules") / f"{base}.fair.json"
                    (Path(settings.MEDIA_ROOT) / fair_rel).write_text(
                        fair_json_to_json_string(fair), encoding="utf-8"
                    )
                    fair_json_path = str(fair_rel).replace("\\", "/")
            except Exception as e:
                # Si falla FAIR JSON, guardamos el CML original igualmente
                print(f"Error generando FAIR JSON: {e}")

        doc = {
            "name": name,
            "format": stored_format,
            "original_filename": upload.name,
            "file_path": str(stored_rel_path).replace("\\", "/"),
            "size_bytes": int(len(raw)),
            "created_at": timezone.now(),
        }
        if fair_json_path is not None:
            doc["fair_json_path"] = fair_json_path

        result = molecules_collection().insert_one(doc)
        return Response(
            {
                "id": str(result.inserted_id),
                "name": name,
                "format": fmt,
                "file_url": request.build_absolute_uri(f"/api/molecules/{result.inserted_id}/file/"),
                "viewer_url": request.build_absolute_uri(f"/viewer/{result.inserted_id}/"),
            },
            status=201,
        )


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

        # Limpia vacíos
        updates = {k: v for k, v in updates.items() if v}
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

    return render(
        request,
        "molecules/viewer.html",
        {
            "molecule_id": str(oid),
            "name": doc.get("name", ""),
            "format": doc.get("format", "pdb"),
            "file_url": f"/api/molecules/{oid}/file/",
            "fair_json_url": f"/api/molecules/{oid}/fair/" if doc.get("fair_json_path") else "",
        },
    )

