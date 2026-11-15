# Should the team adopt a monorepo?

## The case for it

A single repository makes cross-package changes atomic, so a breaking API change and its callers land in one review. It also lets every package share one lint and test setup.

## The costs

Builds get slower as the repository grows, unless the build tool caches results per package. Access control is coarser: you cannot easily hide one package from a contractor. Moving the history of twelve repositories takes about two weeks of one engineer's time.

## Limitations of this analysis

This comparison assumes the packages are released together; it does not hold for libraries that ship on their own schedule. However, the caching argument only applies if the CI runners keep a shared cache, which ours do not today.

## Recommendation

Adopt the monorepo for the four web packages only, and revisit the mobile apps in Q3 once a shared cache exists.
