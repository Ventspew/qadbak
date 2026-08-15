Place proprietary APK files here (not committed to git):

| File | Source |
|------|--------|
| `cosmog.apk` | Cosmog Discord `#apk-releases` (license required) |
| `pogo.apk` | Matching Pokémon GO arm64 APK (version per Cosmog docs) |

The **worker-agent** installs these into Redroid. For a physical phone, `scripts/provision-android.sh` installs them over ADB.

Optional native libraries (Cosmog Discord extract tool):

```
services/cosmog/apk/libs/
```

After adding APKs, restart workers or re-run the provision script:

```bash
docker compose --profile workers restart worker-agent
bash scripts/provision-android.sh --device-id pixel-1
```
