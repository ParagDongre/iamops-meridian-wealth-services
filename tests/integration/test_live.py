"""Live Keycloak/LDAP tests. Run: docker compose up -d; set RUN_INTEGRATION=1 and the .env values. NOT run in CI here."""
import os, pytest
from types import SimpleNamespace
pytestmark = pytest.mark.skipif(os.environ.get("RUN_INTEGRATION") != "1", reason="set RUN_INTEGRATION=1 with services up")
I = SimpleNamespace(email="live.test@meridian.example", full_name="Live Test", employee_id="E999")

def test_keycloak_idempotent_and_disable():
    from backend.app.config import get_settings; from backend.app.connectors.keycloak import KeycloakConnector
    s = get_settings(); k = KeycloakConnector(s.KEYCLOAK_URL, "meridian-test", s.KEYCLOAK_ADMIN, s.KEYCLOAK_ADMIN_PASSWORD)
    a = k.ensure_account(I); assert k.ensure_account(I) == a
    k.add_to_group(I, "App:Ent"); k.add_to_group(I, "App:Ent"); k.remove_from_group(I, "App:Ent")
    k.disable_account(I); assert k._find("live.test")["enabled"] is False

def test_ldap_idempotent_and_disable():
    from backend.app.config import get_settings; from backend.app.connectors.ldap import LdapConnector
    s = get_settings(); l = LdapConnector(s.LDAP_URL, s.LDAP_BASE_DN, s.LDAP_ADMIN_PASSWORD)
    l.ensure_account(I); l.ensure_account(I); l.add_to_group(I, "App:Ent"); l.add_to_group(I, "App:Ent")
    l.remove_from_group(I, "App:Ent"); l.disable_account(I)
