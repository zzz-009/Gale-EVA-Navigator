# Gale Martian Map

T-02 / M-01: Vite + React + TypeScript + Leaflet 1.9.4.

Windows PowerShell:

```powershell
cd app
npm.cmd install
npm.cmd run build
npm.cmd test
npm.cmd run dev
```

The test imports the actual `CRS_MARS` and checks the equatorial distance
(59,274.6975 m per degree) and the geographic WMTS tile layout.
The metric scale uses `map.distance()` and therefore the same Mars CRS.

Imagery requires network access to NASA Mars Trek. Initial view, radius,
tile URLs and bounds are in `src/config/body.ts`.

Current environment limitations and data source checks: `../docs/data_notes.md`.
Dependencies could not be installed in the restricted execution environment;
build, tests and imagery display have not passed verification yet.
