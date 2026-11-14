from ..config import get_settings
override: list | None = None  # tests inject fake connectors here

def get() -> list:
    if override is not None: return override
    s, out = get_settings(), []
    for n in [x.strip() for x in s.CONNECTORS.split(",") if x.strip() and x.strip() != "none"]:
        if n == "keycloak":
            from .keycloak import KeycloakConnector
            out.append(KeycloakConnector(s.KEYCLOAK_URL, s.KEYCLOAK_REALM, s.KEYCLOAK_ADMIN, s.KEYCLOAK_ADMIN_PASSWORD))
        elif n == "ldap":
            from .ldap import LdapConnector
            out.append(LdapConnector(s.LDAP_URL, s.LDAP_BASE_DN, s.LDAP_ADMIN_PASSWORD))
        else: raise ValueError(f"Unknown connector {n}")
    return out
