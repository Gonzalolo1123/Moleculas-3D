import ipaddress
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from bson import ObjectId
from django.conf import settings
from django.http import FileResponse, Http404
from django.shortcuts import redirect
from django.shortcuts import render
from django.utils import timezone
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .mongo import molecules_collection
from .storage import BULK_ALLOWED_EXT, persist_molecule, safe_ext


def _object_id_or_404(id_str: str) -> ObjectId:
    try:
        return ObjectId(id_str)
    except Exception as e:
        raise Http404("id inválido") from e


def _url_host_is_blocked(host: str) -> bool:
    h = (host or "").lower().strip(".")
    if not h:
        return True
    if h in ("localhost", "127.0.0.1", "::1"):
        return True
    if h.endswith(".local") or h.endswith(".localhost"):
        return True
    try:
        ip = ipaddress.ip_address(h)
        return bool(ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast)
    except ValueError:
        return False


def _is_safe_remote_url(url: str) -> bool:
    try:
        p = urlparse(url.strip())
    except Exception:
        return False
    if p.scheme not in ("http", "https"):
        return False
    if not p.hostname:
        return False
    return not _url_host_is_blocked(p.hostname)


def _fetch_url_bytes(url: str, max_bytes: int = 25 * 1024 * 1024) -> tuple[bytes, str]:
    req = Request(url, headers={"User-Agent": "Moleculas3D-BulkImport/1.0"})
    with urlopen(req, timeout=60) as resp:
        cd = resp.headers.get("Content-Disposition") or ""
        fname = ""
        if "filename=" in cd:
            part = cd.split("filename=", 1)[-1].strip().strip('"').split(";")[0]
            fname = part or ""
        if not fname:
            path = (urlparse(url).path or "").rstrip("/")
            fname = Path(path).name if path else "download"
        if not fname or fname == ".":
            fname = "download.dat"
        chunks: list[bytes] = []
        total = 0
        while True:
            block = resp.read(65536)
            if not block:
                break
            total += len(block)
            if total > max_bytes:
                raise ValueError("El archivo remoto supera el tamaño máximo permitido (25 MB).")
            chunks.append(block)
        return b"".join(chunks), fname


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
                fmt = safe_ext(upload.name)
            raw = upload.read()
            oid, info = persist_molecule(name, upload.name, raw, fmt=fmt)
            q = f"/?created_id={oid}"
            if info.get("duplicate"):
                q += "&duplicate=1"
            return redirect(q)

    created_id = request.GET.get("created_id") or None
    duplicate = request.GET.get("duplicate") == "1"
    return render(
        request,
        "molecules/index.html",
        {"items": _latest_items(), "created_id": created_id, "duplicate": duplicate},
    )


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


def bulk_load(request):
    """
    Carga masiva: varios archivos (o carpeta vía navegador) o importación desde URL pública.
    """
    results: list[dict] = []
    if request.method != "POST":
        return render(request, "molecules/bulk_load.html", {"results": None})

    mode = (request.POST.get("bulk_mode") or "files").strip()

    if mode == "files":
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
                        "detail": (
                            "Ya existía la misma estructura (InChIKey)."
                            if info.get("dedup") == "inchikey"
                            else "Ya existía un archivo idéntico (mismo contenido)."
                        ),
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

    elif mode == "url":
        url = (request.POST.get("source_url") or "").strip()
        if not url:
            results.append({"ok": False, "name": "—", "detail": "Indica una URL válida (http/https)."})
        elif not _is_safe_remote_url(url):
            results.append({
                "ok": False,
                "name": "—",
                "detail": "URL no permitida (usa http/https público; no localhost ni redes privadas).",
            })
        else:
            try:
                raw, remote_name = _fetch_url_bytes(url)
                short_name = Path(remote_name.replace("\\", "/")).name
                stem = Path(short_name).stem or short_name
                ext = safe_ext(short_name)
                if ext not in BULK_ALLOWED_EXT:
                    results.append({
                        "ok": False,
                        "name": short_name,
                        "detail": f"Extensión .{ext} no permitida. Descarga un .cml, .mol, .pdb, etc.",
                    })
                else:
                    oid, info = persist_molecule(stem, short_name, raw, fmt=None)
                    if info.get("duplicate"):
                        results.append({
                            "ok": True,
                            "duplicate": True,
                            "name": stem,
                            "detail": (
                                "Ya existía la misma estructura (InChIKey)."
                                if info.get("dedup") == "inchikey"
                                else "Ya existía un archivo idéntico."
                            ),
                            "id": oid,
                        })
                    else:
                        results.append({
                            "ok": True,
                            "name": stem,
                            "detail": "Descargado e importado.",
                            "id": oid,
                        })
            except URLError as e:
                results.append({"ok": False, "name": url[:80], "detail": f"No se pudo descargar: {e.reason}"})
            except ValueError as e:
                results.append({"ok": False, "name": url[:80], "detail": str(e)})
            except Exception as e:
                results.append({"ok": False, "name": url[:80], "detail": str(e) or "Error desconocido."})

    else:
        results.append({"ok": False, "name": "—", "detail": "Modo de carga desconocido."})

    return render(request, "molecules/bulk_load.html", {"results": results})


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
        oid, info = persist_molecule(name, upload.name, raw, fmt=fmt)
        payload = {
            "id": oid,
            "name": info.get("name") or name,
            "format": fmt,
            "file_url": request.build_absolute_uri(f"/api/molecules/{oid}/file/"),
            "viewer_url": request.build_absolute_uri(f"/viewer/{oid}/"),
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

