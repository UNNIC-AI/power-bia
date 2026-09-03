{
  description = "Power BIA dev shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
  };

  # Deliberately devShells and checks only, no `packages`. The deployable
  # artifacts are the Docker images built from apps/*/Dockerfile; a
  # buildNpmPackage of a pnpm workspace would be a second, divergent build of
  # the same thing, with an npmDepsHash to re-paste on every lockfile edit.
  # The flake's job here is the toolchain, and it is never the only way in:
  # `docker compose` and plain pnpm on the host both work. See README.md.
  outputs = {flake-parts, ...} @ inputs:
    flake-parts.lib.mkFlake {inherit inputs;} {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      perSystem = {pkgs, ...}: {
        devShells.default = pkgs.mkShell {
          packages = [
            # AI SDK 7 requires Node 22+ and is ESM-only. Node 24 is the
            # current LTS line, and the version in .nvmrc.
            pkgs.nodejs_24
            pkgs.pnpm

            # services/dax-gateway targets net10.0 - the same TFM the MVP's
            # precompiled adomd_wrapper was built against (see
            # legacy/adomd_bin/adomd_wrapper.runtimeconfig.json).
            pkgs.dotnet-sdk_10

            # psql for poking at the compose database; drizzle-kit does the
            # migrations itself and needs no client binary.
            pkgs.postgresql_17

            pkgs.docker-compose
            pkgs.shellcheck
          ];

          env = {
            # Keep NuGet and the CLI's telemetry/first-run noise inside the
            # repo instead of scattering it through $HOME.
            DOTNET_CLI_TELEMETRY_OPTOUT = "1";
            DOTNET_NOLOGO = "1";
          };

          shellHook = ''
            export DOTNET_ROOT="${pkgs.dotnet-sdk_10}/share/dotnet"

            echo "node    $(node --version)"
            echo "pnpm    $(pnpm --version)"
            echo "dotnet  $(dotnet --version)"
            echo "psql    ${pkgs.postgresql_17.version}"
            echo ""
            echo "  pnpm install                     install the workspace"
            echo "  docker compose --profile db up -d   Postgres (tests need it)"
            echo "  pnpm dev                         api + web"
          '';
        };

        formatter = pkgs.alejandra;

        # `nix flake check` covers what Nix can check hermetically. The
        # JavaScript lint, typecheck and tests need node_modules, so they stay
        # in CI where pnpm has already installed them.
        checks = {
          nix-format =
            pkgs.runCommand "nix-format" {
              buildInputs = [pkgs.alejandra];
            } ''
              alejandra --check ${./flake.nix}
              touch $out
            '';

          shell-lint =
            pkgs.runCommand "shell-lint" {
              buildInputs = [pkgs.shellcheck];
            } ''
              shellcheck ${./start.sh}
              touch $out
            '';
        };
      };
    };
}
