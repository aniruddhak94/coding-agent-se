from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserRole
from app.schemas.auth import UserCreate
from app.core.security import get_password_hash, verify_password
from app.core.config import get_settings
from app.services.log_service import LogService, USER_LOGIN


class AuthService:
    """Service for authentication operations."""
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def get_user_by_email(self, email: str) -> Optional[User]:
        """Get user by email."""
        result = await self.db.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()
    
    async def get_user_by_id(self, user_id: int) -> Optional[User]:
        """Get user by ID."""
        result = await self.db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()
    
    async def create_user(self, user_data: UserCreate) -> User:
        """Create a new user. Auto-assigns ADMIN role if email matches ADMIN_EMAIL env var."""
        settings = get_settings()
        is_admin = settings.admin_email and user_data.email == settings.admin_email

        hashed_password = get_password_hash(user_data.password)
        user = User(
            email=user_data.email,
            password_hash=hashed_password,
            full_name=user_data.full_name,
            role=UserRole.ADMIN.value if is_admin else UserRole.USER.value,
        )
        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)
        return user

    
    async def authenticate_user(self, email: str, password: str) -> Optional[User]:
        """Authenticate user with email and password."""
        user = await self.get_user_by_email(email)
        if not user:
            return None
        if not verify_password(password, user.password_hash):
            return None
        if not user.is_active:
            return None

        # Bootstrap: auto-promote to ADMIN if email matches ADMIN_EMAIL env var
        settings = get_settings()
        if settings.admin_email and user.email == settings.admin_email and user.role != UserRole.ADMIN.value:
            user.role = UserRole.ADMIN.value
            await self.db.commit()
            await self.db.refresh(user)

        # Emit login log
        await LogService(self.db).log(action=USER_LOGIN, user_id=user.id)

        return user

