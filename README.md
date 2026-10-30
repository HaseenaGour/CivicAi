# CivicSignal

A mobile-first civic-service prototype for turning resident reports into prioritized, trackable work. The sample city, people-free report set, and service locations are fictional.

## Run locally

Requirements: Windows PowerShell 5.1 or later. No Node.js, Python, package installation, database, external API key, or build step is required.

From this directory, start the local API and static web server:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\server.ps1
```

The execution-policy bypass applies only to that PowerShell process; it does not change the machine-wide policy. Open <http://127.0.0.1:8765> in a browser and stop the server with Ctrl+C. To use another port:

```powershell
$env:PORT = '8770'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\server.ps1
```

The server listens on `127.0.0.1` only. Do not expose this prototype to a public or shared network.

On the first API request, the app creates `data/reports.json` with 40 synthetic reports. Subsequent reports, assignments, notes, and status history are stored in that local file. Remove the file while the server is stopped to restore the original 40-report demo seed.

## Five-minute demo

1. In **Report an issue**, choose Waterlogging and Canal Ward. Describe an urgent hazard near the underpass; search a sample address, use device location with browser permission, or adjust the keyboard-accessible map pin. Confirm the location preview before sending to receive a reference, simulated summary, nearby matches, and priority.
2. Open **Operations**. The report list sorts by calculated priority. Select the new report to review its factors and related reports.
3. Assign **Drainage team**, add a staff-only note, and move the report to **In progress**. The workflow shows the completed steps.
4. Open **Track a report** and enter the reference from the confirmation. The resident view shows the latest update and progress history; internal notes are not returned by the tracking API.
5. The seeded safety report `CS-26-0011` is available for a quick dashboard walkthrough, and `CS-26-0003` demonstrates a clustered report.

## Architecture

- `public/index.html`, `public/styles.css`, and `public/app.js` implement the accessible, responsive client, local address suggestions, permission-based geolocation, and scripted help assistant with no frontend dependencies.
- `server.ps1` serves the static client and same-origin JSON API using `.NET HttpListener`.
- `data/reports.json` is created at runtime and acts as the local persistence layer. It is not committed as a migration or production database.

### API

- `GET /api/health` reports local storage and simulated-analysis mode.
- `GET /api/reports` returns the staff queue. Optional filters: `category`, `priority`, `status`, and `date` (`today` or `week`).
- `GET /api/insights` returns synthetic area-level hotspot counts and a concise staff action brief.
- `POST /api/reports` validates category, description, area, schematic map coordinates, optional device coordinate pairs, and optional PNG/JPEG/WebP image data; it returns a report reference and analysis.
- `GET /api/track/{reference}` returns citizen-safe status, approximate location, and update history; exact device latitude/longitude is excluded.
- `GET /api/reports/{reference}` returns the staff report.
- `PATCH /api/reports/{reference}` accepts `assignee`, `internalNote`, and/or `status`. Valid workflow statuses are New, Reviewed, Assigned, In progress, and Resolved.

All endpoints are local and unauthenticated by design for this single-user demo. Do not enter real resident data or use this API as a public service.

## Simulated analysis

Analysis is deterministic prototype logic, not an AI-service integration. It uses description keywords and issue type to estimate urgency and safety risk, counts reports within a schematic map radius, estimates impact from nearby-report counts, and combines those factors into a score. Nearby same-category reports are suggested as possible duplicates. Synthetic area clusters power the hotspot summary; proximity is a signal for staff review, not proof of a shared cause.

The map is illustrative and not to scale. Address suggestions search a small local Bellwether sample list; custom address text is retained without geocoding. Device location uses the browser Geolocation API only after explicit permission, stores coordinates rounded to four decimal places in the local staff record, and places an explicitly approximate pin on the schematic map. No location is sent to an external service. Citizen tracking omits precise device coordinates. There is no live basemap, geocoder, or route planning. The optional image is stored locally as data and is not analyzed. The interface labels analysis as simulated and sample records as synthetic.

## Help assistant

The floating **Platform help** button is available while reporting or tracking. It offers scripted guidance about reporting an issue, useful details to include, and finding a report status. Suggested answers link to the relevant screen. It does not create reports, contact a service team, or supply live status updates.

## Limitations

- The local JSON store has no authentication, role separation, encryption at rest, backups, audit retention, or multi-user concurrency controls. Internal notes are hidden from the citizen tracking response, but the staff API has no access control.
- Device coordinates are saved in the local staff record when a resident grants browser permission. The tracking endpoint omits those exact coordinates, but this prototype has no authenticated staff access or production privacy controls; do not use real or sensitive locations.
- This is not a real civic reporting channel. No agency, service team, emergency responder, or resident is connected.
- Priority thresholds and related-report distance are demo heuristics that need domain review before operational use. The hotspot action brief is a fixed, illustrative recommendation.
- No resolution-date estimate is shown because the prototype has no verified service schedule.
- Images remain in the local JSON file until that file is removed; keep demo uploads small and non-sensitive.
