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

## Izolovani Cloudflare preview

Produkcijski deploy command ostaje `npx wrangler deploy`.
Za non-production/preview deploy command koristiti `npm run preview:deploy`.
Build command ostaje `node --test tests/*.test.mjs`.

Preview koristi zasebnu bazu `mkm-preview-db`, definisanu u `previews.d1_databases`.
Skripta prvo provjerava da preview i migracije koriste istu testnu bazu i
da njen ID nije produkcijski. Zatim primjenjuje samo neprimijenjene migracije
na `PREVIEW_DB` i pokreće `wrangler preview`. Produkcijske migracije se ne izvršavaju.
Testna baza se ne puni kopijom produkcijskih podataka ili korisničkih naloga.
Za prijavu treba zaseban testni nalog; prazna baza nema administratora.

### Testni administrator

U Cloudflare Build variables dodati **Secret** `MKM_PREVIEW_ADMIN_PASSWORD`
(lozinka od 12–128 znakova) i ponoviti preview build. Lozinku ne unositi u kod,
GitHub ili chat. Skripta kreira `preview-admin@mkm.test` samo ako testna baza
još nema korisnika. Postojeći nalozi i lozinke se ne mijenjaju. Privremeni SQL
sa nasoljenim hashom briše se nakon izvršenja i ne ispisuje se u build log.
