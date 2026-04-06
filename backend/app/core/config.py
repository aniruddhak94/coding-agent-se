from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # App
    app_name: str = "Intelligent Coding Agent"
    debug: bool = False
    
    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/ica"
    
    # JWT
    secret_key: str = "your-secret-key-change-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 10080  # 7 days
    refresh_token_expire_days: int = 30
    
    # Gemini AI
    gemini_api_key: str = ""
    
    # HuggingFace
    hf_api_token: str = ""
    
    github_token: str = ""
    # Vector DB
    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    qdrant_collection: str = "ica_code_chunks"
    
    # File Storage
    file_storage_path: str = "./storage/files"
    
    # Redis
    redis_url: str = "redis://localhost:6380"
    
    # Execution Engine
    execution_timeout: int = 10
    execution_memory_limit: str = "256m"
    execution_cpu_quota: int = 50000
    
    # Workspace
    workspace_base_image: str = "node:20-bookworm"

    # Admin bootstrap — set ADMIN_EMAIL env var to auto-promote that user to ADMIN on login
    admin_email: str = ""
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
