# Installation

Three ways in, and none of them is the only one. Pick whichever matches what you
already have installed. [`README.md`](../README.md) has the quickstart for each;
this file has the prerequisites and the exact versions.

Linux and macOS are the supported development platforms. Windows differences are
at the bottom and are not implemented.

## Versions

| Tool | Version | Why this one |
|---|---|---|
| Node | **24** (`.nvmrc`) | AI SDK 7 is ESM-only and needs Node 22+; 24 is the current LTS line |
| pnpm | **11.20.0** (`packageManager`) | Workspaces plus the `catalog:` protocol |
| .NET SDK | **10** | `services/dax-gateway` targets `net10.0`, the TFM the MVP's ADOMD wrapper was built against |
| Postgres | **17** | Pinned in compose and here. `jsonb`, enums and cascading FKs are all used |
| Docker | any with `docker compose` v2 | Postgres, the gateway, and the images |
| Nix | with flakes enabled | Optional. Provides all of the above |

Third-party package versions are pinned once in the `catalog:` block of
`pnpm-workspace.yaml`. Never put a range in a `package.json`.

## Path 1: Docker only

Nothing but Docker. `docker compose --profile all up -d --build` builds and runs
every service, including the API and the web app.

Nothing else to install. Skip to [setup.md](./setup.md) for the Power BI side.

## Path 2: local tooling

You need Node 24, pnpm 11 and Docker. .NET 10 as well if you intend to work on
the gateway rather than run its container.

**Linux (Debian, Ubuntu):**

```bash
# Node 24 through nodesource, or a version manager - fnm, nvm, asdf.
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
corepack enable                      # pnpm comes from the packageManager field

# Optional, only to build the gateway from source.
sudo apt-get install -y dotnet-sdk-10.0

# Optional, only to poke at the database by hand.
sudo apt-get install -y postgresql-client-17
```

**macOS:**

```bash
brew install node@24 dotnet-sdk libpq
corepack enable
```

`corepack enable` is what makes `pnpm` resolve to 11.20.0 from the
`packageManager` field, so everyone runs the same pnpm. With a version manager,
`nvm use` or `fnm use` reads `.nvmrc`.

**No native dependencies.** Nothing in this project compiles a native module -
scrypt comes from Node's own `crypto`, which is why the password hashing is
scrypt rather than argon2. So there is no build-essential, no python, and no
`node-gyp` in the way.

## Path 3: Nix

```bash
nix develop
```

The flake provides node 24, pnpm 11, dotnet 10, psql 17, docker-compose and
shellcheck. It exposes `devShells`, a `formatter` (alejandra, so `nix fmt` works)
and `checks` (`nix flake check` runs the Nix format check and shellcheck).

It deliberately exposes **no `packages`**: the deployable artifacts are the Docker
images, and a `buildNpmPackage` of a pnpm workspace would be a second, divergent
build of the same thing with a hash to re-paste on every lockfile edit.

The commands stay in `package.json`. If something only works inside
`nix develop`, that is a bug.

## After any path

```bash
cp .env.example .env
```

Generate the three secrets — the API validates them at import time and refuses to
boot on a malformed one, in demo mode as much as in live mode:

```bash
for v in DAX_GATEWAY_TOKEN DATASET_SECRET_KEY SESSION_COOKIE_SECRET; do
  sed -i "s|^$v=.*|$v=$(openssl rand -hex 32)|" .env
done
```

`DATASET_SECRET_KEY` must be exactly 64 hex characters and `SESSION_COOKIE_SECRET`
at least 32. Rotating `DATASET_SECRET_KEY` in place makes every stored dataset
secret undecryptable, so generate it once.

Then apply the schema:

```bash
docker compose --profile db up -d
set -a; . ./.env; set +a
pnpm install
pnpm db:migrate
```

Migrations are never applied by a booting application: with more than one replica
two processes race. `pnpm db:migrate`, the `migrate` compose profile, or a deploy
step.

For the live Power BI path, continue with [setup.md](./setup.md). For everything
else, [development.md](./development.md).

## Windows

Not implemented and not supported. WSL2 with the Linux instructions above is the
path that works; the differences that would need handling if it ever is supported:

- `sed -i` behaves differently; the secret generation loop above needs rewriting.
- `host.docker.internal` resolves natively, so the `extra_hosts` entries in
  `docker-compose.yml` are redundant rather than required.
- `start.sh` is bash and assumes `ss`, `openssl` and GNU `sed`.
- `.gitattributes` sets `* text=auto eol=lf`, so a checkout keeps LF endings.
