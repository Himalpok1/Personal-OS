# Home Lab Runbook — the `personal-os` production host

*Checkpoint 10.8.5 (2026-09-18), ADR-079 and ADR-080. Load on demand; not auto-imported. This is the
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

**Ray** is the owner's AI agent and, by owner decision (ADR-079 §4), a **trusted infrastructure
operator** on this host: user `hatch` on tailnet node `muse` (100.84.166.123), an SSH key for
`himallinux` (comment `hatch`, `SHA256:vA8oSk…`) that is not restricted and must not be —
risk is managed by observability, durability and safeguards. It polls the meetup board /
`docker ps` every three minutes and does host setup on request. Every command it sends is logged
by the audit shell bound to its key (§6). `himallinux` is in `docker` and `sudo`; the desktop
session auto-logs in on `tty2`. `sudo` needs a password — no agent has it.

Personal OS host-side tooling lives at **`~/personal-os-ops/`** (installed from
`scripts/homelab/` by `scripts/homelab/install.sh`); its state at `~/.personal-os-ops/`
(`checks.log`, `last-problems`, `changes.log`, `manifest`, `cron.log`, `agent-ssh.log`,
`docker-events.log`); saved images at `~/personal-os-images/<label>/`; backups at
`~/personal-os-backups/` (ADR-080), pulled to the Mac's `~/PersonalOS-Backups/host/`.

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

## 3. Standing rules (ADR-079, ADR-080)

1. **Ray is a trusted operator.** Its access is not removed or reduced; what it does is
   recorded (the audit shell), what it removes is detected (the event watcher), and what it
   breaks is recoverable (saved images, root-owned deploy key, the backup). Any future agent
   with less trust goes through the 10.8 Action Framework instead.
2. **Image tags are ephemeral.** The rollback artifact is the saved tarball + keeper container +
   the per-release directory + the pushed `rollback-pre-<checkpoint>` git tag. Never trust a tag
   you have not just listed.
3. **Retention: newest two labels** (current + previous release). `save-release-images.sh`
   retires older tarballs, keepers and `:<label>` tags. Nothing else prunes Personal OS images.
4. **Any cleanup on this host excludes `io.personal-os.protected=true`** — the label every
   Personal OS image carries: `docker image prune -a --filter "label!=io.personal-os.protected=true"`.
   `docker system prune` (any flags) is not run on this host at all — it removes the keeper
   containers first. A bare `image prune -a` cannot take a Personal OS image (proven, §7), but
   it takes every other unused image and the build cache.
5. **The deployment key lives in `/etc/ssh/authorized_keys.d/himallinux`** (root-owned) as well
   as the user file. Rewriting the user file cannot lock the deployer out (proven, §7).
6. **The agent's key line carries `command="…/agent-audit-shell.sh hatch"`.** If the user file
   is ever rewritten without it, the watchdog says so (YELLOW `agent: no key … bound to the audit
   shell`); re-add the option — it changes nothing about what the key may do.
7. **`sudo`, `apt`, `reboot`, `sshd_config`, `daemon.json` are owner-typed steps.** The scripts
   print exactly what they will do; nothing in `~/personal-os-ops` escalates on its own.
8. **Preflight before every deployment, validation after every reboot** — `scripts/homelab/preflight.sh`.
9. **The backup runs daily and is pulled daily** (03:30 on the host, 09:30 on the Mac). A dump
   older than 36 h is a YELLOW. Test a restore after any Postgres image change.

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

**Database restore (ADR-080).** Backups: `~/personal-os-backups/db/personalos-<ts>.dump` on the
host, mirrored at `~/PersonalOS-Backups/host/personal-os-backups/` on the Mac. Into the live
database (after `docker compose … stop api worker`):
```bash
docker exec -i personal-os-postgres-1 pg_restore -U postgres -d personalos --no-owner --clean --if-exists < personalos-<ts>.dump
```
Into a scratch database to inspect first: `create database personalos_restoretest`, restore
into it, compare counts, `drop database`. Tested at 10.8.5: every table equal, 25 migrations.

