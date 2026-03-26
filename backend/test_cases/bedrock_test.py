"""
bedrock_test.py - Quick connectivity check for AWS Bedrock models.
Run with:  python bedrock_test.py  (inside the venv)
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load .env from backend directory
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)

AWS_ACCESS_KEY_ID     = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION            = os.getenv("AWS_REGION", "ap-south-1")

print(f"AWS Key   : {AWS_ACCESS_KEY_ID[:8]}..." if AWS_ACCESS_KEY_ID else "AWS_ACCESS_KEY_ID not set")
print(f"AWS Region: {AWS_REGION}\n")

# Models in sync with agent_service.py
# Prefix guide:
#   global.  -> callable from ap-south-1, routes across all commercial regions
#   apac.    -> APAC-region cross-region profiles (Anthropic Claude only)
#   us.      -> NOT callable from ap-south-1
MODELS = {
    "bedrock-claude-sonnet": "global.anthropic.claude-sonnet-4-6",              # Claude Sonnet 4.6
    "bedrock-claude-haiku":  "global.anthropic.claude-haiku-4-5-20251001-v1:0", # Claude Haiku 4.5
    "bedrock-llama":         "apac.meta.llama3-2-90b-instruct-v1:0",            # Llama 3.2 90B (apac)
    "bedrock-mistral":       "mistral.mistral-large-2407-v1:0",                 # bare ID (ap-south-1)
    "qwen3-vl-235b":         "Qwen3 VL 235B A22B",
    "qwen3-235b-2507":       "Qwen3 235B A22B 2507",
    "gpt-oss-120b":          "gpt-oss-120b",
}

TEST_MESSAGE = "Say 'OK' and nothing else."

try:
    from langchain_aws import ChatBedrockConverse
except ImportError:
    print("ERROR: langchain-aws not installed. Run: pip install langchain-aws")
    sys.exit(1)

results = {}

for name, model_id in MODELS.items():
    print(f"Testing {name} ({model_id}) ...", end=" ", flush=True)
    try:
        llm = ChatBedrockConverse(
            model=model_id,
            region_name=AWS_REGION,
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
            temperature=0,
            max_tokens=10,
        )
        response = llm.invoke(TEST_MESSAGE)
        reply = response.content.strip()
        print(f"OK  Reply: {reply!r}")
        results[name] = ("OK", reply)
    except Exception as e:
        err = str(e)
        print(f"FAIL\n   ERROR: {err}\n")
        results[name] = ("FAIL", err)

print("\n-- Summary --")
for name, (status, _) in results.items():
    icon = "[OK]  " if status == "OK" else "[FAIL]"
    print(f"  {icon}  {name}")

all_ok = all(s == "OK" for s, _ in results.values())
print("\nAll models connected!" if all_ok else "\nSome models failed - check errors above.")
