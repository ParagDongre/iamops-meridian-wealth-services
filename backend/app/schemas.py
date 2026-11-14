from datetime import date
from pydantic import BaseModel, Field

EMAIL = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
class IdentityIn(BaseModel):
    employee_id: str = Field(min_length=3, max_length=20)
    full_name: str = Field(min_length=2, max_length=120)
    email: str = Field(pattern=EMAIL)
    department: str
    job_title: str
    manager_id: int | None = None
    employment_type: str = "Employee"
    location: str = ""
    joining_date: date
    business_role_id: int | None = None
class IdentityPatch(BaseModel):
    full_name: str | None = None
    email: str | None = Field(default=None, pattern=EMAIL)
    department: str | None = None
    job_title: str | None = None
    manager_id: int | None = None
    location: str | None = None
    employment_type: str | None = None
    business_role_id: int | None = None
class Login(BaseModel):
    email: str
    password: str
class GrantIn(BaseModel):
    identity_id: int
    entitlement_id: int
