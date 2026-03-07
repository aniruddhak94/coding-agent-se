import asyncio
import os
import sys
from google import genai

sys.path.append(r"c:\Users\Abhas\OneDrive\Desktop\coding\coding_Agent\coding-agent\backend")
from app.core.config import get_settings

async def test_gemini():
    settings = get_settings()
    client = genai.Client(api_key=settings.gemini_api_key)
    
    print("Testing models/text-embedding-004")
    try:
        result = client.models.embed_content(
            model="text-embedding-004",
            contents="test"
        )
        print("Success for text-embedding-004")
    except Exception as e:
        print(f"Error text-embedding-004: {e}")

    print("\nTesting text-embedding-004")
    try:
        result = client.models.embed_content(
            model="models/text-embedding-004",
            contents="test"
        )
        print("Success for models/text-embedding-004")
    except Exception as e:
        print(f"Error models/text-embedding-004: {e}")

if __name__ == "__main__":
    asyncio.run(test_gemini())
