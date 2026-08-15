# Place proprietary Exeggcute/GC files here (not committed):

| File | Source |
|------|--------|
| `debs/gc.deb` | Exeggcute/GC Discord or vendor (jailbreak tweak) |
| `ipa/pogo.ipa` | Matching Pokémon GO IPA (`ipatool download -b com.nianticlabs.pokemongo`) |

`scripts/provision-ios.sh` copies the GC config to the phone and optionally installs these packages over SSH.
