import type { ArcGISFeature } from "./arcgis";
import { formatSurveyDate } from "./arcgis";

/** Cleaned-up view of one audit, combining pre + post survey data. */
export type AuditContext = {
  // Identity
  school: string;
  address: string;
  dateDisplay: string;
  time: string;
  weather: string;
  coordinator: string;
  auditorEmail: string;
  role: string;
  schoolContact: string;
  schoolContactEmail: string;
  initiatedBy: string;
  previousAudit: string;
  routeDescription: string;
  preExistingConcerns: string;

  // Mode split (from pre-survey / school role)
  modeWalk: string;
  modeBike: string;
  modeTransit: string;
  modeBus: string;
  modeDropOff: string;
  studentCount: string;
  designatedRoutes: string;
  mainConcerns: string;
  landmarks: string;
  parentConcerns: string;
  parentConcernDetails: string;

  // Infrastructure (planner role – post survey)
  adaSignage: string;
  vegetationBlocking: string;
  poolingWater: string;
  immediateHazards: string;
  trippingHazards: string;
  sidewalkGaps: string;
  grantOpportunities: string;
  nearbyConstruction: string;
  constructionDetails: string;
  additionalInfrastructureNotes: string;

  // Traffic (traffic role – post survey)
  conflictingSignage: string;
  wayfinding: string;
  trafficConditions: string;
  crashHistory: string;
  crashDetails: string;
  crosswalks: string;
  vehicleSpeeds: string;
  crossingGuard: string;
  schoolZoneSigns: string;
  dropOffConflict: string;
  pedestrianGenerators: string;
  pedestrianGeneratorDetails: string;
  additionalTrafficNotes: string;

  // Infrastructure extras
  grantDetails: string;
  designatedRouteDetails: string;

  // Traffic extras
  wayfindingLocations: string;

  // Summary
  topConcern1: string;
  topConcern2: string;
  topConcern3: string;
  overallSeverity: string;
  safetyRating: string;
  comfortableLetChild: string;
  comfortDetails: string;
  additionalNotes: string;
  additionalComments: string;
  participantsPresent: string;
  participantsMissing: string;
};

type Attrs = Record<string, string | number | null>;

/**
 * Search multiple attribute objects for the first non-empty value of `field`.
 * This handles surveys where multiple records exist per audit (one per role),
 * each record filling different fields.
 */
function str(sources: Attrs[], field: string): string {
  for (const attrs of sources) {
    const v = attrs[field];
    if (v === null || v === undefined) continue;
    if (typeof v === "number") {
      if (field.toLowerCase().includes("date") && v > 1_000_000_000_000) {
        return new Date(v).toLocaleDateString("en-US", {
          year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
        });
      }
      return String(v);
    }
    const s = String(v).trim();
    if (s && s !== "null" && s !== "undefined") return s;
  }
  return "";
}

/**
 * Returns the attributes of the SRTS Coordinator's post-survey record.
 * Falls back to the first post record if no coordinator role is found.
 * The coordinator record is prioritised for identity fields (name, email, time)
 * because they are the lead auditor who organised the walkthrough.
 */
function findCoordinator(postFeatures: ArcGISFeature[]): Attrs {
  const COORD_ROLES = ["srts coordinator", "srts staff", "domi staff", "coordinator"];
  const found = postFeatures.find((f) => {
    const role = String(f.attributes["what_is_your_role_today"] ?? "").toLowerCase().trim();
    return COORD_ROLES.some((r) => role.includes(r));
  });
  return (found ?? postFeatures[0])?.attributes as Attrs ?? {};
}

