# Venue data reference

The public tracker and calendars read [`_data/conferences.yml`](../_data/conferences.yml). Discovered candidates stay in [`_data/conferences_extra.yml`](../_data/conferences_extra.yml) until reviewed.

## Scope

Research topics include security, privacy, cryptography, post-quantum cryptography, quantum computing, formal methods, and AI/ML. A proposed academic venue should have a public call for papers, submission instructions, an identifiable review process, and a clear publication plan. Link the organizer's source in your pull request.

Update an existing venue edition where appropriate instead of adding a duplicate. New or changed records are checked by the [Python validator](../scripts/venue_validation.py), including records submitted through manual pull requests.

## Example record

This record uses details from the tracked MLSys edition. Check the organizer's current announcement before proposing changes.

```yaml
- name: MLSys
  description: Conference on Machine Learning and Systems
  year: 2027
  link: https://mlsys.org/Conferences/2027
  deadline: ["2026-10-30 12:00"]
  timezone: America/Los_Angeles
  date: June 21-25, 2027
  place: Bellevue, Washington, USA
  tags: [AI, CONF]
```

## Fields accepted for submissions

| Field | Required | Rules |
| --- | --- | --- |
| `name` | Yes | Short venue name, up to 80 characters; start with a letter or digit. |
| `year` | Yes | Integer: the current UTC year or one of the next five years. |
| `link` | Yes | Public HTTPS organizer URL, up to 400 characters. |
| `deadline` | Yes | One to eight unique strings in `YYYY-MM-DD HH:mm` format, or `["TBA"]` alone. |
| `timezone` | Yes | Recognized IANA timezone; explicitly use `Etc/GMT+12` for Anywhere on Earth. |
| `date` | Yes | Event dates as text, up to 100 characters; use `TBA` when unannounced. |
| `place` | Yes | Event location as text, up to 120 characters; use `TBA` when unannounced. |
| `tags` | Yes | Include a research topic and a publication type; at most one ranking. |
| `description` | No | Longer venue name or description, up to 240 characters. |
| `comment` | No | Submission notes, up to 600 characters. |
| `dblp` | No | HTTPS URL on `dblp.org`, up to 400 characters. |

Text fields must be nonempty when supplied, with no surrounding whitespace, HTML, Liquid templates, or control characters. URLs must use public domain names and HTTPS without embedded login details or custom ports. No additional fields are accepted.

## Tags

| Category | Accepted values |
| --- | --- |
| Research topic | `SEC`, `CRYPTO`, `PQC`, `QUANTUM`, `FORMAL`, `AI` |
| Publication type | `CONF`, `WORKSHOP`, `TUTORIAL`, `POSTER`, `TOOLS` |
| Ranking (optional) | `TOP4`, `CORE-A`, `CORE-B`, `CORE-C`, `OTHERS` |

Use unique tags, between two and twelve total. The displayed labels are configured in [`_data/filters.yml`](../_data/filters.yml). Verify rankings independently; the URL draft service does not infer them.

## Deadlines and timezones

Always use a list, even for one deadline. Numeric deadline years must fall between the venue year minus two and the venue year, inclusive. Multiple submission rounds use separate entries:

```yaml
deadline: ["2026-10-31 23:59", "2027-02-28 23:59"]
timezone: Etc/GMT+12
```

Use `["TBA"]` by itself until dates are announced. These records remain visible on the tracker and do not create calendar events. The tracker displays deadlines in each visitor's local time. Its countdown keeps times ending in `:00` exact and counts through the last second of a minute ending in `:59`.

| Meaning | IANA timezone |
| --- | --- |
| Anywhere on Earth (UTC−12) | `Etc/GMT+12` |
| UTC | `Etc/UTC` |
| US Pacific, including daylight saving changes | `America/Los_Angeles` |
| US Eastern, including daylight saving changes | `America/New_York` |
| Fixed UTC−8 | `Etc/GMT+8` |
| Fixed UTC+7 | `Etc/GMT-7` |

The sign in `Etc/GMT` names is inverted. Prefer a regional timezone when the organizer follows daylight saving time.

## Legacy data

Older records may omit `timezone`; the renderer defaults them to Anywhere on Earth. New or changed records must provide it explicitly to pass validation.

The renderer also recognizes `%y` and `%Y` year placeholders in legacy records. The tracker substitutes the venue year, while calendar templates substitute the build year. These placeholders are not accepted for new or changed records. Use explicit numeric years so tracker and calendar dates agree.
