import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { AuditContext } from "./audit-context";
import type {
  DomiContent,
  PublicContent,
  SchoolCommunityContent,
} from "./claude-reports";

export type ReportPhoto = {
  data: Uint8Array;
  name: string;
  /** MIME type — e.g. "image/jpeg", "image/png" */
  contentType: string;
};

// ── Palette ───────────────────────────────────────────────────────────────────

const C = {
  domiBlue:   "1F4E79",
  accentBlue: "2E75B6",
  lightBlue:  "D5E8F0",
  darkGray:   "404040",
  medGray:    "666666",
  lightGray:  "F2F2F2",
  white:      "FFFFFF",
  red:        "C00000",
  amber:      "FF8C00",
  green:      "375623",
  lightGreen: "E2EFDA",
  lightAmber: "FFF2CC",
  lightRed:   "FFDAD6",
};

// ── Numbering / styles shared across all docs ─────────────────────────────────

const numbering = {
  config: [
    {
      reference: "bullets",
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: "•",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 540, hanging: 360 } } },
      }],
    },
  ],
};

const styles = {
  default: { document: { run: { font: "Arial", size: 20 } } },
  paragraphStyles: [
    {
      id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
      run: { size: 28, bold: true, font: "Arial", color: C.domiBlue },
      paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 0 },
    },
    {
      id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
      run: { size: 24, bold: true, font: "Arial", color: C.accentBlue },
      paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 },
    },
  ],
};

// ── Border helpers ────────────────────────────────────────────────────────────

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

// ── Primitive builders ────────────────────────────────────────────────────────

function cell(
  text: string,
  opts: {
    bold?: boolean; color?: string; bg?: string; width?: number;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType]; size?: number;
  } = {},
) {
  const {
    bold = false, color = C.darkGray, bg = C.white,
    width = 4680, align = AlignmentType.LEFT, size = 20,
  } = opts;
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: bg, type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 150, right: 150 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: align,
      children: [new TextRun({ text, bold, color, font: "Arial", size })],
    })],
  });
}

function headerCell(text: string, width = 4680) {
  return cell(text, { bold: true, color: C.white, bg: C.domiBlue, width, size: 20 });
}

function sectionHeading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1) {
  return new Paragraph({
    heading: level,
    spacing: { before: 280, after: 120 },
    border: level === HeadingLevel.HEADING_1 ? {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: C.accentBlue, space: 1 },
    } : {},
    children: [new TextRun({
      text, bold: true, font: "Arial",
      size: level === HeadingLevel.HEADING_1 ? 28 : 24,
      color: level === HeadingLevel.HEADING_1 ? C.domiBlue : C.accentBlue,
    })],
  });
}

function body(text: string, opts: { bold?: boolean; color?: string; italic?: boolean } = {}) {
  const { bold = false, color = C.darkGray, italic = false } = opts;
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, bold, color, font: "Arial", size: 20, italics: italic })],
  });
}

function bullet(text: string, opts: { bold?: boolean; color?: string } = {}) {
  const { bold = false, color = C.darkGray } = opts;
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, bold, color, font: "Arial", size: 20 })],
  });
}

function spacer(pts = 160) {
  return new Paragraph({ spacing: { after: pts }, children: [new TextRun("")] });
}

function mimeToDocxType(contentType: string): "jpg" | "png" | "gif" | "bmp" {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("bmp")) return "bmp";
  return "jpg";
}

/**
 * Renders a two-column grid of embedded photos with captions.
 * Returns an empty array if no photos are provided.
 */
