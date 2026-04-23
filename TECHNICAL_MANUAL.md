# SRTS Walkability Audit System: Technical Manual

**Client:** Harriet Jackson, SRTS Program Coordinator, DOMI City of Pittsburgh  
**Prepared by:** Doris Gao, Evelyn Lui, Lilian Zhao  
**Last updated:** April 2026

---

## 1. System Overview

The SRTS Walkability Audit System is a digital replacement for the paper-based walkability audit process previously used by the Safe Routes to School program. It consists of three integrated components:

**ArcGIS Survey123** collects audit data from participants in the field. Two surveys exist:
- A **pre-survey** completed by school staff (usually the principal or school contact) before the audit begins. It captures school-level baseline data: student enrollment, travel mode estimates, designated walking routes, and pre-existing concerns.
- A **post-survey** completed by each participant after the walk. Participants fill in different sections based on their role (SRTS Coordinator, Planner, Traffic Engineer, Guest). Photos with optional captions can be attached to this survey.

Responses are stored in ArcGIS hosted feature layers owned by Harriet Jackson's DOMI ArcGIS Online account.

**A Next.js web application** deployed on Vercel allows Harriet to log in with her ArcGIS credentials, select a completed audit, preview the survey data, and download reports. It queries both ArcGIS feature layers (including related photo tables and GPS geometry), sends audit data to Claude AI, and produces three downloadable Word documents tailored for different audiences.

**Anthropic's Claude API** generates narrative report content from structured survey data. The output is combined with survey data, photos, and a GPS route map inside a programmatic Word document builder to produce the final reports.

---

## 2. Why We Built It This Way

### Why ArcGIS instead of Google Forms + Sheets?
The original proposal used Google Forms and Google Sheets. During implementation we discovered that Harriet already had ArcGIS Online access through DOMI. Building on existing licensed infrastructure eliminated ongoing software costs and kept all data within city-controlled systems. Survey123 also offers better mobile form support for field use and native support for GPS geometry capture.

### Why a composite key (school + date) instead of a formal audit ID?
We designed and partially built a formal audit ID system but abandoned it after discovering that Survey123's web designer forms cannot support dynamic dropdown population from a feature layer at the field level. A composite key of school name + audit date is sufficient for SRTS's scale, where Harriet controls the audit scheduling process and duplicate school/date combinations are practically impossible.

### Why Next.js on Vercel?
The original proposal used Azure. We pivoted to Vercel because it offers simpler deployment for a Next.js app with no server management overhead, a free tier sufficient for Harriet's usage volume, and faster iteration during development.

### Why Claude for report generation?
Report generation requires synthesizing responses from multiple participant roles into coherent narrative summaries tailored for different audiences. A predefined template alone cannot handle the variability in survey responses. Claude (specifically `claude-opus-4-5`) handles narrative generation while the `docx` library controls document structure and formatting.

### Why separate pre and post surveys?
A pilot audit conducted March 26, 2026 revealed that completing a form on a phone during the walk was impractical. The pre/post split respects the primary function of the audit — actually walking and observing — without the survey interfering with it.

### Why does the post-survey have multiple records per audit?
Each participant (coordinator, planner, traffic engineer, guest) submits their own post-survey record for the same audit. They each fill in different sections of the form based on their expertise. The web app merges all these records into a single coherent audit context by searching all records for the first non-null value for each field. The SRTS Coordinator's record is always used for identity fields (name, role, time) since they organise the audit.

---

## 3. System Architecture

### Data flow (end to end)

```
Survey123 (participants in field)
    │ GPS geotrace, photos, survey answers
    ▼
ArcGIS Online Hosted Feature Layers
    │ Pre-survey layer (Layer 0)
    │ Post-survey layer (Layer 0) + related photo tables (Layer 1+)
    ▼
Next.js API routes on Vercel
    ├── /api/audits            — lists distinct audits from post-survey
    ├── /api/report/stream     — streams survey data retrieval status (SSE)
    └── /api/report/download   — generates and returns the .docx file
    │
    ├── Queries ArcGIS REST API for features, attachments, geometry
    ├── Calls Claude API for narrative content
    └── Uses sharp + ArcGIS World Street Map for GPS route map image
    ▼
Browser (Harriet's machine)
    └── Downloads .docx report
```

### Step-by-step flow

