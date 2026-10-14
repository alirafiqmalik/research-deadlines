import { InvalidSubmission, publicUrl, validatePayload, TOPICS, KINDS } from "./venue-validation.js";

const lengths = { name: 80, description: 240, date: 100, place: 120, timezone: 64 };

export const draftSchema = {
  type: "object", additionalProperties: false,
  properties: {
    ...Object.fromEntries(Object.entries(lengths).map(([key, maxLength]) => [key, { type: ["string", "null"], maxLength }])),
    year: { type: ["integer", "null"] },
    deadline: { type: ["array", "null"], maxItems: 8, items: { type: "string" } },
    tags: { type: "array", maxItems: 11, uniqueItems: true, items: { type: "string", enum: [...TOPICS, ...KINDS] } },
  },
  required: [...Object.keys(lengths), "year", "deadline", "tags"],
};

export function normalizeDraft(raw, source, year = new Date().getUTCFullYear()) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(key => !Object.hasOwn(draftSchema.properties, key))) throw new InvalidSubmission("The parser returned an invalid draft. Use the manual form.");
  const base = { name: "Draft", year: year + 1, link: source, date: "TBA", place: "TBA", deadline: ["TBA"], timezone: "Etc/GMT+12", tags: ["SEC", "CONF"] };
  const draft = { link: source, source };
  try {
    for (const field of [...Object.keys(lengths), "year"]) {
      const value = raw[field];
      draft[field] = value === null || value === undefined || value === "" ? null : validatePayload({ schemaVersion: 1, source, venue: { ...base, [field]: value } }, year).venue[field];
    }
    if (raw.deadline != null && (!Array.isArray(raw.deadline) || raw.deadline.length > 8)) throw new Error("invalid deadlines");
    // A date without its year or timezone is unsafe to turn into a countdown.
    draft.deadline = raw.deadline?.length && draft.year && draft.timezone ? validatePayload({ schemaVersion: 1, source, venue: { ...base, year: draft.year, timezone: draft.timezone, deadline: raw.deadline } }, year).venue.deadline : null;
    if (!Array.isArray(raw.tags) || raw.tags.length > 11 || new Set(raw.tags).size !== raw.tags.length || raw.tags.some(tag => ![...TOPICS, ...KINDS].includes(tag))) throw new Error("invalid tags");
    draft.tags = raw.tags;
  } catch { throw new InvalidSubmission("The parser could not produce safe venue fields. Use the manual form."); }
  const missingFields = ["name", "year", "date", "place", "deadline", "timezone"].filter(field => draft[field] == null);
  if (!draft.tags.some(tag => TOPICS.includes(tag))) missingFields.push("research domain");
  if (!draft.tags.some(tag => KINDS.includes(tag))) missingFields.push("publication type");
  return { draft, missingFields };
}

export function readDraft(result) {
  const draft = result?.draft;
  if (!draft || typeof draft !== "object" || Array.isArray(draft) || Object.keys(draft).some(key => ![...Object.keys(draftSchema.properties), "link", "source"].includes(key))) throw new InvalidSubmission("The service returned an invalid draft. Use the manual form.");
  publicUrl(draft.source, "source");
  if (draft.link !== draft.source) throw new InvalidSubmission("The draft source did not match its website.");
  const facts = Object.fromEntries(Object.keys(draftSchema.properties).filter(key => key in draft).map(key => [key, draft[key]]));
  return normalizeDraft(facts, draft.source);
}
