# SRTS Report Generation

This app is a Vercel-ready Next.js project that currently implements:

- ArcGIS OAuth login (plus optional direct username/password token login)
- Audit list retrieval (`school + date`) from the pre-survey layer
- Audit selection and server-streamed retrieval events
- Data pull from pre/post layers, including attachments and geometry payload

LLM + DOCX generation is intentionally deferred for now.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` from `.env.example`:

```bash
cp .env.example .env.local
```

3. Fill in these required env values:
- `ARCGIS_PRE_SURVEY_LAYER_URL`
- `ARCGIS_POST_SURVEY_LAYER_URL`
- `ARCGIS_CLIENT_ID` (ArcGIS OAuth app client id)

Optional overrides:
- `ARCGIS_PORTAL_URL` (defaults to `https://www.arcgis.com`)
- `ARCGIS_REFERER` (defaults to `http://localhost:3000`)
- `ARCGIS_CLIENT_SECRET` (if your ArcGIS OAuth app requires it)
- `ARCGIS_OAUTH_REDIRECT_URI` (defaults to `http://localhost:3000/api/arcgis/oauth/callback`)
- `ARCGIS_SCHOOL_FIELD` (defaults to `school_name`)
- `ARCGIS_DATE_FIELD` (defaults to `survey_date`)
- `ARCGIS_OBJECTID_FIELD` (defaults to `OBJECTID`)

## Run Locally

```bash
npm run dev
```

Open `http://localhost:3000`.

## API Endpoints Implemented

- `GET /api/arcgis/oauth/start`
  - Starts ArcGIS OAuth authorize flow

- `GET /api/arcgis/oauth/callback`
  - Exchanges ArcGIS OAuth code for token and redirects back to UI

- `POST /api/arcgis/login`
  - Body: `{ "username": "...", "password": "..." }`
  - Returns ArcGIS token and expiry

- `GET /api/audits?token=...`
  - Returns distinct `{ school, surveyDate }` audit combinations

- `POST /api/report/stream`
  - Body: `{ "token": "...", "school": "...", "surveyDate": "..." }`
  - Streams status events and returns full retrieved payload at completion

## Next Build Steps

- Integrate your chosen LLM with streamed narrative generation
- Convert final narrative + retrieved data into downloadable DOCX
- Persist/reuse ArcGIS tokens securely (session or encrypted cookie)