function photoGallery(photos: ReportPhoto[], heading = "Site Photos"): Array<Paragraph | Table> {
  if (!photos.length) return [];

  const IMG_W = 270;
  const IMG_H = 203; // ~4:3 aspect ratio
  const COL_W = 4680; // half of 9360 DXA

  const rows: TableRow[] = [];
  for (let i = 0; i < photos.length; i += 2) {
    const pair = [photos[i], photos[i + 1]];
    rows.push(new TableRow({
      children: pair.map((photo) => new TableCell({
        borders,
        width: { size: COL_W, type: WidthType.DXA },
        margins: { top: 120, bottom: 120, left: 120, right: 120 },
        children: photo
          ? [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new ImageRun({
                  data: photo.data,
                  transformation: { width: IMG_W, height: IMG_H },
                  type: mimeToDocxType(photo.contentType),
                })],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 60 },
                children: [new TextRun({ text: photo.name, font: "Arial", size: 16, color: C.medGray, italics: true })],
              }),
            ]
          : [new Paragraph({ children: [new TextRun({ text: "" })] })],
      })),
    }));
  }

  return [
    sectionHeading(heading),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [COL_W, COL_W],
      rows,
    }),
    spacer(120),
  ];
}

function mapBlock(mapImage: Uint8Array | null, routeDescription: string): Array<Paragraph | Table> {
  const caption = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 80 },
    children: [new TextRun({
      text: mapImage
        ? "School neighborhood map — GPS route not yet enabled in survey form"
        : "[Map unavailable — GPS route not enabled in survey form]",
      font: "Arial", size: 16, color: C.medGray, italics: true,
    })],
  });

  if (mapImage) {
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new ImageRun({ data: mapImage, transformation: { width: 560, height: 380 }, type: "png" })],
      }),
      caption,
    ];
  }

  // Fallback text placeholder
  return [
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [9360],
      rows: [new TableRow({ children: [
        new TableCell({
          borders,
          width: { size: 9360, type: WidthType.DXA },
          shading: { fill: "E8F0F8", type: ShadingType.CLEAR },
          margins: { top: 600, bottom: 600, left: 200, right: 200 },
          children: [
            new Paragraph({ alignment: AlignmentType.CENTER, children: [
              new TextRun({ text: "🗺", font: "Arial", size: 48 }),
            ]}),
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120 }, children: [
              new TextRun({ text: "[AUDIT ROUTE MAP — Geotrace from ArcGIS Survey123]", font: "Arial", size: 18, color: C.medGray, italics: true }),
            ]}),
            ...(routeDescription ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60 }, children: [
              new TextRun({ text: routeDescription, font: "Arial", size: 18, color: C.medGray }),
            ]})] : []),
          ],
        }),
      ]})],
    }),
  ];
}

function makeHeader(title: string, subtitle: string) {
  return new Header({
    children: [
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.accentBlue, space: 4 } },
        spacing: { after: 120 },
        children: [new TextRun({
          text: "CITY OF PITTSBURGH  |  DEPARTMENT OF MOBILITY & INFRASTRUCTURE  |  SAFE ROUTES TO SCHOOL",
          font: "Arial", size: 16, color: C.medGray,
        })],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: title, font: "Arial", size: 22, bold: true, color: C.domiBlue })],
      }),
      new Paragraph({
        children: [new TextRun({ text: subtitle, font: "Arial", size: 18, color: C.medGray, italics: true })],
      }),
    ],
  });
}

function makeFooter(date: string) {
  return new Footer({
    children: [new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: C.accentBlue, space: 4 } },
      spacing: { before: 100 },
      children: [
        new TextRun({ text: `Generated by SRTS Walkability Audit System  |  ${date}`, font: "Arial", size: 16, color: C.medGray }),
        new TextRun({ text: "\tSafe Routes to School  |  DOMI, City of Pittsburgh", font: "Arial", size: 16, color: C.medGray }),
      ],
    })],
  });
}

