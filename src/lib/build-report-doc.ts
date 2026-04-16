import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { ArcGISFeature } from "./arcgis";

function val(
  attrs: Record<string, string | number | null>,
  field: string,
): string {
  const v = attrs[field];
  if (v === null || v === undefined || v === "") return "[ not recorded ]";
  if (typeof v === "number") {
    // ArcGIS date fields come back as epoch ms
    if (field.toLowerCase().includes("date") && v > 1_000_000_000_000) {
      return new Date(v).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }
    return String(v);
  }
  return String(v).trim() || "[ not recorded ]";
}

function heading(text: string, level: HeadingLevel = HeadingLevel.HEADING_2) {
  return new Paragraph({ text, heading: level });
}

function blank(label: string) {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true }),
      new TextRun({
        text: "____________________________________________________________",
        color: "AAAAAA",
      }),
    ],
    spacing: { after: 120 },
  });
}

function field(label: string, value: string) {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true }),
      new TextRun({ text: value }),
    ],
    spacing: { after: 80 },
  });
}

function twoColTable(rows: [string, string][]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      ([label, value]) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 45, type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: label, bold: true })],
                }),
              ],
            }),
            new TableCell({
              width: { size: 55, type: WidthType.PERCENTAGE },
              children: [new Paragraph({ text: value })],
            }),
          ],
        }),
    ),
  });
}

function spacer() {
  return new Paragraph({ text: "", spacing: { after: 160 } });
}

export async function buildReportDocx(
  school: string,
  surveyDate: string,
  preFeatures: ArcGISFeature[],
  postFeatures: ArcGISFeature[],
): Promise<Buffer> {
  const pre = preFeatures[0]?.attributes ?? {};
  const post = postFeatures[0]?.attributes ?? {};

  const displayDate = val(post, "date_of_audit") !== "[ not recorded ]"
    ? val(post, "date_of_audit")
    : surveyDate;

  const sections: (Paragraph | Table)[] = [
    // ── Cover ───────────────────────────────────────────────────────
    new Paragraph({
      text: "Safe Routes to School",
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      text: "Walk Audit Report",
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
    }),
    spacer(),
    field("School", school || "[ not recorded ]"),
    field("Date of Audit", displayDate),
    field(
      "Auditor (Post-Survey)",
      val(post, "what_is_your_full_name"),
    ),
    field("Role", val(post, "what_is_your_role_today")),
    field("Weather Conditions", val(post, "weather_conditions")),
    spacer(),

    // ── Pre-Survey Background ────────────────────────────────────────
    heading("Pre-Survey Background Information"),
    twoColTable([
      ["Approx. students who walk", val(pre, "approx_of_students_who_walk")],
      ["Approx. students who bike", val(pre, "approx_of_students_who_bike")],
      ["Approx. using public transit", val(pre, "approx_using_public_transportat")],
      ["Approx. dropped off by parents", val(pre, "approx_dropped_off_by_parents")],
      ["Approx. taking school bus", val(pre, "approx_taking_the_school_bus")],
      ["Students attending school", val(pre, "how_many_students_attend_this_s")],
      ["Designated walking routes?", val(pre, "are_designated_walking_routes_c")],
    ]),
    spacer(),
    field("Main concerns before audit", val(pre, "what_are_your_main_concerns_reg")),
    field(
      "Notable landmarks near route",
      val(pre, "what_are_the_notable_public_sit"),
    ),
    field(
      "Parents/students reported safety concerns?",
      val(pre, "have_parents_or_students_report"),
    ),
    field("Description", val(pre, "if_yes_describe")),
    spacer(),

    // ── Route Observations ───────────────────────────────────────────
    heading("Route Observations"),
    field("Audit route description", val(post, "audit_route_description")),
    spacer(),
    twoColTable([
      ["ADA-compliant signage present?", val(post, "is_ada_compliant_signage_consis")],
      ["Vegetation blocking sidewalks?", val(post, "is_landscaping_or_vegetation_bl")],
      ["Pooling water at curb ramps?", val(post, "is_there_pooling_water_at_curb")],
      ["Immediate hazards (manhole, debris)?", val(post, "are_manhole_covers_obstructing")],
      ["Tripping hazards > 1 inch?", val(post, "are_there_tripping_hazards_grea")],
      ["Critical sidewalk gaps?", val(post, "are_there_critical_gaps_where_s")],
      ["Crosswalks clearly visible?", val(post, "are_crosswalks_clearly_visible")],
      ["Vehicle speeds appropriate?", val(post, "are_vehicle_speeds_appropriate")],
      ["Crossing guard at intersections?", val(post, "is_a_crossing_guard_present_at")],
      ["School zone speed limit signs posted?", val(post, "are_school_zone_speed_limit_sig")],
      ["Drop-off zone causing pedestrian conflict?", val(post, "is_the_school_drop_offpick_up_z")],
      ["Conflicting/unclear signage?", val(post, "is_there_any_conflicting_or_unc")],
      ["Wayfinding signage for students?", val(post, "is_wayfinding_signage_present_f")],
      ["Crash history concerns?", val(post, "are_there_known_crash_history_c")],
      ["Known crash details", val(post, "if_yes_please_specify_details")],
    ]),
    spacer(),
    field("Additional notes", val(post, "field_43")),
    spacer(),

    // ── Top Concerns ────────────────────────────────────────────────
    heading("Top Concerns from Today's Audit"),
    field("Top concern #1", val(post, "top_concern_1_from_todays_audit")),
    field("Top concern #2", val(post, "top_concern_2_from_todays_audit")),
    field("Top concern #3", val(post, "top_concern_3_from_todays_audit")),
    field("Overall severity", val(post, "overall_severity_of_issues_obse")),
    spacer(),

    // ── Safety Ratings ───────────────────────────────────────────────
    heading("Safety Perception"),
    field(
      "Would a student feel safe walking this route? (1–5)",
      val(post, "do_you_think_a_student_would_fe"),
    ),
    field(
      "Comfortable letting a child walk this route alone?",
      val(post, "would_you_feel_comfortable_lett"),
    ),
    spacer(),

    // ── Narrative placeholders ───────────────────────────────────────
    heading("Summary Narrative"),
    new Paragraph({
      children: [
        new TextRun({
          text: "The following section will be completed by the LLM narrative engine once an AI provider is configured.",
          italics: true,
          color: "888888",
        }),
      ],
      spacing: { after: 160 },
    }),
    blank("Executive summary"),
    blank("Key findings"),
    blank("Priority recommendations"),
    blank("Next steps"),
    spacer(),

    // ── Additional Comments ──────────────────────────────────────────
    heading("Additional Comments"),
    field(
      "Pre-survey",
      val(pre, "any_additional_comments_or_obse"),
    ),
    field(
      "Post-survey",
      val(post, "any_additional_comments_or_obse"),
    ),
  ];

  const doc = new Document({
    sections: [
      {
        children: sections,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
