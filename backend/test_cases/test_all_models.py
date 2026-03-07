import asyncio
import sys
from google import genai

sys.path.append(r"c:\Users\Abhas\OneDrive\Desktop\coding\coding_Agent\coding-agent\backend")
from app.core.config import get_settings

def test_models():
    settings = get_settings()
    client = genai.Client(api_key=settings.gemini_api_key)
    
    models_to_test = [
        "text-embedding-004",
        "models/text-embedding-004",
        "gemini-embedding-001",
        "models/gemini-embedding-001"
    ]
    
    print(f"API Key start: {settings.gemini_api_key[:10]}...")
    for model in models_to_test:
        print(f"Testing {model}...")
        try:
            result = client.models.embed_content(
                model=model,
                contents="test"
            )
            print(f"Success! {len(result.embeddings[0].values)} values returned.")
        except Exception as e:
            print(f"Failed: {str(e)[:100]}")

if __name__ == "__main__":
    test_models()
