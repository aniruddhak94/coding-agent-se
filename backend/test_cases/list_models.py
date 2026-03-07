import asyncio
import os
import sys
from google import genai

sys.path.append(r"c:\Users\Abhas\OneDrive\Desktop\coding\coding_Agent\coding-agent\backend")
from app.core.config import get_settings

def list_models():
    settings = get_settings()
    client = genai.Client(api_key=settings.gemini_api_key)
    print("Available embedding models:")
    for model in client.models.list():
        if "embed" in model.name.lower():
            print(f"- {model.name}")

if __name__ == "__main__":
    list_models()
