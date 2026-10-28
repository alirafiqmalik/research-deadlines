# Contributing to Research Deadlines

## Add or correct a venue

Use **Add Venue** on the [tracker](https://alihamzamalik.me/research-deadlines/) to create a proposal. You can enter the details manually or start from a public call-for-papers URL. Check every suggested field against the organizer's website before submitting.

For a direct pull request:

1. Read the [scope and data format](docs/data-format.md).
2. Edit `_data/conferences.yml`. Update an existing edition when appropriate instead of adding a duplicate.
3. Link the official call for papers in your PR and explain any uncertain dates.
4. Run `python3 -m unittest discover -s tests -v` and inspect the local preview.

Keep automatically discovered candidates in `_data/conferences_extra.yml` until verified. That file does not feed the public tracker or calendars.

## Change the code

Follow the [local setup](README.md#run-locally). Run `make test` and `make check` for submission-service changes, and `npm run test:ui --prefix backend` for interface changes. Build the site with `make build` for Jekyll or calendar changes.

Keep pull requests focused, describe the visible behavior, and include the checks you ran. Include a screenshot for visual changes. Follow the existing Python, JavaScript, Liquid, and YAML conventions; avoid adding a build framework for a small change.

## Refresh the README screenshot

Start `make preview`, then run `node backend/scripts/capture-readme.mjs` in another terminal after installing the backend dependencies and Chromium. The capture uses the real rendered page with a fixed viewport and UTC timezone. Review the image before committing it.
