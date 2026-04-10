import os

from pymongo import MongoClient


_client = None


def get_mongo_client() -> MongoClient:
    global _client
    if _client is None:
        mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017")
        _client = MongoClient(mongo_uri)
    return _client


def get_db():
    client = get_mongo_client()
    db_name = os.getenv("MONGO_DB_NAME", "molecules_db")
    return client[db_name]


def molecules_collection():
    return get_db()["molecules"]


def ensure_molecule_indexes() -> None:
    """Índices para deduplicación por InChIKey y hash de archivo."""
    coll = molecules_collection()
    coll.create_index("inchikey", sparse=True)
    coll.create_index("content_sha256", sparse=True)

