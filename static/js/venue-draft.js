import { InvalidSubmission, publicUrl, validatePayload, TOPICS, KINDS } from "./venue-validation.js";

const lengths = { name: 80, description: 240, date: 100, place: 120, timezone: 64 };
const minuteWarning = "Deadline times use the form's minute precision. Check the exact time on the source page.";
const secondPrecision = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:[0-5]\d$/;

export const draftSchema = {
  type: "object", additionalProperties: false,
  properties: {
    ...Object.fromEntries(Object.keys(lengths).map(key => [key, { anyOf: [{ type: "string" }, { type: "null" }] }])),
    year: { anyOf: [{ type: "integer" }, { type: "null" }] },
    deadline: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
    tags: { type: "array", items: { type: "string", enum: [...TOPICS, ...KINDS] } },
  },
  required: [...Object.keys(lengths), "year", "deadline", "tags"],
};

export function normalizeDraft(raw, source, year = new Date().getUTCFullYear()) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(key => !Object.hasOwn(draftSchema.properties, key))) throw new InvalidSubmission("The parser returned an invalid draft. Use the manual form.");
  const base = { name: "Draft", year: year + 1, link: source, date: "TBA", place: "TBA", deadline: ["TBA"], timezone: "Etc/GMT+12", tags: ["SEC", "CONF"] };
  const draft = { link: source, source };
  let reducedPrecision = false;
  try {
    for (const field of [...Object.keys(lengths), "year"]) {
      const value = raw[field];
      draft[field] = value === null || value === undefined || value === "" ? null : value;
    }
    if (raw.deadline != null && (!Array.isArray(raw.deadline) || raw.deadline.length > 8)) throw new Error("invalid deadlines");
    // A date without its year or timezone is unsafe to turn into a countdown.
    draft.deadline = raw.deadline?.length && draft.year && draft.timezone ? raw.deadline : null;
    if (draft.deadline) draft.deadline = draft.deadline.map(value => {
      if (typeof value !== "string" || !secondPrecision.test(value)) return value;
      reducedPrecision = true;
      return value.slice(0, 16);
    });
    if (!Array.isArray(raw.tags) || raw.tags.length > 11 || new Set(raw.tags).size !== raw.tags.length || raw.tags.some(tag => ![...TOPICS, ...KINDS].includes(tag))) throw new Error("invalid tags");
    draft.tags = raw.tags;
    const candidate = { ...base, ...Object.fromEntries([...Object.keys(lengths), "year", "deadline"].filter(field => draft[field] != null).map(field => [field, draft[field]])), tags: [...draft.tags] };
    if (!candidate.tags.some(tag => TOPICS.includes(tag))) candidate.tags.push("SEC");
    if (!candidate.tags.some(tag => KINDS.includes(tag))) candidate.tags.push("CONF");
    // Validate known facts once. Placeholder values stay inside this check;
    // they are never returned as extracted facts or written into the form.
    validatePayload({ schemaVersion: 1, source, venue: candidate }, year);
  } catch { throw new InvalidSubmission("The parser could not produce safe venue fields. Use the manual form."); }
  const missingFields = ["name", "year", "date", "place", "deadline", "timezone"].filter(field => draft[field] == null);
  if (!draft.tags.some(tag => TOPICS.includes(tag))) missingFields.push("research domain");
  if (!draft.tags.some(tag => KINDS.includes(tag))) missingFields.push("publication type");
  return { draft, missingFields, warnings: reducedPrecision ? [minuteWarning] : [] };
}

export function readDraft(result) {
  const draft = result?.draft;
  if (!draft || typeof draft !== "object" || Array.isArray(draft) || Object.keys(draft).some(key => ![...Object.keys(draftSchema.properties), "link", "source"].includes(key))) throw new InvalidSubmission("The service returned an invalid draft. Use the manual form.");
  publicUrl(draft.source, "source");
  if (draft.link !== draft.source) throw new InvalidSubmission("The draft source did not match its website.");
  const facts = Object.fromEntries(Object.keys(draftSchema.properties).filter(key => key in draft).map(key => [key, draft[key]]));
  const normalized = normalizeDraft(facts, draft.source);
  // Only show our fixed precision notice, never arbitrary model instructions.
  if (Array.isArray(result.warnings) && result.warnings.includes(minuteWarning)) normalized.warnings = [minuteWarning];
  return normalized;
}
