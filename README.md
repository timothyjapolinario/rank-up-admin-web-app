# RankUp Admin Web App

The admin app manages hubs, players, and matches through the RankUp API. The public website remains in `rank-up-webapp` and consumes the public data export produced here.

## Run locally

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local` first (see `.env.example`). These are public client settings; never put a Supabase secret or `service_role` key in this app.

```bash
npm install
npm run dev
```

Start the API using its HTTPS launch profile, then open [http://127.0.0.1:3001](http://127.0.0.1:3001). The Vite development server proxies `/api` requests to `https://localhost:7081`; trust the ASP.NET Core development certificate if prompted. The app loads hubs, players, and matches from the API and writes changes back to it. API errors are shown in the workspace; there is no seeded-data fallback.

## Admin workflow

- Select a hub or create another one.
- Add, edit, and deactivate hub players. Ratings are owned by the API and are not directly editable.
- Inactive players that appear in match history can be reactivated. The current API only lists active players by hub, so inactive players with no match history cannot be discovered by the admin app.
- Record a scheduled doubles match, including the score, teams, date, and optional YouTube URL. Complete a scheduled result to apply the API's Elo changes and rating history.
- Cancel scheduled matches without changing ratings.
- The current API does not expose import, result-correction, or void endpoints. Those actions are not offered in this app.

## Weekly publishing

Use **Download public.json** after completing results. It downloads one JSON file in the exact format the public app reads. Replace `rank-up-webapp/src/data/public.json` with the downloaded file; there is no ZIP to extract. The export includes active hubs, active players, and completed matches. Rating snapshots come from API match records; they are not recalculated by the browser.

Use **Export API backup** to download a snapshot of the data returned by the API. Importing a backup into the API is not supported by the current API.

Build and publish the public website after replacing the file.

For production, set `VITE_API_BASE_URL` to the API's base URL including `/api/v1` (for example `https://api.example.test/api/v1`) and configure the API to allow the admin app's origin.

## Sign-in

The admin app uses Supabase email/password sign-in. It has no sign-up flow. In the Supabase dashboard, disable public sign-ups and create administrator accounts yourself. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as GitHub Actions repository variables for Pages deployments.

The admin UI requires a signed-in session and sends its Supabase access token with API requests. API-side JWT validation and authorization are intentionally not included here; until that is set up separately, the API endpoints are not protected by this sign-in gate. The API also needs to allow the Pages origin through CORS.

## GitHub Pages deployment

Pushing to `main` builds and deploys the app to `https://timothyjapolinario.github.io/rank-up-admin-web-app/`. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. The workflow configures the Pages base path and production API URL; the API must allow the Pages origin (`https://timothyjapolinario.github.io`) through CORS.

## Build and tests

```bash
npm run build
npm test
```
