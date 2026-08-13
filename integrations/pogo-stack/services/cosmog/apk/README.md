Place proprietary APK files here (not committed to git):

| File | Source |
|------|--------|
| `cosmog.apk` | Cosmog Discord `#apk-releases` (license required) |
| `pogo.apk` | Matching Pokémon GO arm64 APK (version per Cosmog docs) |

The **worker-agent** container installs these into Redroid via ADB on first run.

After adding APKs, restart workers:

```bash
docker compose --profile workers restart worker-agent
```
