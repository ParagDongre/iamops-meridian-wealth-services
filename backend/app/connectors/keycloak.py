"""Real Keycloak Admin REST connector. Idempotent: every call checks state first."""
import requests

class KeycloakConnector:
    name = "keycloak"
    def __init__(self, base, realm, admin, password):
        self.base, self.realm, self._a, self._p = base.rstrip("/"), realm, admin, password
        self._realm_ok = False

    def _headers(self):
        r = requests.post(f"{self.base}/realms/master/protocol/openid-connect/token", timeout=10,
            data={"grant_type": "password", "client_id": "admin-cli", "username": self._a, "password": self._p})
        r.raise_for_status()
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    def _call(self, method, path, ok=(200, 201, 204), **kw):
        r = requests.request(method, f"{self.base}/admin/realms{path}", headers=self._headers(), timeout=10, **kw)
        if r.status_code not in ok: raise RuntimeError(f"Keycloak {method} {path} -> {r.status_code} {r.text[:120]}")
        return r

    def _ensure_realm(self):
        if self._realm_ok: return
        if self._call("GET", f"/{self.realm}", ok=(200, 404)).status_code == 404:
            self._call("POST", "", json={"realm": self.realm, "enabled": True})
        self._realm_ok = True

    @staticmethod
    def username(i): return i.email.split("@")[0]

    def _find(self, u):
        users = self._call("GET", f"/{self.realm}/users", params={"username": u, "exact": "true"}).json()
        return users[0] if users else None

    def ensure_account(self, i):
        self._ensure_realm(); u = self.username(i); ex = self._find(u)
        if ex: return ex["id"]
        r = self._call("POST", f"/{self.realm}/users", json={"username": u, "email": i.email, "enabled": True,
                       "firstName": i.full_name.split()[0], "lastName": i.full_name.split()[-1],
                       "attributes": {"employeeId": [i.employee_id]}})
        return r.headers["Location"].rsplit("/", 1)[-1]

    def disable_account(self, i):
        self._ensure_realm(); ex = self._find(self.username(i))
        if ex and ex.get("enabled", True): self._call("PUT", f"/{self.realm}/users/{ex['id']}", json={"enabled": False})

    def _group(self, name, create):
        gs = self._call("GET", f"/{self.realm}/groups", params={"search": name, "exact": "true"}).json()
        g = next((x for x in gs if x["name"] == name), None)
        if g: return g["id"]
        if not create: return None
        return self._call("POST", f"/{self.realm}/groups", json={"name": name}).headers["Location"].rsplit("/", 1)[-1]

    def add_to_group(self, i, group):
        uid = self.ensure_account(i); self._call("PUT", f"/{self.realm}/users/{uid}/groups/{self._group(group, True)}")

    def remove_from_group(self, i, group):
        ex, gid = self._find(self.username(i)), self._group(group, False)
        if ex and gid: self._call("DELETE", f"/{self.realm}/users/{ex['id']}/groups/{gid}")