function coverBlock(fill: string, title: string, sub1: string, sub2: string, sub1Color = "BDD7EE") {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders: noBorders,
      width: { size: 9360, type: WidthType.DXA },
      shading: { fill, type: ShadingType.CLEAR },
      margins: { top: 400, bottom: 400, left: 400, right: 400 },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [
          new TextRun({ text: title, font: "Arial", size: 40, bold: true, color: C.white }),
        ]}),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120 }, children: [
          new TextRun({ text: sub1, font: "Arial", size: 22, color: sub1Color, italics: true }),
        ]}),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80 }, children: [
          new TextRun({ text: sub2, font: "Arial", size: 22, color: C.lightBlue }),
        ]}),
      ],
    })]})],
  });
}

function contactBlock(name: string, email: string, org: string, fill: string, textColor: string) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders,
      width: { size: 9360, type: WidthType.DXA },
      shading: { fill, type: ShadingType.CLEAR },
      margins: { top: 150, bottom: 150, left: 200, right: 200 },
      children: [
        new Paragraph({ children: [new TextRun({ text: name, font: "Arial", size: 20, bold: true, color: textColor })] }),
        new Paragraph({ children: [new TextRun({ text: org, font: "Arial", size: 20, color: C.darkGray })] }),
        new Paragraph({ children: [new TextRun({ text: email, font: "Arial", size: 20, color: C.darkGray })] }),
      ],
    })]})],
  });
}

const pageLayout = {
  properties: {
    page: {
      size: { width: 12240, height: 15840 },
      margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    },
  },
};

async function toBuffer(doc: Document): Promise<ArrayBuffer> {
  const buf = await Packer.toBuffer(doc);
  // Explicitly allocate a plain ArrayBuffer and copy in — avoids the
  // ArrayBuffer | SharedArrayBuffer union that TypeScript can't narrow.
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return copy;
}

// ── Helper: map Yes/No/Partial survey values to colored severity ──────────────

function severityColor(val: string): string {
  const v = val.toLowerCase();
  if (v === "yes") return C.red;
  if (v === "no") return C.green;
  if (v.includes("partial")) return C.amber;
  return C.darkGray;
}

// ════════════════════════════════════════════════════════════════════════════════
// 1. DOMI Internal Report
// ════════════════════════════════════════════════════════════════════════════════

