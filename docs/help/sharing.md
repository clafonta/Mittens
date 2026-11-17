# Sharing Mittens with a team

Mittens is built to run on your own computer, but the same command can run it on a shared machine (a team server, a VM, a test environment) so several people, apps or test runs use the same mocks.

## Start it for other machines

By default Mittens listens only on `127.0.0.1`, so nothing else can reach it. Add `--host 0.0.0.0` to listen on every network interface:

```sh
npx @clafonta/mittens --host 0.0.0.0 --port 4000 --dir ./mittens
```

Then, from other machines:

- **Apps** send mock traffic to `http://<server>:4000/...` using any host name: the server's IP address, its DNS name, or a load balancer in front of it.
- **People** open the dashboard at `http://<server>:4000/_mittens`, using the server's **IP address or its own machine name**. Other host names (a DNS alias like `mittens.example.com`) are refused for the dashboard and the API, to stop malicious web pages from reaching Mittens through DNS tricks.
- **AI assistants** connect to `http://<server>:4000/_mittens/mcp` with the same rule, IP address or machine name. See [AI assistants](assistants.md).

## Everyone shares one live state

There's one Mittens, so there's one [live state](live-state.md): when someone flips a service to an outage profile, every app using that server gets the outage. A few habits help:

- Agree on who changes what, or give each team or app its own Mittens on its own port.
- Use [tags](services.md) (`--tag checkout`) to run one Mittens per area from the same definitions folder.
- **Start over** (or `POST /_mittens/api/reset`) resets everyone's live state and clears everyone's history; use `keep` to leave parts alone (see [HTTP API](api.md)).
- For quick experiments that only affect you, run Mittens locally instead.

## Keep the definitions in git

The definitions folder is plain YAML, so the usual setup is a clone of your repo on the server:

- Mittens reloads when the files change, so a `git pull` on the server updates the mocks without a restart.
- Start it with `--read-only` if the files on the server should only ever come from git: dashboard edits then last until Mittens restarts and never touch the clone. Without it, edits made in the dashboard are written to the server's copy, and someone has to commit them.
- `--profile <id>` applies a profile at startup, so a test environment always starts in a known state.

## Security

Mittens has no login. Anyone who can reach the port can:

- change services, scenarios and profiles, and (unless you use `--read-only`) the files on disk;
- point a proxy-mode service at any URL the server can reach, and see the responses;
- read History, which holds the headers and bodies of every request, including tokens and passwords from proxied traffic (see [Recording](recording.md)).

Hook files are code and can't be created or changed through the dashboard, the API or an assistant, only by editing files on the server; use `--no-hooks` if you don't want them to run at all.

So only share Mittens on a network you trust: a private network, a VPN, or behind a firewall that limits who can connect. Don't expose it to the internet, and don't proxy production traffic carrying real customer credentials through a shared Mittens.
