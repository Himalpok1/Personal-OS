#!/usr/bin/env bash
# scripts/homelab/harden-ssh.sh — runs ON THE HOST, NEEDS ROOT (owner types the
# sudo password):   ssh -t personal-os 'sudo bash ~/personal-os-ops/harden-ssh.sh'
#
# Makes the deployment key survive anything that rewrites
# ~/.ssh/authorized_keys (on 2026-09-17 an agent's setup step did exactly
# that). sshd is told to ALSO read a root-owned file that the himallinux user —
# and therefore every agent holding a key for that user — cannot modify:
#   /etc/ssh/authorized_keys.d/<user>   (root:root 0644, dir 0755)
# via a drop-in /etc/ssh/sshd_config.d/10-personal-os.conf. The user file keeps
# working, so nothing that exists today breaks. The config is validated with
# `sshd -t` before reload, and reload never drops the current session.
#
#   --disable-password-auth   also sets PasswordAuthentication no. Only do this
#                             AFTER the root-owned key file is proven to log in
#                             from the Mac (BatchMode) — it removes the recovery
#                             path the owner used on 2026-09-18.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 2; }
USER_NAME="${SUDO_USER:-himallinux}"
HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"
DEPLOY_KEY_FP="${DEPLOY_KEY_FP:-SHA256:+7UVEergzuSiOvnI9RLsS7/bxbhxunlms42m89EjOp4}"

# Extract the deployment key line from the user's file by fingerprint.
line="$(while read -r l; do
  [ -z "$l" ] && continue
  fp="$(printf '%s\n' "$l" | ssh-keygen -lf /dev/stdin 2>/dev/null | awk '{print $2}')"
  [ "$fp" = "$DEPLOY_KEY_FP" ] && { printf '%s\n' "$l"; break; }
done < "$HOME_DIR/.ssh/authorized_keys")"
[ -n "$line" ] || { echo "deployment key $DEPLOY_KEY_FP not found in $HOME_DIR/.ssh/authorized_keys; restore it first (ssh-copy-id)" >&2; exit 1; }

install -d -m 0755 -o root -g root /etc/ssh/authorized_keys.d
printf '%s\n' "$line" > "/etc/ssh/authorized_keys.d/$USER_NAME"
chown root:root "/etc/ssh/authorized_keys.d/$USER_NAME"; chmod 0644 "/etc/ssh/authorized_keys.d/$USER_NAME"

install -d -m 0755 /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/10-personal-os.conf <<CONF
# Personal OS Checkpoint 10.8.5 (ADR-079): the deployment key lives in a
# root-owned file the login user cannot rewrite. The user file is still read.
AuthorizedKeysFile .ssh/authorized_keys /etc/ssh/authorized_keys.d/%u
CONF
if [ "${1:-}" = "--disable-password-auth" ]; then
  echo "PasswordAuthentication no" >> /etc/ssh/sshd_config.d/10-personal-os.conf
fi
sshd -t
systemctl reload ssh
echo "installed /etc/ssh/authorized_keys.d/$USER_NAME ($(ssh-keygen -lf "/etc/ssh/authorized_keys.d/$USER_NAME"))"
echo "sshd effective: $(sshd -T 2>/dev/null | grep -iE '^(authorizedkeysfile|passwordauthentication) ' | tr '\n' ' ')"
echo "verify from the Mac: ssh -o BatchMode=yes personal-os 'echo ok'"
