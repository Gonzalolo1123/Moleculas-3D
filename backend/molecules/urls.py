from django.urls import path

from . import views


urlpatterns = [
    # Web home
    path("", views.index, name="home"),
    # Web CRUD (mínimo)
    path("crud/delete/<str:molecule_id>/", views.web_delete, name="web_delete"),
    # API
    path("api/molecules/", views.MoleculeListCreate.as_view(), name="molecule_list_create"),
    path("api/molecules/<str:molecule_id>/", views.MoleculeDetail.as_view(), name="molecule_detail"),
    path("api/molecules/<str:molecule_id>/file/", views.MoleculeFile.as_view(), name="molecule_file"),
    path("api/molecules/<str:molecule_id>/fair/", views.MoleculeFairJson.as_view(), name="molecule_fair"),
    # Web viewer
    path("viewer/<str:molecule_id>/", views.viewer, name="viewer"),
]