1. Harriet visits the web app and authenticates via ArcGIS OAuth 2.0
2. The app queries both survey layers and builds a deduplicated list of audits (grouped by `date_of_audit`)
3. Harriet selects an audit from the dropdown and clicks **Load Preview**
4. The app streams status updates via Server-Sent Events while it:
   - Queries pre-survey records filtered to the selected school
   - Queries all post-survey records for that date (all roles), with geometry enabled
   - Queries related photo tables to find attached images and captions
   - Builds an `AuditContext` by merging records across all roles
5. The preview is displayed in the UI in **Summary** or **By User** mode
6. Harriet clicks **Download** for one of three report types
7. The download API route:
   - Re-queries the same data
   - Calls Claude API to generate role-specific narrative content
   - Fetches binary photo data and the GPS route map image (basemap PNG with route drawn using `sharp`)
   - Assembles the final `.docx` using the `docx` library
   - Returns the file as a download

---

## 4. Repository Structure

**GitHub:** https://github.com/lillian-zhao/SRTS-Report-Generation

```
src/
├── app/
│   ├── page.tsx                        Main UI — sign in, select audit, preview, download
│   ├── layout.tsx                      Root layout
│   ├── dev/page.tsx                    Developer tools page (/dev) — token, fields, raw data
│   └── api/
│       ├── audits/route.ts             GET — returns deduplicated audit list
│       ├── arcgis/
│       │   ├── login/route.ts          POST — server-side ArcGIS token generation (fallback)
│       │   ├── fields/route.ts         GET — returns field metadata for both layers
│       │   └── oauth/
│       │       ├── start/route.ts      GET — begins ArcGIS OAuth flow
│       │       └── callback/route.ts   GET — handles OAuth redirect, sets token
│       └── report/
│           ├── stream/route.ts         POST — streams data retrieval (Server-Sent Events)
│           └── download/route.ts       POST — generates and returns the .docx file
└── lib/
    ├── arcgis.ts                       All ArcGIS REST API helpers (token, query, attachments)
    ├── arcgis-browser-token.ts         Client-side token generation (runs in browser)
    ├── audit-context.ts                Merges pre+post features into a single AuditContext object
    ├── claude-reports.ts               Claude API calls — generates structured JSON per report type
    ├── build-report-doc.ts             Assembles .docx files using the docx library
    └── map-utils.ts                    Fetches basemap PNG + composites GPS route using sharp
```

### Key design patterns

- **`AuditContext`** (`audit-context.ts`) is the central data structure. It merges all post-survey records across roles into a single flat object. The `str()` helper picks the first non-null value across all records for each field. The SRTS Coordinator's record (identified by `what_is_your_role_today`) is always checked first for identity fields.
- **Photo attachments** are stored in related tables (sublayers 1+), not as direct attachments on the main layer — a Survey123 design decision. `queryRelatedPhotoAttachments()` discovers these tables dynamically via the service metadata endpoint and queries each one. Photo captions are stored as attribute fields on the related table records.
- **GPS route geometry** is only present on post-survey records submitted after the geotrace question was re-enabled (see Section 8). Old records have `Shape__Length: null` and no geometry.
- **Map generation** (`map-utils.ts`): if GPS geometry is available, the bounding box of the route is used to fetch a street basemap PNG from ArcGIS World Street Map, then `sharp` composites the polyline on top. If no geometry is available, Nominatim (OpenStreetMap) geocodes the school address and a neighbourhood-level basemap is fetched instead.

---

## 5. Environment Variables

Create a `.env.local` file for local development. For production, set these in the Vercel project dashboard under **Settings → Environment Variables**.

| Variable | Required | Description |
|---|---|---|
| `ARCGIS_PRE_SURVEY_LAYER_URL` | ✅ | Full URL to pre-survey Feature Layer, ending in `/FeatureServer/0` |
| `ARCGIS_POST_SURVEY_LAYER_URL` | ✅ | Full URL to post-survey Feature Layer, ending in `/FeatureServer/0` |
| `ARCGIS_CLIENT_ID` | ✅ | OAuth App Client ID from ArcGIS Developer portal |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic API key — required for report generation |
| `ARCGIS_OAUTH_REDIRECT_URI` | ✅ (prod) | Full callback URL: `https://your-domain.vercel.app/api/arcgis/oauth/callback` |
| `ARCGIS_REFERER` | ✅ (prod) | Your app's base URL — used in ArcGIS token requests as the referer |
| `ARCGIS_PORTAL_URL` | optional | Defaults to `https://www.arcgis.com`. Change only if using a private ArcGIS Enterprise portal |
| `ARCGIS_TOKEN_CLIENT` | optional | `referer` (default) or `requestip`. Controls ArcGIS token auth mode |
| `ARCGIS_SCHOOL_FIELD` | optional | Pre-survey school name field. Defaults to `which_school_is_this_audit_for` |
| `ARCGIS_POST_SCHOOL_FIELD` | optional | Post-survey school name field. Defaults to `field_103` |
| `ARCGIS_DATE_FIELD` | optional | Survey date field. Defaults to `date_of_audit` |
| `ARCGIS_OBJECTID_FIELD` | optional | Object ID field. Defaults to `objectid` |
| `NEXT_PUBLIC_ARCGIS_PORTAL_URL` | optional | Client-side portal URL for browser token generation |

