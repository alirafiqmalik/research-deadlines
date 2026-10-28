.PHONY: preview build test check test-ui

preview:
	python3 scripts/preview_venues.py

build:
	ruby -e 'load Gem.bin_path("jekyll", "jekyll")' -- build --disable-disk-cache

test:
	python3 -m unittest discover -s tests -v
	npm test --prefix backend

check:
	npm run check --prefix backend

test-ui:
	npm run test:ui --prefix backend