export async function buildDomiReport(ctx: AuditContext, llm: DomiContent, photos: ReportPhoto[] = [], mapImage: Uint8Array | null = null): Promise<ArrayBuffer> {
  const children = [

    coverBlock(
      C.domiBlue,
      "WALKABILITY AUDIT REPORT",
      "DOMI INTERNAL — CONFIDENTIAL",
      `${ctx.school}  |  ${ctx.dateDisplay}`,
    ),

    spacer(200),

    sectionHeading("Audit Summary"),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [2800, 6560],
      rows: [
        new TableRow({ children: [headerCell("Field", 2800), headerCell("Details", 6560)] }),
        new TableRow({ children: [cell("School", { bold: true, bg: C.lightGray, width: 2800 }), cell(ctx.school, { width: 6560 })] }),
        new TableRow({ children: [cell("Address", { bold: true, bg: C.lightGray, width: 2800 }), cell(ctx.address || "—", { width: 6560 })] }),
        new TableRow({ children: [cell("Audit Date", { bold: true, bg: C.lightGray, width: 2800 }), cell(ctx.dateDisplay, { width: 6560 })] }),
        new TableRow({ children: [cell("Time", { bold: true, bg: C.lightGray, width: 2800 }), cell(ctx.time || "—", { width: 6560 })] }),
        new TableRow({ children: [cell("Weather", { bold: true, bg: C.lightGray, width: 2800 }), cell(ctx.weather || "—", { width: 6560 })] }),
        new TableRow({ children: [cell("Coordinator", { bold: true, bg: C.lightGray, width: 2800 }), cell(ctx.coordinator || "—", { width: 6560 })] }),
        new TableRow({ children: [cell("School Contact", { bold: true, bg: C.lightGray, width: 2800 }), cell(ctx.schoolContact || "—", { width: 6560 })] }),
        new TableRow({ children: [cell("Initiated By", { bold: true, bg: C.lightGray, width: 2800 }), cell(ctx.initiatedBy || "—", { width: 6560 })] }),
        new TableRow({ children: [cell("Previous Audit", { bold: true, bg: C.lightGray, width: 2800 }), cell(ctx.previousAudit || "—", { width: 6560 })] }),
        new TableRow({ children: [cell("Overall Severity", { bold: true, bg: C.lightGray, width: 2800 }), cell(ctx.overallSeverity || "—", { bold: true, color: C.red, width: 6560 })] }),
      ],
    }),

    spacer(),

    sectionHeading("Audit Route"),
    body(ctx.routeDescription || "Route details not recorded."),
    spacer(100),
    ...mapBlock(mapImage, ctx.routeDescription || ""),

    spacer(),

    sectionHeading("Pre-Existing Known Concerns"),
    body(llm.preExistingConcernsNarrative),
    spacer(80),
    ...(ctx.preExistingConcerns ? [bullet(ctx.preExistingConcerns)] : []),

    spacer(),

    sectionHeading("Infrastructure Findings (Planner)"),
    body(llm.infrastructureNarrative),
    spacer(80),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [5560, 1900, 1900],
      rows: [
        new TableRow({ children: [headerCell("Infrastructure Item", 5560), headerCell("Status", 1900), headerCell("Severity", 1900)] }),
        new TableRow({ children: [cell("ADA-compliant signage consistently present", { width: 5560 }), cell(ctx.adaSignage || "—", { width: 1900 }), cell(ctx.adaSignage === "No" ? "High" : "—", { color: severityColor(ctx.adaSignage || ""), bold: true, width: 1900 })] }),
        new TableRow({ children: [cell("Vegetation/landscaping blocking sidewalks", { width: 5560, bg: C.lightGray }), cell(ctx.vegetationBlocking || "—", { width: 1900, bg: C.lightGray }), cell(ctx.vegetationBlocking === "Yes" ? "High" : "—", { color: severityColor(ctx.vegetationBlocking || ""), bold: true, width: 1900, bg: C.lightGray })] }),
        new TableRow({ children: [cell("Pooling water at curb ramps", { width: 5560 }), cell(ctx.poolingWater || "—", { width: 1900 }), cell(ctx.poolingWater === "Yes" ? "Medium" : "—", { color: severityColor(ctx.poolingWater || ""), bold: true, width: 1900 })] }),
        new TableRow({ children: [cell("Immediate hazards (manhole, debris)", { width: 5560, bg: C.lightGray }), cell(ctx.immediateHazards || "—", { width: 1900, bg: C.lightGray }), cell(ctx.immediateHazards === "Yes" ? "Critical" : "—", { color: severityColor(ctx.immediateHazards || ""), bold: true, width: 1900, bg: C.lightGray })] }),
        new TableRow({ children: [cell("Tripping hazards >1 inch", { width: 5560 }), cell(ctx.trippingHazards || "—", { width: 1900 }), cell(ctx.trippingHazards === "Yes" ? "High" : "—", { color: severityColor(ctx.trippingHazards || ""), bold: true, width: 1900 })] }),
        new TableRow({ children: [cell("Critical sidewalk gaps", { width: 5560, bg: C.lightGray }), cell(ctx.sidewalkGaps || "—", { width: 1900, bg: C.lightGray }), cell(ctx.sidewalkGaps === "Yes" ? "Critical" : "—", { color: severityColor(ctx.sidewalkGaps || ""), bold: true, width: 1900, bg: C.lightGray })] }),
        new TableRow({ children: [cell("Existing grant opportunities", { width: 5560 }), cell(ctx.grantOpportunities || "—", { width: 1900 }), cell("—", { width: 1900 })] }),
        new TableRow({ children: [cell("Nearby active/proposed construction", { width: 5560, bg: C.lightGray }), cell(ctx.nearbyConstruction || "—", { width: 1900, bg: C.lightGray }), cell(ctx.nearbyConstruction === "Yes" ? "High" : "—", { color: severityColor(ctx.nearbyConstruction || ""), bold: true, width: 1900, bg: C.lightGray })] }),
      ],
    }),
    ...(ctx.grantDetails ? [spacer(80), body("Grant Opportunity Details:", { bold: true }), bullet(ctx.grantDetails)] : []),
    ...(ctx.constructionDetails ? [spacer(80), body("Active/Proposed Nearby Projects:", { bold: true }), bullet(ctx.constructionDetails)] : []),
    ...(ctx.additionalInfrastructureNotes ? [spacer(80), body("Specific Observations:", { bold: true }), bullet(ctx.additionalInfrastructureNotes)] : []),

    spacer(),

    sectionHeading("Traffic & Safety Findings (Traffic Team)"),
    body(llm.trafficNarrative),
    spacer(80),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [5560, 1900, 1900],
      rows: [
        new TableRow({ children: [headerCell("Traffic Item", 5560), headerCell("Status", 1900), headerCell("Concern", 1900)] }),
        new TableRow({ children: [cell("Known crash history at intersections", { width: 5560 }), cell(ctx.crashHistory || "—", { width: 1900 }), cell(ctx.crashHistory === "Yes" ? "Critical" : "—", { color: severityColor(ctx.crashHistory || ""), bold: true, width: 1900 })] }),
        new TableRow({ children: [cell("Conflicting/unclear signage", { width: 5560, bg: C.lightGray }), cell(ctx.conflictingSignage || "—", { width: 1900, bg: C.lightGray }), cell("—", { width: 1900, bg: C.lightGray })] }),
        new TableRow({ children: [cell("Wayfinding signage for students", { width: 5560 }), cell(ctx.wayfinding || "—", { width: 1900 }), cell(ctx.wayfinding === "No" ? "High" : "—", { color: ctx.wayfinding === "No" ? C.red : C.darkGray, bold: true, width: 1900 })] }),
        new TableRow({ children: [cell("Crosswalks clearly visible & maintained", { width: 5560, bg: C.lightGray }), cell(ctx.crosswalks || "—", { width: 1900, bg: C.lightGray }), cell(ctx.crosswalks === "No" ? "High" : "—", { color: ctx.crosswalks === "No" ? C.red : C.darkGray, bold: true, width: 1900, bg: C.lightGray })] }),
        new TableRow({ children: [cell("Vehicle speeds appropriate for school zone", { width: 5560 }), cell(ctx.vehicleSpeeds || "—", { width: 1900 }), cell(ctx.vehicleSpeeds === "No" ? "Critical" : "—", { color: ctx.vehicleSpeeds === "No" ? C.red : C.darkGray, bold: true, width: 1900 })] }),
        new TableRow({ children: [cell("Crossing guard at high-volume intersections", { width: 5560, bg: C.lightGray }), cell(ctx.crossingGuard || "—", { width: 1900, bg: C.lightGray }), cell(ctx.crossingGuard === "No" ? "High" : "—", { color: ctx.crossingGuard === "No" ? C.red : C.darkGray, bold: true, width: 1900, bg: C.lightGray })] }),
        new TableRow({ children: [cell("School zone speed limit signs visible", { width: 5560 }), cell(ctx.schoolZoneSigns || "—", { width: 1900 }), cell(ctx.schoolZoneSigns === "No" ? "High" : "—", { color: ctx.schoolZoneSigns === "No" ? C.red : C.darkGray, bold: true, width: 1900 })] }),
        new TableRow({ children: [cell("Drop-off/pick-up zone causing pedestrian conflict", { width: 5560, bg: C.lightGray }), cell(ctx.dropOffConflict || "—", { width: 1900, bg: C.lightGray }), cell(ctx.dropOffConflict === "Yes" ? "Medium" : "—", { color: ctx.dropOffConflict === "Yes" ? C.amber : C.darkGray, bold: true, width: 1900, bg: C.lightGray })] }),
        new TableRow({ children: [cell("Pedestrian generators along route", { width: 5560 }), cell(ctx.pedestrianGenerators || "—", { width: 1900 }), cell("Note", { width: 1900 })] }),
      ],
    }),
    ...(ctx.crashDetails ? [spacer(80), body("Critical Flag:", { bold: true, color: C.red }), bullet(ctx.crashDetails)] : []),
    ...(llm.criticalFlags.length > 0 ? [spacer(80), body("⚠ Critical Flags — Immediate Attention Required:", { bold: true, color: C.red }), ...llm.criticalFlags.map((f) => bullet(f))] : []),
    ...(ctx.pedestrianGeneratorDetails ? [spacer(80), body("Pedestrian generators along route:", { bold: true }), bullet(ctx.pedestrianGeneratorDetails)] : []),
    ...(ctx.wayfindingLocations ? [spacer(80), body("Suggested wayfinding sign locations:", { bold: true }), bullet(ctx.wayfindingLocations)] : []),
    ...(ctx.additionalTrafficNotes ? [spacer(80), body("Additional Observations:", { bold: true }), bullet(ctx.additionalTrafficNotes)] : []),

    spacer(),

    sectionHeading("Top 3 Priority Concerns (Coordinator Summary)"),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [800, 7160, 1400],
      rows: [
        new TableRow({ children: [headerCell("#", 800), headerCell("Concern", 7160), headerCell("Severity", 1400)] }),
        ...llm.topConcerns.map((c, i) => {
          const isEven = i % 2 === 1;
          const bg = isEven ? C.lightGray : C.white;
          const sevColor = c.severity === "Critical" ? C.red : c.severity === "High" ? C.amber : C.darkGray;
          return new TableRow({ children: [
            cell(String(i + 1), { bold: true, align: AlignmentType.CENTER, width: 800, bg }),
            cell(c.concern, { width: 7160, bg }),
            cell(c.severity, { bold: true, color: sevColor, width: 1400, bg }),
          ]});
        }),
      ],
    }),

    spacer(),

    sectionHeading("Recommended Actions"),
    body("Immediate (0–3 months):", { bold: true }),
    ...llm.immediateActions.map((a) => bullet(a)),
    spacer(80),
    body("Short-Term (3–6 months):", { bold: true }),
    ...llm.shortTermActions.map((a) => bullet(a)),
    spacer(80),
    body("Long-Term / Project Candidates:", { bold: true }),
    ...llm.longTermActions.map((a) => bullet(a)),

    spacer(),

    ...photoGallery(photos, "Site Photos"),

    spacer(),
    body("Report prepared by SRTS Walkability Audit System  |  For internal DOMI use only", { italic: true, color: C.medGray }),
  ];

  return toBuffer(new Document({
    numbering, styles,
    sections: [{
      ...pageLayout,
      headers: { default: makeHeader("Walkability Audit — DOMI Internal Report", `${ctx.school}  |  ${ctx.dateDisplay}  |  Confidential`) },
      footers: { default: makeFooter(ctx.dateDisplay) },
      children,
    }],
  }));
}