### Current production values (as of April 2026)

- **Pre-survey layer:** `https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/survey123_a319154d30174363a7f1332a41a4168f_results/FeatureServer/0`
- **Post-survey layer:** `https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/survey123_98dcc2e10b5d4b7296d0bb72d7722e4a_results/FeatureServer/0`
- **ArcGIS Client ID:** `I0vhxBaDbmuJZAET`
- **OAuth Redirect URI:** `https://srts-report-generation.vercel.app/api/arcgis/oauth/callback`

> ⚠️ The `ANTHROPIC_API_KEY` is **not** stored in `vercel.json` (it is a secret). It must be added manually in the Vercel dashboard under Environment Variables and is not committed to the repository.

---

## 6. Running Locally

```bash
# Clone the repo
git clone https://github.com/lillian-zhao/SRTS-Report-Generation.git
cd SRTS-Report-Generation

# Install dependencies (Node 18+ required)
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local and fill in all required values

# Start development server
npm run dev
```

- Main app: http://localhost:3000
- Developer tools: http://localhost:3000/dev

### Notes for local development

- ArcGIS OAuth login redirects to whatever `ARCGIS_OAUTH_REDIRECT_URI` is set to in your `.env.local`. For local dev, set this to `http://localhost:3000/api/arcgis/oauth/callback` and register this URI in the ArcGIS Developer portal.
- Set `ARCGIS_REFERER=http://localhost:3000` locally.
- The `/dev` page is the fastest way to test the data pipeline. It lets you inspect the raw ArcGIS token, layer field names, and all survey data without generating a report.

---

## 7. Deployment on Vercel

**Deployed URL:** https://srts-report-generation.vercel.app/

### Initial setup

