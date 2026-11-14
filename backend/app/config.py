from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    DATABASE_URL: str = "sqlite:///./iamops_dev.db"
    JWT_SECRET: str  # required: no default secret in code
    KEYCLOAK_URL: str = "http://localhost:8080"
    KEYCLOAK_ADMIN: str = ""
    KEYCLOAK_ADMIN_PASSWORD: str = ""
    LDAP_URL: str = "ldap://localhost:389"
    CONNECTORS: str = "none"  # comma list: keycloak,ldap  (none = local-only, no external calls)
    KEYCLOAK_REALM: str = "meridian"
    LDAP_BASE_DN: str = "dc=meridian,dc=local"
    LDAP_ADMIN_PASSWORD: str = ""
    ENV: str = "dev"  # dev | prod
    ENABLE_DOCS: bool = False
    SLA_SWEEP_MINUTES: int = 0  # 0 = scheduler off
    LOCKOUT_THRESHOLD: int = 5
    LOCKOUT_MINUTES: int = 15
    LOGIN_RATE_PER_MIN: int = 20
    TOKEN_MINUTES: int = 30

    @model_validator(mode="after")
    def _prod_guard(self):
        if self.ENV == "prod":
            bad = []
            if len(self.JWT_SECRET) < 32 or "change_me" in self.JWT_SECRET: bad.append("JWT_SECRET must be >=32 random chars")
            if self.DATABASE_URL.startswith("sqlite"): bad.append("DATABASE_URL must be PostgreSQL")
            if "change_me" in self.DATABASE_URL: bad.append("DATABASE_URL uses a placeholder password")
            if bad: raise ValueError("Unsafe production config: " + "; ".join(bad))
        return self

def get_settings() -> Settings:
    return Settings()
