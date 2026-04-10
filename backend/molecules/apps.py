from django.apps import AppConfig


class MoleculesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "molecules"

    def ready(self) -> None:
        from .mongo import ensure_molecule_indexes

        ensure_molecule_indexes()

