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
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    
    # Gemini AI
    gemini_api_key: str = "AIzaSyASkkNan6_gAr15Ocy4L7eF9yzY05zq3Wg"
    
    github_token: str = ""
    # Vector DB
    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    qdrant_collection: str = "ica_code_chunks"
    
    # File Storage
    file_storage_path: str = "./storage/files"
    
    # Redis
    redis_url: str = "redis://localhost:6379"
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