// ════════════════════════════════════════════════════════════════════════════════
// 2. School & Community Partner Report
// ════════════════════════════════════════════════════════════════════════════════

export async function buildSchoolCommunityReport(ctx: AuditContext, llm: SchoolCommunityContent, photos: ReportPhoto[] = [], mapImage: Uint8Array | null = null): Promise<ArrayBuffer> {
  const children = [

    coverBlock(
      C.accentBlue,
      "WALKABILITY AUDIT SUMMARY",
      "For School & Community Partners",
      `${ctx.school}  |  ${ctx.dateDisplay}`,
      "BDD7EE",
    ),

    spacer(200),

    sectionHeading("About This Audit"),
    body(llm.aboutNarrative),

    spacer(),

    sectionHeading("Route Walked"),
    body(ctx.routeDescription || "Route details not recorded."),
    spacer(100),
    ...mapBlock(mapImage, ctx.routeDescription || ""),

    spacer(),

    sectionHeading("How Students Get to School"),
    body("Based on information provided by school staff:"),
    spacer(80),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [4680, 4680],
      rows: [
        new TableRow({ children: [headerCell("Mode of Transportation", 4680), headerCell("Approximate % of Students", 4680)] }),
        new TableRow({ children: [cell("Walking", { width: 4680 }), cell(ctx.modeWalk || "—", { width: 4680, bold: true })] }),
        new TableRow({ children: [cell("School Bus", { width: 4680, bg: C.lightGray }), cell(ctx.modeBus || "—", { width: 4680, bg: C.lightGray })] }),
        new TableRow({ children: [cell("Biking", { width: 4680 }), cell(ctx.modeBike || "—", { width: 4680 })] }),
        new TableRow({ children: [cell("Public Transportation", { width: 4680, bg: C.lightGray }), cell(ctx.modeTransit || "—", { width: 4680, bg: C.lightGray })] }),
        new TableRow({ children: [cell("Dropped off by parents", { width: 4680 }), cell(ctx.modeDropOff || "—", { width: 4680 })] }),
      ],
    }),
    spacer(100),
    body("With the majority of students walking, safe and accessible routes are essential to the daily school experience."),

    spacer(),

    sectionHeading("What We Found"),
    sectionHeading("Areas of Concern", HeadingLevel.HEADING_2),
    ...llm.areasOfConcern.map((a) => bullet(a)),
    spacer(80),
    sectionHeading("What Parents and Students Have Reported", HeadingLevel.HEADING_2),
    body("School staff indicated that families have raised specific concerns about:"),
    body(llm.parentConcernsSummary),
    ...(ctx.parentConcernDetails ? [bullet(ctx.parentConcernDetails)] : []),

    spacer(),

    sectionHeading("What Happens Next"),
    body("The findings from this audit will be shared with DOMI bureaus responsible for traffic, planning, and infrastructure. Some of the actions being considered include:"),
    spacer(80),
    ...llm.whatHappensNext.map((s) => bullet(s)),
    spacer(80),
    body("SRTS will follow up with the school as plans develop. If you have additional concerns or observations, please contact:"),
    spacer(80),
    contactBlock(
      `${ctx.coordinator || "SRTS Program Coordinator"} — SRTS Program Coordinator`,
      ctx.auditorEmail || "srts@pittsburghpa.gov",
      "Department of Mobility and Infrastructure, City of Pittsburgh",
      C.lightBlue,
      C.domiBlue,
    ),

    spacer(),

    ...photoGallery(photos, "Photos from the Audit"),

    spacer(),
    body("Thank you to all participants — school staff, city representatives, and community members — who took part in making this audit possible.", { italic: true, color: C.medGray }),
  ];

  return toBuffer(new Document({
    numbering, styles,
    sections: [{
      ...pageLayout,
      headers: { default: makeHeader("Walkability Audit Summary — School & Community Partner", `${ctx.school}  |  ${ctx.dateDisplay}`) },
      footers: { default: makeFooter(ctx.dateDisplay) },
      children,
    }],
  }));
}

