"""
test_huggingface.py - Quick connectivity check for HuggingFace Inference API models.
Run with:  python test_huggingface.py  (inside the venv)
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load .env from backend directory
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)

HF_API_TOKEN = os.getenv("HF_API_TOKEN", "")

if not HF_API_TOKEN:
    print("ERROR: HF_API_TOKEN not set in .env")
    print("Add this line to backend/.env:")
    print("  HF_API_TOKEN=hf_your_token_here")
    sys.exit(1)

print(f"HF Token : {HF_API_TOKEN[:10]}...{HF_API_TOKEN[-4:]}")
print()

# Models in sync with agent_service.py
MODELS = {
    "hf-qwen-7b":   "Qwen/Qwen2.5-7B-Instruct",
    "hf-qwen-35b":  "Qwen/Qwen3.5-35B-A3B",
    "hf-llama-8b":  "meta-llama/Llama-3.1-8B-Instruct",
    "hf-llama-70b": "meta-llama/Llama-3.1-70B-Instruct",
}

TEST_MESSAGE = "Say 'OK' and nothing else."

# ── Method 1: Raw requests (fast, no LangChain dependency) ──────────────────
print("=" * 60)
print("  TEST 1: Raw HuggingFace Inference API (requests)")
print("=" * 60)

import requests

raw_results = {}

for name, model_id in MODELS.items():
    print(f"\nTesting {name} ({model_id}) ...", end=" ", flush=True)
    try:
        response = requests.post(
            "https://router.huggingface.co/v1/chat/completions",
            headers={"Authorization": f"Bearer {HF_API_TOKEN}"},
            json={
                "model": model_id,
                "messages": [{"role": "user", "content": TEST_MESSAGE}],
                "max_tokens": 20,
                "temperature": 0.1,
            },
            timeout=60,
        )
        data = response.json()

        if "choices" in data:
            reply = data["choices"][0]["message"]["content"].strip()
            print(f"OK  Reply: {reply!r}")
            raw_results[name] = ("OK", reply)
        elif "error" in data:
            err = data["error"]
            if isinstance(err, dict):
                err = err.get("message", str(err))
            print(f"FAIL\n   ERROR: {err}")
            raw_results[name] = ("FAIL", err)
        else:
            print(f"FAIL\n   Unexpected: {data}")
            raw_results[name] = ("FAIL", str(data))

    except Exception as e:
        print(f"FAIL\n   ERROR: {e}")
        raw_results[name] = ("FAIL", str(e))


# ── Method 2: LangChain ChatHuggingFace (same as agent_service.py) ──────────
print("\n")
print("=" * 60)
print("  TEST 2: LangChain ChatHuggingFace + HuggingFaceEndpoint")
print("=" * 60)

lc_results = {}

try:
    from langchain_huggingface import ChatHuggingFace, HuggingFaceEndpoint
except ImportError:
    print("\nERROR: langchain-huggingface not installed.")
    print("Run: pip install langchain-huggingface")
    lc_results = {name: ("SKIP", "langchain-huggingface not installed") for name in MODELS}

if not lc_results:
    for name, model_id in MODELS.items():
        print(f"\nTesting {name} ({model_id}) ...", end=" ", flush=True)
        try:
            llm = HuggingFaceEndpoint(
                repo_id=model_id,
                huggingfacehub_api_token=HF_API_TOKEN,
                temperature=0.1,
                max_new_tokens=20,
                task="text-generation",
            )
            chat = ChatHuggingFace(llm=llm)
            response = chat.invoke(TEST_MESSAGE)
            reply = response.content.strip()
            print(f"OK  Reply: {reply!r}")
            lc_results[name] = ("OK", reply)
        except Exception as e:
            err = str(e)[:200]
            print(f"FAIL\n   ERROR: {err}")
            lc_results[name] = ("FAIL", err)


# ── Summary ──────────────────────────────────────────────────────────────────
print("\n")
print("=" * 60)
print("  SUMMARY")
print("=" * 60)

print("\n  Raw API Results:")
for name, (status, _) in raw_results.items():
    icon = "✅" if status == "OK" else "❌"
    print(f"    {icon}  {name}")

print("\n  LangChain Results:")
for name, (status, _) in lc_results.items():
    icon = "✅" if status == "OK" else ("⏭️" if status == "SKIP" else "❌")
    print(f"    {icon}  {name}")

raw_ok = all(s == "OK" for s, _ in raw_results.values())
lc_ok = all(s == "OK" for s, _ in lc_results.values())

if raw_ok and lc_ok:
    print("\n🎉 All models connected successfully!")
elif raw_ok:
    print("\n⚠️  Raw API works, but LangChain integration has issues — check errors above.")
else:
    print("\n❌ Some models failed — check errors above.")
