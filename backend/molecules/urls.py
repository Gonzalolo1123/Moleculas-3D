from django.urls import path
from django.views.generic import RedirectView

from . import views


urlpatterns = [
    # Web home
    path("", views.index, name="home"),
    path("profesor/", views.role_professor, name="role_professor"),
    path("estudiantes/", views.role_student, name="role_student"),
    path("carga-masiva/", RedirectView.as_view(url="/", permanent=False), name="bulk_load_legacy"),
    # Web CRUD (mínimo)
    path("crud/delete/<str:molecule_id>/", views.web_delete, name="web_delete"),
    # API
    path("api/molecules/", views.MoleculeListCreate.as_view(), name="molecule_list_create"),
    path(
        "api/molecules/recompute-identifiers/",
        views.MoleculeRecomputeIdentifiersAll.as_view(),
        name="molecule_recompute_identifiers_all",
    ),
    path("api/molecules/<str:molecule_id>/", views.MoleculeDetail.as_view(), name="molecule_detail"),
    path("api/molecules/<str:molecule_id>/file/", views.MoleculeFile.as_view(), name="molecule_file"),
    path("api/molecules/<str:molecule_id>/fair/", views.MoleculeFairJson.as_view(), name="molecule_fair"),
    path(
        "api/molecules/<str:molecule_id>/conformers/",
        views.MoleculeConformerVariants.as_view(),
        name="molecule_conformers",
    ),
    path(
        "api/molecules/<str:molecule_id>/group-link/",
        views.MoleculeGroupLink.as_view(),
        name="molecule_group_link",
    ),
    path(
        "api/molecules/<str:molecule_id>/recompute-identifiers/",
        views.MoleculeRecomputeIdentifiers.as_view(),
        name="molecule_recompute_identifiers",
    ),
    # Web viewer
    path("viewer/<str:molecule_id>/", views.viewer, name="viewer"),
]