**Whole host rebuilt / disk lost.** Since 10.8.5 the off-host copy on the Mac holds the last 14
daily dumps, the globals, `.env`, the serving compose files, `tailscale serve` routes, the
crontab, the public keys and the image tarballs; the repository is on GitHub. Order: install
Docker → `.env` to `/home/himallinux/personal-os/.env` (0600) → ship the release directory (`git
archive` of the tagged commit) → `docker load` the tarballs → `up -d postgres` alone → globals
(`psql -f globals-<ts>.sql`) → `pg_restore` the dump → `up -d api worker web` → `tailscale serve`
per `tailscale-serve.txt` → `crontab` per `crontab.txt` → `install.sh` from the repo →
`preflight.sh`. Up to 24 h of writes can be lost (the device outbox re-sends unacknowledged
captures; provider data re-syncs). Other home-lab stacks on the host are not covered.

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
- **Change detection** (same run): `authorized_keys`, `.env`, every compose file under
  `~/docker` and the serving release, crontab, `tailscale serve`, the `personal-os-*` image tags,
  the container set — any difference is an ntfy `eyes` event and a line in
  `~/.personal-os-ops/changes.log`; high priority when a Personal OS image/container, the key
  file or `.env` is involved.
- **Docker event watcher:** `~/personal-os-ops/docker-events-watch.sh` (`@reboot`, kept alive
  by the watchdog) → `~/.personal-os-ops/docker-events.log`; immediate ntfy for any Personal
  OS image/container/volume removal, any `prune` event, or ≥5 image deletes in 60 s.
- **Agent commands:** `~/.personal-os-ops/agent-ssh.log` — one line per SSH session from the
  agent key (time, label, IP, `!` when destructive, the command with secret-shaped values
  scrubbed); destructive commands are pushed to ntfy at once. Count in every watchdog report.
- **On demand:** `scripts/homelab/preflight.sh` (from the Mac) or
  `ssh personal-os '~/personal-os-ops/check-host.sh --report'`.
- **Inventory:** `ssh personal-os '~/personal-os-ops/save-release-images.sh --list'`.
- Personal OS's own monitoring (five targets, ADR-055) is unchanged and does not cover the host.

## 7. What was proven at 10.8.5 (so it need not be re-argued)

- A real `docker image prune -a` on the host removed every unused foreign image and **none of
  the 9 Personal OS tags** (keeper containers). Docker's own *Reclaimable* for images: 88 KB.
- With the deploy key removed from `~/.ssh/authorized_keys`, a BatchMode login still succeeded
  through `/etc/ssh/authorized_keys.d/himallinux`.
- The audit shell passed a throwaway-key matrix: plain command, exit code, secret scrubbing +
  ntfy flag, scp, sftp, pty login shell, stdin, rsync; Ray's next real poll logged and succeeded.
- The event watcher logged the proof prune's untag/delete events as they happened.
- The first backup restored into a scratch database with every table equal to production.
- The OS update (58 packages incl. Docker 29.7.2 → 29.8.1) restarted every container once;
  all four Personal OS containers returned healthy within ~30 s.

## 8. Known risks carried forward

- **NVMe PCIe correctable errors** — ~1,500/day (`RxErr`, physical layer) on the WD SN730.
  SMART at 10.8.5: `critical_warning 0`, `media_errors 0`, 14 % used, 100 % spare, 33,110
  power-on hours, 62 unsafe shutdowns; link PCIe 3.0 x4 at full width. The flash is healthy; the
  link is noisy. Follow-up, owner's call: `pcie_aspm=off` on the kernel command line (needs a
  GRUB edit + reboot) if the daily count grows or a `Uncorrectable` ever appears; the watchdog
  report prints the count. The backup (ADR-080) is the mitigation that matters.
- **Password auth on `sshd 0.0.0.0:22`** — still on. The root-owned key file is proven, so
  `harden-ssh.sh --disable-password-auth` can be run whenever the owner wants; the LAN is the
  exposure, not the internet.
- **Watchtower** holds a read-write Docker socket and auto-pulls `:latest` weekly for the labeled
  dev-ops containers — a supply-chain surface the owner accepted for that stack. Personal OS
  containers are not labeled and are never touched by it.
- **Ray can still do anything** — by design. The safeguards make it visible and recoverable, not
  impossible. A destructive command reaches ntfy within seconds; an image removal within
  seconds; a config change within 30 minutes.
- **Plaintext service passwords** in `~/docker/code-server` and `~/docker/claude-desktop` compose
  files (owner's home-lab choice; the ports bind the tailnet IP only).
- **The stale `/home/himallinux/personal-os` checkout** still holds the real `.env` and Phase 3
  source (recorded since Phase 5); the trap is unchanged — and `.env` is now also in every
  backup bundle.
- **18 apt packages held back** by Ubuntu's phased rollout at 10.8.5; `unattended-upgrades`
  picks up security ones; run `apply-os-updates.sh` again in a week.
