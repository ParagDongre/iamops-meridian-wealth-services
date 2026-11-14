"""OpenLDAP connector (ldap3). Idempotent: 'already exists' results are treated as success."""
import re
from ldap3 import Server, Connection, MODIFY_ADD, MODIFY_DELETE

OK = (0, 68, 20, 16)  # success, entryAlreadyExists, attributeOrValueExists, noSuchAttribute

class LdapConnector:
    name = "ldap"
    def __init__(self, url, base_dn, admin_password):
        self.url, self.base, self.pw, self._ou = url, base_dn, admin_password, False

    def _c(self):
        c = Connection(Server(self.url, connect_timeout=5), user=f"cn=admin,{self.base}", password=self.pw, auto_bind=True)
        if not self._ou:
            for ou in ("people", "groups", "disabled"):
                c.add(f"ou={ou},{self.base}", ["organizationalUnit"], {"ou": ou})
            self._ou = True
        return c

    def _chk(self, c, what):
        if c.result["result"] not in OK: raise RuntimeError(f"LDAP {what}: {c.result['description']}")

    @staticmethod
    def uid(i): return i.email.split("@")[0]
    def _dn(self, i, ou="people"): return f"uid={self.uid(i)},ou={ou},{self.base}"
    def _gdn(self, g): return f"cn={re.sub(r'[^A-Za-z0-9]+', '-', g).strip('-')},ou=groups,{self.base}"

    def ensure_account(self, i):
        c = self._c()
        parts = i.full_name.split()
        c.add(self._dn(i), ["inetOrgPerson"], {"uid": self.uid(i), "cn": i.full_name, "sn": parts[-1],
              "mail": i.email, "employeeNumber": i.employee_id})
        if c.result["result"] == 68 and not c.search(self._dn(i), "(objectClass=*)"):  # exists elsewhere (disabled)
            c.modify_dn(self._dn(i, "disabled"), f"uid={self.uid(i)}", new_superior=f"ou=people,{self.base}")
        self._chk(c, "add user"); return self._dn(i)

    def disable_account(self, i):
        c = self._c(); c.modify_dn(self._dn(i), f"uid={self.uid(i)}", new_superior=f"ou=disabled,{self.base}")
        if c.result["result"] not in OK + (32,): raise RuntimeError(f"LDAP disable: {c.result['description']}")

    def add_to_group(self, i, group):
        c = self._c(); self.ensure_account(i)
        c.add(self._gdn(group), ["groupOfNames"], {"cn": re.sub(r'[^A-Za-z0-9]+', '-', group).strip('-'),
              "member": [f"cn=placeholder,{self.base}"]})
        c.modify(self._gdn(group), {"member": [(MODIFY_ADD, [self._dn(i)])]}); self._chk(c, "add member")

    def remove_from_group(self, i, group):
        c = self._c(); c.modify(self._gdn(group), {"member": [(MODIFY_DELETE, [self._dn(i)])]})
        if c.result["result"] not in OK + (32,): raise RuntimeError(f"LDAP remove member: {c.result['description']}")
