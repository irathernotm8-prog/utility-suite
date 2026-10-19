# Slate

Accounts, retirement, credit cards, credit score and a monthly savings plan in one Mac app. Everything stays on your computer.

- **Overview** (⌘1) — net worth with the change since last month and over the year, assets split by cash / investments / retirement, your cards, this month's plan, what's coming up, and your scores
- **Accounts** (⌘2) — checking, savings, brokerage, 401(k), IRAs, HSA, loans. Balances come from statements you file or numbers you type in. **Update balances** puts every account on one screen for the monthly routine
- **Cards** (⌘3)
  - *My wallet* — each card's annual fee and next fee date, every credit for the current period (tick it when used, or type a partial amount), and whether the card has paid for itself this card year
  - *All cards* — the 33 cards from The Credit File with their images, cleaned-up earning rates, current fees and every credit with how often it resets. Filter by issuer, fee, what it's best for, or cards within reach of your score. **Add a card** for anything missing. Drop an image on a card to replace its art
- **Calendar** (⌘4) — annual fees, a "keep or cancel" reminder before each fee (30/45/60 days, in Settings), credits about to reset with money still on them, statement reminders, and your own reminders (one-off, monthly or yearly)
- **Planner** (⌘5) — set how much goes into each savings / investment / retirement account per month. *Saved* fills in from the balance change; type over it with your real contribution. Copy last month's plan or apply it to the rest of the year. A year chart compares planned vs saved
- **Credit score** (⌘6) — Equifax, Experian and TransUnion, any date (so you can backfill), with the scoring model. Charted per model so FICO 8 and VantageScore don't get mixed. **Paste history** takes a whole spreadsheet of old scores
- **Statements** (⌘7) — the inbox for everything you download in Slate's browser or drop into the window. Slate reads PDFs, CSVs and OFX/QFX files, guesses the account and month, and finds the ending balance. **File it** moves the file into `Statements/<Bank>/<Year>/<YYYY-MM> <Account>.pdf` and records the balance
- **Bank connections (optional, SimpleFIN Bridge)** — off by default. Make an account at bridge.simplefin.org (about $1.50/month), link your banks there, then in Bridge go to My Account → Apps → New connection and copy the Setup Token. In Slate: Accounts → **Set up**, paste the token. Every account comes in automatically (matched to accounts you already have by bank + last 4), balances refresh on launch when they're over 6 hours old and with **Update now** (Slate stays well under SimpleFIN's ~24 requests/day limit), and new cards get offered to your wallet. Only balances are requested, never transactions. The access link is encrypted with the system keychain, never shown to the window and never included in backups. Disconnecting keeps the accounts and their history; delete the "Slate" app in Bridge to shut it off on their side too.
- **Autofill**
  - *Statements with several accounts* — Chase, BofA and Wells bundle checking and savings in one PDF. Slate finds every account in it (name, last 4, balance, APY) and creates the ones you don't have yet. Card statements fill in the credit line, statement day and the annual-fee month
  - *Cards paid from checking* — "Payment to Chase card ending in 1234" on a bank statement turns into an "Add to my wallet" button
  - *Credit report* — every card and loan with its open date, limit and balance. Free weekly at annualcreditreport.com; open it in Slate's browser and click **Read accounts from this page**, or drop the PDF in. Reports name the bank, not the exact card, so you pick the card for each line
  - *Two of the same card* — each wallet card has its own last 4, account, fee date and credits
- **Browser** (⌘8) — Relay's browser: tabs, your bank shortcuts, sign-ins remembered (only inside Slate). Every download goes straight to the statement inbox. **Save page as PDF** for banks that only show a statement as a web page
- **Monthly report** (⌘9) — one page per month: net worth and change, accounts, planned vs saved, card fees and credits, credit scores, notes. **Save as PDF** writes it to `Documents/Slate/Reports`

## Run it

You need Node.js (LTS) from https://nodejs.org.

```bash
cd ~/Downloads/Slate
npm install
npm start
```

## Install as a real app

```bash
npm run install-app
```

Builds `Slate.app` and copies it to /Applications.

## Sharing with a friend

Mac: send them the folder (without `node_modules`) and have them run the two commands above. Windows: `npm run dist:win` makes `dist/Slate-1.0.0-Windows-Portable.exe`. On first launch Windows shows "Windows protected your PC" — **More info → Run anyway**. Their data stays on their computer; none of yours is included.

## Where things live

- Your data: `~/Library/Application Support/Slate/slate-data.json` (Settings → Back up data makes a copy you can restore)
- Statements: `~/Documents/Slate/Statements` (change it in Settings). New downloads land in `Inbox/`
- Reports: `~/Documents/Slate/Reports`
- Replaced card images: `~/Library/Application Support/Slate/card-images`

## Notes

- Slate never sees bank passwords: you sign in on the bank's own site inside Slate's browser.
- Settings → *Also pick up statements I download in other browsers* copies new PDF/CSV/OFX files from ~/Downloads into the inbox.
- Card data was checked against what was public through mid-2026. Each card has a **Check the issuer's page** button; correct anything with **Add a card** or by replacing the image.
- Card art: 19 cards were upgraded to official images (Discover's own 717px art, the BofA cards without the World Cup badge, the personal JetBlue Plus). To change any card, open it and click **Find a better image**, then right-click an image in Slate's browser → **Use Image as Card Art…**
- Bank accounts aren't on credit reports, so their open date has to come from the bank's account details page.

## Code

- `src/main.js` — window, data storage, the browser's sessions (identity from Relay), report PDFs
- `src/statements.js` — download capture, inbox, filing
- `src/parse.js` — reads PDF / CSV / OFX statements (`npm test` checks it)
- `src/simplefin.js` — the optional SimpleFIN Bridge connection (token claim, balances, account matching)
- `src/extract.js` — finds every account in a statement, card details, cards being paid, and credit report accounts
- `src/data/cards.json` + `src/data/cards/` — the card catalog
- `src/renderer/` — the interface; `core.js` has the shared money, fee and credit logic

## Privacy

A stock install of Slate sends nothing anywhere. There is no account, analytics, crash reporting, update check or server of its own. Your data lives in the app's data folder and your Statements folder, on your computer only.

Slate goes online only when you ask it to:
- **The built-in browser** loads the sites you open (and the search engine when you type a search into the address bar). Shortcuts use letter tiles, not a favicon service.
- **SimpleFIN**, if you connect it, talks only to the SimpleFIN host in your Setup Token.
- **Use image as card art** downloads the image you right-clicked.

Spellcheck is off so no dictionaries are downloaded. `npm run test:privacy` is a network audit: it runs a fresh profile through every screen and fails if any request leaves the computer. Test data in `test/` is made up; keep it that way.