// ════════════════════════════════════════════════════════════════════════════════
// 3. Public Community Update
// ════════════════════════════════════════════════════════════════════════════════

export async function buildPublicReport(ctx: AuditContext, llm: PublicContent, photos: ReportPhoto[] = [], mapImage: Uint8Array | null = null): Promise<ArrayBuffer> {
  const children = [

    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [9360],
      rows: [new TableRow({ children: [new TableCell({
        borders: noBorders,
        width: { size: 9360, type: WidthType.DXA },
        shading: { fill: C.green, type: ShadingType.CLEAR },
        margins: { top: 400, bottom: 400, left: 400, right: 400 },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [
            new TextRun({ text: "SAFE ROUTES TO SCHOOL", font: "Arial", size: 44, bold: true, color: C.white }),
          ]}),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80 }, children: [
            new TextRun({ text: "Walkability Audit — Community Update", font: "Arial", size: 24, color: "C6EFCE" }),
          ]}),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80 }, children: [
            new TextRun({ text: `${ctx.school}  |  ${ctx.dateDisplay}`, font: "Arial", size: 22, color: C.white }),
          ]}),
        ],
      })]})],
    }),

    spacer(200),

    sectionHeading("About the Program"),
    body(llm.programBlurb),

    spacer(),

    sectionHeading("This Audit at a Glance"),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [3120, 3120, 3120],
      rows: [new TableRow({ children: [
        new TableCell({
          borders, width: { size: 3120, type: WidthType.DXA },
          shading: { fill: C.lightGreen, type: ShadingType.CLEAR },
          margins: { top: 200, bottom: 200, left: 150, right: 150 },
          children: [
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: ctx.school, font: "Arial", size: 28, bold: true, color: C.green })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "School Audited", font: "Arial", size: 20, color: C.darkGray })] }),
          ],
        }),
        new TableCell({
          borders, width: { size: 3120, type: WidthType.DXA },
          shading: { fill: C.lightBlue, type: ShadingType.CLEAR },
          margins: { top: 200, bottom: 200, left: 150, right: 150 },
          children: [
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: ctx.modeWalk || "—", font: "Arial", size: 44, bold: true, color: C.accentBlue })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Students Walk to School", font: "Arial", size: 20, color: C.darkGray })] }),
          ],
        }),
        new TableCell({
          borders, width: { size: 3120, type: WidthType.DXA },
          shading: { fill: C.lightAmber, type: ShadingType.CLEAR },
          margins: { top: 200, bottom: 200, left: 150, right: 150 },
          children: [
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: ctx.overallSeverity || "—", font: "Arial", size: 36, bold: true, color: C.amber })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Overall Severity", font: "Arial", size: 20, color: C.darkGray })] }),
          ],
        }),
      ]})],
    }),

    spacer(),

    sectionHeading("Route Walked"),
    body(ctx.routeDescription || "Route details not recorded."),
    spacer(100),
    ...mapBlock(mapImage, ctx.routeDescription || ""),

    spacer(),

    sectionHeading("Key Findings"),
    body(`The audit team identified several conditions affecting pedestrian safety for ${ctx.school} students:`),
    spacer(80),
    ...llm.keyFindings.map((f) => bullet(f)),

    spacer(),

    sectionHeading("Next Steps"),
    body("Findings from this audit have been shared with DOMI's planning and traffic teams for review."),
    spacer(80),
    ...llm.nextSteps.map((s) => bullet(s)),
    spacer(80),
    body("SRTS conducts walkability audits across Pittsburgh Public Schools on an ongoing basis. To learn more or request an audit for your school, contact:"),
    spacer(80),
    contactBlock(
      `${ctx.coordinator || "SRTS Program Coordinator"} — SRTS Program Coordinator`,
      ctx.auditorEmail || "srts@pittsburghpa.gov",
      "Department of Mobility & Infrastructure, City of Pittsburgh",
      C.lightGreen,
      C.green,
    ),

    spacer(),

    ...photoGallery(photos, "Photos from the Audit"),
  ];

  return toBuffer(new Document({
    numbering, styles,
    sections: [{
      ...pageLayout,
      headers: { default: makeHeader("Safe Routes to School — Community Update", `${ctx.school}  |  ${ctx.dateDisplay}  |  Public`) },
      footers: { default: makeFooter(ctx.dateDisplay) },
      children,
    }],
  }));
}
