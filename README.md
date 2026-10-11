# MKM — administracija fudbalskog kluba

Cloudflare Workers + D1 aplikacija za evidenciju članova, grupa, članarina, uplata, izvještaja i datuma ljekarskih uvjerenja.

## Važno
- Repozitorijum sadrži **samo izvorni kod**, nikada stvarne podatke djece, SQL export baze, lozinke ili pristupne tokene.
- GitHub repozitorijum je javan; pristup aplikaciji ograničen je korisničkom prijavom i serverskim provjerama dozvola.
- D1 baza `mkm-db` ostaje na Cloudflare-u.
- Medicinska dokumentacija **ne** čuva se u repozitorijumu. Trenutna funkcija vodi samo datume.
- Objavljivanje i migracije rade se kontrolisano; ne pokretati automatske migracije na produkcionoj bazi.

## Lokalno
```sh
npm install
node --test tests/*.test.mjs
npx wrangler deploy
```

> Kod i vizuelni dizajn prenose se iz postojeće MKM aplikacije.

## Cloudflare Builds

Produkcijska grana: `main`. Cloudflare izvršava `node --test tests/*.test.mjs`, a zatim `npx wrangler deploy` ako build prođe. Promjene baze zahtijevaju zasebnu, kontrolisanu migraciju. Vizuelne izmjene pripremaju se na zasebnoj grani radi pregleda prije spajanja.
