import asyncio
import sys

sys.path.append(r"c:\Users\Abhas\OneDrive\Desktop\coding\coding_Agent\coding-agent\backend")

from app.services.github_service import GitHubService

async def test_github():
    github = GitHubService()
    owner = "Abhas-Sen"
    repo = "CS331-software-lab"
    branch = "main"

    print(f"Testing GitHub import for {owner}/{repo}...")
    
    # Check repo info
    try:
        info = await github.get_repo_info(owner, repo)
        print(f"Repo Info: {info}")
    except Exception as e:
        print(f"Failed to get info: {e}")
        return

    # Check tree
    try:
        files = await github.get_repo_tree(owner, repo, branch)
        print(f"Found {len(files)} indexable files in tree:")
        for file in files[:5]:
            print(f" - {file.path} ({file.size} bytes)")
    except Exception as e:
        print(f"Failed to get tree: {e}")

if __name__ == "__main__":
    asyncio.run(test_github())
