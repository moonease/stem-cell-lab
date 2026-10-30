# Stem Cell Lab – shared stocks & maintenance

A small web app for the stem cell culture team:

- **Stocks** – shared reagents (e.g. Geltrex, media) with type/variant, lot, expiry, storage place, who's in charge, reorder level and "use within X days after opening"; consumables with a weekly OK / low / out check.
- **Ordering** – low or flagged items show up under *To order* → *Ordered* → *Arrived*.
- **Maintenance** – ContraCon, mycoplasma testing, chromosome kit test, or any task you add, with your own interval and responsible person. Marking a task done (also early, e.g. after a contamination) restarts the interval from that date.
- **Weekly duty rotation** – one person per week wipes surfaces, checks consumables and changes the water bath (every 2 weeks). Skips people who are away or have left; weeks can be swapped.
- **People & log** – interns add themselves and set a leaving date; every action is logged with who, when and which device.

## How it works

| Part | Where |
|---|---|
| App page (`index.html`) | GitHub Pages – this repo |
| Server (`apps-script/Code.gs`) | Google Apps Script, deployed as a web app |
| Data | The Google Sheet the script is attached to |

The page talks to the Apps Script web app in the background (JSON), so there is no "created by a Google Apps Script user" banner.

## Security

- Every phone/computer must be **unlocked once with a one-time code** (8 characters, works once, expires after 48 h).
- Admin devices create codes (*People → Devices*) and can remove devices. Normal devices can only use the app.
- The Sheet stores only SHA-256 hashes of codes and device keys. Wrong codes are rate-limited.
- Locked out? In the Google Sheet: menu **Lab app → New one-time code (admin device)**.
- This repo is public, but it contains no lab data – only the page and the server code. Without a device key the server answers nothing.

## Setup / updating the server

1. Google Sheet → **Extensions → Apps Script** → replace `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs). Delete the old `Index` HTML file if there is one.
2. Run **`setup`** once (allow access). The *Execution log* shows the first one-time code (admin).
3. **Deploy → Manage deployments → ✎ → Version: New version → Deploy** (keeps the same URL).
   First time: *Deploy → New deployment → Web app*, Execute as **Me**, access **Anyone**.
4. The web app URL (ending in `/exec`) goes into `index.html` → `const API_URL = '…'`.