1. Push code to the GitHub repository
2. Connect the GitHub repository to a Vercel project
3. In Vercel **Settings → Environment Variables**, add all variables from Section 5 — including `ANTHROPIC_API_KEY` as a secret
4. Set `ARCGIS_REFERER` and `ARCGIS_OAUTH_REDIRECT_URI` to the production Vercel URL
5. In the [ArcGIS Developer portal](https://developers.arcgis.com), open the OAuth app and add the production callback URI (`https://srts-report-generation.vercel.app/api/arcgis/oauth/callback`) as an allowed redirect URI
6. Deploy

Vercel automatically redeploys when changes are pushed to the `main` branch.

### If the Vercel URL ever changes

If the project is transferred to a new Vercel account or the domain changes, **both** of the following must be updated:

1. `ARCGIS_REFERER` and `ARCGIS_OAUTH_REDIRECT_URI` environment variables in the Vercel dashboard
2. The allowed redirect URI in the ArcGIS Developer portal OAuth app settings

Failing to do either will break the login flow.

### Serverless function limits

The report download endpoint (`/api/report/download`) has `maxDuration = 60` seconds — this is set because Claude API calls plus photo fetching can take up to ~45 seconds. The stream endpoint (`/api/report/stream`) has `maxDuration = 30` seconds. If Vercel's free plan limits change, verify these values are still within the allowed range.

---

## 8. ArcGIS Survey123 Configuration

This section documents the Survey123 setup that the web app depends on. **Do not modify survey structure without reading this section.**

### Survey overview

| Survey | Purpose | Key fields |
|---|---|---|
| Pre-survey | School baseline data | `which_school_is_this_audit_for`, `date_of_audit`, travel mode %, student count |
| Post-survey | Field observations by role | `field_103` (school name), `date_of_audit`, `what_is_your_role_today`, infrastructure/traffic findings, `geotrace` question |

### GPS route capture (geotrace question)

The post-survey includes a **"Trace your audit route on the map"** geotrace question. This must **not** have "Do not store the answer" checked in Survey123 Web Designer. When this box is accidentally checked, the data is stored as a non-spatial table and geometry is absent from all submissions.

**To fix if geotrace geometry stops appearing:**
1. Open the survey in Survey123 Web Designer
2. Find the geotrace question
3. Uncheck "Do not store the answer"
4. In the **Publish** dialog, choose **"Delete all existing data and rebuild the feature layer"**
5. Any data submitted before the rebuild will not have geometry. Participants must re-submit or the SRTS Coordinator must edit existing records in ArcGIS Online to re-enter the route

### Photo storage (related tables)

Survey123 stores photo question attachments in **related tables** (sublayers), not as direct attachments on the main layer. The post-survey service contains:
- **Layer 0** — main post-survey feature layer (or table)
- **Layer 1+** — one related table per photo question (typically named `photos`)

Each related table record has a `parentglobalid` field linking it to the main layer record, and photo attachments on that record. The web app dynamically discovers these tables via the service metadata endpoint at runtime — no hardcoded layer IDs are needed.

**Photo captions** entered by the surveyor are stored as a text field on the related table record (typically named `caption`). The app extracts this field automatically.

### Field name stability

Survey123 derives ArcGIS field names from the question names you set in Survey123 Web Designer. **Renaming a question changes its field name**, which will break the data pull. Key field names that the web app relies on by name:

- `what_is_your_full_name`
- `what_is_your_role_today`
- `whats_your_email_address`
- `date_of_audit`
- `time_of_audit`
- `field_103` (post-survey school name — note: this is a Survey123-generated name, not a renamed field)
- `school_address`
- `audit_route_description`
- `any_pre_existing_known_concerns`

Other fields can tolerate renaming because the context builder searches all fields by value rather than by hardcoded name.

---

## 9. Claude API

The web app uses Claude (`claude-opus-4-5`) to generate structured JSON narrative content from survey data. This is implemented in `src/lib/claude-reports.ts`. The JSON is consumed by `build-report-doc.ts` to produce the final Word documents.

### Three report types

| Report | Audience | Claude generates |
|---|---|---|
| **DOMI Internal** | City planners, traffic engineers | Technical narratives, critical flags, immediate/short/long-term action lists |
| **School & Community** | Principals, PTAs, community groups | Student-accessible safety summary, parent action items, positive observations |
| **Public Update** | General public, newsletters, social media | Plain-language summary, what was found, next steps |

Each call uses a separate system prompt tailored to the target audience and returns strictly formatted JSON. The `docx` builder then fills pre-structured Word document templates with this content alongside the raw survey data.

### Managing API credits

- Credits are managed at [console.anthropic.com](https://console.anthropic.com)
- Credentials for this account are in the separate credentials document provided at handoff
- We recommend checking the balance monthly and topping up when below $10
- When credits run out, report generation will fail with an error at the download step — the preview and audit selection steps will still work

### Rotating the API key

1. Log into [console.anthropic.com](https://console.anthropic.com)
2. Navigate to **API Keys**
3. Generate a new key and deactivate the old one
4. In the Vercel dashboard, go to **Settings → Environment Variables** and update `ANTHROPIC_API_KEY`
5. Trigger a redeployment from the Vercel dashboard (or push any commit to `main`)

---

## 10. Known Limitations and Gotchas

### Survey structure is fragile
Modifying question names or question order in Survey123 Web Designer will change ArcGIS field names, potentially breaking data mapping. Always test the full pipeline end-to-end (from survey submission through to report download) after any survey changes. Use the `/dev` page to inspect raw field values before and after changes.

### Old records lack GPS geometry
Only post-survey records submitted after the geotrace question was re-enabled (March–April 2026) have geometry. Records submitted before that rebuild have `Shape__Length: null` and no geometry. For these audits, the map in the report falls back to a geocoded neighbourhood basemap around the school address.

### Composite key fragility
If a participant enters the wrong date or school name in the post-survey, their record will not join correctly to the audit. The school name dropdown mitigates this in the post-survey, but date entry remains free-text.

### Multiple participants, different dates
In some cases, participants submit their post-survey response on a different day from the audit date. The app filters post-survey records by `date_of_audit` value (what the participant entered), not by `CreationDate`. If a participant enters the wrong date, their record will not be included.

### LLM output variability
Claude's narrative output may vary between runs for the same audit data. Reports should always be reviewed before sharing with stakeholders.

### Vercel cold starts
The first report download after a period of inactivity may take longer than usual due to Vercel serverless cold start time. This is normal.

### ArcGIS token expiry
OAuth tokens issued by ArcGIS expire after approximately 2 hours. If Harriet leaves the page open past expiry, queries will fail with an authentication error. She should sign out and sign back in. The app stores the token expiry time and displays it in the UI.

---

## 11. Suggested Features / Improvements

The following improvements were identified during development but were out of scope:

1. **Formal audit ID system** — The composite key approach works at current scale. If SRTS expands to multiple coordinators or many simultaneous audits, a formal ID (generated at the start of each audit and entered into both surveys) would make data joins more robust.

2. **PDF export** — The current output is `.docx`. A PDF conversion step (e.g. using LibreOffice on a Vercel Fluid Compute instance, or a third-party API) would make reports easier to share directly.

3. **Email delivery** — Instead of downloading the file, Harriet could have reports emailed to relevant stakeholders directly from the web app.

4. **Multi-run comparison** — A future view could compare two audits of the same school across different years to track progress.

5. **In-app report preview** — Render a HTML preview of the report content before downloading the Word doc.

6. **Route overlay quality** — Currently the GPS route is drawn as a plain polyline over a street basemap. Using a dedicated mapping API (e.g. Mapbox Static Images API) would allow a higher-quality styled map with turn-by-turn route smoothing and custom school markers.

7. **Pre-survey date flexibility** — The pre-survey is submitted on a separate day from the post-survey. Currently the app matches them by school name. A shared audit date or ID would make matching more reliable.

---

## 12. Guide for Future Development Teams

### Getting started

1. **Fork** the repository on GitHub — do not push directly to the `main` branch, which is connected to Harriet's live Vercel deployment
2. Clone your fork locally
3. Follow the setup steps in Section 6 to run the app locally
4. Use the `/dev` page at http://localhost:3000/dev for testing — it shows the raw ArcGIS token, all layer field names, raw JSON for any audit's pre and post data, photo metadata, and geometry. This is the fastest debugging tool in the project

### Testing the full pipeline

The safest way to test end-to-end without generating real reports is:
1. Sign in with a test ArcGIS account that has read access to the survey layers
2. Use the `/dev` page to inspect raw data and confirm field mappings
3. Select an audit on the main page and use **Load Preview** to confirm the audit context is built correctly
4. Download a **DOMI Internal** report (this exercises Claude, photos, map, and docx generation in one step)

### Understanding the data merge

The most important thing to understand is how `buildAuditContext()` (`src/lib/audit-context.ts`) works. Each audit has:
- 1 pre-survey record (from the school contact)
- N post-survey records (one per participant — coordinator, planner, traffic, guests)

The `str(sources, fieldName)` helper scans all records in order and returns the first non-null value for each field. The coordinator's record is always put first for identity fields. This means most field values will come from whichever participant filled in that section — which is intentional.

### Adding a new report field

1. Add the field name to the `AuditContext` type in `audit-context.ts`
2. Map it in `buildAuditContext()` using the `str()` helper
3. Add it to the relevant section in `contextToPromptText()` so Claude sees it
4. Add it to the preview UI in `page.tsx` under the relevant section group
5. Use it in `build-report-doc.ts` where appropriate

### Changing Claude model or prompts

The Claude model is set in `claude-reports.ts` (`claude-opus-4-5` as of April 2026). To change the model, update the `model` field in the `callClaude()` helper. The system prompts are defined inline in `generateDomiContent()`, `generateSchoolCommunityContent()`, and `generatePublicContent()`. Each prompt ends with a strict JSON schema that Claude must return — if you change the schema, update the corresponding TypeScript type and the `build-report-doc.ts` code that reads it.

### Developer tools page (/dev)

The `/dev` page (`src/app/dev/page.tsx`) is a debugging interface. It allows you to:
- View and test the ArcGIS OAuth token
- Inspect all field names on both survey layers
- Stream raw data for any audit (same API call as the main app)
- See the full JSON payload including raw `preFeatures`, `postFeatures`, photo metadata, and geometry

It is not linked from the main UI (Harriet does not see it) but is accessible by navigating to `/dev` directly.

---

*End of document. For questions, contact the DOMI SRTS program coordinator or refer to the GitHub repository README.*
