import sys
import asyncio
from qdrant_client import QdrantClient

sys.path.append(r"c:\Users\Abhas\OneDrive\Desktop\coding\coding_Agent\coding-agent\backend")
from app.core.config import get_settings

def delete_qdrant_collection():
    settings = get_settings()
    client = QdrantClient(host=settings.qdrant_host, port=settings.qdrant_port)
    
    collection_name = settings.qdrant_collection
    try:
        client.delete_collection(collection_name=collection_name)
        print(f"Collection '{collection_name}' deleted successfully.")
    except Exception as e:
        print(f"Failed to delete collection '{collection_name}': {e}")

if __name__ == "__main__":
    delete_qdrant_collection()
