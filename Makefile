.PHONY: version-update release-prepare release-patch release-minor release-major release-push

CURRENT_BRANCH := $(shell git rev-parse --abbrev-ref HEAD)
VERSION_FILES := package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock

version-update:
	node scripts/version-update.mjs $(or $(BUMP),patch)

release-prepare:
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "Working tree is not clean. Commit/stash changes first."; \
		exit 1; \
	fi
	@$(MAKE) version-update BUMP=$(or $(BUMP),patch)
	@git add $(VERSION_FILES)
	@VERSION=$$(node -p "require('./package.json').version"); \
	git commit -m "release: v$$VERSION"; \
	git tag -a "v$$VERSION" -m "Release $$VERSION"
	@echo "Release commit created and tagged v$$(node -p 'require(\"./package.json\").version')"

release-push:
	@git push origin $(CURRENT_BRANCH)
	@LATEST_TAG=$$(git describe --tags --abbrev=0); \
	git push origin $$LATEST_TAG
	@echo "Pushed $(CURRENT_BRANCH) and tag $$(git describe --tags --abbrev=0)"

release-patch:
	@$(MAKE) release-prepare BUMP=patch
	@$(MAKE) release-push

release-minor:
	@$(MAKE) release-prepare BUMP=minor
	@$(MAKE) release-push

release-major:
	@$(MAKE) release-prepare BUMP=major
	@$(MAKE) release-push
