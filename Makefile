.PHONY: version-update

version-update:
	node scripts/version-update.mjs $(or $(BUMP),patch)
