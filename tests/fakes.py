class FakeConnector:
    def __init__(self, name="fake"):
        self.name, self.users, self.groups, self.disabled, self.fail, self.calls = name, {}, {}, set(), False, 0
    def _chk(self):
        self.calls += 1
        if self.fail: raise RuntimeError("target system rejected the operation")
    def ensure_account(self, i): self._chk(); self.users.setdefault(i.email, f"id-{len(self.users)}"); return self.users[i.email]
    def add_to_group(self, i, g): self._chk(); self.ensure_account(i); self.groups.setdefault(g, set()).add(i.email)
    def remove_from_group(self, i, g): self._chk(); self.groups.get(g, set()).discard(i.email)
    def disable_account(self, i): self._chk(); self.disabled.add(i.email)