export function buildAuditContext(
  school: string,
  surveyDate: string,
  preFeatures: ArcGISFeature[],
  postFeatures: ArcGISFeature[],
): AuditContext {
  // Each role (coordinator, planner, traffic) submits a separate post-survey
  // record. Merge them all so every field is found regardless of which record
  // it lives in.
  const post: Attrs[] = postFeatures.map((f) => f.attributes as Attrs);
  const pre: Attrs[] = preFeatures.map((f) => f.attributes as Attrs);

  // pre-survey fields are checked after post in case the same field appears in both
  const all = [...post, ...pre];

  // Put the coordinator record first so identity fields resolve to the right person
  const coord = findCoordinator(postFeatures);
  const coordFirst: Attrs[] = [coord, ...post];

  return {
    school: school || str(post, "field_103") || str(pre, "which_school_is_this_audit_for"),
    address: str(post, "school_address"),
    dateDisplay: str(post, "date_of_audit") || formatSurveyDate(surveyDate),
    time: str(coordFirst, "time_of_audit"),
    weather: str(coordFirst, "weather_conditions"),
    coordinator: str(coordFirst, "what_is_your_full_name"),
    auditorEmail: str(coordFirst, "whats_your_email_address"),
    role: str(coordFirst, "what_is_your_role_today"),
    schoolContact: str(post, "school_contact_name"),
    schoolContactEmail: str(post, "school_contact_emailphone"),
    initiatedBy: str(post, "was_this_audit_initiated_by"),
    previousAudit: str(post, "has_this_school_been_audited_be"),
    routeDescription: str(post, "audit_route_description"),
    preExistingConcerns: str(post, "any_pre_existing_known_concerns"),

    modeWalk: str(all, "approx_of_students_who_walk"),
    modeBike: str(all, "approx_of_students_who_bike"),
    modeTransit: str(all, "approx_using_public_transportat"),
    modeBus: str(all, "approx_taking_the_school_bus"),
    modeDropOff: str(all, "approx_dropped_off_by_parents"),
    studentCount: str(pre, "how_many_students_attend_this_s"),
    designatedRoutes: str(all, "are_designated_walking_routes_c"),
    mainConcerns: str(all, "what_are_your_main_concerns_reg"),
    landmarks: str(all, "what_are_the_notable_public_sit"),
    parentConcerns: str(all, "have_parents_or_students_report"),
    parentConcernDetails: str(all, "if_yes_describe"),

    adaSignage: str(post, "is_ada_compliant_signage_consis"),
    vegetationBlocking: str(post, "is_landscaping_or_vegetation_bl"),
    poolingWater: str(post, "is_there_pooling_water_at_curb"),
    immediateHazards: str(post, "are_manhole_covers_obstructing"),
    trippingHazards: str(post, "are_there_tripping_hazards_grea"),
    sidewalkGaps: str(post, "are_there_critical_gaps_where_s"),
    grantOpportunities: str(post, "are_there_existing_grant_opport"),
    grantDetails: str(post, "if_yes_specify"),
    nearbyConstruction: str(post, "are_there_any_proposed_or_activ"),
    constructionDetails: str(post, "field_94"),
    additionalInfrastructureNotes: str(post, "field_43"),

    conflictingSignage: str(post, "is_there_any_conflicting_or_unc"),
    wayfinding: str(post, "is_wayfinding_signage_present_f"),
    wayfindingLocations: str(post, "where_along_this_route_can_way"),
    trafficConditions: str(post, "are_there_noticeable_difference"),
    crashHistory: str(post, "are_there_known_crash_history_c"),
    crashDetails: str(post, "if_yes_please_specify_details"),
    crosswalks: str(post, "are_crosswalks_clearly_visible"),
    vehicleSpeeds: str(post, "are_vehicle_speeds_appropriate"),
    crossingGuard: str(post, "is_a_crossing_guard_present_at"),
    schoolZoneSigns: str(post, "are_school_zone_speed_limit_sig"),
    dropOffConflict: str(post, "is_the_school_drop_offpick_up_z"),
    pedestrianGenerators: str(post, "are_there_pedestrian_generators"),
    pedestrianGeneratorDetails: str(post, "field_89"),
    additionalTrafficNotes: str(post, "additional_notes_and_observatio"),

    designatedRouteDetails: str(all, "if_yes_please_specify"),

    topConcern1: str(all, "top_concern_1_from_todays_audit"),
    topConcern2: str(all, "top_concern_2_from_todays_audit"),
    topConcern3: str(all, "top_concern_3_from_todays_audit"),
    overallSeverity: str(all, "overall_severity_of_issues_obse"),
    safetyRating: str(all, "do_you_think_a_student_would_fe"),
    comfortableLetChild: str(all, "would_you_feel_comfortable_lett"),
    comfortDetails: str(all, "field_96"),
    additionalNotes: str(all, "additional_notes"),
    additionalComments: str(all, "any_additional_comments_or_obse"),
    participantsPresent: str(post, "were_all_expected_participants"),
    participantsMissing: str(post, "if_not_who_was_missing"),
  };
}

