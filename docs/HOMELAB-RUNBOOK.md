# Home Lab Runbook — the `personal-os` production host

*Checkpoint 10.8.5 (2026-09-18), ADR-079. Load on demand; not auto-imported. This is the
operational companion to `docs/ARCHITECTURE.md` → Deployment order. The host is no longer a
single-purpose box: everything below assumes other stacks and an AI agent share it.*

---

## 1. What runs on the host (inventory, 2026-09-18)

| Stack | Where | Owner | Notes |
|---|---|---|---|
| **Personal OS** — `personal-os-{postgres,api,worker,web}-1` | `/home/himallinux/personal-os-<checkpoint>-release` (build context per release), `.env` at `/home/himallinux/personal-os/.env` | this repo | api `127.0.0.1:3000`, web `127.0.0.1:8081`, fronted by `tailscale serve` on `:443`/`:8443`; Postgres publishes nothing |
| `dev-ops`: Watchtower, Dozzle, Uptime Kuma, Glance, ntfy, it-tools | `~/docker/dev-ops` | owner / Ray | all bound to the tailnet IP `100.117.78.19`; Watchtower `--cleanup --label-enable`, Sundays 04:00 UTC, **RW Docker socket** (allowlisted); Dozzle RO socket |
| code-server | `~/docker/code-server` | Ray | `:8091`, mounts `~/projects` only; plaintext password in the compose file (owner's) |
| Claude Desktop (webtop) | `~/docker/claude-desktop` | Ray | `:8092`, `/dev/kvm` passthrough; plaintext password in the compose file |
| Immich (4 containers) | `~/docker/immich` | owner / Ray | `:8087`; its own Postgres, bind-mounted under `~/docker/immich` |
| `ray-dashboard` (nginx) + `ray-dashboard-updater` (`alpine/git` pull every 120 s) | `~/ray-dashboard` | Ray | **binds `0.0.0.0:8080`** — LAN-visible by design (the tablet kiosk); the updater mounts the GitHub deploy key `~/.ssh/ray-dashboard-deploy` read-only |
| `agents-meetup` (python) | `~/meetup` | Ray | `:8086`, a JSON message board for two agents |
| `hello-world` (`brave_haibt`, exited Aug 15) | — | — | the Phase 0 install probe; harmless, and it is why the incident was `image prune -a`, not `system prune` |

**Ray** is the owner's AI agent: user `hatch` on tailnet node `muse` (100.84.166.123). It holds
an SSH key for `himallinux` (comment `hatch`, `SHA256:vA8oSk…`) and polls `docker ps`/`docker
stats` every three minutes (`~/ray-dashboard/tools/collect_apps.py`). `himallinux` is in `docker`
and `sudo`; the desktop session auto-logs in on `tty2`. `sudo` needs a password — no agent has it.

Personal OS host-side tooling lives at **`~/personal-os-ops/`** (installed from
`scripts/homelab/` by `scripts/homelab/install.sh`); its state at `~/.personal-os-ops/`
(`checks.log`, `last-problems`, `cron.log`, `agent-ssh.log`); saved images at
`~/personal-os-images/<label>/`.

## 2. The 2026-09-18 incident — root cause

Two events, one actor. Details and evidence in ADR-079 §1; the short form:

- **Images** — between 01:30 and 01:40 CDT (06:30–06:40Z) ~163 GB of images and build cache were
  deleted. Docker keeps 256 events (seconds here) and journals no image removal, so the trace is
  `sar -b` (a 1,686 tps / 15.9 MB/s-read mass unlink in exactly that sample) lined up against the
  sshd log: the only long session was Ray's (01:29:18–01:40:08). The surviving stopped
  `hello-world` container means `docker image prune -a` (+ a builder prune), not `system prune`.
- **Deploy key** — `~/.ssh/authorized_keys` was rewritten at 22:02 CDT on 09-17 inside a burst
  of Ray setup sessions; the deploy key stopped working until the owner's `ssh-copy-id` at 01:01.

Why nothing recorded it: a non-interactive `ssh host 'cmd'` writes no `.bash_history`, needs no
`sudo` (docker group), and Docker's CLI verbs are not audited. **Any key for `himallinux` is
root-equivalent and silent.** Confirmation, if wanted: Ray's own transcript on `muse` for
06:29–06:40Z on 2026-09-18.

## 3. Standing rules (ADR-079)

1. **Image tags are ephemeral.** The rollback artifact is the saved tarball + keeper container +
   the per-release directory + the pushed `rollback-pre-<checkpoint>` git tag. Never trust a tag
   you have not just listed.
2. **Retention: newest two labels** (current + previous release). `save-release-images.sh`
   retires older tarballs, keepers and `:<label>` tags. Nothing else prunes Personal OS images.
3. **Any cleanup on this host excludes `io.personal-os.protected=true`** — the label every
   Personal OS image carries: `docker image prune -a --filter "label!=io.personal-os.protected=true"`.
   `docker system prune` (any flags) is not run on this host at all — it removes the keeper
   containers first.
4. **The deployment key lives in `/etc/ssh/authorized_keys.d/himallinux`** (root-owned) as well
   as the user file. Rewriting the user file cannot lock the deployer out.
5. **An agent's always-on key is a forced-command key** (`ray-poll-wrapper.sh`). Agent
   administration uses a separate key the owner enables for the task and revokes after.
6. **`sudo`, `apt`, `reboot`, `sshd_config`, `daemon.json` are owner-typed steps.** The scripts
   print exactly what they will do; nothing in `~/personal-os-ops` escalates on its own.
7. **Preflight before every deployment, validation after every reboot** — `scripts/homelab/preflight.sh`.

## 4. Deployment — the frozen order, with the 10.8.5 additions

From the Mac, in the repo:

```bash
scripts/homelab/preflight.sh          # 0. BatchMode login + host report; stop on RED
```

Then the Checkpoint 5.7 order (`docs/ARCHITECTURE.md`): 1 ship the release directory (`git
archive`), **2 tag the serving images by digest**, 3 build, 4 verify the new api image, 5 migrate
from the new image with `--no-deps`, 6 roll out each service alone (`postgres` never named). The
two additions:

```bash
# 2b. right after tagging (still before build): make the tags survive anything
ssh personal-os '~/personal-os-ops/save-release-images.sh rollback-pre-<checkpoint>'
# 7. after the rollout is healthy: save the serving set under its own label
ssh personal-os '~/personal-os-ops/save-release-images.sh <checkpoint> --from-latest'
```

Step 7 also retires the release before the previous one (rule 2). A service that a checkpoint
does not rebuild (the worker, 10.5–10.8) is tagged from `:latest` at step 2 so every service has a
`rollback-pre-*` tag — its pre-checkpoint image *is* its serving image.

## 5. Recovery procedures

**Deployment key refused (`Permission denied (publickey)`).** After `harden-ssh.sh` this cannot
happen from a user-file rewrite. Before it, or if the root file is also gone:
`ssh-copy-id -i ~/.ssh/id_ed25519.pub personal-os` (owner types the password), then
`scripts/homelab/preflight.sh`. If password auth has been disabled, use the desktop console
(`tty2` auto-login) and re-run `sudo bash ~/personal-os-ops/harden-ssh.sh`.

**Rollback images gone again.** Fast path (seconds), on the host:
```bash
for s in api worker web; do docker load -i ~/personal-os-images/rollback-pre-<cp>/$s.tar.gz; done
```
(`sha256sum -c` against the `.sha256` files first if in doubt.) Proof path (minutes): rebuild from
the previous release directory — `docker compose -p personal-os-rollback --env-file
/home/himallinux/personal-os/.env -f docker-compose.yml -f docker-compose.prod.yml build api web`
inside `personal-os-<previous>-release`, then `docker tag`. Then the frozen rollback:
`docker tag personal-os-{api,web,worker}:rollback-pre-<cp> personal-os-{api,web,worker}:latest`
and `up -d --no-deps --no-build --force-recreate api web worker` from the release directory.
Migrations are additive-only; no schema rollback, ever.

**Whole host rebuilt / disk lost.** There is **no backup** (ADR-024): the Postgres volume
`personal-os_postgres_data` is the only copy of the owner's data. What survives elsewhere: the
repository (private GitHub), `.env` only if `docs/SOURCE-DURABILITY.md` Option 2 has been done
(it has not), the Rabbit's local data. This runbook cannot recover data; it can only rebuild the
service.

**Reboot** (owner):
```bash
ssh -t personal-os 'sudo bash ~/personal-os-ops/apply-os-updates.sh'   # updates, no reboot
ssh -t personal-os 'sudo reboot'
# wait ~2 min, then
scripts/homelab/preflight.sh
```
Expect after reboot: all containers `restart: unless-stopped` come back (Personal OS's four,
the dev-ops stack, Immich); `tailscale serve` persists; the desktop auto-logs in; the crontab
watchdog resumes. If `docker-ce` was in the update set, every container restarted once during the
update as well (live-restore is off) — the worker's in-flight pg-boss jobs are retried, a
`mail_sync_runs` row may show the documented failed-opened-never-finished shape.

## 6. Monitoring

- **Watchdog:** `~/personal-os-ops/check-host.sh` from the `himallinux` crontab every 30 min →
  ntfy topic **`personal-os-ops`** at `http://100.117.78.19:8085` (subscribe in the ntfy app over
  Tailscale). Notifies on change only; one daily heartbeat at 08:00 local. Config overrides in
  `~/.personal-os-ops/config` (`DISK_WARN`, `DISK_CRIT`, `ALLOWED_SOCKET_RW`, `DEPLOY_KEY_FP`,
  `NTFY_URL`, `HEARTBEAT_HOUR`). Log: `~/.personal-os-ops/checks.log`.
- **On demand:** `scripts/homelab/preflight.sh` (from the Mac) or
  `ssh personal-os '~/personal-os-ops/check-host.sh --report'`.
- **Inventory:** `ssh personal-os '~/personal-os-ops/save-release-images.sh --list'`.
- **Agent key activity** (once the forced command is installed): `~/.personal-os-ops/agent-ssh.log`
  — one line per call, command name only.
- Personal OS's own monitoring (five targets, ADR-055) is unchanged and does not cover the host.

## 7. Known risks carried forward

- **NVMe PCIe correctable errors** — 38,098 since the Aug 29 boot, ~1,500/day, on the only disk,
  with no backup. Correctable ≠ data loss, but it is the strongest reason to revisit ADR-024.
  After the reboot: `sudo nvme smart-log /dev/nvme0` (needs `nvme-cli`), check the slot/riser,
  consider `pcie_aspm=off`.
- **Password auth on `sshd 0.0.0.0:22`** until `harden-ssh.sh --disable-password-auth` is run
  after the root-owned key file is proven. The LAN is the exposure, not the internet.
- **Watchtower** holds a read-write Docker socket and auto-pulls `:latest` weekly for the labeled
  dev-ops containers — a supply-chain surface the owner accepted for that stack. Personal OS
  containers are not labeled and are never touched by it.
- **Ray's key stays unrestricted until the owner applies §3 rule 5.** Until then the watchdog
  is the only guard: it detects a missing deploy key, a missing rollback set and disk growth
  within 30 minutes; it cannot prevent them.
- **Plaintext service passwords** in `~/docker/code-server` and `~/docker/claude-desktop` compose
  files (owner's home-lab choice; the ports bind the tailnet IP only).
- **The stale `/home/himallinux/personal-os` checkout** still holds the real `.env` and Phase 3
  source (recorded since Phase 5); the trap is unchanged.