/** Format an AuditContext as a readable text block for LLM prompts. */
export function contextToPromptText(c: AuditContext): string {
  const line = (label: string, val: string) =>
    val ? `${label}: ${val}` : null;

  return [
    "=== AUDIT IDENTITY ===",
    line("School", c.school),
    line("Address", c.address),
    line("Date", c.dateDisplay),
    line("Time", c.time),
    line("Weather", c.weather),
    line("Coordinator", c.coordinator),
    line("Role", c.role),
    line("School Contact", c.schoolContact),
    line("Audit initiated by", c.initiatedBy),
    line("Previous audit conducted", c.previousAudit),
    "",
    "=== ROUTE ===",
    line("Route description", c.routeDescription),
    line("Pre-existing known concerns", c.preExistingConcerns),
    "",
    "=== MODE SPLIT (school data) ===",
    line("Students who walk", c.modeWalk),
    line("Students who bike", c.modeBike),
    line("Public transit", c.modeTransit),
    line("School bus", c.modeBus),
    line("Dropped off by parents", c.modeDropOff),
    line("Approximate student enrollment", c.studentCount),
    line("Designated walking routes established", c.designatedRoutes),
    "",
    "=== PRE-AUDIT CONTEXT ===",
    line("Main concerns before audit", c.mainConcerns),
    line("Notable landmarks", c.landmarks),
    line("Parent/student safety concerns reported", c.parentConcerns),
    line("Details", c.parentConcernDetails),
    "",
    "=== INFRASTRUCTURE FINDINGS ===",
    line("ADA-compliant signage consistently present", c.adaSignage),
    line("Vegetation blocking sidewalks", c.vegetationBlocking),
    line("Pooling water at curb ramps", c.poolingWater),
    line("Immediate hazards (manhole, debris)", c.immediateHazards),
    line("Tripping hazards > 1 inch", c.trippingHazards),
    line("Critical sidewalk gaps", c.sidewalkGaps),
    line("Grant opportunities tied to findings", c.grantOpportunities),
    line("Grant opportunity details", c.grantDetails),
    line("Nearby active/proposed construction", c.nearbyConstruction),
    line("Construction details", c.constructionDetails),
    line("Additional infrastructure notes", c.additionalInfrastructureNotes),
    "",
    "=== TRAFFIC & SAFETY FINDINGS ===",
    line("Conflicting or unclear signage", c.conflictingSignage),
    line("Wayfinding signage present for students", c.wayfinding),
    line("Suggested wayfinding locations along route", c.wayfindingLocations),
    line("Noticeable peak vs non-peak traffic difference", c.trafficConditions),
    line("Known crash history at intersections", c.crashHistory),
    line("Crash details", c.crashDetails),
    line("Crosswalks clearly visible and maintained", c.crosswalks),
    line("Vehicle speeds appropriate for school zone", c.vehicleSpeeds),
    line("Crossing guard at high-volume intersections", c.crossingGuard),
    line("School zone speed limit signs visible", c.schoolZoneSigns),
    line("Drop-off/pick-up zone causing pedestrian conflict", c.dropOffConflict),
    line("Pedestrian generators along route", c.pedestrianGenerators),
    line("Pedestrian generator details", c.pedestrianGeneratorDetails),
    line("Additional traffic notes", c.additionalTrafficNotes),
    "",
    "=== SUMMARY ===",
    line("Top concern #1", c.topConcern1),
    line("Top concern #2", c.topConcern2),
    line("Top concern #3", c.topConcern3),
    line("Overall severity of issues observed", c.overallSeverity),
    line("Student safety rating (1-5)", c.safetyRating),
    line("Comfortable letting child walk alone", c.comfortableLetChild),
    line("Comfort details / reason", c.comfortDetails),
    line("Designated route specification", c.designatedRouteDetails),
    line("Participants all present", c.participantsPresent),
    line("Missing participants", c.participantsMissing),
    line("Additional notes", c.additionalNotes),
    line("Additional comments", c.additionalComments),
  ]
    .filter((l) => l !== null)
    .join("\n");
}
